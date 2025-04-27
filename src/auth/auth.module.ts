// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { MailService } from '../mail/mail.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { GuardsModule } from './guards.module';
import { DataFilterService } from '../core/data-filter.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'supersecret',
      signOptions: { expiresIn: '1h' },
    }),
  ],
  providers: [
    AuthService,
    JwtStrategy,
    MailService,
    GuardsModule,
    DataFilterService,
  ],
  controllers: [AuthController],
  exports: [GuardsModule],
})
export class AuthModule {}
