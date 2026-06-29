// src/users/users.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User, Role, PermissionType } from '@prisma/client'; // Import PermissionType
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(): Promise<any[]> {
    // 1. Fetch all users without trying to include permissions
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // 2. Fetch all role-based permissions in a single, efficient query
    const allRolePermissions = await this.prisma.roleModulePermission.findMany({
      select: {
        role: true,
        permission: {
          select: {
            type: true,
          },
        },
      },
    });

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
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        department: true,
      },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async updateUser(id: string, data: UpdateUserDto): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return this.prisma.user.update({
      where: { id },
      data: {
        ...data,
      },
    });
  }

  async deleteUser(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return this.prisma.user.delete({ where: { id } });
  }
}
