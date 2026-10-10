import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto.js';

async function errors(input: object) {
  return validate(plainToInstance(UpdateProfileDto, input));
}

describe('UpdateProfileDto', () => {
  it('trims a valid full name and accepts nullable fields', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      fullName: '  Nguyen Van A  ',
      phone: null,
      avatarUrl: null,
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.fullName).toBe('Nguyen Van A');
  });

  it.each([
    { fullName: '' },
    { fullName: '   ' },
    { fullName: null },
    { phone: '123' },
    { avatarUrl: 'ftp://example.com/avatar.png' },
    { avatarUrl: `https://example.com/${'a'.repeat(2040)}` },
  ])('rejects invalid profile input %#', async (input) => {
    expect(await errors(input)).not.toHaveLength(0);
  });
});
