// src/auth/roles.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { RouteRegistry } from '../route-registry';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private routeRegistry: RouteRegistry) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: {
      route?: { path?: string };
      url: string;
      user: { role: string };
    } = context.switchToHttp().getRequest();
    const routePath = this.getRoutePath(request);
    const { user } = request;

    const routeConfig = await this.routeRegistry.findRoute(routePath);
    if (!routeConfig) return false;

    return !!routeConfig.permissions[user.role];
  }

  private getRoutePath(request: {
    route?: { path?: string };
    url: string;
  }): string {
    if (request.route?.path) {
      return request.route.path;
    }
    return request.url.split('?')[0];
  }
}
