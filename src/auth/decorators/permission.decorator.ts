import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'permission';
export interface PermissionMetadata {
  moduleKey: string;
  action: 'VIEW' | 'CREATE' | 'EDIT' | 'DELETE';
}

export const RequirePermission = (
  moduleKey: string,
  action: PermissionMetadata['action'],
) => SetMetadata(PERMISSION_KEY, { moduleKey, action } as PermissionMetadata);
