import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateSkuDto } from './create-sku.dto.js';
import { UpdateSkuDto } from './update-sku.dto.js';

describe('SKU DTOs', () => {
  const validCreate = {
    attributes: { color: 'Black', storage: '256 GB' },
    price: 1200000,
    weightGrams: 400,
    lengthCm: 20,
    widthCm: 10,
    heightCm: 5,
  };

  it('accepts a complete create payload', async () => {
    const errors = await validate(plainToInstance(CreateSkuDto, validCreate));
    expect(errors).toHaveLength(0);
  });

  it.each([
    ['weightGrams', 0],
    ['lengthCm', 0],
    ['widthCm', -1],
    ['heightCm', 0],
  ])('rejects non-positive %s', async (field, value) => {
    const errors = await validate(
      plainToInstance(CreateSkuDto, { ...validCreate, [field]: value }),
    );
    expect(errors.some((error) => error.property === field)).toBe(true);
  });

  it.each([{}, [], { color: '' }, { color: 42 }, { '   ': 'black' }])(
    'rejects invalid attribute objects',
    async (attributes) => {
      const errors = await validate(
        plainToInstance(CreateSkuDto, { ...validCreate, attributes }),
      );
      expect(errors.some((error) => error.property === 'attributes')).toBe(
        true,
      );
    },
  );

  it('rejects an empty update payload', async () => {
    const errors = await validate(plainToInstance(UpdateSkuDto, {}));
    expect(errors.some((error) => error.property === 'price')).toBe(true);
  });

  it('accepts a partial update payload', async () => {
    const errors = await validate(
      plainToInstance(UpdateSkuDto, { weightGrams: 500 }),
    );
    expect(errors).toHaveLength(0);
  });

  it.each([
    'attributes',
    'price',
    'currency',
    'weightGrams',
    'lengthCm',
    'widthCm',
    'heightCm',
    'isActive',
  ])('rejects explicit null for optional update field %s', async (field) => {
    const errors = await validate(
      plainToInstance(UpdateSkuDto, { [field]: null }),
    );
    expect(errors.some((error) => error.property === field)).toBe(true);
  });
});
