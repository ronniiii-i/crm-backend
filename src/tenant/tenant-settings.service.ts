import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  // `tenants` is RLS-protected too: the policy matches `id` against
  // `app.current_tenant`, so these reads must run inside `withTenant`.
  async get(tenantId: string) {
    const tenant = await this.prisma.withTenant(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId } }),
    );
    return {
      success: true,
      settings: { name: tenant?.name, slug: tenant?.slug },
    };
  }

  async update(tenantId: string, body: any) {
    const updated = await this.prisma.withTenant(tenantId, (tx) =>
      tx.tenant.update({
        where: { id: tenantId },
        data: { name: body?.name },
      }),
    );
    return {
      success: true,
      settings: { name: updated.name, slug: updated.slug },
    };
  }
}
