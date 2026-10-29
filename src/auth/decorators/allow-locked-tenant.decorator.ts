import { SetMetadata } from '@nestjs/common';

export const ALLOW_LOCKED_TENANT_KEY = 'allowLockedTenant';
export const AllowLockedTenant = () =>
  SetMetadata(ALLOW_LOCKED_TENANT_KEY, true);
