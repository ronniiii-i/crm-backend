// src/auth/middleware/session.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(private readonly jwtService: JwtService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const token =
      (req.cookies as { access_token?: string })?.access_token ||
      req.headers.authorization?.split(' ')[1];

    if (token) {
      try {
        this.jwtService.verify(token);
        next();
      } catch (error) {
        const clearCookieOptions = {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax' as 'lax' | 'strict' | 'none',
          path: '/',
        };
        res.clearCookie('access_token', clearCookieOptions);
        console.error('SessionMiddleware: Token verification failed:', error);
        console.warn(
          'SessionMiddleware: Invalid token detected. Cleared access_token cookie, returning 401.',
        );
        return res.status(401).json({ message: 'Session expired' });
      }
    } else {
      next();
    }
  }
}
