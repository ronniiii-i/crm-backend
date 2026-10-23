import { Global, Module } from '@nestjs/common';
import {
  CacheService,
  REDIS_CLIENT_FACTORY,
  defaultRedisClientFactory,
} from './cache.service';

@Global()
@Module({
  imports: [],
  providers: [
    { provide: REDIS_CLIENT_FACTORY, useValue: defaultRedisClientFactory },
    CacheService,
  ],
  exports: [CacheService],
})
export class CacheModule {}
