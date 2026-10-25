import { AsyncLocalStorage } from 'async_hooks';

export interface TenantContext {
  tenantId: string;
  tenantSlug?: string | null;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

export const getTenantId = () => tenantStorage.getStore()?.tenantId;

export const getTenantSlug = () => tenantStorage.getStore()?.tenantSlug ?? null;

export const runWithTenant = <T>(
  tenantId: string,
  fn: () => T,
  tenantSlug?: string | null,
) => tenantStorage.run({ tenantId, tenantSlug }, fn);
