import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { UserEntity } from './domain/user.entity.js';
import {
  IdentityPublicApi,
  type PublicIdentityUser,
} from './identity-public.api.js';
import { RbacService } from './rbac/rbac.service.js';

@Injectable()
export class IdentityPublicApiService extends IdentityPublicApi {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly rbac: RbacService,
    private readonly dataSource: DataSource,
  ) {
    super();
  }

  async getPublicUser(userId: string): Promise<PublicIdentityUser | null> {
    const user = await this.users.findOne({
      where: { id: userId, deletedAt: IsNull() },
      select: { id: true, fullName: true, status: true },
    });
    if (!user) return null;

    const [roles, trustRows] = await Promise.all([
      this.rbac.getRoles(userId),
      this.dataSource.query<Array<{ trust_level: string; rewarded: boolean }>>(
        `SELECT (SELECT trust_level FROM identity.reputation_scores WHERE user_id = $1) AS trust_level,
          EXISTS (SELECT 1 FROM identity.profile_completion_rewards WHERE user_id = $1) AS rewarded`,
        [userId],
      ),
    ]);
    return {
      id: user.id,
      fullName: user.fullName,
      status: user.status,
      roles,
      trustLevel: trustRows[0]?.trust_level ?? 'STANDARD',
      profileCompletionRewarded: trustRows[0]?.rewarded ?? false,
    };
  }

  async isActiveUser(userId: string): Promise<boolean> {
    return (
      (await this.users.count({
        where: { id: userId, status: 'ACTIVE', deletedAt: IsNull() },
      })) === 1
    );
  }

  getUserRoles(userId: string): Promise<string[]> {
    return this.rbac.getRoles(userId);
  }

  hasPermission(userId: string, permission: string): Promise<boolean> {
    return this.rbac.hasAllPermissions(userId, [permission]);
  }
}
