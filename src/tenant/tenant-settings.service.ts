import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    return { success: true, settings: { name: tenant?.name, slug: tenant?.slug } };
  }

  async update(tenantId: string, body: any) {
    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { name: body?.name },
    });
    return { success: true, settings: { name: updated.name, slug: updated.slug } };
  }
}
