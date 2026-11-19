import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { UpdateProfileDto } from '../dtos/update-profile.dto.js';
import { ProfileUserEntity } from '../entities/profile-user.entity.js';
import { UserAddressEntity } from '../entities/user-address.entity.js';
import { AddressService } from '../addresses/address.service.js';
import { IdentityReputationApi } from '../../identity-reputation.api.js';

export type PublicProfile = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  roles: string[];
  reputationScore: number;
  trustLevel: string;
  profileCompletionRewarded: boolean;
  addresses: UserAddressEntity[];
};

@Injectable()
export class ProfileService {
  constructor(
    @InjectRepository(ProfileUserEntity)
    private readonly users: Repository<ProfileUserEntity>,
    private readonly dataSource: DataSource,
    private readonly addresses: AddressService,
    private readonly reputation: IdentityReputationApi,
  ) {}

  async getProfile(userId: string): Promise<PublicProfile> {
    const user = await this.users.findOne({
      where: { id: userId, deletedAt: IsNull() },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        avatarUrl: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const [roleRows, trustRows, addresses] = await Promise.all([
      this.dataSource.query<{ code: string }[]>(
        `SELECT DISTINCT r.code
           FROM identity.user_roles ur
           JOIN identity.roles r ON r.id = ur.role_id
          WHERE ur.user_id = $1 AND r.deleted_at IS NULL
          ORDER BY r.code`,
        [userId],
      ),
      this.dataSource.query<
        {
          trust_level: string | null;
          score: number | string | null;
          rewarded: boolean;
        }[]
      >(
        `SELECT r.trust_level, r.score,
          EXISTS (SELECT 1 FROM identity.profile_completion_rewards WHERE user_id = $1) AS rewarded
         FROM (SELECT 1) AS _
         LEFT JOIN identity.reputation_scores r ON r.user_id = $1`,
        [userId],
      ),
      this.addresses.list(userId),
    ]);

    const rawScore = trustRows[0]?.score;
    const reputationScore =
      rawScore !== undefined &&
      rawScore !== null &&
      Number.isFinite(Number(rawScore))
        ? Number(rawScore)
        : 50;

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      roles: roleRows.map(({ code }) => code),
      reputationScore,
      trustLevel: trustRows[0]?.trust_level ?? 'STANDARD',
      profileCompletionRewarded: trustRows[0]?.rewarded ?? false,
      addresses: addresses.map((addr) => {
        const { userId: _, ...rest } = addr;
        return rest as unknown as typeof addr;
      }),
    };
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileDto,
  ): Promise<PublicProfile> {
    const changes = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    );

    try {
      await this.dataSource.transaction(async (manager) => {
        const result = await manager
          .getRepository(ProfileUserEntity)
          .createQueryBuilder()
          .update(ProfileUserEntity)
          .set(changes)
          .where('id = :id', { id: userId })
          .andWhere('deleted_at IS NULL')
          .execute();
        if (result.affected !== 1)
          throw new NotFoundException('User not found');
        await this.reputation.rewardProfileCompletion(userId, manager);
      });
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        throw new ConflictException('Phone already exists');
      }
      throw error;
    }

    return this.getProfile(userId);
  }
}
