import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const databaseUrl = config.get<string>('DATABASE_URL');
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  if (
    config.get('NODE_ENV') === 'production' &&
    !config.get<string>('JWT_SECRET')
  )
    throw new Error('JWT_SECRET is required in production.');

  app.enableShutdownHooks();
  app.setGlobalPrefix('api');
  const configuredOrigins = config
    .get<string>('WEB_ORIGIN', '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const webOrigins = Array.from(
    new Set([
      ...configuredOrigins,
      ...(config.get('NODE_ENV') === 'production'
        ? []
        : ['http://localhost:5174', 'http://127.0.0.1:5174']),
    ]),
  );
  app.enableCors({
    origin: webOrigins,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Afia Leather Inventory API')
    .setDescription(
      'API for inventory, purchases, sales, and customer accounts.',
    )
    .setVersion('0.1')
    .build();
  SwaggerModule.setup('api/docs', app, () =>
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  await app.listen(config.get<number>('API_PORT', 3000));
}
await bootstrap();
