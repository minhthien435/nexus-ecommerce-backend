import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UpdateProfileDto } from '../dtos/update-profile.dto.js';
import { ProfileUserEntity } from '../entities/profile-user.entity.js';

export type PublicProfile = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  roles: string[];
  trustLevel: string;
};

@Injectable()
export class ProfileService {
  constructor(
    @InjectRepository(ProfileUserEntity)
    private readonly users: Repository<ProfileUserEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async get(userId: string): Promise<PublicProfile> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        avatarUrl: true,
      },
    });
    if (!user) throw new NotFoundException();

    const [access] = await this.dataSource.query<
      { roles: string[] | null; trustLevel: string | null }[]
    >(
      `SELECT COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
              MAX(rs.trust_level) AS "trustLevel"
         FROM identity.users u
         LEFT JOIN identity.user_roles ur ON ur.user_id = u.id
         LEFT JOIN identity.roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
         LEFT JOIN identity.reputation_scores rs ON rs.user_id = u.id
        WHERE u.id = $1 AND u.deleted_at IS NULL
        GROUP BY u.id`,
      [userId],
    );
    if (!access) throw new NotFoundException();

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      roles: access.roles ?? [],
      trustLevel: access.trustLevel ?? 'STANDARD',
    };
  }

  async update(
    userId: string,
    input: UpdateProfileDto,
  ): Promise<PublicProfile> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException();

    if (input.fullName !== undefined) user.fullName = input.fullName;
    if (input.phone !== undefined) user.phone = input.phone;
    if (input.avatarUrl !== undefined) user.avatarUrl = input.avatarUrl;

    try {
      await this.users.save(user);
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException();
      throw error;
    }
    return this.get(userId);
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    );
  }
}
