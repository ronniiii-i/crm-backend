import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User, Prisma } from '@prisma/client';
import { UpdateUserDto } from './dto/update-user.dto';
import { getTenantId } from '../tenant/tenant-context';
import { SessionStateService } from '../auth/services/session-state.service';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private readonly sessionState: SessionStateService,
  ) {}

  /**
   * Runs `fn` against the current request's tenant when one is available.
   * Under a pooled Prisma client the `app.current_tenant` setting must be on
   * the same connection as the query, so RLS-protected reads/writes go through
   * `withTenant`. Without a tenant the query still fails closed at the DB layer.
   */
  private scoped<T>(
    fn: (db: Prisma.TransactionClient | PrismaService) => Promise<T>,
  ): Promise<T> {
    const tenantId = getTenantId();
    if (!tenantId) return fn(this.prisma);
    return this.prisma.withTenant(tenantId, (tx) => fn(tx));
  }

  async findAll(): Promise<any[]> {
    return this.scoped((db) =>
      db.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          isVerified: true,
          avatarUrl: true,
          roleId: true,
          departmentId: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          role: {
            select: {
              id: true,
              name: true,
              slug: true,
              rank: true,
              dataScope: true,
              isTenantAdmin: true,
            },
          },
          department: { select: { id: true, name: true, key: true } },
        },
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
      }),
    );
  }

  async findOne(id: string): Promise<User> {
    const user = await this.scoped((db) =>
      db.user.findUnique({
        where: { id },
        include: {
          department: true,
        },
      }),
    );
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async updateUser(id: string, data: UpdateUserDto): Promise<any> {
    const user = await this.scoped((db) =>
      db.user.findUnique({ where: { id } }),
    );
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    if (data.roleId) {
      const role = await this.scoped((db) =>
        db.role.findFirst({ where: { id: data.roleId } }),
      );
      if (!role) throw new NotFoundException('Role not found');
    }

    if (data.departmentId) {
      const department = await this.scoped((db) =>
        db.department.findFirst({ where: { id: data.departmentId } }),
      );
      if (!department) throw new NotFoundException('Department not found');
    }

    const updateData: any = {
      ...data,
    };

    // Map avatar -> avatarUrl for compatibility
    if (updateData.avatar !== undefined) {
      updateData.avatarUrl = updateData.avatar;
      delete updateData.avatar;
    }
    if (updateData.departmentId === '') updateData.departmentId = null;

    // Changing someone's status, role, or department must invalidate the
    // claims baked into their current access token. Bumping the session
    // version makes the next guarded request fail until it is refreshed.
    const invalidating =
      (data.status !== undefined && data.status !== user.status) ||
      (data.roleId !== undefined && data.roleId !== user.roleId) ||
      (updateData.departmentId !== undefined &&
        updateData.departmentId !== user.departmentId);

    const updated = await this.scoped((db) =>
      db.user.update({
        where: { id },
        data: {
          ...updateData,
          ...(invalidating ? { sessionVersion: { increment: 1 } } : {}),
        },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          isVerified: true,
          roleId: true,
          departmentId: true,
          createdAt: true,
          role: { select: { id: true, name: true, slug: true } },
          department: { select: { id: true, name: true, key: true } },
        },
      }),
    );

    if (invalidating) {
      await this.sessionState.flushUser(user.tenantId, id);
    }

    return updated;
  }

  async deleteUser(id: string): Promise<User> {
    const user = await this.scoped((db) =>
      db.user.findUnique({ where: { id } }),
    );
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    const deleted = await this.scoped((db) =>
      db.user.delete({ where: { id } }),
    );
    await this.sessionState.flushUser(user.tenantId, id);
    return deleted;
  }
}
