import { SetMetadata } from '@nestjs/common';

export const TENANT_ADMIN_ONLY_KEY = 'tenantAdminOnly';
export const TenantAdminOnly = () => SetMetadata(TENANT_ADMIN_ONLY_KEY, true);
