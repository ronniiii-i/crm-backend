import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_DEPARTMENTS } from '../tenant/defaults';

function slugifyDepartmentKey(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every tenant table is guarded by row-level security, so queries must run
   * on a connection where `app.current_tenant` is set. `withTenant` does that
   * and joins an in-flight transaction for the same tenant instead of nesting.
   */
  private scoped<T>(
    tenantId: string,
    fn: (db: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.withTenant(tenantId, fn);
  }

  /**
   * Every workspace is provisioned with the default department catalogue.
   * Tenants created before provisioning existed (or partially rolled back)
   * would otherwise open Settings to an empty list. Seeding only happens when
   * there are no departments at all, so an admin who removes a default isn't
   * surprised by it reappearing on the next request.
   */
  private async ensureDefaults(tenantId: string) {
    await this.scoped(tenantId, async (tx) => {
      const count = await tx.department.count({ where: { tenantId } });
      if (count > 0) return;

      await tx.department.createMany({
        data: DEFAULT_DEPARTMENTS.map((department) => ({
          tenantId,
          key: department.key,
          name: department.name,
          sortOrder: department.sortOrder,
          isSystem: true,
        })),
        skipDuplicates: true,
      });
    });
  }

  async list(tenantId: string) {
    await this.ensureDefaults(tenantId);

    const departments = await this.scoped(tenantId, (tx) =>
      tx.department.findMany({
        where: { tenantId },
        include: {
          manager: { select: { id: true, name: true, email: true } },
          _count: { select: { members: true, Module: true, teams: true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    );
    return { success: true, departments };
  }

  async overview(tenantId: string) {
    const departments = await this.list(tenantId);
    return departments;
  }

  async get(tenantId: string, id: string) {
    const department = await this.scoped(tenantId, (tx) =>
      tx.department.findFirst({
        where: { id, tenantId },
        include: {
          manager: { select: { id: true, name: true, email: true } },
          members: {
            select: { id: true, name: true, email: true, roleId: true },
          },
        },
      }),
    );
    if (!department) throw new NotFoundException('Department not found');
    return { success: true, department };
  }

  /** Pick a key that is not already used in this tenant. */
  private async resolveKey(
    db: Prisma.TransactionClient,
    tenantId: string,
    name: string,
    requested?: string,
  ) {
    const base =
      slugifyDepartmentKey(requested?.trim() || name) || 'department';
    let candidate = base;
    let suffix = 2;

    // `key` is unique per tenant. Try the natural slug first, then suffix it.
    while (
      await db.department.findFirst({
        where: { tenantId, key: candidate },
        select: { id: true },
      })
    ) {
      candidate = `${base}_${suffix++}`;
    }

    return candidate;
  }

  async create(tenantId: string, dto: any) {
    const name = String(dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Department name is required');

    const department = await this.scoped(tenantId, async (tx) => {
      if (dto.managerId) {
        const manager = await tx.user.findFirst({
          where: { id: dto.managerId, tenantId },
        });
        if (!manager)
          throw new BadRequestException('Manager not found in tenant');
      }

      const key = await this.resolveKey(tx, tenantId, name, dto.key);

      return tx.department.create({
        data: {
          tenantId,
          name,
          key,
          description: dto.description ?? null,
          managerId: dto.managerId ?? null,
          sortOrder: dto.sortOrder ?? 0,
          isSystem: false,
        },
      });
    });

    return { success: true, department };
  }

  async update(tenantId: string, id: string, dto: any) {
    const updated = await this.scoped(tenantId, async (tx) => {
      const department = await tx.department.findFirst({
        where: { id, tenantId },
      });
      if (!department) throw new NotFoundException('Department not found');

      if (dto.managerId) {
        const manager = await tx.user.findFirst({
          where: { id: dto.managerId, tenantId },
        });
        if (!manager)
          throw new BadRequestException('Manager not found in tenant');
      }

      return tx.department.update({
        where: { id },
        data: {
          name: dto.name?.trim() || undefined,
          description: dto.description ?? undefined,
          managerId:
            dto.managerId === null ? null : (dto.managerId ?? undefined),
          sortOrder: dto.sortOrder ?? undefined,
        },
      });
    });

    return { success: true, department: updated };
  }

  async remove(tenantId: string, id: string) {
    await this.scoped(tenantId, async (tx) => {
      const department = await tx.department.findFirst({
        where: { id, tenantId },
        include: {
          _count: {
            select: {
              members: true,
              teams: true,
              expenses: true,
              permissionGroupAssignments: true,
            },
          },
        },
      });
      if (!department) throw new NotFoundException('Department not found');

      // Default (system) departments may be removed by a tenant admin. They are
      // only "system" in the sense that provisioning created them.
      if (
        department._count.members > 0 ||
        department._count.teams > 0 ||
        department._count.expenses > 0
      ) {
        throw new BadRequestException(
          'Department still has members, teams, or expenses linked to it',
        );
      }

      // Modules are navigation entries, not owned records: detach them instead
      // of blocking the delete or cascading them away.
      await tx.module.updateMany({
        where: { tenantId, departmentId: id },
        data: { departmentId: null },
      });
      // Department-scoped permission grants do not survive the department.
      await tx.permissionGroupAssignment.deleteMany({
        where: { tenantId, departmentId: id },
      });
      await tx.department.delete({ where: { id } });
    });

    return { success: true };
  }
}
