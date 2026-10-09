import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Request } from 'express';

type AuthenticatedRequest = Request & { user?: { id?: unknown } };

export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const id = request.user?.id;

    if (typeof id !== 'string' || !isUUID(id)) {
      throw new UnauthorizedException();
    }

    return id;
  },
);
