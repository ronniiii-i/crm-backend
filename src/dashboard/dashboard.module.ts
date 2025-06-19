import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import * as redisStore from 'cache-manager-redis-store';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [
    CacheModule.register({
      store: redisStore, // Uncomment if using Redis
      host: 'localhost', // Replace with your Redis host (e.g., 'redis' if in Docker)
      port: 6379, // Replace with your Redis port
      ttl: 300, // Default cache lifetime in seconds (e.g., 5 minutes)
    }),
    AuthModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
