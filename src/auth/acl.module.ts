import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { PermissionResolutionService } from './services/permission-resolution.service';

@Module({
  imports: [CacheModule],
  providers: [PermissionResolutionService],
  exports: [PermissionResolutionService],
})
export class AclModule {}
