import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User, Role, PermissionType, Prisma } from '@prisma/client'; // Import PermissionType
import { UpdateUserDto } from './dto/update-user.dto';
import { getTenantId } from '../tenant/tenant-context';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

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
    // 1. Fetch all users without trying to include permissions
    const users = await this.scoped((db) =>
      db.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isVerified: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    );

    // 2. Fetch all role-based permissions in a single, efficient query
    const allRolePermissions = await this.scoped((db) =>
      db.roleModulePermission.findMany({
        select: {
          role: true,
          permission: {
            select: {
              type: true,
            },
          },
        },
      }),
    );

    // 3. Create a lookup map for quick access to a role's permissions
    const permissionsMap = new Map<Role, Set<PermissionType>>();

    for (const rolePerm of allRolePermissions) {
      if (!permissionsMap.has(rolePerm.role)) {
        permissionsMap.set(rolePerm.role, new Set<PermissionType>());
      }
      if (rolePerm.permission) {
        permissionsMap.get(rolePerm.role)!.add(rolePerm.permission.type);
      }
    }

    // 4. Map the users and add their permissions from the lookup map
    return users.map((user) => {
      const permissions = Array.from(permissionsMap.get(user.role) || []);

      return {
        ...user,
        permissions: permissions,
      };
    });
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

  async updateUser(id: string, data: UpdateUserDto): Promise<User> {
    const user = await this.scoped((db) =>
      db.user.findUnique({ where: { id } }),
    );
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const updateData: any = {
      ...data,
    };

    // Map avatar -> avatarUrl for compatibility
    if (updateData.avatar !== undefined) {
      updateData.avatarUrl = updateData.avatar;
      delete updateData.avatar;
    }

    return this.scoped((db) =>
      db.user.update({
        where: { id },
        data: updateData,
      }),
    );
  }

  async deleteUser(id: string): Promise<User> {
    const user = await this.scoped((db) =>
      db.user.findUnique({ where: { id } }),
    );
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return this.scoped((db) => db.user.delete({ where: { id } }));
  }
}
