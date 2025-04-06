// // src/security/recaptcha.service.ts
// import { Injectable } from '@nestjs/common';
// import { verify } from 'google-recaptcha-v3';

// @Injectable()
// export class RecaptchaService {
//   async verifyToken(token: string): Promise<boolean> {
//     try {
//       const score: number = (await verify(
//         process.env.RECAPTCHA_SECRET_KEY,
//         token,
//       )) as number;
//       return score >= 0.5; // Only require challenge if score < 0.5
//     } catch {
//       return false;
//     }
//   }
// }
