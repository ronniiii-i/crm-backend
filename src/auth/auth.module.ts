import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { MailService } from '../mail/mail.service';
import { AuthController } from './auth.controller';
// import { UsersModule } from '../users/users.module';
import { JwtStrategy } from './jwt.strategy';
// import { RecaptchaService } from '../security/recaptcha.service';
// import { SuspicionDetectorService } from '../security/suspicion-detector.service';

@Module({
  imports: [
    // UsersModule,
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
    // RecaptchaService,
    // SuspicionDetectorService,
  ],
  controllers: [AuthController],
})
export class AuthModule {}
