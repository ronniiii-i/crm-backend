import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async list(tenantId: string) {
    const roles = await this.prisma.role.findMany({
      where: { tenantId },
      include: {
        _count: {
          select: {
            users: true,
            roleModulePermissions: true,
            invitations: true,
          },
        },
      },
      orderBy: [{ isTenantAdmin: 'desc' }, { rank: 'asc' }, { name: 'asc' }],
    });
    return { success: true, roles };
  }

  async assignable(tenantId: string, user: any) {
    const roles = await this.prisma.role.findMany({
      where: { tenantId },
      orderBy: [{ rank: 'asc' }, { name: 'asc' }],
    });
    const filtered = roles.filter((r) => {
      if (r.isTenantAdmin) return false;
      if (user?.isTenantAdmin) return true;
      if (!user?.roleRank) return false;
      return r.rank >= user.roleRank;
    });
    return { success: true, roles: filtered };
  }

  async get(tenantId: string, id: string) {
    const role = await this.prisma.role.findFirst({ where: { id, tenantId } });
    if (!role) throw new NotFoundException('Role not found');
    return { success: true, role };
  }

  async create(tenantId: string, user: any, dto: CreateRoleDto) {
    if (dto.dataScope === 'TENANT') {
      throw new BadRequestException('Custom roles cannot use TENANT scope');
    }
    if (dto.rank && (dto.rank < 1 || dto.rank > 999)) {
      throw new BadRequestException('Rank must be between 1 and 999');
    }

    const slug = slugify(dto.name);
    const existing = await this.prisma.role.findFirst({
      where: { tenantId, slug },
    });
    if (existing) throw new ConflictException('Role already exists');

    const role = await this.prisma.role.create({
      data: {
        tenantId,
        name: dto.name,
        slug,
        description: dto.description,
        rank: dto.rank ?? 500,
        dataScope: dto.dataScope ?? 'SELF',
        isSystem: false,
        isTenantAdmin: false,
      },
    });

    await this.cache.del(`acl:modules:${tenantId}:*`);
    return { success: true, role };
  }

  async update(tenantId: string, id: string, dto: UpdateRoleDto) {
    const role = await this.prisma.role.findFirst({ where: { id, tenantId } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isTenantAdmin) {
      if (dto.rank !== undefined || dto.dataScope !== undefined) {
        throw new BadRequestException('Tenant admin role is immutable');
      }
      if (dto.name)
        throw new BadRequestException('Tenant admin role cannot be renamed');
    }
    if (role.isSystem && dto.name)
      throw new BadRequestException('System role name cannot be changed');
    if (dto.dataScope === 'TENANT' && !role.isTenantAdmin) {
      throw new BadRequestException('Custom roles cannot use TENANT scope');
    }

    const updated = await this.prisma.role.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        rank: dto.rank,
        dataScope: dto.dataScope,
      },
    });

    if (dto.dataScope && dto.dataScope !== role.dataScope) {
      const users = await this.prisma.user.findMany({
        where: { tenantId, roleId: id },
        select: { id: true },
      });
      for (const u of users) {
        await this.prisma.user.update({
          where: { id: u.id },
          data: { sessionVersion: { increment: 1 } },
        });
      }
      await this.cache.del(`acl:modules:${tenantId}:*`);
    }

    return { success: true, role: updated };
  }

  async remove(tenantId: string, id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { users: true, invitations: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isTenantAdmin)
      throw new ForbiddenException('Tenant admin role cannot be deleted');
    if (role.isSystem)
      throw new ForbiddenException('System role cannot be deleted');
    if (role._count.users > 0 || role._count.invitations > 0) {
      throw new ConflictException({
        message: 'Role has assigned users or pending invitations',
        users: role._count.users,
        invitations: role._count.invitations,
      });
    }

    await this.prisma.role.delete({ where: { id } });
    await this.cache.del(`acl:modules:${tenantId}:*`);
    return { success: true };
  }
}
