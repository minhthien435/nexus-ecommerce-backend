import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto.js';

describe('UpdateProfileDto', () => {
  it('trims valid names and accepts nullable fields', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      fullName: '  Nguyen Van A  ',
      phone: null,
      avatarUrl: null,
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.fullName).toBe('Nguyen Van A');
  });

  it.each([
    { fullName: '   ' },
    { phone: '123' },
    { avatarUrl: 'ftp://example.com/a.png' },
    { avatarUrl: `https://example.com/${'a'.repeat(2048)}` },
  ])('rejects invalid payload %#', async (payload) => {
    expect(
      await validate(plainToInstance(UpdateProfileDto, payload)),
    ).not.toHaveLength(0);
  });
});
