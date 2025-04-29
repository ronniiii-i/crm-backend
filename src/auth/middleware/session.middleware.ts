// src/auth/middleware/session.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(private readonly jwtService: JwtService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const token =
      (req.cookies as { token?: string })?.token ||
      req.headers.authorization?.split(' ')[1];

    if (token) {
      try {
        this.jwtService.verify(token);
        // Token is valid, continue
        next();
      } catch {
        // Token expired or invalid
        res.clearCookie('token');
        return res.status(401).json({ message: 'Session expired' });
      }
    } else {
      next();
    }
  }
}
