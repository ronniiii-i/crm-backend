// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as dotenv from 'dotenv';
dotenv.config();

// console.log('JWT_SECRET from environment:', process.env.JWT_SECRET);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('CRM API')
    .setDescription('API for ClaspCRM.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // Configure CORS - ABSOLUTELY ESSENTIAL for cross-origin cookie sending
  app.enableCors({
    // origin: process.env.FRONTEND_URL,
    origin: [
      'http://localhost:3000',
      'https://claspcrm.vercel.app',
      'https://claspcrm.onrender.com',
    ],
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type, Accept, Authorization',
  });

  app.use(cookieParser()); // <-- Add this line to enable cookie parsing

  const PORT = process.env.PORT || 3030;
  await app.listen(PORT);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap().catch((err) => {
  console.error('Error during application bootstrap:', err);
});
