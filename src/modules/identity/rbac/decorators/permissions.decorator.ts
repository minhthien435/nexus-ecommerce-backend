import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'identity:permissions';

export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
