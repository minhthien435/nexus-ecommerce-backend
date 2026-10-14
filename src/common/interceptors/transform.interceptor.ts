import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpStatus,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Response } from 'express';
import { Buffer } from 'node:buffer';

export interface StandardResponse<T> {
  success: true;
  data: T;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  StandardResponse<T> | T | undefined
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<StandardResponse<T> | T | undefined> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        const response = context.switchToHttp().getResponse<Response>();

        // Do not wrap if response headers are already sent or status is 204 NO_CONTENT
        if (
          response &&
          (response.headersSent ||
            response.statusCode === HttpStatus.NO_CONTENT)
        ) {
          return data;
        }

        // Do not wrap if data is a Stream or Buffer
        if (
          data !== null &&
          typeof data === 'object' &&
          (typeof (data as unknown as { pipe: unknown }).pipe === 'function' ||
            Buffer.isBuffer(data))
        ) {
          return data;
        }

        // Do not double-wrap if data is already a standard envelope
        if (
          data !== null &&
          typeof data === 'object' &&
          !Array.isArray(data) &&
          (data as Record<string, unknown>).success === true &&
          'data' in (data as Record<string, unknown>)
        ) {
          return data as unknown as StandardResponse<T>;
        }

        // Do not double-wrap if controller returned { message, data }
        if (
          data !== null &&
          typeof data === 'object' &&
          !Array.isArray(data) &&
          'message' in (data as Record<string, unknown>) &&
          'data' in (data as Record<string, unknown>)
        ) {
          const { data: innerData } = data as Record<string, unknown>;
          return {
            success: true,
            data: innerData === undefined ? null : innerData,
          } as unknown as StandardResponse<T>;
        }

        // Handle undefined -> null, normal data -> wrap
        const normalizedData = data === undefined ? null : data;

        return {
          success: true,
          data: normalizedData,
        } as unknown as StandardResponse<T>;
      }),
    );
  }
}
