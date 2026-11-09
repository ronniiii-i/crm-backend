import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  deriveCurrencySymbol,
  validateTenantSettingsPatch,
  type TenantWorkspaceSettings,
} from './tenant-settings.validation';

@Injectable()
export class TenantSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  // `tenants` is RLS-protected too: the policy matches `id` against
  // `app.current_tenant`, so these reads must run inside `withTenant`.
  private async load(tenantId: string) {
    const tenant = await this.prisma.withTenant(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId } }),
    );
    if (!tenant) throw new NotFoundException('Workspace not found');
    return tenant;
  }

  private toSettings(tenant: {
    name: string;
    slug: string;
    currency?: string | null;
    currencySymbol?: string | null;
    dateFormat?: string | null;
    timeZone?: string | null;
    locale?: string | null;
    weekStartsOn?: number | null;
  }): TenantWorkspaceSettings {
    const currency = tenant.currency ?? 'USD';
    const locale = tenant.locale ?? 'en-US';
    return {
      name: tenant.name,
      slug: tenant.slug,
      currency,
      currencySymbol:
        tenant.currencySymbol ?? deriveCurrencySymbol(currency, locale),
      dateFormat: tenant.dateFormat ?? 'd MMM yyyy',
      timeZone: tenant.timeZone ?? 'UTC',
      locale,
      weekStartsOn: tenant.weekStartsOn ?? 1,
    };
  }

  /** Full workspace settings used by the session payload. */
  async getSettings(tenantId: string): Promise<TenantWorkspaceSettings> {
    return this.toSettings(await this.load(tenantId));
  }

  async get(tenantId: string) {
    const settings = await this.getSettings(tenantId);
    return { success: true, settings };
  }

  async update(
    tenantId: string,
    body: Record<string, unknown>,
    actorId?: string | null,
  ) {
    const patch = validateTenantSettingsPatch(body ?? {});
    const current = await this.load(tenantId);

    const updated = await this.prisma.withTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.currency !== undefined && { currency: patch.currency }),
          ...(patch.currencySymbol !== undefined && {
            currencySymbol: patch.currencySymbol,
          }),
          ...(patch.dateFormat !== undefined && {
            dateFormat: patch.dateFormat,
          }),
          ...(patch.timeZone !== undefined && { timeZone: patch.timeZone }),
          ...(patch.locale !== undefined && { locale: patch.locale }),
          ...(patch.weekStartsOn !== undefined && {
            weekStartsOn: patch.weekStartsOn,
          }),
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actorId ?? null,
          action: 'SETTINGS_UPDATE',
          entity: 'tenant',
          entityId: tenantId,
          before: this.toSettings(current) as unknown as Prisma.InputJsonValue,
          after: this.toSettings(tenant) as unknown as Prisma.InputJsonValue,
        },
      });

      return tenant;
    });

    return { success: true, settings: this.toSettings(updated) };
  }
}
