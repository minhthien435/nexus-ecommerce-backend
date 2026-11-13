import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type FindOptionsWhere, Repository } from 'typeorm';
import { EmailService } from '../../../common/email/email.service.js';
import { ListNotificationsQueryDto } from '../dto/list-notifications.query.dto.js';
import { UpdateNotificationPreferenceDto } from '../dto/update-preference.dto.js';
import { NotificationPreferenceEntity } from '../entities/notification-preference.entity.js';
import { NotificationEntity } from '../entities/notification.entity.js';
import {
  MANDATORY_NOTIFICATION_TYPES,
  NOTIFICATION_TYPES,
  USER_CONFIGURABLE_NOTIFICATION_CHANNELS,
  type UserConfigurableNotificationChannel,
} from '../notification.constants.js';
import {
  NotificationDispatchApi,
  type NotifyUserInput,
} from '../notification-dispatch.api.js';
import { NotificationGateway } from '../ws/notification.gateway.js';

@Injectable()
export class NotificationService extends NotificationDispatchApi {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notifications: Repository<NotificationEntity>,
    @InjectRepository(NotificationPreferenceEntity)
    private readonly preferences: Repository<NotificationPreferenceEntity>,
    private readonly gateway: NotificationGateway,
    private readonly email: EmailService,
  ) {
    super();
  }

  async notify(input: NotifyUserInput): Promise<void> {
    try {
      const requestedChannels: UserConfigurableNotificationChannel[] =
        input.channels ?? ['PUSH'];
      const channels = [...new Set(requestedChannels)];
      for (const channel of channels) {
        if (!(await this.isEnabled(input.userId, input.type, channel)))
          continue;
        if (channel === 'PUSH') await this.push(input);
        if (channel === 'EMAIL') await this.sendEmail(input);
      }
    } catch (error) {
      this.logger.error(
        `Notification dispatch failed for user ${input.userId}: ${this.errorMessage(error)}`,
      );
    }
  }

  async notifyMany(inputs: NotifyUserInput[]): Promise<void> {
    await Promise.allSettled(inputs.map((input) => this.notify(input)));
  }

  async listForUser(userId: string, query: ListNotificationsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: FindOptionsWhere<NotificationEntity> = {
      userId,
      channel: 'PUSH',
    };
    if (query.unreadOnly) where.readAt = IsNull();
    if (query.type) where.notificationType = query.type;
    const [[rows, totalItems], unreadCount] = await Promise.all([
      this.notifications.findAndCount({
        where,
        order: { createdAt: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.getUnreadCount(userId),
    ]);
    return {
      items: rows.map((row) => this.toPayload(row)),
      meta: {
        page,
        limit,
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
        unreadCount,
      },
    };
  }

  getUnreadCount(userId: string): Promise<number> {
    return this.notifications.count({
      where: { userId, channel: 'PUSH', readAt: IsNull() },
    });
  }

  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.notifications.findOne({
      where: { id: notificationId, userId, channel: 'PUSH' },
    });
    if (!notification) throw new NotFoundException('Notification not found');
    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.notifications.save(notification);
    }
    const unreadCount = await this.getUnreadCount(userId);
    this.gateway.emitUnreadCount(userId, unreadCount);
    return { notification: this.toPayload(notification), unreadCount };
  }

  async markAllAsRead(userId: string): Promise<{ unreadCount: number }> {
    await this.notifications.update(
      { userId, channel: 'PUSH', readAt: IsNull() },
      { readAt: new Date() },
    );
    this.gateway.emitUnreadCount(userId, 0);
    return { unreadCount: 0 };
  }

  async getPreferences(userId: string) {
    const saved = await this.preferences.find({ where: { userId } });
    const indexed = new Map(
      saved.map((item) => [
        `${item.notificationType}:${item.channel}`,
        item.isEnabled,
      ]),
    );
    return NOTIFICATION_TYPES.flatMap((notificationType) =>
      USER_CONFIGURABLE_NOTIFICATION_CHANNELS.map((channel) => ({
        notificationType,
        channel,
        isEnabled:
          MANDATORY_NOTIFICATION_TYPES.has(notificationType) ||
          (indexed.get(`${notificationType}:${channel}`) ?? true),
      })),
    );
  }

  async updatePreference(userId: string, dto: UpdateNotificationPreferenceDto) {
    const isEnabled = MANDATORY_NOTIFICATION_TYPES.has(dto.notificationType)
      ? true
      : dto.isEnabled;
    await this.preferences.upsert(
      {
        userId,
        notificationType: dto.notificationType,
        channel: dto.channel,
        isEnabled,
      },
      ['userId', 'notificationType', 'channel'],
    );
    return { ...dto, isEnabled };
  }

  private async push(input: NotifyUserInput): Promise<void> {
    const notification = await this.createDelivery(input, 'PUSH', 'SENT');
    if (!notification) return;
    const unreadCount = await this.getUnreadCount(input.userId);
    this.gateway.emitToUser(
      input.userId,
      this.toPayload(notification),
      unreadCount,
    );
  }

  private async sendEmail(input: NotifyUserInput): Promise<void> {
    if (!input.emailPayload?.to) {
      this.logger.warn(
        `Skipped EMAIL notification without recipient: ${input.type}`,
      );
      return;
    }
    const notification = await this.createDelivery(input, 'EMAIL', 'PENDING');
    if (!notification) return;
    try {
      await this.email.sendNotification({
        recipient: input.emailPayload.to,
        subject: input.emailPayload.subject ?? input.title,
        text: input.content,
        html: input.emailPayload.html,
      });
      notification.status = 'SENT';
      notification.sentAt = new Date();
    } catch (error) {
      notification.status = 'FAILED';
      notification.retryCount += 1;
      this.logger.error(
        `Notification email failed for ${input.userId}: ${this.errorMessage(error)}`,
      );
    }
    await this.notifications.save(notification);
  }

  private async createDelivery(
    input: NotifyUserInput,
    channel: UserConfigurableNotificationChannel,
    status: 'PENDING' | 'SENT',
  ): Promise<NotificationEntity | null> {
    const now = new Date();
    const entity = this.notifications.create({
      userId: input.userId,
      sourceEventId: input.sourceEventId ?? null,
      notificationType: input.type,
      channel,
      title: input.title,
      content: input.content,
      status,
      retryCount: 0,
      nextRetryAt: null,
      sentAt: status === 'SENT' ? now : null,
      readAt: null,
      actionUrl: input.actionUrl ?? null,
      metadata: input.metadata ?? null,
    });
    try {
      return await this.notifications.save(entity);
    } catch (error) {
      if (this.postgresCode(error) === '23505' && input.sourceEventId) {
        return null;
      }
      throw error;
    }
  }

  private async isEnabled(
    userId: string,
    type: string,
    channel: UserConfigurableNotificationChannel,
  ): Promise<boolean> {
    if (MANDATORY_NOTIFICATION_TYPES.has(type)) return true;
    const preference = await this.preferences.findOne({
      where: { userId, notificationType: type, channel },
      select: { isEnabled: true },
    });
    return preference?.isEnabled ?? true;
  }

  private toPayload(notification: NotificationEntity) {
    return {
      id: notification.id,
      title: notification.title,
      content: notification.content,
      type: notification.notificationType,
      isRead: Boolean(notification.readAt),
      actionUrl: notification.actionUrl,
      metadata: notification.metadata,
      createdAt: notification.createdAt,
    };
  }

  private postgresCode(error: unknown): string | undefined {
    const candidate = error as {
      code?: string;
      driverError?: { code?: string };
    };
    return candidate?.code ?? candidate?.driverError?.code;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
