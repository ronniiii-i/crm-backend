import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { Request } from 'express';

interface JwtPayload {
  userId: string;
  email: string;
}

interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractTokenFromHeader(request);

    console.error('DEBUG: Authentication Request Details');
    console.error('Request Headers:', request.headers);
    console.error('Token being verified:', token);
    console.error('Current time:', new Date());
    console.error('Request URL:', request.url);
    console.error('Request Method:', request.method);

    if (!token) {
      console.error('ERROR: No token provided');
      throw new UnauthorizedException('No token provided');
    }

    // Check if token is blacklisted
    const isBlacklisted = await this.prisma.blacklistedToken.findUnique({
      where: { token },
    });

    console.error('Is token blacklisted?', !!isBlacklisted);

    if (isBlacklisted) {
      console.error('ERROR: Token has been invalidated');
      throw new UnauthorizedException('Token has been invalidated');
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      request.user = payload;
      return super.canActivate(context) as Promise<boolean>;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }

  override handleRequest<TUser = any>(err: unknown, user: TUser | null): TUser {
    if (err instanceof Error || !user) {
      throw new UnauthorizedException(
        err instanceof Error ? err.message : 'Unauthorized',
      );
    }
    return user;
  }
}
