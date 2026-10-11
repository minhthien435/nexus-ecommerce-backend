import { PERMISSIONS_KEY, Permissions } from './permissions.decorator.js';
import { ROLES_KEY, Roles } from './roles.decorator.js';

describe('RBAC decorators', () => {
  it('stores role and permission metadata on a handler', () => {
    class Controller {
      @Roles('ADMIN', 'STAFF')
      @Permissions('USER.VIEW', 'USER.UPDATE')
      handler() {}
    }

    expect(
      Reflect.getMetadata(ROLES_KEY, Controller.prototype.handler),
    ).toEqual(['ADMIN', 'STAFF']);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, Controller.prototype.handler),
    ).toEqual(['USER.VIEW', 'USER.UPDATE']);
  });
});
