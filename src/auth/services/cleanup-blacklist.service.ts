// import { Injectable, Logger } from '@nestjs/common';
// import { Cron } from '@nestjs/schedule';
// import { PrismaService } from '../../prisma/prisma.service';

// @Injectable()
// export class CleanupBlacklistService {
//   private readonly logger = new Logger(CleanupBlacklistService.name);

//   constructor(private readonly prisma: PrismaService) {}

//   @Cron('0 * * * *') // Runs every 6 hours instead of daily
//   async handleCron() {
//     this.logger.log('Starting token cleanup...');

//     try {
//       const { count } = await this.prisma.blacklistedToken.deleteMany({
//         where: {
//           OR: [
//             { expiresAt: { lt: new Date() } },
//             {
//               AND: [
//                 { expiresAt: undefined },
//                 {
//                   createdAt: {
//                     lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
//                   },
//                 }, // 30 days old
//               ],
//             },
//           ],
//         },
//       });

//       this.logger.log(`Cleaned up ${count} tokens`);
//     } catch (error) {
//       this.logger.error(
//         'Cleanup failed:',
//         error instanceof Error ? error.message : 'Unknown error',
//       );
//     }
//   }
// }
