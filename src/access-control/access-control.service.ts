import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class AccessControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async catalog(tenantId: string) {
    const modules = await this.prisma.module.findMany({
      where: { tenantId },
      orderBy: [{ group: 'asc' }, { order: 'asc' }, { name: 'asc' }],
    });

    const groupsMap = new Map<string, any[]>();
    for (const m of modules) {
      const list = groupsMap.get(m.group) || [];
      list.push({
        key: m.key,
        name: m.name,
        actions: ['VIEW', 'CREATE', 'EDIT', 'DELETE'],
      });
      groupsMap.set(m.group, list);
    }

    const groups = Array.from(groupsMap.entries()).map(([name, modules]) => ({
      name,
      modules,
    }));

    return {
      success: true,
      actions: ['VIEW', 'CREATE', 'EDIT', 'DELETE'],
      groups,
    };
  }

  async rolePermissions(tenantId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, tenantId } });
    if (!role) throw new BadRequestException('Role not found');

    const modules = await this.prisma.module.findMany({ where: { tenantId } });
    const perms = await this.prisma.permission.findMany();
    const grants = await this.prisma.roleModulePermission.findMany({
      where: { tenantId, roleId },
    });

    const grantSet = new Set(grants.map((g) => `${g.moduleId}:${g.permissionId}`));
    const result = modules.map((m) => {
      return perms.map((p) => ({
        moduleKey: m.key,
        action: p.type,
        granted: role.isTenantAdmin ? true : grantSet.has(`${m.id}:${p.id}`),
      }));
    }).flat();

    return {
      success: true,
      roleId,
      immutable: role.isTenantAdmin,
      grants: result,
    };
  }

  async updateRolePermissions(tenantId: string, roleId: string, grants: any[]) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, tenantId } });
    if (!role) throw new BadRequestException('Role not found');
    if (role.isTenantAdmin) throw new ForbiddenException('Tenant admin permissions are immutable');

    await this.prisma.$transaction(async (tx) => {
      await tx.roleModulePermission.deleteMany({ where: { tenantId, roleId } });

      for (const g of grants || []) {
        if (!g.granted) continue;
        const module = await tx.module.findFirst({ where: { tenantId, key: g.moduleKey } });
        const permission = await tx.permission.findFirst({ where: { type: g.action } });
        if (!module || !permission) continue;
        await tx.roleModulePermission.create({
          data: {
            tenantId,
            roleId,
            moduleId: module.id,
            permissionId: permission.id,
          },
        });
      }
    });

    await this.cache.del(`acl:modules:${tenantId}:*`);
    await this.cache.del(`perm:resolve:${tenantId}:*`);
    return this.rolePermissions(tenantId, roleId);
  }
}
