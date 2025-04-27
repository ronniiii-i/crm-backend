// src/auth/guards.module.ts
import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessControlGuard } from './access-control.guard';
import { RolesGuard } from './roles.guard';
import { DepartmentGuard } from './department.guard';
import { PermissionGuard } from './permission.guard';

@Module({
  providers: [
    Reflector,
    RolesGuard,
    DepartmentGuard,
    PermissionGuard,
    AccessControlGuard,
  ],
  exports: [AccessControlGuard, RolesGuard, DepartmentGuard, PermissionGuard],
})
export class GuardsModule {}
