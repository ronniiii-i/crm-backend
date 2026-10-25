import { AsyncLocalStorage } from 'async_hooks';

export interface TenantContext {
  tenantId: string;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();
export const getTenantId = () => tenantStorage.getStore()?.tenantId;
export const runWithTenant = <T>(tenantId: string, fn: () => T) =>
  tenantStorage.run({ tenantId }, fn);
