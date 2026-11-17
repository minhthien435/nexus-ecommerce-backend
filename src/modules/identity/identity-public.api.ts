import type { UserStatus } from './domain/user-status.js';

export type PublicIdentityUser = {
  id: string;
  fullName: string;
  status: UserStatus;
  roles: string[];
  trustLevel: string;
  profileCompletionRewarded: boolean;
};

export abstract class IdentityPublicApi {
  abstract getPublicUser(userId: string): Promise<PublicIdentityUser | null>;
  abstract isActiveUser(userId: string): Promise<boolean>;
  abstract getUserRoles(userId: string): Promise<string[]>;
  abstract hasPermission(userId: string, permission: string): Promise<boolean>;
}
