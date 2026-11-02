import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { Permissions } from '../rbac/decorators/permissions.decorator.js';
import { Roles } from '../rbac/decorators/roles.decorator.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RolesGuard } from '../rbac/guards/roles.guard.js';
import { RbacService } from '../rbac/rbac.service.js';
import { AdminUserService } from './admin-user.service.js';
import {
  AdminUserPasswordDto,
  AdminUserRolesDto,
  AdminUserStatusDto,
} from './dtos/admin-user-mutations.dto.js';
import { ListUsersQueryDto } from './dtos/list-users-query.dto.js';

@Roles('ADMIN')
@UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
@Controller('api/v1/identity/admin/users')
export class IdentityAdminUserController {
  constructor(
    private readonly users: AdminUserService,
    private readonly rbac: RbacService,
  ) {}

  @Permissions('USER.LIST')
  @Get()
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list(query);
  }

  @Permissions('USER.VIEW')
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.users.getById(id);
  }

  @Permissions('USER.UPDATE')
  @Patch(':id/status')
  status(
    @CurrentUserId() actorId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: AdminUserStatusDto,
  ) {
    return this.users.setStatus(actorId, id, input.status, input.reason);
  }

  @Patch(':id/roles')
  async roles(
    @CurrentUserId() actorId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: AdminUserRolesDto,
  ) {
    const assign = input.assign ?? [];
    const revoke = input.revoke ?? [];
    if (
      assign.length + revoke.length === 0 ||
      new Set([...assign, ...revoke]).size !== assign.length + revoke.length
    ) {
      throw new BadRequestException(
        'Role changes must be nonempty, unique and disjoint',
      );
    }
    const permissions = [
      ...(assign.length ? ['USER.ROLE.ASSIGN'] : []),
      ...(revoke.length ? ['USER.ROLE.REVOKE'] : []),
    ];
    if (!(await this.rbac.hasAllPermissions(actorId, permissions))) {
      throw new ForbiddenException('Required permission is missing');
    }
    return this.users.changeRoles(actorId, id, assign, revoke);
  }

  @Permissions('USER.CHANGE_PASSWORD')
  @Patch(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async password(
    @CurrentUserId() actorId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: AdminUserPasswordDto,
  ): Promise<void> {
    await this.users.resetPassword(actorId, id, input.newPassword);
  }
}
