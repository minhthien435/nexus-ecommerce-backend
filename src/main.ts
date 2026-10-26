import {
  BadRequestException,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({
    origin: [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:3000',
    ],
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
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
