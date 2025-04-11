import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaService } from './prisma/prisma.service';
import { PrismaModule } from './prisma/prisma.module';
import { MailService } from './mail/mail.service';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000, // 1 minute in milliseconds
        limit: 100, // 100 requests per minute (general API limits)
      },
      {
        name: 'short',
        ttl: 10000, // 10 seconds in milliseconds
        limit: 10, // 10 requests per 10 seconds (burst protection)
      },
      {
        name: 'auth',
        ttl: 3600000, // 1 hour in milliseconds
        limit: 50, // 5 requests per hour (strict auth endpoints)
      },
      {
        name: 'sensitive',
        ttl: 86400000, // 24 hours in milliseconds
        limit: 10, // 10 requests per day (for very sensitive ops)
      },
    ]),
    AuthModule,
    PrismaModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    AppService,
    PrismaService,
    MailService,
  ],
})
export class AppModule {}
