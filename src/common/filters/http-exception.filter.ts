import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

export interface ErrorResponseBody {
  success: false;
  statusCode: number;
  errorCode?: string;
  message: string | string[];
  errors?: Array<{ field: string; rule: string; message: string }>;
  data?: unknown;
  error: string;
  timestamp: string;
  path: string;
}

function getDefaultErrorCode(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_ERROR';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'RESOURCE_NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'RESOURCE_ALREADY_EXISTS';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'UNPROCESSABLE_ENTITY';
    case HttpStatus.INTERNAL_SERVER_ERROR:
    default:
      return 'INTERNAL_SERVER_ERROR';
  }
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      return;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (response && response.headersSent) {
      return;
    }

    let status: number;
    let message: string | string[];
    let error: string;
    let errorCode: string | undefined;
    let errors:
      Array<{ field: string; rule: string; message: string }> | undefined;
    let data: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
        error = exception.name;
        errorCode = getDefaultErrorCode(status);
      } else if (typeof res === 'object' && res !== null) {
        const responseObj = res as Record<string, unknown>;
        message =
          (responseObj.message as string | string[]) || exception.message;
        error = (responseObj.error as string) || exception.name;
        errorCode =
          (responseObj.errorCode as string) || getDefaultErrorCode(status);
        if (Array.isArray(responseObj.errors)) {
          errors = responseObj.errors as Array<{
            field: string;
            rule: string;
            message: string;
          }>;
        }
        if ('data' in responseObj) {
          data = responseObj.data;
        }
      } else {
        message = exception.message;
        error = exception.name;
        errorCode = getDefaultErrorCode(status);
      }
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      error = 'Internal Server Error';
      errorCode = 'INTERNAL_SERVER_ERROR';

      this.logger.error(
        `Unhandled exception: ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const responseBody: ErrorResponseBody = {
      success: false,
      statusCode: status,
      errorCode,
      message,
      ...(errors ? { errors } : {}),
      ...(data !== undefined ? { data } : {}),
      error,
      timestamp: new Date().toISOString(),
      path: request?.url || '',
    };

    response.status(status).json(responseBody);
  }
}
