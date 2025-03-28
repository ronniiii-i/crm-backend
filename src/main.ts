import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: true, // Allow all origins for testing
    methods: ['GET', 'POST'],
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3030);
}
bootstrap();
