import { Global, Module } from '@nestjs/common';
import { EmailLinkService } from './email-link.service';
import {
  EMAIL_TRANSPORT,
  EmailService,
  LoggingTransport,
  ResendTransport,
  readBooleanEnv,
  type EmailTransport,
} from './email.service';

function createEmailTransport(): EmailTransport {
  const enabled = readBooleanEnv(
    process.env.EMAIL_ENABLED,
    process.env.NODE_ENV !== 'test',
  );

  if (!enabled) {
    return new LoggingTransport();
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'RESEND_API_KEY is required when EMAIL_ENABLED=true in production',
      );
    }
    return new LoggingTransport();
  }

  return new ResendTransport(apiKey);
}

@Global()
@Module({
  providers: [
    EmailLinkService,
    EmailService,
    {
      provide: EMAIL_TRANSPORT,
      useFactory: createEmailTransport,
    },
  ],
  exports: [EmailLinkService, EmailService, EMAIL_TRANSPORT],
})
export class EmailModule {}
