// src/auth/guards.module.ts
import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessControlGuard } from './access-control.guard';
import { RolesGuard } from './roles.guard';
import { DepartmentGuard } from './department.guard';
import { PermissionGuard } from './permission.guard';
import { RouteRegistry } from '../route-registry';
import { CacheModule } from '../../cache/cache.module';

@Module({
  imports: [CacheModule],
  providers: [
    Reflector,
    RolesGuard,
    DepartmentGuard,
    PermissionGuard,
    AccessControlGuard,
    RouteRegistry,
  ],
  exports: [AccessControlGuard, RolesGuard, DepartmentGuard, PermissionGuard],
})
export class GuardsModule {}
