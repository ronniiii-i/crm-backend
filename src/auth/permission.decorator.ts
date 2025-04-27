// src/auth/permission.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { Permission } from './permission-types';

export const Permissions = (permission: Permission) =>
  SetMetadata('permission', permission);
