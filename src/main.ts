import {
  BadRequestException,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';

function formatValidationErrors(
  errors: ValidationError[],
): Array<{ field: string; rule: string; message: string }> {
  const result: Array<{ field: string; rule: string; message: string }> = [];

  function traverse(errList: ValidationError[], parent = '') {
    for (const err of errList) {
      const field = parent ? `${parent}.${err.property}` : err.property;
      if (err.constraints) {
        for (const [rule, message] of Object.entries(err.constraints)) {
          result.push({ field, rule, message });
        }
      }
      if (err.children && err.children.length > 0) {
        traverse(err.children, field);
      }
    }
  }

  traverse(errors);
  return result;
}

function resolveCorsOrigins(): string[] {
  const defaults = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
  ];
  const configured = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return [...new Set([...defaults, ...configured])];
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  app.set('trust proxy', 1);
  app.enableCors({
    origin: resolveCorsOrigins(),
    credentials: true,
  });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) => {
        const formatted = formatValidationErrors(errors);
        return new BadRequestException({
          errorCode: 'VALIDATION_ERROR',
          message: 'Dữ liệu không hợp lệ',
          errors: formatted,
        });
      },
    }),
  );
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
await bootstrap();
