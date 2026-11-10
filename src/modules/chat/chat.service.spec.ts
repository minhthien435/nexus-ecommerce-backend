import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ChatService } from './chat.service.js';

const buyerId = '11111111-1111-4111-8111-111111111111';
const sellerId = '22222222-2222-4222-8222-222222222222';
const outsiderId = '99999999-9999-4999-8999-999999999999';
const conversationId = '33333333-3333-4333-8333-333333333333';
const clientMessageId = '55555555-5555-4555-8555-555555555555';
const conversation = {
  id: conversationId,
  buyerId,
  sellerId,
  shopId: '44444444-4444-4444-8444-444444444444',
  buyerUnreadCount: 0,
  sellerUnreadCount: 0,
} as any;

function service(
  overrides: {
    dataSource?: any;
    conversations?: any;
    messages?: any;
    events?: any;
  } = {},
) {
  return new ChatService(
    overrides.dataSource ?? { transaction: vi.fn() },
    overrides.conversations ?? {},
    overrides.messages ?? {},
    {
      get: vi.fn((key: string) =>
        key === 'SUPABASE_URL'
          ? 'https://nexus.supabase.co'
          : key === 'SUPABASE_STORAGE_BUCKET'
            ? 'nexus-media'
            : undefined,
      ),
    } as any,
    overrides.events ?? { emit: vi.fn() },
  );
}

