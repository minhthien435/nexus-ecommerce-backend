import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { isUUID } from 'class-validator';
import type { Server, Socket } from 'socket.io';
import { IsNull, Repository } from 'typeorm';
import { UserEntity } from '../../identity/domain/user.entity.js';
import { NotificationEntity } from '../entities/notification.entity.js';

type AuthedSocket = Socket & { data: { userId?: string } };

export interface NotificationSocketPayload {
  id: string;
  title: string;
  content: string;
  type: string;
  isRead: boolean;
  actionUrl: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

@WebSocketGateway({
  namespace: '/notification',
  cors: { origin: true, credentials: true },
})
export class NotificationGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(NotificationEntity)
    private readonly notifications: Repository<NotificationEntity>,
  ) {}

  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const token = this.token(client);
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
      const unreadCount = await this.notifications.count({
        where: { userId: user.id, channel: 'PUSH', readAt: IsNull() },
      });
      client.emit('notification:unread-count', { unreadCount });
    } catch {
      client.disconnect(true);
    }
  }

  emitToUser(
    userId: string,
    notification: NotificationSocketPayload,
    unreadCount: number,
  ): void {
    const room = this.server.to(`user:${userId}`);
    room.emit('notification:new', notification);
    room.emit('notification:unread-count', { unreadCount });
  }

  emitUnreadCount(userId: string, unreadCount: number): void {
    this.server
      .to(`user:${userId}`)
      .emit('notification:unread-count', { unreadCount });
  }

  private token(client: AuthedSocket): string | undefined {
    const authToken = client.handshake.auth?.token;
    const headerToken = client.handshake.headers.authorization;
    const value =
      (typeof authToken === 'string' ? authToken : undefined) ?? headerToken;
    if (!value) return undefined;
    return value.startsWith('Bearer ') ? value.slice(7) : value;
  }
}
