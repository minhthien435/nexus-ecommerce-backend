import { UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { isUUID } from 'class-validator';
import { IsNull, Repository } from 'typeorm';
import type { Server, Socket } from 'socket.io';
import { UserEntity } from '../../identity/domain/user.entity.js';
import { ChatService } from '../chat.service.js';
import { SocketSendMessageDto } from '../dtos/chat.dto.js';
import { ChatEventsService } from './chat-events.service.js';

type AuthedSocket = Socket & { data: { userId?: string } };

@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: true, credentials: true },
})
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly chat: ChatService,
    private readonly events: ChatEventsService,
  ) {}
  afterInit(server: Server): void {
    this.events.bind(server);
  }
  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const header = client.handshake.headers.authorization;
      const token =
        (typeof client.handshake.auth?.token === 'string'
          ? client.handshake.auth.token
          : undefined) ??
        (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
      if (!token) throw new Error();
      const claims = await this.jwt.verifyAsync<{
        sub?: unknown;
        tokenVersion?: unknown;
      }>(token);
      if (
        typeof claims.sub !== 'string' ||
        !isUUID(claims.sub) ||
        !Number.isInteger(claims.tokenVersion)
      )
        throw new Error();
      const user = await this.users.findOne({
        where: { id: claims.sub, status: 'ACTIVE', deletedAt: IsNull() },
        select: { id: true, tokenVersion: true },
      });
      if (!user || user.tokenVersion !== claims.tokenVersion) throw new Error();
      client.data.userId = user.id;
      await client.join(`user:${user.id}`);
    } catch {
      client.disconnect(true);
    }
  }
  private id(client: AuthedSocket): string {
    if (!client.data.userId) throw new Error('Unauthorized');
    return client.data.userId;
  }
  @SubscribeMessage('message:send') async send(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: SocketSendMessageDto,
  ) {
    if (!isUUID(body.conversationId)) throw new Error('Invalid conversation');
    const result = await this.chat.send(
      this.id(client),
      body.conversationId,
      body.message,
    );
    client.emit('message:ack', result);
    return result;
  }
  @SubscribeMessage('typing') async typing(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId: string; isTyping: boolean },
  ) {
    if (!isUUID(body.conversationId) || typeof body.isTyping !== 'boolean')
      throw new Error('Invalid typing event');
    const userId = this.id(client);
    const recipient = await this.chat.counterpart(userId, body.conversationId);
    this.events.emit(recipient, 'typing', {
      conversationId: body.conversationId,
      userId,
      isTyping: body.isTyping,
    });
  }
  @SubscribeMessage('typing:start') async typingStart(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId: string },
  ) {
    return this.relayTyping(client, body.conversationId, true, 'typing:start');
  }
  @SubscribeMessage('typing:stop') async typingStop(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId: string },
  ) {
    return this.relayTyping(client, body.conversationId, false, 'typing:stop');
  }
  private async relayTyping(
    client: AuthedSocket,
    conversationId: string,
    isTyping: boolean,
    event: string,
  ) {
    if (!isUUID(conversationId)) throw new Error('Invalid conversation');
    const userId = this.id(client);
    const recipient = await this.chat.counterpart(userId, conversationId);
    this.events.emit(recipient, event, { conversationId, userId, isTyping });
  }
  @SubscribeMessage('message:read') async read(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId: string },
  ) {
    if (!isUUID(body.conversationId)) throw new Error('Invalid conversation');
    return this.chat.markRead(this.id(client), body.conversationId);
  }
}
