import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpExceptionFilter } from './http-exception.filter.js';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let mockArgumentsHost: ArgumentsHost;
  let mockResponse: {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    headersSent: boolean;
  };
  let mockRequest: { url: string };

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      headersSent: false,
    };
    mockRequest = { url: '/api/v1/test' };

    mockArgumentsHost = {
      getType: vi.fn().mockReturnValue('http'),
      switchToHttp: vi.fn().mockReturnValue({
        getResponse: vi.fn().mockReturnValue(mockResponse),
        getRequest: vi.fn().mockReturnValue(mockRequest),
      }),
    } as unknown as ArgumentsHost;
  });

  it('should format a 404 NotFoundException correctly', () => {
    const exception = new NotFoundException('Resource not found');

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: 404,
        message: 'Resource not found',
        error: 'Not Found',
        path: '/api/v1/test',
      }),
    );
    const jsonCall = mockResponse.json.mock.calls[0][0];
    expect(jsonCall.timestamp).toBeDefined();
  });

  it('should format a 401 UnauthorizedException correctly', () => {
    const exception = new UnauthorizedException(
      'Email hoặc mật khẩu không chính xác',
    );

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: 401,
        message: 'Email hoặc mật khẩu không chính xác',
        error: 'Unauthorized',
        path: '/api/v1/test',
      }),
    );
  });

  it('should format a 403 ForbiddenException correctly', () => {
    const exception = new ForbiddenException('Tài khoản đã bị khóa');

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: 403,
        message: 'Tài khoản đã bị khóa',
        error: 'Forbidden',
        path: '/api/v1/test',
      }),
    );
  });

  it('should format a 409 ConflictException correctly', () => {
    const exception = new ConflictException('Email đã tồn tại');

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: 409,
        message: 'Email đã tồn tại',
        error: 'Conflict',
        path: '/api/v1/test',
      }),
    );
  });

  it('should format validation errors with an array of messages correctly (HTTP 400)', () => {
    const validationMessages = [
      'email must be an email',
      'password is too short',
    ];
    const exception = new BadRequestException({
      statusCode: 400,
      message: validationMessages,
      error: 'Bad Request',
    });

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: 400,
        message: validationMessages,
        error: 'Bad Request',
        path: '/api/v1/test',
      }),
    );
  });

  it('should handle string response from custom HttpException', () => {
    const exception = new HttpException(
      'Custom Error Message',
      HttpStatus.FORBIDDEN,
    );

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: 403,
        message: 'Custom Error Message',
        error: 'HttpException',
        path: '/api/v1/test',
      }),
    );
  });

  it('should handle unhandled/internal errors (500) without exposing stack trace', () => {
    const exception = new Error('Database unexpected failure');

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: 500,
        message: 'Internal server error',
        error: 'Internal Server Error',
        path: '/api/v1/test',
      }),
    );
    const jsonCall = mockResponse.json.mock.calls[0][0];
    expect(jsonCall).not.toHaveProperty('stack');
  });

  it('should not send response if headers are already sent', () => {
    mockResponse.headersSent = true;
    const exception = new UnauthorizedException();

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).not.toHaveBeenCalled();
    expect(mockResponse.json).not.toHaveBeenCalled();
  });

  it('should pass through if host type is not http', () => {
    mockArgumentsHost.getType = vi.fn().mockReturnValue('rpc');
    const exception = new BadRequestException();

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).not.toHaveBeenCalled();
    expect(mockResponse.json).not.toHaveBeenCalled();
  });
});
