import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { Permissions } from '../../identity/rbac/decorators/permissions.decorator.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import { ListNotificationsQueryDto } from '../dto/list-notifications.query.dto.js';
import { UpdateNotificationPreferenceDto } from '../dto/update-preference.dto.js';
import { NotificationService } from '../services/notification.service.js';

@Controller('api/v1/notifications')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @Permissions('NOTIFICATION.VIEW')
  async list(
    @CurrentUserId() userId: string,
    @Query() query: ListNotificationsQueryDto,
  ) {
    const result = await this.notifications.listForUser(userId, query);
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Lấy danh sách thông báo thành công',
      data: result.items,
      meta: result.meta,
    };
  }

  @Get('unread-count')
  @Permissions('NOTIFICATION.VIEW')
  async unreadCount(@CurrentUserId() userId: string) {
    return { unreadCount: await this.notifications.getUnreadCount(userId) };
  }

  @Patch('read-all')
  @Permissions('NOTIFICATION.VIEW')
  markAllAsRead(@CurrentUserId() userId: string) {
    return this.notifications.markAllAsRead(userId);
  }

  @Get('preferences')
  @Permissions('NOTIFICATION.MANAGE_PREFERENCE')
  preferences(@CurrentUserId() userId: string) {
    return this.notifications.getPreferences(userId);
  }

  @Patch('preferences')
  @Permissions('NOTIFICATION.MANAGE_PREFERENCE')
  updatePreference(
    @CurrentUserId() userId: string,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    return this.notifications.updatePreference(userId, dto);
  }

  @Patch(':id/read')
  @Permissions('NOTIFICATION.VIEW')
  markAsRead(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) notificationId: string,
  ) {
    return this.notifications.markAsRead(userId, notificationId);
  }
}
