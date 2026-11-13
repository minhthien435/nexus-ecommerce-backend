import type {
  NotificationType,
  UserConfigurableNotificationChannel,
} from './notification.constants.js';

export interface NotifyUserInput {
  userId: string;
  type: NotificationType | string;
  title: string;
  content: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
  sourceEventId?: string;
  channels?: UserConfigurableNotificationChannel[];
  emailPayload?: {
    to: string;
    subject?: string;
    html?: string;
  };
}

export abstract class NotificationDispatchApi {
  abstract notify(input: NotifyUserInput): Promise<void>;
  abstract notifyMany(inputs: NotifyUserInput[]): Promise<void>;
}
