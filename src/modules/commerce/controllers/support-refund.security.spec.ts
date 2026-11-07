import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { PERMISSIONS_KEY } from '../../identity/rbac/decorators/permissions.decorator.js';
import { ROLES_KEY } from '../../identity/rbac/decorators/roles.decorator.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import { RolesGuard } from '../../identity/rbac/guards/roles.guard.js';
import { SupportRefundController } from './support-refund.controller.js';

describe('SupportRefundController security', () => {
  it('requires auth, ADMIN/STAFF role and ORDER.REFUND permission', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SupportRefundController),
    ).toEqual([AccessTokenGuard, RolesGuard, PermissionsGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, SupportRefundController)).toEqual([
      'ADMIN',
      'STAFF',
    ]);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, SupportRefundController),
    ).toEqual(['ORDER.REFUND']);
  });
});
