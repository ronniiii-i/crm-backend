// src/cache/cache.service.ts
import { Injectable } from '@nestjs/common';
import * as NodeCache from 'node-cache';

@Injectable()
export class CacheService {
  private cache: NodeCache;

  // Advanced cache config (in CacheService)
  //   private cache = new NodeCache({
  //     stdTTL: 3600, // Default cache lifetime (seconds)
  //     checkperiod: 600, // Automatic cleanup interval
  //     maxKeys: 10000, // Maximum items in cache
  //     useClones: false, // Better for object performance
  //     deleteOnExpire: true, // Automatically remove expired items
  //   });

  constructor() {
    this.cache = new NodeCache({
      stdTTL: 3600, // 1 hour cache lifetime
      checkperiod: 600, // 10 minutes cleanup interval
      useClones: false, // better performance for objects
    });
  }

  get(key: string): any {
    return this.cache.get(key);
  }

  set(key: string, value: any, ttl?: number): boolean {
    return this.cache.set(key, value, ttl || 3600);
  }

  del(key: string): number {
    return this.cache.del(key);
  }

  flush(): void {
    this.cache.flushAll();
  }

  // Call this when routes change
  invalidateRouteCache(path: string): void {
    const cacheKey = `route:${path}`;
    this.del(cacheKey);
  }

  // Call this when all routes need refreshing
  invalidateAllRoutes(): void {
    const keys = this.cache.keys().filter((k) => k.startsWith('route:'));
    keys.forEach((k) => this.del(k));
  }

  // Add to CacheService
  getStats() {
    return {
      hits: this.cache.getStats().hits,
      misses: this.cache.getStats().misses,
      keys: this.cache.keys().length,
      size: this.cache.getStats().ksize,
    };
  }
}
