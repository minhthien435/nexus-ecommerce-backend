import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { UserAddressEntity } from '../entities/user-address.entity.js';
import { AddressService } from './address.service.js';
import type { ShippingLocationsService } from '../../../fulfillment/services/shipping-locations.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const addressId = '22222222-2222-4222-8222-222222222222';

function address(
  overrides: Partial<UserAddressEntity> = {},
): UserAddressEntity {
  return Object.assign(new UserAddressEntity(), {
    id: addressId,
    userId,
    recipientName: 'A',
    recipientPhone: '0912345678',
    addressLine: '12 Street',
    provinceCode: '001',
    districtCode: '002',
    wardCode: '003',
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

function setup(count = 0) {
  const events: string[] = [];
  const saved = address();
  const transactionRepository = {
    count: vi.fn(async () => {
      events.push('count');
      return count;
    }),
    create: vi.fn((value) => Object.assign(saved, value)),
    save: vi.fn(async (value) => {
      events.push('save');
      return value;
    }),
    update: vi.fn(async () => {
      events.push('reset');
      return { affected: 1 };
    }),
    findOne: vi.fn(async () => saved),
  } as unknown as Repository<UserAddressEntity>;
  const manager = {
    query: vi.fn(async () => {
      events.push('lock');
      return [];
    }),
    getRepository: vi.fn(() => transactionRepository),
  } as unknown as EntityManager;
  const repository = {
    find: vi.fn(),
    delete: vi.fn(),
  } as unknown as Repository<UserAddressEntity>;
  const dataSource = {
    transaction: vi.fn(async (work: (manager: EntityManager) => unknown) =>
      work(manager),
    ),
  } as unknown as DataSource;

  return {
    service: new AddressService(repository, dataSource),
    repository,
    dataSource,
    transactionRepository,
    manager,
    events,
    saved,
  };
}

const createInput = {
  recipientName: 'A',
  recipientPhone: '0912345678',
  addressLine: '12 Street',
  provinceCode: '001',
  districtCode: '002',
  wardCode: '003',
  isDefault: false,
};

describe('AddressService', () => {
  it('resolves v3 names and saves them without a district', async () => {
    const { repository, dataSource, transactionRepository } = setup();
    const locations = {
      newProvinces: vi.fn(async () => [{ code: '1', name: 'Hà Nội' }]),
      newWards: vi.fn(async () => [{ code: '2', name: 'Ward' }]),
    } as unknown as ShippingLocationsService;
    const service = new AddressService(repository, dataSource, locations);
    await service.create(userId, {
      ...createInput,
      addressScheme: 'ghn_v3',
      provinceCode: '1',
      wardCode: '2',
    });
    expect(transactionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        addressScheme: 'ghn_v3',
        provinceName: 'Hà Nội',
        wardName: 'Ward',
        districtCode: null,
      }),
    );
  });

  it('requires explicit IDs when upgrading a legacy address', async () => {
    const { service, transactionRepository } = setup();
    await expect(
      service.update(userId, addressId, { addressScheme: 'ghn_v3' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transactionRepository.save).not.toHaveBeenCalled();
  });

  it('rejects a ward outside the selected v3 province without saving', async () => {
    const { repository, dataSource, transactionRepository } = setup();
    const locations = {
      newProvinces: vi.fn(async () => [{ code: '1', name: 'Hà Nội' }]),
      newWards: vi.fn(async () => [{ code: '2', name: 'Ward' }]),
    } as unknown as ShippingLocationsService;
    const service = new AddressService(repository, dataSource, locations);
    await expect(
      service.create(userId, {
        ...createInput,
        addressScheme: 'ghn_v3',
        provinceCode: '1',
        wardCode: '3',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transactionRepository.save).not.toHaveBeenCalled();
  });

  it('scopes list to the current user', async () => {
    const { service, repository } = setup();
    vi.mocked(repository.find).mockResolvedValue([]);

    await service.list(userId);

    expect(repository.find).toHaveBeenCalledWith({ where: { userId } });
  });

  it('locks before counting and saving a create', async () => {
    const { service, manager, events, saved } = setup();

    await expect(service.create(userId, createInput)).resolves.toBe(saved);
    expect(events).toEqual(['lock', 'count', 'save']);
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      [userId],
    );
  });

  it('rejects the sixth address without saving', async () => {
    const { service, transactionRepository } = setup(5);

    await expect(service.create(userId, createInput)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(transactionRepository.save).not.toHaveBeenCalled();
  });

  it('serializes concurrent creates at four addresses so only one succeeds', async () => {
    let total = 4;
    let tail = Promise.resolve();
    const dataSource = {
      transaction: async (work: (manager: EntityManager) => unknown) => {
        let release: () => void = () => {};
        const previous = tail;
        tail = new Promise<void>((resolve) => {
          release = resolve;
        });
        const repository = {
          count: vi.fn(async () => total),
          create: vi.fn((value) => value),
          save: vi.fn(async (value) => {
            total += 1;
            return value;
          }),
          update: vi.fn(),
        } as unknown as Repository<UserAddressEntity>;
        const manager = {
          query: vi.fn(async () => previous),
          getRepository: vi.fn(() => repository),
        } as unknown as EntityManager;
        try {
          return await work(manager);
        } finally {
          release();
        }
      },
    } as unknown as DataSource;
    const service = new AddressService(
      {} as Repository<UserAddressEntity>,
      dataSource,
    );

    const results = await Promise.allSettled([
      service.create(userId, createInput),
      service.create(userId, createInput),
    ]);

    expect(total).toBe(5);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
  });

  it('locks and clears only this user default before saving a new default', async () => {
    const { service, transactionRepository, events } = setup();

    await service.create(userId, { ...createInput, isDefault: true });

    expect(events).toEqual(['lock', 'count', 'reset', 'save']);
    expect(transactionRepository.update).toHaveBeenCalledWith(
      { userId, isDefault: true },
      { isDefault: false },
    );
  });

  it('serializes concurrent default transitions so at most one remains default', async () => {
    const secondId = '33333333-3333-4333-8333-333333333333';
    const rows = [address({ isDefault: true }), address({ id: secondId })];
    let tail = Promise.resolve();
    const dataSource = {
      transaction: async (work: (manager: EntityManager) => unknown) => {
        let release: () => void = () => {};
        const previous = tail;
        tail = new Promise<void>((resolve) => {
          release = resolve;
        });
        const repository = {
          findOne: vi.fn(async ({ where: { id, userId: owner } }) =>
            rows.find((row) => row.id === id && row.userId === owner),
          ),
          update: vi.fn(async () => {
            rows.forEach((row) => (row.isDefault = false));
            return { affected: rows.length };
          }),
          save: vi.fn(async (row) => row),
        } as unknown as Repository<UserAddressEntity>;
        const manager = {
          query: vi.fn(async () => previous),
          getRepository: vi.fn(() => repository),
        } as unknown as EntityManager;
        try {
          return await work(manager);
        } finally {
          release();
        }
      },
    } as unknown as DataSource;
    const service = new AddressService(
      {} as Repository<UserAddressEntity>,
      dataSource,
    );

    await Promise.all([
      service.update(userId, addressId, { isDefault: true }),
      service.update(userId, secondId, { isDefault: true }),
    ]);

    expect(rows.filter((row) => row.isDefault)).toHaveLength(1);
  });

  it('rejects an empty update before starting a transaction', async () => {
    const { service, dataSource } = setup();

    expect(() => service.update(userId, addressId, {})).toThrow(
      BadRequestException,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('conceals a missing or foreign address on update', async () => {
    const { service, transactionRepository } = setup();
    vi.mocked(transactionRepository.findOne).mockResolvedValue(null);

    await expect(
      service.update(userId, addressId, { recipientName: 'B' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transactionRepository.findOne).toHaveBeenCalledWith({
      where: { id: addressId, userId },
    });
    expect(transactionRepository.save).not.toHaveBeenCalled();
  });

  it('updates only the fields supplied by a partial update without locking user when isDefault is not true', async () => {
    const { service, manager, transactionRepository, saved } = setup();

    await expect(
      service.update(userId, addressId, { recipientName: 'B' }),
    ).resolves.toBe(saved);

    expect(saved.recipientName).toBe('B');
    expect(saved.addressLine).toBe('12 Street');
    expect(saved.recipientPhone).toBe('0912345678');
    expect(manager.query).not.toHaveBeenCalled();
    expect(transactionRepository.update).not.toHaveBeenCalled();
  });

  it('scopes delete to both address and user and returns 404 when absent', async () => {
    const { service, repository } = setup();
    vi.mocked(repository.delete).mockResolvedValue({ raw: [], affected: 0 });

    await expect(service.remove(userId, addressId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repository.delete).toHaveBeenCalledWith({ id: addressId, userId });
  });

  it('deletes a default address without promoting another address', async () => {
    const { service, repository, transactionRepository } = setup();
    vi.mocked(repository.delete).mockResolvedValue({ raw: [], affected: 1 });

    await expect(service.remove(userId, addressId)).resolves.toBeUndefined();

    expect(repository.delete).toHaveBeenCalledWith({ id: addressId, userId });
    expect(transactionRepository.update).not.toHaveBeenCalled();
  });
});
