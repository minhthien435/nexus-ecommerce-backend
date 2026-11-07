import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { PERMISSIONS_KEY } from '../../identity/rbac/decorators/permissions.decorator.js';
import { ROLES_KEY } from '../../identity/rbac/decorators/roles.decorator.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import { RolesGuard } from '../../identity/rbac/guards/roles.guard.js';
import { SupportOrderCancelController } from './support-order-cancel.controller.js';

describe('SupportOrderCancelController security', () => {
  it('exposes the approved POST route with staff authorization', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, SupportOrderCancelController),
    ).toBe('api/v1/commerce/support/orders');
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SupportOrderCancelController),
    ).toEqual([AccessTokenGuard, RolesGuard, PermissionsGuard]);
    expect(
      Reflect.getMetadata(ROLES_KEY, SupportOrderCancelController),
    ).toEqual(['ADMIN', 'STAFF']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        SupportOrderCancelController.prototype.cancel,
      ),
    ).toEqual(['ORDER.CANCEL']);
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        SupportOrderCancelController.prototype.cancel,
      ),
    ).toBe(RequestMethod.POST);
  });
});
