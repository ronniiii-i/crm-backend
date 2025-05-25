// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser'; // <-- Add this import

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Configure CORS - ABSOLUTELY ESSENTIAL for cross-origin cookie sending
  app.enableCors({
    origin: process.env.FRONTEND_URL, // e.g., 'http://localhost:3000' or your deployed frontend URL
    credentials: true, // Allow cookies to be sent and received
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
