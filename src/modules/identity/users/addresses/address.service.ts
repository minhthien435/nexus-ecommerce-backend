import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CreateAddressDto } from '../dtos/create-address.dto.js';
import { UpdateAddressDto } from '../dtos/update-address.dto.js';
import { UserAddressEntity } from '../entities/user-address.entity.js';
import { ShippingLocationsService } from '../../../fulfillment/services/shipping-locations.service.js';

const MAX_ADDRESSES = 5;

@Injectable()
export class AddressService {
  constructor(
    @InjectRepository(UserAddressEntity)
    private readonly repository: Repository<UserAddressEntity>,
    private readonly dataSource: DataSource,
    @Optional() private readonly locations?: ShippingLocationsService,
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

      const resolved = await this.resolveLocation(
        input.addressScheme ?? 'legacy',
        input.provinceCode,
        input.wardCode,
      );
      return repository.save(
        repository.create({ ...input, ...resolved, userId }),
      );
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

      const scheme = changes.addressScheme ?? address.addressScheme ?? 'legacy';
      if (
        scheme === 'ghn_v3' &&
        address.addressScheme !== 'ghn_v3' &&
        (!changes.provinceCode || !changes.wardCode)
      ) {
        throw new BadRequestException(
          'Explicit province and ward are required to upgrade an address',
        );
      }
      if (
        scheme === 'legacy' &&
        address.addressScheme === 'ghn_v3' &&
        (!changes.provinceCode || !changes.districtCode || !changes.wardCode)
      ) {
        throw new BadRequestException(
          'Explicit legacy province, district and ward are required',
        );
      }
      const resolved = await this.resolveLocation(
        scheme,
        changes.provinceCode ?? address.provinceCode,
        changes.wardCode ?? address.wardCode,
      );
      Object.assign(address, changes, resolved);
      return repository.save(address);
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.repository.delete({ id, userId });
    if (result.affected !== 1) throw new NotFoundException('Address not found');
  }

  private async resolveLocation(
    scheme: 'legacy' | 'ghn_v3',
    provinceCode: string | null,
    wardCode: string | null,
  ) {
    if (scheme === 'legacy')
      return { addressScheme: scheme, provinceName: null, wardName: null };
    if (
      !this.locations ||
      !provinceCode ||
      !/^[1-9]\d*$/.test(provinceCode) ||
      !wardCode
    )
      throw new BadRequestException(
        'Valid GHN v3 province and ward are required',
      );
    const province = (await this.locations.newProvinces()).find(
      (item) => item.code === provinceCode,
    );
    const ward = (await this.locations.newWards(Number(provinceCode))).find(
      (item) => item.code === wardCode,
    );
    if (!province || !ward)
      throw new BadRequestException('Invalid GHN v3 province or ward');
    return {
      addressScheme: scheme,
      provinceName: province.name,
      wardName: ward.name,
      districtCode: null,
    };
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
