import { BadRequestException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { DataSource, IsNull } from 'typeorm';
import { RefreshTokenEntity } from '../../domain/refresh-token.entity.js';
import { UserEntity } from '../../domain/user.entity.js';
import { ChangePasswordDto } from '../dtos/change-password.dto.js';

@Injectable()
export class PasswordService {
  constructor(private readonly dataSource: DataSource) {}

  async changePassword(
    userId: string,
    input: ChangePasswordDto,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(UserEntity);
      const user = await users
        .createQueryBuilder('user')
        .setLock('pessimistic_write')
        .where('user.id = :userId', { userId })
        .andWhere('user.deleted_at IS NULL')
        .andWhere('user.status = :status', { status: 'ACTIVE' })
        .getOne();
      if (
        !user ||
        !(await argon2.verify(user.passwordHash, input.currentPassword))
      ) {
        throw new BadRequestException('Current password is incorrect');
      }
      if (await argon2.verify(user.passwordHash, input.newPassword)) {
        throw new BadRequestException(
          'New password must be different from current password',
        );
      }
      user.passwordHash = await argon2.hash(input.newPassword, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
      });
      user.tokenVersion += 1;
      await users.save(user);
      await manager
        .getRepository(RefreshTokenEntity)
        .update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
    });
  }
}
