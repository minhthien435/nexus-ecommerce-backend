import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailModule } from '../../common/email/email.module.js';
import { UserEntity } from '../identity/domain/user.entity.js';
import { IdentityModule } from '../identity/identity.module.js';
import { NotificationController } from './controllers/notification.controller.js';
import { NotificationPreferenceEntity } from './entities/notification-preference.entity.js';
import { NotificationEntity } from './entities/notification.entity.js';
import { NotificationDispatchApi } from './notification-dispatch.api.js';
import { NotificationService } from './services/notification.service.js';
import { NotificationGateway } from './ws/notification.gateway.js';

@Module({
  imports: [
    forwardRef(() => IdentityModule),
    EmailModule,
    TypeOrmModule.forFeature([
      NotificationEntity,
      NotificationPreferenceEntity,
      UserEntity,
    ]),
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationGateway,
    { provide: NotificationDispatchApi, useExisting: NotificationService },
  ],
  exports: [NotificationDispatchApi],
})
export class NotificationModule {}
