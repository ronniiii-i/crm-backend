import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { getTenantId } from '../tenant/tenant-context';

@Injectable()
export class ProfileService {
  constructor(private prisma: PrismaService) {}

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
          createdAt: true,
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
          ...(dto.name && { name: dto.name }),
          ...(dto.avatar && { avatarUrl: dto.avatar }),
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
          department: { select: { id: true, name: true, key: true } },
          managedDepartment: { select: { id: true, name: true, key: true } },
        },
      }),
    );
  }
}
