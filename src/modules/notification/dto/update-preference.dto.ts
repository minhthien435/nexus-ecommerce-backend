import { IsBoolean, IsIn } from 'class-validator';
import {
  NOTIFICATION_TYPES,
  USER_CONFIGURABLE_NOTIFICATION_CHANNELS,
  type NotificationType,
  type UserConfigurableNotificationChannel,
} from '../notification.constants.js';

export class UpdateNotificationPreferenceDto {
  @IsIn(NOTIFICATION_TYPES)
  notificationType: NotificationType;

  @IsIn(USER_CONFIGURABLE_NOTIFICATION_CHANNELS)
  channel: UserConfigurableNotificationChannel;

  @IsBoolean()
  isEnabled: boolean;
}
