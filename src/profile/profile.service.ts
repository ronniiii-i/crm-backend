import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { getTenantId } from '../tenant/tenant-context';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../workspace/services/audit.service';

@Injectable()
export class ProfileService {
  constructor(
    private prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** Run `fn` in the current request's tenant transaction when available. */
  private scoped<T>(
    fn: (db: Prisma.TransactionClient | PrismaService) => Promise<T>,
  ): Promise<T> {
    const tenantId = getTenantId();
    if (!tenantId) return fn(this.prisma);
    return this.prisma.withTenant(tenantId, (tx) => fn(tx));
  }

  async getProfile(userId: string) {
    const user = await this.scoped((db) =>
      db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: {
            select: {
              id: true,
              name: true,
              slug: true,
              dataScope: true,
              isTenantAdmin: true,
              rank: true,
            },
          },
          avatarUrl: true,
          isVerified: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          tenant: { select: { name: true, slug: true, status: true } },
          department: {
            select: { id: true, name: true, key: true },
          },
          managedDepartment: {
            select: { id: true, name: true, key: true },
          },
        },
      }),
    );

    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.scoped((db) =>
      db.user.findUnique({ where: { id: userId } }),
    );
    if (!user) throw new NotFoundException('User not found');

    return this.scoped((db) =>
      db.user.update({
        where: { id: userId },
        data: {
          ...(dto.name !== undefined &&
            dto.name.trim() && { name: dto.name.trim() }),
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: {
            select: {
              id: true,
              name: true,
              slug: true,
              dataScope: true,
              isTenantAdmin: true,
            },
          },
          avatarUrl: true,
          isVerified: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          tenant: { select: { name: true, slug: true, status: true } },
          department: { select: { id: true, name: true, key: true } },
          managedDepartment: { select: { id: true, name: true, key: true } },
        },
      }),
    );
  }

  /**
   * Finalize an avatar upload: the key must belong to this tenant/user, the
   * object must exist, and its content type/size are re-checked server-side
   * before the user row and audit log are updated in one transaction.
   */
  async finalizeAvatar(userId: string, tenantId: string, key: string) {
    this.storage.assertAvatarKey(tenantId, userId, key);
    const head = await this.storage.head(key);
    this.storage.assertAvatarObject(head);

    const avatarUrl = this.storage.publicUrl(key);
    let previousUrl: string | null = null;

    const result = await this.prisma.withTenant(tenantId, async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, avatarUrl: true },
      });
      if (!user) throw new NotFoundException('User not found');
      previousUrl = user.avatarUrl;

      await tx.user.update({
        where: { id: userId },
        data: { avatarUrl },
      });

      await this.audit.record(tx, null, {
        tenantId,
        actorId: userId,
        action: 'AVATAR_UPDATE',
        entity: 'user',
        entityId: userId,
        before: { avatarUrl: user.avatarUrl },
        after: { avatarUrl },
      });

      return {
        success: true,
        avatarUrl,
        user: { id: userId, avatar: avatarUrl, avatarUrl },
      };
    });

    // Replacing an avatar leaves the previous object behind; clean it up
    // without letting a storage failure fail the request.
    if (previousUrl && previousUrl !== avatarUrl) {
      void this.storage.deleteByPublicUrl(previousUrl);
    }

    return result;
  }

  async removeAvatar(userId: string, tenantId: string) {
    const result = await this.prisma.withTenant(tenantId, async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, avatarUrl: true },
      });
      if (!user) throw new NotFoundException('User not found');

      await tx.user.update({
        where: { id: userId },
        data: { avatarUrl: null },
      });

      await this.audit.record(tx, null, {
        tenantId,
        actorId: userId,
        action: 'AVATAR_UPDATE',
        entity: 'user',
        entityId: userId,
        before: { avatarUrl: user.avatarUrl },
        after: { avatarUrl: null },
      });

      return user.avatarUrl;
    });

    // The row change is authoritative; object deletion is best effort.
    void this.storage.deleteByPublicUrl(result);

    return {
      success: true,
      avatarUrl: null,
      user: { id: userId, avatar: null, avatarUrl: null },
    };
  }
}
