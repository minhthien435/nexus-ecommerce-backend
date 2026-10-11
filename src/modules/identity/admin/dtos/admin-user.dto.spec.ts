import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AssignRoleDto } from './assign-role.dto.js';
import { ListUsersQueryDto } from './list-users-query.dto.js';

describe('admin user DTOs', () => {
  it('normalizes pagination, sorting and role filters', async () => {
    const dto = plainToInstance(ListUsersQueryDto, {
      page: '2',
      limit: '50',
      role: ' seller ',
      sortOrder: 'desc',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({
      page: 2,
      limit: 50,
      role: 'SELLER',
      sortOrder: 'DESC',
    });
  });

  it('rejects invalid statuses, excessive limits and malformed role codes', async () => {
    for (const input of [
      { status: 'DELETED' },
      { limit: '101' },
      { role: 'bad role' },
    ]) {
      expect(
        await validate(plainToInstance(ListUsersQueryDto, input)),
      ).not.toHaveLength(0);
    }
  });

  it('normalizes an assigned role code', async () => {
    const dto = plainToInstance(AssignRoleDto, { roleCode: ' seller ' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.roleCode).toBe('SELLER');
  });
});
