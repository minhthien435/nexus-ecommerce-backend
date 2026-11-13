import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { IsOptional, IsString, isUUID, MaxLength } from 'class-validator';
import { IsNull, Repository } from 'typeorm';
import type { Server, Socket } from 'socket.io';
import { UserEntity } from '../../identity/domain/user.entity.js';
import { AuctionService } from '../auction.service.js';
import { AuctionEventsService } from './auction-events.service.js';

export class AuctionRoomPayloadDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  auctionId?: string;
}

type AuctionSocket = Socket & {
  data: {
    userId?: string;
    isGuest?: boolean;
  };
};

@WebSocketGateway({
  namespace: '/auction',
  cors: { origin: true, credentials: true },
})
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class AuctionGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(AuctionGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly auctionService: AuctionService,
    private readonly events: AuctionEventsService,
  ) {}

  afterInit(server: Server): void {
    this.events.bind(server);
  }

  async handleConnection(client: AuctionSocket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      // Guest viewers may connect to watch live auction rooms; bidding goes via REST + AccessTokenGuard.
      client.data.isGuest = true;
      return;
    }

    try {
      const claims = await this.jwt.verifyAsync<{
        sub?: unknown;
        tokenVersion?: unknown;
      }>(token);
      if (
        typeof claims.sub !== 'string' ||
        !isUUID(claims.sub) ||
        !Number.isInteger(claims.tokenVersion)
      ) {
        throw new Error('INVALID_CLAIMS');
      }

      const user = await this.users.findOne({
        where: { id: claims.sub, status: 'ACTIVE', deletedAt: IsNull() },
        select: { id: true, tokenVersion: true },
      });
      if (!user || user.tokenVersion !== claims.tokenVersion) {
        throw new Error('USER_INVALID_OR_REVOKED');
      }

      client.data.userId = user.id;
      client.data.isGuest = false;
    } catch (error) {
      this.logger.debug(
        `Rejected /auction socket ${client.id}: ${(error as Error).message}`,
      );
      client.disconnect(true);
    }
  }

  @SubscribeMessage('joinAuction')
  async handleJoinAuction(
    @ConnectedSocket() client: AuctionSocket,
    @MessageBody() payload: AuctionRoomPayloadDto,
  ) {
    const identifier = this.pickIdentifier(payload);
    if (!identifier) {
      return {
        ok: false,
        errorCode: 'INVALID_AUCTION_IDENTIFIER',
        message: 'Thiếu sessionId hoặc auctionId để tham gia phòng đấu giá',
      };
    }

    const auction =
      await this.auctionService.resolveAuctionIdentity(identifier);
    if (!auction) {
      return {
        ok: false,
        errorCode: 'AUCTION_NOT_FOUND',
        message: 'Không tìm thấy phiên đấu giá',
      };
    }

    await client.join(this.events.roomName(auction.id));

    const nowMs = Date.now();
    const endMs = auction.endsAt ? new Date(auction.endsAt).getTime() : nowMs;
    const remainingSeconds = Math.max(0, Math.floor((endMs - nowMs) / 1000));

    return {
      ok: true,
      sessionId: auction.id,
      auctionId: auction.id,
      auctionCode: auction.code ?? null,
      status: this.auctionService.mapStatus(auction),
      currentPrice: Number(auction.currentPrice),
      highestBidderId: auction.highestBidderId ?? null,
      serverTime: new Date(nowMs).toISOString(),
      remainingSeconds,
    };
  }

  @SubscribeMessage('leaveAuction')
  async handleLeaveAuction(
    @ConnectedSocket() client: AuctionSocket,
    @MessageBody() payload: AuctionRoomPayloadDto,
  ) {
    const identifier = this.pickIdentifier(payload);
    if (!identifier) {
      return { ok: true };
    }

    const auction =
      await this.auctionService.resolveAuctionIdentity(identifier);
    const roomId = auction?.id ?? identifier;
    await client.leave(this.events.roomName(roomId));

    return {
      ok: true,
      sessionId: roomId,
    };
  }

  private pickIdentifier(payload?: AuctionRoomPayloadDto): string | null {
    const raw = payload?.sessionId ?? payload?.auctionId;
    if (typeof raw !== 'string') {
      return null;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private extractToken(client: AuctionSocket): string | undefined {
    const authToken =
      typeof client.handshake.auth?.token === 'string'
        ? client.handshake.auth.token.trim()
        : undefined;
    const header =
      typeof client.handshake.headers?.authorization === 'string'
        ? client.handshake.headers.authorization.trim()
        : undefined;
    const raw = authToken || header;
    if (!raw) {
      return undefined;
    }
    return raw.toLowerCase().startsWith('bearer ') ? raw.slice(7).trim() : raw;
  }
}
