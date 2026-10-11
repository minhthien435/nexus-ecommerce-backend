import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { Permissions } from '../rbac/decorators/permissions.decorator.js';
import { Roles } from '../rbac/decorators/roles.decorator.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RolesGuard } from '../rbac/guards/roles.guard.js';
import { AdminUserService } from './admin-user.service.js';
import { AssignRoleDto } from './dtos/assign-role.dto.js';
import { ListUsersQueryDto } from './dtos/list-users-query.dto.js';

@Roles('ADMIN')
@UseGuards(AccessTokenGuard, RolesGuard, PermissionsGuard)
@Controller('api/v1/admin/users')
export class AdminUserController {
  constructor(private readonly users: AdminUserService) {}

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
  @Patch(':id/lock')
  lock(
    @CurrentUserId() actorId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.users.lock(actorId, id);
  }

  @Permissions('USER.UPDATE')
  @Patch(':id/unlock')
  unlock(
    @CurrentUserId() actorId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.users.unlock(actorId, id);
  }

  @Permissions('USER.ROLE.ASSIGN')
  @Post(':id/roles')
  assignRole(
    @CurrentUserId() actorId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: AssignRoleDto,
  ) {
    return this.users.assignRole(actorId, id, input.roleCode);
  }

  @Permissions('USER.ROLE.REVOKE')
  @Delete(':id/roles/:roleCode')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeRole(
    @CurrentUserId() actorId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('roleCode') roleCode: string,
  ): Promise<void> {
    await this.users.revokeRole(actorId, id, roleCode.trim().toUpperCase());
  }

  @Permissions('USER.DELETE')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUserId() actorId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.users.softDelete(actorId, id);
  }
}
