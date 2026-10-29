import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import * as dotenv from 'dotenv';
import { validateEnv } from './config/env.validation';
dotenv.config();

async function bootstrap() {
  const env = validateEnv(process.env);

  const app = await NestFactory.create(AppModule);

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
        'https://claspworkspace.vercel.app',
        'https://clasp-backend.onrender.com',
        'https://claspworkspace.com',
        'https://www.claspworkspace.com',
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
