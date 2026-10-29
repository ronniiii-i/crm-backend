import { SetMetadata } from '@nestjs/common';

export const SYSTEM_ADMIN_ROUTE_KEY = 'systemAdminRoute';
export const SystemAdminRoute = () => SetMetadata(SYSTEM_ADMIN_ROUTE_KEY, true);
