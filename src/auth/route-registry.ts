import { Injectable } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { ALL_ROUTES } from './routes';

@Injectable()
export class RouteRegistry {
  getRoutes() {
    return ALL_ROUTES;
  }
}
