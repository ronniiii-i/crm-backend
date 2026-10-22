import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';

@Global()
@Module({
  imports: [],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
