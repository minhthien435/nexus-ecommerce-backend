import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangePasswordDto } from './change-password.dto.js';

describe('ChangePasswordDto', () => {
  it('accepts a valid shared-policy password', async () => {
    expect(
      await validate(
        plainToInstance(ChangePasswordDto, {
          currentPassword: 'OldPassword1!',
          newPassword: 'NewPassword2!',
        }),
      ),
    ).toHaveLength(0);
  });

  it.each([
    {},
    { currentPassword: 1, newPassword: 'NewPassword2!' },
    { currentPassword: 'old', newPassword: 2 },
    { currentPassword: 'old', newPassword: 'weak' },
  ])('rejects missing, non-string, or weak values %#', async (input) => {
    expect(
      await validate(plainToInstance(ChangePasswordDto, input)),
    ).not.toHaveLength(0);
  });
});
