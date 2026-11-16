import { describe, expect, it, vi } from 'vitest';
import { AuctionGateway } from './auction.gateway.js';
import { AuctionEventsService } from './auction-events.service.js';
import type { AuctionService } from '../auction.service.js';

describe('AuctionGateway', () => {
  const validUserId = 'a0000000-0000-4000-8000-000000000001';
  const auctionUuid = 'b0000000-0000-4000-8000-000000000002';

  const makeClient = (token?: string, headerAuth?: string) =>
    ({
      id: 'sock-1',
      data: {},
      handshake: {
        auth: token !== undefined ? { token } : {},
        headers: headerAuth !== undefined ? { authorization: headerAuth } : {},
      },
      join: vi.fn().mockResolvedValue(undefined),
      leave: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    }) as any;

  const makeGateway = (overrides?: {
    verifyAsync?: ReturnType<typeof vi.fn>;
    findUser?: ReturnType<typeof vi.fn>;
    resolveAuctionIdentity?: ReturnType<typeof vi.fn>;
    mapStatus?: ReturnType<typeof vi.fn>;
  }) => {
    const events = new AuctionEventsService();
    const toMock = vi.fn().mockReturnValue({ emit: vi.fn() });
    events.bind({ to: toMock } as any);

    const jwt = {
      verifyAsync:
        overrides?.verifyAsync ??
        vi.fn().mockResolvedValue({ sub: validUserId, tokenVersion: 1 }),
    } as any;
    const users = {
      findOne:
        overrides?.findUser ??
        vi.fn().mockResolvedValue({ id: validUserId, tokenVersion: 1 }),
    } as any;
    const auctionService = {
      resolveAuctionIdentity:
        overrides?.resolveAuctionIdentity ??
        vi.fn().mockResolvedValue({
          id: auctionUuid,
          code: 'AUC-100',
          status: 'ACTIVE',
          currentPrice: '250000.00',
          highestBidderId: validUserId,
          startsAt: new Date(Date.now() - 60_000),
          endsAt: new Date(Date.now() + 120_000),
        }),
      mapStatus: overrides?.mapStatus ?? vi.fn().mockReturnValue('LIVE'),
    } as unknown as AuctionService;

    const gateway = new AuctionGateway(jwt, users, auctionService, events);
    return { gateway, events, jwt, users, auctionService, toMock };
  };

  it('allows guest connection without token', async () => {
    const { gateway, jwt } = makeGateway();
    const client = makeClient();

    await gateway.handleConnection(client);

    expect(client.data.isGuest).toBe(true);
    expect(client.data.userId).toBeUndefined();
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('authenticates valid Bearer token and strips prefix', async () => {
    const verifyAsync = vi
      .fn()
      .mockResolvedValue({ sub: validUserId, tokenVersion: 1 });
    const { gateway } = makeGateway({ verifyAsync });
    const client = makeClient('Bearer valid-jwt-token');

    await gateway.handleConnection(client);

    expect(verifyAsync).toHaveBeenCalledWith('valid-jwt-token');
    expect(client.data.userId).toBe(validUserId);
    expect(client.data.isGuest).toBe(false);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('authenticates raw token without Bearer prefix', async () => {
    const verifyAsync = vi
      .fn()
      .mockResolvedValue({ sub: validUserId, tokenVersion: 1 });
    const { gateway } = makeGateway({ verifyAsync });
    const client = makeClient('raw-jwt-token');

    await gateway.handleConnection(client);

    expect(verifyAsync).toHaveBeenCalledWith('raw-jwt-token');
    expect(client.data.userId).toBe(validUserId);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects client when invalid token is provided', async () => {
    const verifyAsync = vi
      .fn()
      .mockRejectedValue(new Error('invalid signature'));
    const { gateway } = makeGateway({ verifyAsync });
    const client = makeClient('Bearer tampered');

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('resolves auction code to canonical UUID room on joinAuction and returns sync ack', async () => {
    const { gateway, auctionService } = makeGateway();
    const client = makeClient();

    const ack = await gateway.handleJoinAuction(client, {
      sessionId: 'AUC-100',
    });

    expect(auctionService.resolveAuctionIdentity).toHaveBeenCalledWith(
      'AUC-100',
    );
    expect(client.join).toHaveBeenCalledWith(`auction:${auctionUuid}`);
    expect(ack).toMatchObject({
      ok: true,
      sessionId: auctionUuid,
      auctionId: auctionUuid,
      auctionCode: 'AUC-100',
      status: 'LIVE',
      currentPrice: 250000,
      highestBidderId: validUserId,
      startsAt: expect.any(String),
      endsAt: expect.any(String),
    });
  });

  it('returns AUCTION_NOT_FOUND ack when auction does not exist', async () => {
    const { gateway } = makeGateway({
      resolveAuctionIdentity: vi.fn().mockResolvedValue(null),
    });
    const client = makeClient();

    const ack = await gateway.handleJoinAuction(client, {
      sessionId: 'MISSING',
    });

    expect(ack).toMatchObject({
      ok: false,
      errorCode: 'AUCTION_NOT_FOUND',
    });
    expect(client.join).not.toHaveBeenCalled();
  });

  it('leaves canonical UUID room on leaveAuction', async () => {
    const { gateway } = makeGateway();
    const client = makeClient();

    const ack = await gateway.handleLeaveAuction(client, {
      sessionId: 'AUC-100',
    });

    expect(client.leave).toHaveBeenCalledWith(`auction:${auctionUuid}`);
    expect(ack).toEqual({ ok: true, sessionId: auctionUuid });
  });

  it('emits bid:placed, auction:sniped, and auction:ended to canonical room', () => {
    const emit = vi.fn();
    const to = vi.fn().mockReturnValue({ emit });
    const events = new AuctionEventsService();
    events.bind({ to } as any);

    events.emitBidPlaced({
      sessionId: auctionUuid,
      newPrice: 300,
      bidderMaskedName: '***0001',
      bidTime: '2026-11-13T10:00:00.000Z',
      highestBidderId: validUserId,
    });
    events.emitAuctionSniped({
      sessionId: auctionUuid,
      newEndTime: '2026-11-13T10:01:00.000Z',
      extensionCount: 1,
      remainingExtensions: 9,
      message: 'Extended 60s',
    });
    events.emitAuctionEnded({
      sessionId: auctionUuid,
      winnerId: validUserId,
      finalPrice: 300,
      status: 'ENDED',
    });
    events.emitAuctionUpdated({
      sessionId: auctionUuid,
      auctionCode: 'AUC-100',
      status: 'SCHEDULED',
      startPrice: 100000,
      bidStep: 10000,
      minNextBid: 110000,
      startsAt: '2026-11-16T03:00:00.000Z',
      endsAt: '2026-11-16T05:00:00.000Z',
    });

    expect(to).toHaveBeenCalledWith(`auction:${auctionUuid}`);
    expect(emit).toHaveBeenNthCalledWith(
      1,
      'bid:placed',
      expect.objectContaining({ sessionId: auctionUuid, newPrice: 300 }),
    );
    expect(emit).toHaveBeenNthCalledWith(
      2,
      'auction:sniped',
      expect.objectContaining({ sessionId: auctionUuid, extensionCount: 1 }),
    );
    expect(emit).toHaveBeenNthCalledWith(
      3,
      'auction:ended',
      expect.objectContaining({
        sessionId: auctionUuid,
        winnerId: validUserId,
      }),
    );
    expect(emit).toHaveBeenNthCalledWith(
      4,
      'auction:updated',
      expect.objectContaining({
        sessionId: auctionUuid,
        startsAt: '2026-11-16T03:00:00.000Z',
        endsAt: '2026-11-16T05:00:00.000Z',
      }),
    );
  });
});
