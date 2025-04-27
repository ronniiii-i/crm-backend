import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { MailService } from '../mail/mail.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './roles.guard';
import { AccessControlGuard } from './access-control.guard';
import { DepartmentGuard } from './department.guard';
import { DataFilterService } from 'src/core/data-filter.service';

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
    RolesGuard,
    DepartmentGuard,
    AccessControlGuard,
    DataFilterService,
  ],
  controllers: [AuthController],
  exports: [AccessControlGuard],
})
export class AuthModule {}
