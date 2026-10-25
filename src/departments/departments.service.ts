import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string) {
    const departments = await this.prisma.department.findMany({
      where: { tenantId },
      include: {
        manager: { select: { id: true, name: true, email: true } },
        _count: { select: { members: true, Module: true, teams: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return { success: true, departments };
  }

  async overview(tenantId: string) {
    const departments = await this.list(tenantId);
    return departments;
  }

  async get(tenantId: string, id: string) {
    const department = await this.prisma.department.findFirst({
      where: { id, tenantId },
      include: {
        manager: { select: { id: true, name: true, email: true } },
        members: { select: { id: true, name: true, email: true, roleId: true } },
      },
    });
    if (!department) throw new NotFoundException('Department not found');
    return { success: true, department };
  }

  async create(tenantId: string, dto: any) {
    const existing = await this.prisma.department.findFirst({ where: { tenantId, key: dto.key } });
    if (existing) throw new BadRequestException('Department key already exists');

    const department = await this.prisma.department.create({
      data: {
        tenantId,
        name: dto.name,
        key: dto.key,
        description: dto.description,
        isSystem: false,
      },
    });
    return { success: true, department };
  }

  async update(tenantId: string, id: string, dto: any) {
    const department = await this.prisma.department.findFirst({ where: { id, tenantId } });
    if (!department) throw new NotFoundException('Department not found');

    if (dto.managerId) {
      const manager = await this.prisma.user.findFirst({ where: { id: dto.managerId, tenantId } });
      if (!manager) throw new BadRequestException('Manager not found in tenant');
    }

    const updated = await this.prisma.department.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        managerId: dto.managerId ?? undefined,
        sortOrder: dto.sortOrder ?? undefined,
      },
    });
    return { success: true, department: updated };
  }

  async remove(tenantId: string, id: string) {
    const department = await this.prisma.department.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { members: true, Module: true, teams: true, expenses: true } } },
    });
    if (!department) throw new NotFoundException('Department not found');
    if (department.isSystem) throw new ForbiddenException('System department cannot be deleted');
    if (department._count.members > 0 || department._count.Module > 0 || department._count.teams > 0 || department._count.expenses > 0) {
      throw new BadRequestException('Department has linked records');
    }

    await this.prisma.department.delete({ where: { id } });
    return { success: true };
  }
}
