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

export type PublicProfile = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  roles: string[];
  trustLevel: string;
  addresses: UserAddressEntity[];
};

@Injectable()
export class ProfileService {
  constructor(
    @InjectRepository(ProfileUserEntity)
    private readonly users: Repository<ProfileUserEntity>,
    private readonly dataSource: DataSource,
    private readonly addresses: AddressService,
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
      this.dataSource.query<{ trust_level: string }[]>(
        `SELECT trust_level
           FROM identity.reputation_scores
          WHERE user_id = $1
          LIMIT 1`,
        [userId],
      ),
      this.addresses.list(userId),
    ]);

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      roles: roleRows.map(({ code }) => code),
      trustLevel: trustRows[0]?.trust_level ?? 'STANDARD',
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
      const result = await this.users
        .createQueryBuilder()
        .update(ProfileUserEntity)
        .set(changes)
        .where('id = :id', { id: userId })
        .andWhere('deleted_at IS NULL')
        .execute();
      if (result.affected !== 1) throw new NotFoundException('User not found');
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