describe('ChatService', () => {
  it('hides conversation existence from non-participants', async () => {
    const s = service({
      conversations: { findOne: vi.fn().mockResolvedValue(conversation) },
      messages: { createQueryBuilder: vi.fn() },
    });
    await expect(
      s.history(outsiderId, conversationId, { limit: 30 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns an idempotent retry without a transaction, emission, or unread increment', async () => {
    const original = {
      id: 'm1',
      conversationId,
      senderId: buyerId,
      clientMessageId,
    };
    const dataSource = { transaction: vi.fn() };
    const events = { emit: vi.fn() };
    const s = service({
      dataSource,
      events,
      messages: { findOne: vi.fn().mockResolvedValue(original) },
    });
    await expect(
      s.send(buyerId, conversationId, {
        clientMessageId,
        type: 'TEXT',
        text: 'retry',
      }),
    ).resolves.toEqual({ message: original, duplicate: true });
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only text after trimming', async () => {
    const dataSource = { transaction: vi.fn() };
    const s = service({ dataSource, messages: { findOne: vi.fn() } });
    await expect(
      s.send(buyerId, conversationId, {
        clientMessageId,
        type: 'TEXT',
        text: '   ',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('persists, increments once, then emits message:new to the counterpart', async () => {
    const saved = {
      id: 'm1',
      createdAt: new Date(),
      conversationId,
      senderId: buyerId,
    };
    const conversationRepo = {
      createQueryBuilder: vi.fn(() => ({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(conversation),
      })),
      increment: vi.fn(),
      update: vi.fn(),
    };
    const messageRepo = { save: vi.fn().mockResolvedValue(saved) };
    const manager = {
      getRepository: vi.fn((entity: any) =>
        entity.name.includes('Conversation') ? conversationRepo : messageRepo,
      ),
    };
    const events = { emit: vi.fn() };
    const s = service({
      messages: { findOne: vi.fn().mockResolvedValue(null) },
      events,
      dataSource: { transaction: vi.fn(async (fn: any) => fn(manager)) },
    });
    await s.send(buyerId, conversationId, {
      clientMessageId,
      type: 'TEXT',
      text: ' hello ',
    });
    expect(messageRepo.save).toHaveBeenCalledTimes(1);
    expect(conversationRepo.increment).toHaveBeenCalledWith(
      { id: conversationId },
      'sellerUnreadCount',
      1,
    );
    expect(events.emit).toHaveBeenCalledWith(sellerId, 'message:new', saved);
  });

  it('uses the equal-timestamp id tie-breaker and returns a stable next cursor', async () => {
    const at = new Date('2026-01-01T00:00:00.000Z');
    const items = [
      { id: 'c', createdAt: at },
      { id: 'b', createdAt: at },
      { id: 'a', createdAt: at },
    ];
    const qb: any = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue(items),
    };
    const s = service({
      conversations: { findOne: vi.fn().mockResolvedValue(conversation) },
      messages: { createQueryBuilder: vi.fn(() => qb) },
    });
    const result = await s.history(buyerId, conversationId, { limit: 2 });
    expect(qb.orderBy).toHaveBeenCalledWith('m.created_at', 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('m.id', 'DESC');
    expect(result.items.map((x: any) => x.id)).toEqual(['c', 'b']);
    expect(
      JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString()),
    ).toEqual({ createdAt: at.toISOString(), id: 'b' });
  });

  it('rejects malformed history cursors before querying messages', async () => {
    const qb: any = { where: vi.fn().mockReturnThis() };
    const s = service({
      conversations: { findOne: vi.fn().mockResolvedValue(conversation) },
      messages: { createQueryBuilder: vi.fn(() => qb) },
    });
    await expect(
      s.history(buyerId, conversationId, { limit: 30, cursor: 'not-json' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a decoded cursor whose id is not a UUID', async () => {
    const qb: any = { where: vi.fn().mockReturnThis() };
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: new Date().toISOString(), id: 'not-a-uuid' }),
    ).toString('base64url');
    const s = service({
      conversations: { findOne: vi.fn().mockResolvedValue(conversation) },
      messages: { createQueryBuilder: vi.fn(() => qb) },
    });
    await expect(
      s.history(buyerId, conversationId, { limit: 30, cursor }),
    ).rejects.toThrow(BadRequestException);
  });

  it('resets only the caller counter and marks counterpart messages read', async () => {
    const messageRepo = { update: vi.fn().mockResolvedValue({ affected: 2 }) };
    const lockedQuery = {
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(conversation),
    };
    const conversationRepo = {
      update: vi.fn(),
      createQueryBuilder: vi.fn(() => lockedQuery),
    };
    const manager = {
      getRepository: vi.fn((entity: any) =>
        entity.name.includes('Message') ? messageRepo : conversationRepo,
      ),
    };
    const events = { emit: vi.fn() };
    const s = service({
      conversations: { findOne: vi.fn().mockResolvedValue(conversation) },
      events,
      dataSource: { transaction: vi.fn(async (fn: any) => fn(manager)) },
    });
    await expect(s.markRead(buyerId, conversationId)).resolves.toEqual(
      expect.objectContaining({ updated: 2 }),
    );
    expect(conversationRepo.update).toHaveBeenCalledWith(conversationId, {
      buyerUnreadCount: 0,
    });
    expect(lockedQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(messageRepo.update.mock.calls[0][0]).toEqual(
      expect.objectContaining({ senderId: sellerId }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      sellerId,
      'message:read',
      expect.objectContaining({ conversationId, userId: buyerId }),
    );
  });

  it('rejects non-Nexus, mismatched, oversized, and unsafe image metadata', async () => {
    const s = service();
    const base = {
      clientMessageId,
      type: 'IMAGE' as const,
      image: {
        url: 'https://evil.test/chat/a.png',
        key: 'chat/a.png',
        size: 100,
        mimeType: 'image/png',
      },
    };
    await expect(s.send(buyerId, conversationId, base)).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      s.send(buyerId, conversationId, {
        ...base,
        image: {
          ...base.image,
          url: 'https://nexus.supabase.co/storage/v1/object/public/nexus-media/chat/a.png',
          size: 6 * 1024 * 1024,
        },
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      s.send(buyerId, conversationId, {
        ...base,
        image: {
          ...base.image,
          url: 'https://nexus.supabase.co/storage/v1/object/public/nexus-media/chat/a.png',
          mimeType: 'image/svg+xml',
        },
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('suppresses the same verified product context found inside five minutes', async () => {
    const recentQb: any = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue({ id: 'recent' }),
    };
    const productRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'p1', name: 'Phone' }),
    };
    const messageRepo = {
      createQueryBuilder: vi.fn(() => recentQb),
      save: vi.fn(),
    };
    const manager = {
      getRepository: vi.fn((entity: any) =>
        entity.name.includes('ProductEntity') ? productRepo : messageRepo,
      ),
    };
    const result = await (service() as any).addProductContext(
      manager,
      conversation,
      { sellerId },
      'phone',
    );
    expect(result).toBeUndefined();
    expect(messageRepo.save).not.toHaveBeenCalled();
    expect(recentQb.andWhere).toHaveBeenCalledWith(
      "m.context ->> 'productSlug' = :slug",
      { slug: 'phone' },
    );
  });

  it('creates a server-snapshotted product context card', async () => {
    const recentQb: any = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
    };
    const skuQb: any = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getRawOne: vi.fn().mockResolvedValue({ min: '99000.00' }),
    };
    const saved = { id: 'card', createdAt: new Date() };
    const repos: Record<string, any> = {
      ProductEntity: {
        findOne: vi.fn().mockResolvedValue({ id: 'p1', name: 'Phone' }),
      },
      ProductImageEntity: {
        findOne: vi.fn().mockResolvedValue({ url: 'https://image' }),
      },
      ProductSkuEntity: { createQueryBuilder: vi.fn(() => skuQb) },
      ChatMessageEntity: {
        createQueryBuilder: vi.fn(() => recentQb),
        save: vi.fn().mockResolvedValue(saved),
      },
      ChatConversationEntity: { increment: vi.fn(), update: vi.fn() },
    };
    const manager = {
      getRepository: vi.fn((entity: any) => repos[entity.name]),
    };
    await (service() as any).addProductContext(
      manager,
      conversation,
      { sellerId },
      'phone',
    );
    expect(repos.ChatMessageEntity.save).toHaveBeenCalledWith(
      expect.objectContaining({
        senderId: buyerId,
        type: 'PRODUCT',
        context: {
          productSlug: 'phone',
          name: 'Phone',
          imageUrl: 'https://image',
          minPrice: '99000.00',
        },
      }),
    );
    expect(repos.ChatConversationEntity.increment).toHaveBeenCalledWith(
      { id: conversationId },
      'sellerUnreadCount',
      1,
    );
  });

  it('verifies order participant ownership and snapshots authoritative order fields', async () => {
    const recentQb: any = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
    };
    const saved = { id: 'order-card', createdAt: new Date() };
    const repos: Record<string, any> = {
      OrderEntity: {
        findOne: vi.fn().mockResolvedValue({
          orderNumber: 'NEX-1',
          status: 'PAID',
          total: '120000.00',
        }),
      },
      ChatMessageEntity: {
        createQueryBuilder: vi.fn(() => recentQb),
        save: vi.fn().mockResolvedValue(saved),
      },
      ChatConversationEntity: { increment: vi.fn(), update: vi.fn() },
    };
    const manager = {
      getRepository: vi.fn((entity: any) => repos[entity.name]),
    };
    await (service() as any).addOrderContext(
      manager,
      conversation,
      { sellerId },
      'NEX-1',
    );
    expect(repos.OrderEntity.findOne).toHaveBeenCalledWith({
      where: { orderNumber: 'NEX-1', buyerId, sellerId },
    });
    expect(repos.ChatMessageEntity.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ORDER',
        context: {
          orderNumber: 'NEX-1',
          status: 'PAID',
          totalAmount: '120000.00',
        },
      }),
    );
  });
});
