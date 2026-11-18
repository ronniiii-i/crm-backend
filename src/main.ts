import { NestFactory } from '@nestjs/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as dotenv from 'dotenv';
import { validateEnv } from './config/env.validation';
dotenv.config();

/**
 * Configure Express `trust proxy` from `TRUST_PROXY`.
 *
 * The rate limiter keys credential policies on the client IP, so behind a
 * reverse proxy the address must come from `X-Forwarded-For` rather than the
 * proxy itself. `false` disables trust (direct connections only), `true`
 * trusts the entire chain (only safe when every proxy is controlled), and an
 * integer trusts that many hops.
 */
function configureTrustProxy(
  app: INestApplication,
  value: string | undefined,
): void {
  const instance = app.getHttpAdapter().getInstance() as {
    set?: (key: string, value: unknown) => void;
  };
  if (!instance?.set) return;

  const raw = (value ?? '1').trim().toLowerCase();
  if (raw === '' || raw === 'false' || raw === '0' || raw === 'off') {
    instance.set('trust proxy', false);
    return;
  }
  if (raw === 'true' || raw === 'on') {
    instance.set('trust proxy', true);
    return;
  }
  const hops = Number(raw);
  if (Number.isInteger(hops) && hops > 0) {
    instance.set('trust proxy', hops);
    return;
  }
  // Unknown value: keep the secure default rather than trusting every hop.
  instance.set('trust proxy', 1);
}

async function bootstrap() {
  const env = validateEnv(process.env);

  const app = await NestFactory.create(AppModule);

  configureTrustProxy(app, env.TRUST_PROXY);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Clasp Workspace API')
    .setDescription('API for Clasp Workspace.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }

      const allowed = [
        env.FRONTEND_URL,
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'https://claspcrm.vercel.app',
        'https://clasp-workspace.onrender.com',
        'https://claspcrm.onrender.com',
        'https://claspworkspace.work.gd',
      ];

      if (allowed.includes(origin)) {
        return callback(null, true);
      }

      if (origin.endsWith('.localhost:3000')) {
        return callback(null, true);
      }

      if (origin.endsWith('.claspworkspace.com')) {
        return callback(null, true);
      }

      // Tenant apps are served on subdomains of the configured frontend origin
      // (for example acme.claspworkspace.work.gd). Accept any subdomain of an
      // explicitly allowed origin instead of maintaining a per-TLD allowlist.
      const isTenantSubdomain = allowed.some((allowedOrigin) => {
        if (!allowedOrigin) return false;
        try {
          const allowedHost = new URL(allowedOrigin).hostname.toLowerCase();
          const requestHost = new URL(origin).hostname.toLowerCase();
          return requestHost.endsWith(`.${allowedHost}`);
        } catch {
          return false;
        }
      });

      if (isTenantSubdomain) {
        return callback(null, true);
      }

      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type, Accept, Authorization, X-Tenant-Slug',
  });

  app.use(cookieParser());

  const PORT = env.PORT;
  await app.listen(PORT);
  console.log(`Listening on port: ${PORT}`);
}
bootstrap().catch((err) => {
  console.error('Error during application bootstrap:', err);
  process.exit(1);
});
