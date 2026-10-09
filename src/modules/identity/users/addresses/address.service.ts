import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CreateAddressDto } from '../dtos/create-address.dto.js';
import { UpdateAddressDto } from '../dtos/update-address.dto.js';
import { UserAddressEntity } from '../entities/user-address.entity.js';

const MAX_ADDRESSES = 5;

@Injectable()
export class AddressService {
  constructor(
    @InjectRepository(UserAddressEntity)
    private readonly repository: Repository<UserAddressEntity>,
    private readonly dataSource: DataSource,
  ) {}

  list(userId: string): Promise<UserAddressEntity[]> {
    return this.repository.find({ where: { userId } });
  }

  create(userId: string, input: CreateAddressDto): Promise<UserAddressEntity> {
    return this.dataSource.transaction(async (manager) => {
      await this.lockUser(manager, userId);
      const repository = manager.getRepository(UserAddressEntity);
      if ((await repository.count({ where: { userId } })) >= MAX_ADDRESSES) {
        throw new ConflictException('Address limit reached');
      }
      if (input.isDefault) await this.clearDefault(repository, userId);

      return repository.save(repository.create({ ...input, userId }));
    });
  }

  update(
    userId: string,
    id: string,
    input: UpdateAddressDto,
  ): Promise<UserAddressEntity> {
    const changes = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as UpdateAddressDto;
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('At least one update field is required');
    }

    return this.dataSource.transaction(async (manager) => {
      if (changes.isDefault === true) await this.lockUser(manager, userId);
      const repository = manager.getRepository(UserAddressEntity);
      const address = await repository.findOne({ where: { id, userId } });
      if (!address) throw new NotFoundException('Address not found');
      if (changes.isDefault === true)
        await this.clearDefault(repository, userId);

      Object.assign(address, changes);
      return repository.save(address);
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.repository.delete({ id, userId });
    if (result.affected !== 1) throw new NotFoundException('Address not found');
  }

  private lockUser(manager: EntityManager, userId: string): Promise<unknown> {
    return manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [userId],
    );
  }

  private async clearDefault(
    repository: Repository<UserAddressEntity>,
    userId: string,
  ): Promise<void> {
    await repository.update({ userId, isDefault: true }, { isDefault: false });
  }
}
