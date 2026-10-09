import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAddressDto } from './create-address.dto.js';
import { UpdateAddressDto } from './update-address.dto.js';

const validCreatePayload = {
  provinceCode: '001',
  districtCode: '007',
  wardCode: '00031',
  addressLine: '12 Nguyen Trai',
  recipientPhone: '0912345678',
};

describe('address DTOs', () => {
  it('accepts valid create data, preserves leading zeroes, and defaults isDefault', async () => {
    const dto = plainToInstance(CreateAddressDto, validCreatePayload);

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.provinceCode).toBe('001');
    expect(dto.districtCode).toBe('007');
    expect(dto.wardCode).toBe('00031');
    expect(dto.isDefault).toBe(false);
  });

  it.each([
    'provinceCode',
    'districtCode',
    'wardCode',
    'addressLine',
    'recipientPhone',
  ] as const)('rejects create data missing %s', async (property) => {
    const payload = { ...validCreatePayload };
    delete payload[property];

    const errors = await validate(plainToInstance(CreateAddressDto, payload));

    expect(errors.map((error) => error.property)).toContain(property);
  });

  it.each(['09123abc78', '091234567', '09123456789'])(
    'rejects invalid recipientPhone %s',
    async (recipientPhone) => {
      const errors = await validate(
        plainToInstance(CreateAddressDto, {
          ...validCreatePayload,
          recipientPhone,
        }),
      );

      expect(errors.map((error) => error.property)).toContain('recipientPhone');
    },
  );

  it('rejects explicit null for create isDefault', async () => {
    const errors = await validate(
      plainToInstance(CreateAddressDto, {
        ...validCreatePayload,
        isDefault: null,
      }),
    );

    expect(errors.map((error) => error.property)).toContain('isDefault');
  });

  it('accepts a valid partial update', async () => {
    const dto = plainToInstance(UpdateAddressDto, { provinceCode: '001' });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an invalid supplied update field', async () => {
    const errors = await validate(
      plainToInstance(UpdateAddressDto, { recipientPhone: 'invalid' }),
    );

    expect(errors.map((error) => error.property)).toContain('recipientPhone');
  });

  it.each([
    'provinceCode',
    'districtCode',
    'wardCode',
    'addressLine',
    'recipientPhone',
    'isDefault',
  ] as const)('rejects explicit null for update %s', async (property) => {
    const errors = await validate(
      plainToInstance(UpdateAddressDto, { [property]: null }),
    );

    expect(errors.map((error) => error.property)).toContain(property);
  });
});
