import { ExecutionContext, CallHandler, HttpStatus } from '@nestjs/common';
import { of, throwError, firstValueFrom } from 'rxjs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Buffer } from 'node:buffer';
import { TransformInterceptor } from './transform.interceptor.js';

describe('TransformInterceptor', () => {
  let interceptor: TransformInterceptor<unknown>;
  let mockExecutionContext: ExecutionContext;
  let mockCallHandler: CallHandler;
  let mockResponse: { statusCode: number; headersSent: boolean };

  beforeEach(() => {
    interceptor = new TransformInterceptor();
    mockResponse = {
      statusCode: 200,
      headersSent: false,
    };
    mockExecutionContext = {
      getType: vi.fn().mockReturnValue('http'),
      switchToHttp: vi.fn().mockReturnValue({
        getResponse: vi.fn().mockReturnValue(mockResponse),
      }),
    } as unknown as ExecutionContext;
  });

  it('should wrap a plain object in standard envelope format', async () => {
    const data = { id: 1, name: 'Test User' };
    mockCallHandler = { handle: vi.fn().mockReturnValue(of(data)) };

    const observable = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );
    const result = await firstValueFrom(observable);

    expect(result).toEqual({
      success: true,
      data: { id: 1, name: 'Test User' },
    });
  });

  it('should wrap an array in standard envelope format', async () => {
    const data = [{ id: 1 }, { id: 2 }];
    mockCallHandler = { handle: vi.fn().mockReturnValue(of(data)) };

    const observable = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );
    const result = await firstValueFrom(observable);

    expect(result).toEqual({
      success: true,
      data: [{ id: 1 }, { id: 2 }],
    });
  });

  it('should wrap a string in standard envelope format', async () => {
    const data = 'Hello World';
    mockCallHandler = { handle: vi.fn().mockReturnValue(of(data)) };

    const observable = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );
    const result = await firstValueFrom(observable);

    expect(result).toEqual({
      success: true,
      data: 'Hello World',
    });
  });

  it('should not double-wrap data that already has a standard envelope structure', async () => {
    const envelopeData = { success: true, data: { id: 1 } };
    mockCallHandler = { handle: vi.fn().mockReturnValue(of(envelopeData)) };

    const observable = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );
    const result = await firstValueFrom(observable);

    expect(result).toEqual({
      success: true,
      data: { id: 1 },
    });
  });

  it('should handle null by wrapping it as { success: true, data: null }', async () => {
    mockCallHandler = { handle: vi.fn().mockReturnValue(of(null)) };

    const observable = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );
    const result = await firstValueFrom(observable);

    expect(result).toEqual({
      success: true,
      data: null,
    });
  });

  it('should handle undefined by wrapping it as { success: true, data: null }', async () => {
    mockCallHandler = { handle: vi.fn().mockReturnValue(of(undefined)) };

    const observable = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );
    const result = await firstValueFrom(observable);

    expect(result).toEqual({
      success: true,
      data: null,
    });
  });

  it('should re-throw errors emitted from Observable without converting to success response', async () => {
    const testError = new Error('Database connection failed');
    mockCallHandler = {
      handle: vi.fn().mockReturnValue(throwError(() => testError)),
    };

    const observable = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );

    await expect(firstValueFrom(observable)).rejects.toThrow(
      'Database connection failed',
    );
  });

  it('should not wrap response when HTTP status is 204 NO_CONTENT', async () => {
    mockResponse.statusCode = HttpStatus.NO_CONTENT;
    mockCallHandler = { handle: vi.fn().mockReturnValue(of(undefined)) };

    const observable = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );
    const result = await firstValueFrom(observable);

    expect(result).toBeUndefined();
  });

  it('should not wrap response when response.headersSent is true', async () => {
    mockResponse.headersSent = true;
    const data = { raw: 'already-sent' };
    mockCallHandler = { handle: vi.fn().mockReturnValue(of(data)) };

    const observable = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );
    const result = await firstValueFrom(observable);

    expect(result).toEqual(data);
  });

  it('should not wrap Stream response with a pipe method', async () => {
    const mockStream = { pipe: vi.fn(), on: vi.fn() };
    mockCallHandler = { handle: vi.fn().mockReturnValue(of(mockStream)) };

    const observable = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );
    const result = await firstValueFrom(observable);

    expect(result).toBe(mockStream);
  });

  it('should not wrap Buffer response', async () => {
    const bufferData = Buffer.from('binary data');
    mockCallHandler = { handle: vi.fn().mockReturnValue(of(bufferData)) };

    const observable = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );
    const result = await firstValueFrom(observable);

    expect(result).toBe(bufferData);
  });

  it('should pass through when execution context type is not http', async () => {
    mockExecutionContext.getType = vi.fn().mockReturnValue('rpc');
    const data = { rpcResult: 'ok' };
    mockCallHandler = { handle: vi.fn().mockReturnValue(of(data)) };

    const observable = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );
    const result = await firstValueFrom(observable);

    expect(result).toEqual(data);
  });
});
