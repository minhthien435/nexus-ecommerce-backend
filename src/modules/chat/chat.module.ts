import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { IdentityModule } from '../identity/identity.module.js';
import { UserEntity } from '../identity/domain/user.entity.js';
import { ChatConversationEntity } from './domain/entities/chat-conversation.entity.js';
import { ChatMessageEntity } from './domain/entities/chat-message.entity.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { ChatGateway } from './ws/chat.gateway.js';
import { ChatEventsService } from './ws/chat-events.service.js';

@Module({
  imports: [
    ConfigModule,
    IdentityModule,
    TypeOrmModule.forFeature([
      ChatConversationEntity,
      ChatMessageEntity,
      UserEntity,
    ]),
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, ChatEventsService],
  exports: [ChatService],
})
export class ChatModule {}
