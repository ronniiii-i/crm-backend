import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaService } from './prisma/prisma.service';
import { PrismaModule } from './prisma/prisma.module';
import { MailService } from './mail/mail.service';
import { SuspicionDetectorService } from './security/suspicion-detector.service';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 3600, // 1 hour
        limit: 3, // 3 requests per hour
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
    SuspicionDetectorService,
  ],
})
export class AppModule {}
