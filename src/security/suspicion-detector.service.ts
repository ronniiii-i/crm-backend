// // src/security/suspicion-detector.service.ts
// import { Injectable } from '@nestjs/common';
// import { ThrottlerStorageService } from '@nestjs/throttler';

// @Injectable()
// export class SuspicionDetectorService {
//   constructor(private readonly throttler: ThrottlerStorageService) {}

//   async isSuspiciousRequest(ip: string, endpoint: string): Promise<boolean> {
//     // Check if IP has multiple recent failed attempts
//     const failures = await this.throttler.getRecord(ip, endpoint);
//     return failures?.count > 3; // Trigger CAPTCHA after 3 failures
//   }
// }
