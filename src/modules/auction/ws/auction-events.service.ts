import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

export const AUCTION_SOCKET_EVENTS = {
  BID_PLACED: 'bid:placed',
  TICK: 'auction:tick',
  SNIPED: 'auction:sniped',
  ENDED: 'auction:ended',
} as const;

export interface BidPlacedEventPayload {
  sessionId: string;
  auctionCode?: string | null;
  newPrice: number;
  minNextBid?: number;
  bidCount?: number;
  bidderId?: string;
  highestBidderId?: string;
  bidderMaskedName: string;
  bidTime: string;
}

export interface AuctionTickEventPayload {
  sessionId: string;
  remainingSeconds: number;
}

export interface AuctionSnipedEventPayload {
  sessionId: string;
  auctionCode?: string | null;
  newEndTime: string;
  extensionCount: number;
  remainingExtensions: number;
  message: string;
}

export interface AuctionEndedEventPayload {
  sessionId: string;
  auctionCode?: string | null;
  winnerId: string | null;
  finalPrice: number | null;
  status: string;
}

@Injectable()
export class AuctionEventsService {
  private readonly logger = new Logger(AuctionEventsService.name);
  private server?: Server;

  bind(server: Server): void {
    this.server = server;
  }

  roomName(auctionId: string): string {
    return `auction:${auctionId}`;
  }

  emitBidPlaced(payload: BidPlacedEventPayload): void {
    this.emitToRoom(
      payload.sessionId,
      AUCTION_SOCKET_EVENTS.BID_PLACED,
      payload,
    );
  }

  emitAuctionTick(payload: AuctionTickEventPayload): void {
    this.emitToRoom(payload.sessionId, AUCTION_SOCKET_EVENTS.TICK, payload);
  }

  emitAuctionSniped(payload: AuctionSnipedEventPayload): void {
    this.emitToRoom(payload.sessionId, AUCTION_SOCKET_EVENTS.SNIPED, payload);
  }

  emitAuctionEnded(payload: AuctionEndedEventPayload): void {
    this.emitToRoom(payload.sessionId, AUCTION_SOCKET_EVENTS.ENDED, payload);
  }

  private emitToRoom(auctionId: string, event: string, payload: unknown): void {
    if (!this.server) {
      return;
    }
    try {
      this.server.to(this.roomName(auctionId)).emit(event, payload);
    } catch (error) {
      this.logger.warn(
        `Failed to emit ${event} for auction ${auctionId}: ${(error as Error).message}`,
      );
    }
  }
}
