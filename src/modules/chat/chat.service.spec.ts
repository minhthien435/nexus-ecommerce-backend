import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ShopEntity } from '../identity/domain/shop.entity.js';
import { UserEntity } from '../identity/domain/user.entity.js';
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
    const shopRepo = {
      findOne: vi
        .fn()
        .mockResolvedValue({ id: conversation.shopId, status: 'ACTIVE' }),
    };
    const messageRepo = { save: vi.fn().mockResolvedValue(saved) };
    const manager = {
      getRepository: vi.fn((entity: any) => {
        if (entity.name?.includes('Conversation')) return conversationRepo;
        if (entity.name?.includes('Shop') || entity === ShopEntity)
          return shopRepo;
        return messageRepo;
      }),
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
    expect(events.emit).toHaveBeenCalledWith(buyerId, 'message:new', saved);
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
    expect(events.emit).toHaveBeenCalledWith(
      buyerId,
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

  describe('list (BE-05)', () => {
    function setupListMocks(options: {
      items?: any[];
      totalItems?: number;
      shops?: any[];
      buyers?: any[];
    }) {
      const qb: any = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi
          .fn()
          .mockResolvedValue([
            options.items ?? [],
            options.totalItems ?? (options.items ? options.items.length : 0),
          ]),
      };

      const conversationsRepo = {
        createQueryBuilder: vi.fn(() => qb),
        increment: vi.fn(),
        update: vi.fn(),
      };

      const messagesRepo = {
        update: vi.fn(),
      };

      const shopRepo = {
        find: vi.fn().mockResolvedValue(options.shops ?? []),
      };

      const userRepo = {
        find: vi.fn().mockResolvedValue(options.buyers ?? []),
      };

      const dataSource = {
        getRepository: vi.fn((entity: any) => {
          if (entity === ShopEntity || entity.name?.includes('Shop'))
            return shopRepo;
          if (entity === UserEntity || entity.name?.includes('User'))
            return userRepo;
          return {};
        }),
      };

      const s = service({
        conversations: conversationsRepo,
        messages: messagesRepo,
        dataSource,
      });

      return { s, qb, conversationsRepo, messagesRepo, shopRepo, userRepo };
    }

    it('1 & 2: Buyer retrieves conversation list with Shop summary and buyer: null', async () => {
      const conv = {
        id: 'c-1',
        buyerId,
        sellerId,
        shopId: 'shop-1',
        buyerUnreadCount: 3,
        sellerUnreadCount: 0,
        lastMessagePreview: 'Alo shop',
        lastMessageAt: new Date('2026-11-10T12:00:00Z'),
        createdAt: new Date('2026-11-10T10:00:00Z'),
        updatedAt: new Date('2026-11-10T12:00:00Z'),
      };
      const shop = {
        id: 'shop-1',
        name: 'Nexus Fashion',
        slug: 'nexus-fashion',
        logoUrl: 'https://cdn/logo.png',
      };

      const { s } = setupListMocks({ items: [conv], shops: [shop] });
      const result = await s.list(buyerId);

      expect(result.items).toHaveLength(1);
      const item = result.items[0];
      expect(item.id).toBe('c-1');
      expect(item.shop).toEqual({
        name: 'Nexus Fashion',
        slug: 'nexus-fashion',
        logoUrl: 'https://cdn/logo.png',
      });
      expect(item.buyer).toBeNull();
      expect(item.myUnreadCount).toBe(3);
    });

    it('3 & 4: Seller retrieves conversation list with Buyer summary', async () => {
      const conv = {
        id: 'c-2',
        buyerId,
        sellerId,
        shopId: 'shop-1',
        buyerUnreadCount: 0,
        sellerUnreadCount: 7,
        lastMessagePreview: 'Shop có giao nhanh không?',
        lastMessageAt: new Date('2026-11-10T14:00:00Z'),
        createdAt: new Date('2026-11-10T10:00:00Z'),
        updatedAt: new Date('2026-11-10T14:00:00Z'),
      };
      const buyer = {
        id: buyerId,
        fullName: 'Nguyễn Văn A',
        avatarUrl: 'https://cdn/avatar.png',
      };
      const shop = {
        id: 'shop-1',
        name: 'Nexus Fashion',
        slug: 'nexus-fashion',
        logoUrl: null,
      };

      const { s } = setupListMocks({
        items: [conv],
        shops: [shop],
        buyers: [buyer],
      });
      const result = await s.list(sellerId);

      expect(result.items).toHaveLength(1);
      const item = result.items[0];
      expect(item.id).toBe('c-2');
      expect(item.buyer).toEqual({
        fullName: 'Nguyễn Văn A',
        avatarUrl: 'https://cdn/avatar.png',
      });
      expect(item.shop).toEqual({
        name: 'Nexus Fashion',
        slug: 'nexus-fashion',
        logoUrl: null,
      });
      expect(item.myUnreadCount).toBe(7);
    });

    it('5, 6, 7 & 8: Independent role handling and unread count isolation when user is both Buyer and Seller', async () => {
      const currentUserId = 'dual-role-user';
      const convAsBuyer = {
        id: 'conv-buyer',
        buyerId: currentUserId,
        sellerId: 'other-seller',
        shopId: 'shop-a',
        buyerUnreadCount: 4,
        sellerUnreadCount: 99,
        lastMessagePreview: 'Hàng tới chưa shop?',
        lastMessageAt: new Date('2026-11-10T15:00:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const convAsSeller = {
        id: 'conv-seller',
        buyerId: 'customer-b',
        sellerId: currentUserId,
        shopId: 'shop-b',
        buyerUnreadCount: 88,
        sellerUnreadCount: 2,
        lastMessagePreview: 'Có giảm giá không?',
        lastMessageAt: new Date('2026-11-10T16:00:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const shops = [
        { id: 'shop-a', name: 'Shop A', slug: 'shop-a', logoUrl: null },
        {
          id: 'shop-b',
          name: 'Shop B',
          slug: 'shop-b',
          logoUrl: 'https://logo-b',
        },
      ];
      const buyers = [
        { id: 'customer-b', fullName: 'Khách Hàng B', avatarUrl: null },
      ];

      const { s } = setupListMocks({
        items: [convAsBuyer, convAsSeller],
        shops,
        buyers,
      });

      const result = await s.list(currentUserId);
      expect(result.items).toHaveLength(2);

      const itemBuyer = result.items[0];
      expect(itemBuyer.id).toBe('conv-buyer');
      expect(itemBuyer.myUnreadCount).toBe(4); // Buyer unread, NOT 99
      expect(itemBuyer.buyer).toBeNull();
      expect(itemBuyer.shop?.name).toBe('Shop A');

      const itemSeller = result.items[1];
      expect(itemSeller.id).toBe('conv-seller');
      expect(itemSeller.myUnreadCount).toBe(2); // Seller unread, NOT 88
      expect(itemSeller.buyer?.fullName).toBe('Khách Hàng B');
      expect(itemSeller.shop?.name).toBe('Shop B');
    });

    it('9: Safely handles null when conversation has no messages', async () => {
      const conv = {
        id: 'c-empty',
        buyerId,
        sellerId,
        shopId: 'shop-1',
        buyerUnreadCount: 0,
        sellerUnreadCount: 0,
        lastMessagePreview: null,
        lastMessageAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const { s } = setupListMocks({ items: [conv], shops: [] });
      const result = await s.list(buyerId);

      expect(result.items[0].lastMessagePreview).toBeNull();
      expect(result.items[0].lastMessageAt).toBeNull();
      expect(result.items[0].myUnreadCount).toBe(0);
    });

    it('10 & 11: Accurately reflects lastMessagePreview and lastMessageAt', async () => {
      const now = new Date('2026-11-10T18:30:00.000Z');
      const conv = {
        id: 'c-msg',
        buyerId,
        sellerId,
        shopId: 'shop-1',
        buyerUnreadCount: 1,
        sellerUnreadCount: 0,
        lastMessagePreview: 'Đã gửi hình ảnh',
        lastMessageAt: now,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const { s } = setupListMocks({ items: [conv], shops: [] });
      const result = await s.list(buyerId);

      expect(result.items[0].lastMessagePreview).toBe('Đã gửi hình ảnh');
      expect(result.items[0].lastMessageAt).toEqual(now);
    });

    it('12: Applies default pagination page=1, limit=20', async () => {
      const { s, qb } = setupListMocks({ items: [], totalItems: 0 });
      const result = await s.list(buyerId);

      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(20);
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        totalItems: 0,
        totalPages: 1,
      });
    });

    it('13: Applies custom pagination for subsequent pages accurately', async () => {
      const { s, qb } = setupListMocks({ items: [], totalItems: 50 });
      const result = await s.list(buyerId, { page: 3, limit: 15 });

      expect(qb.skip).toHaveBeenCalledWith(30);
      expect(qb.take).toHaveBeenCalledWith(15);
      expect(result.meta.page).toBe(3);
      expect(result.meta.limit).toBe(15);
    });

    it('14 & 15: Accurately calculates totalItems and totalPages', async () => {
      const { s } = setupListMocks({
        items: [{ id: '1', buyerId, sellerId, shopId: 's1' }],
        totalItems: 45,
      });
      const result = await s.list(buyerId, { page: 1, limit: 20 });

      expect(result.meta.totalItems).toBe(45);
      expect(result.meta.totalPages).toBe(3);
    });

    it('16: Returns valid response on empty conversation list', async () => {
      const { s } = setupListMocks({ items: [], totalItems: 0 });
      const result = await s.list(buyerId, { page: 1, limit: 20 });

      expect(result.items).toEqual([]);
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        totalItems: 0,
        totalPages: 1,
      });
    });

    it('17: Queries only conversations belonging to current user', async () => {
      const { s, qb } = setupListMocks({ items: [], totalItems: 0 });
      await s.list('user-xyz');

      expect(qb.where).toHaveBeenCalledWith(
        'c.buyer_id = :userId OR c.seller_id = :userId',
        { userId: 'user-xyz' },
      );
    });

    it('18 & 19: Applies deterministic ordering: lastMessageAt DESC NULLS LAST and tie-breakers', async () => {
      const { s, qb } = setupListMocks({ items: [], totalItems: 0 });
      await s.list(buyerId);

      expect(qb.orderBy).toHaveBeenCalledWith(
        'c.last_message_at',
        'DESC',
        'NULLS LAST',
      );
      expect(qb.addOrderBy).toHaveBeenCalledWith('c.created_at', 'DESC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('c.id', 'DESC');
    });

    it('20: Prevents N+1 queries by batching shop and buyer lookups', async () => {
      const items = [
        { id: '1', buyerId: 'cust-1', sellerId, shopId: 'shop-1' },
        { id: '2', buyerId: 'cust-2', sellerId, shopId: 'shop-1' },
        { id: '3', buyerId: 'cust-1', sellerId, shopId: 'shop-2' },
      ];

      const { s, shopRepo, userRepo } = setupListMocks({
        items,
        shops: [
          { id: 'shop-1', name: 'S1', slug: 's1' },
          { id: 'shop-2', name: 'S2', slug: 's2' },
        ],
        buyers: [
          { id: 'cust-1', fullName: 'C1' },
          { id: 'cust-2', fullName: 'C2' },
        ],
      });

      await s.list(sellerId);

      expect(shopRepo.find).toHaveBeenCalledTimes(1);
      expect(userRepo.find).toHaveBeenCalledTimes(1);
    });

    it('21 & 22: list API does not mutate unread counters or mark messages as read', async () => {
      const items = [
        { id: '1', buyerId, sellerId, shopId: 'shop-1', buyerUnreadCount: 5 },
      ];
      const { s, conversationsRepo, messagesRepo } = setupListMocks({ items });

      await s.list(buyerId);

      expect(conversationsRepo.increment).not.toHaveBeenCalled();
      expect(conversationsRepo.update).not.toHaveBeenCalled();
      expect(messagesRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('error handling (BE-06)', () => {
    it('1. CHAT_SHOP_NOT_FOUND (404) when shop does not exist or is inactive', async () => {
      const manager = {
        getRepository: vi.fn(() => ({
          findOne: vi.fn().mockResolvedValue(null),
        })),
      };
      const s = service({
        dataSource: { transaction: vi.fn(async (fn: any) => fn(manager)) },
      });

      const promise = s.open(buyerId, { shopId: 'shop-not-found' });
      await expect(promise).rejects.toThrow(NotFoundException);
      await promise.catch((err: NotFoundException) => {
        expect(err.getStatus()).toBe(404);
        expect(err.getResponse()).toEqual({
          errorCode: 'CHAT_SHOP_NOT_FOUND',
          message: 'Active shop not found',
        });
      });
    });

    it('2. CHAT_OWN_SHOP (400) when buyer attempts to chat with their own shop', async () => {
      const manager = {
        getRepository: vi.fn(() => ({
          findOne: vi
            .fn()
            .mockResolvedValue({ id: 'my-shop', sellerId: buyerId }),
        })),
      };
      const s = service({
        dataSource: { transaction: vi.fn(async (fn: any) => fn(manager)) },
      });

      const promise = s.open(buyerId, { shopId: 'my-shop' });
      await expect(promise).rejects.toThrow(BadRequestException);
      await promise.catch((err: BadRequestException) => {
        expect(err.getStatus()).toBe(400);
        expect(err.getResponse()).toEqual({
          errorCode: 'CHAT_OWN_SHOP',
          message: 'Cannot chat with your own shop',
        });
      });
    });

    it('3. CHAT_CONTEXT_CONFLICT (400) when both productSlug and orderNumber are provided', async () => {
      const conversationRepo = {
        findOne: vi.fn().mockResolvedValue(conversation),
        createQueryBuilder: vi.fn(() => ({
          setLock: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          getOneOrFail: vi.fn().mockResolvedValue(conversation),
        })),
      };
      const manager = {
        getRepository: vi.fn((entity: any) =>
          entity.name?.includes('Conversation')
            ? conversationRepo
            : { findOne: vi.fn().mockResolvedValue({ id: 's1', sellerId }) },
        ),
      };
      const s = service({
        dataSource: { transaction: vi.fn(async (fn: any) => fn(manager)) },
      });

      const promise = s.open(buyerId, {
        shopId: 's1',
        productSlug: 'slug-1',
        orderNumber: 'ORD-1',
      });
      await expect(promise).rejects.toThrow(BadRequestException);
      await promise.catch((err: BadRequestException) => {
        expect(err.getStatus()).toBe(400);
        expect(err.getResponse()).toEqual({
          errorCode: 'CHAT_CONTEXT_CONFLICT',
          message: 'Choose one context',
        });
      });
    });

    it('4. CHAT_PRODUCT_NOT_FOUND (404) when attached product slug is invalid', async () => {
      const manager = {
        getRepository: vi.fn((entity: any) => {
          if (entity.name?.includes('ProductEntity')) {
            return { findOne: vi.fn().mockResolvedValue(null) };
          }
          return {};
        }),
      };
      const s = service();
      const promise = (s as any).addProductContext(
        manager,
        conversation,
        { sellerId },
        'missing-slug',
      );
      await expect(promise).rejects.toThrow(NotFoundException);
      await promise.catch((err: NotFoundException) => {
        expect(err.getStatus()).toBe(404);
        expect(err.getResponse()).toEqual({
          errorCode: 'CHAT_PRODUCT_NOT_FOUND',
          message: 'Product not found',
        });
      });
    });

    it('5. CHAT_ORDER_NOT_FOUND (404) when attached order is invalid or not owned', async () => {
      const manager = {
        getRepository: vi.fn((entity: any) => {
          if (entity.name?.includes('OrderEntity')) {
            return { findOne: vi.fn().mockResolvedValue(null) };
          }
          return {};
        }),
      };
      const s = service();
      const promise = (s as any).addOrderContext(
        manager,
        conversation,
        { sellerId },
        'INVALID-ORD',
      );
      await expect(promise).rejects.toThrow(NotFoundException);
      await promise.catch((err: NotFoundException) => {
        expect(err.getStatus()).toBe(404);
        expect(err.getResponse()).toEqual({
          errorCode: 'CHAT_ORDER_NOT_FOUND',
          message: 'Order not found',
        });
      });
    });

    it('6. CHAT_CONVERSATION_NOT_FOUND (404) when conversation does not exist or user is outsider', async () => {
      const s = service({
        conversations: { findOne: vi.fn().mockResolvedValue(null) },
      });
      const promise = s.history(buyerId, 'non-existent', { limit: 20 });
      await expect(promise).rejects.toThrow(NotFoundException);
      await promise.catch((err: NotFoundException) => {
        expect(err.getStatus()).toBe(404);
        expect(err.getResponse()).toEqual({
          errorCode: 'CHAT_CONVERSATION_NOT_FOUND',
          message: 'Conversation not found',
        });
      });
    });

    it('7. CHAT_TEXT_REQUIRED (400) when text message is empty or whitespace only', async () => {
      const s = service();
      const promise = s.send(buyerId, conversationId, {
        clientMessageId,
        type: 'TEXT',
        text: '   ',
      });
      await expect(promise).rejects.toThrow(BadRequestException);
      await promise.catch((err: BadRequestException) => {
        expect(err.getStatus()).toBe(400);
        expect(err.getResponse()).toEqual({
          errorCode: 'CHAT_TEXT_REQUIRED',
          message: 'Message text is required',
        });
      });
    });

    it('8. CHAT_IMAGE_INVALID (400) on invalid mime type, oversized, or foreign URL', async () => {
      const s = service();
      const promise = s.send(buyerId, conversationId, {
        clientMessageId,
        type: 'IMAGE',
        image: {
          url: 'https://attacker.site/image.png',
          key: 'chat/evil.png',
          size: 1000,
          mimeType: 'image/png',
        },
      });
      await expect(promise).rejects.toThrow(BadRequestException);
      await promise.catch((err: BadRequestException) => {
        expect(err.getStatus()).toBe(400);
        expect(err.getResponse()).toEqual({
          errorCode: 'CHAT_IMAGE_INVALID',
          message: 'Image is not from Nexus chat storage',
        });
      });
    });

    it('9. CHAT_CLIENT_ID_CONFLICT (409) when clientMessageId is reused across conversations', async () => {
      const s = service({
        messages: {
          findOne: vi.fn().mockResolvedValue({
            id: 'm-other',
            conversationId: 'different-conv',
            senderId: buyerId,
            clientMessageId,
          }),
        },
      });
      const promise = s.send(buyerId, conversationId, {
        clientMessageId,
        type: 'TEXT',
        text: 'Hello',
      });
      await expect(promise).rejects.toThrow(ConflictException);
      await promise.catch((err: ConflictException) => {
        expect(err.getStatus()).toBe(409);
        expect(err.getResponse()).toEqual({
          errorCode: 'CHAT_CLIENT_ID_CONFLICT',
          message: 'clientMessageId already used',
        });
      });
    });

    it('10. CHAT_SHOP_UNAVAILABLE (403) when sending message to a closed or suspended shop', async () => {
      const conversationRepo = {
        createQueryBuilder: vi.fn(() => ({
          setLock: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          getOne: vi.fn().mockResolvedValue(conversation),
        })),
      };
      const shopRepo = {
        findOne: vi
          .fn()
          .mockResolvedValue({ id: conversation.shopId, status: 'CLOSED' }),
      };
      const manager = {
        getRepository: vi.fn((entity: any) => {
          if (entity.name?.includes('Conversation')) return conversationRepo;
          if (entity.name?.includes('Shop') || entity === ShopEntity)
            return shopRepo;
          return {};
        }),
      };
      const s = service({
        messages: { findOne: vi.fn().mockResolvedValue(null) },
        dataSource: { transaction: vi.fn(async (fn: any) => fn(manager)) },
      });

      const promise = s.send(buyerId, conversationId, {
        clientMessageId,
        type: 'TEXT',
        text: 'Shop còn mở không?',
      });
      await expect(promise).rejects.toThrow(ForbiddenException);
      await promise.catch((err: ForbiddenException) => {
        expect(err.getStatus()).toBe(403);
        expect(err.getResponse()).toEqual({
          errorCode: 'CHAT_SHOP_UNAVAILABLE',
          message: 'Shop is currently unavailable',
        });
      });
    });

    it('11. CHAT_INVALID_CURSOR (400) when pagination cursor is malformed or non-UUID', async () => {
      const qb: any = { where: vi.fn().mockReturnThis() };
      const s = service({
        conversations: { findOne: vi.fn().mockResolvedValue(conversation) },
        messages: { createQueryBuilder: vi.fn(() => qb) },
      });
      const promise = s.history(buyerId, conversationId, {
        limit: 10,
        cursor: 'invalid-base64!',
      });
      await expect(promise).rejects.toThrow(BadRequestException);
      await promise.catch((err: BadRequestException) => {
        expect(err.getStatus()).toBe(400);
        expect(err.getResponse()).toEqual({
          errorCode: 'CHAT_INVALID_CURSOR',
          message: 'Invalid cursor',
        });
      });
    });
  });

  describe('realtime & shop availability (BE-07)', () => {
    it('C4: send() emits message:new to both recipient and sender user rooms for multi-device sync', async () => {
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
      const shopRepo = {
        findOne: vi
          .fn()
          .mockResolvedValue({ id: conversation.shopId, status: 'ACTIVE' }),
      };
      const messageRepo = { save: vi.fn().mockResolvedValue(saved) };
      const manager = {
        getRepository: vi.fn((entity: any) => {
          if (entity.name?.includes('Conversation')) return conversationRepo;
          if (entity.name?.includes('Shop') || entity === ShopEntity)
            return shopRepo;
          return messageRepo;
        }),
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
        text: 'Sync multi-tab message',
      });

      // Recipient receives new message
      expect(events.emit).toHaveBeenCalledWith(sellerId, 'message:new', saved);
      // Sender also receives new message on their own room
      expect(events.emit).toHaveBeenCalledWith(buyerId, 'message:new', saved);
    });

    it('C4: markRead() emits message:read to both counterpart and reader user rooms for unread badge sync', async () => {
      const messageRepo = {
        update: vi.fn().mockResolvedValue({ affected: 3 }),
      };
      const conversationRepo = {
        createQueryBuilder: vi.fn(() => ({
          setLock: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          getOne: vi.fn().mockResolvedValue(conversation),
        })),
        update: vi.fn(),
      };
      const manager = {
        getRepository: vi.fn((entity: any) =>
          entity.name?.includes('Message') ? messageRepo : conversationRepo,
        ),
      };
      const events = { emit: vi.fn() };
      const s = service({
        dataSource: { transaction: vi.fn(async (fn: any) => fn(manager)) },
        events,
      });

      await s.markRead(buyerId, conversationId);

      const expectedPayload = expect.objectContaining({
        conversationId,
        userId: buyerId,
      });
      // Counterpart receives read confirmation
      expect(events.emit).toHaveBeenCalledWith(
        sellerId,
        'message:read',
        expectedPayload,
      );
      // Reader receives read confirmation for other tabs
      expect(events.emit).toHaveBeenCalledWith(
        buyerId,
        'message:read',
        expectedPayload,
      );
    });

    it('C6: send() succeeds when shop is ACTIVE', async () => {
      const saved = {
        id: 'm-active',
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
      const shopRepo = {
        findOne: vi
          .fn()
          .mockResolvedValue({ id: conversation.shopId, status: 'ACTIVE' }),
      };
      const messageRepo = { save: vi.fn().mockResolvedValue(saved) };
      const manager = {
        getRepository: vi.fn((entity: any) => {
          if (entity.name?.includes('Conversation')) return conversationRepo;
          if (entity.name?.includes('Shop') || entity === ShopEntity)
            return shopRepo;
          return messageRepo;
        }),
      };
      const events = { emit: vi.fn() };
      const s = service({
        messages: { findOne: vi.fn().mockResolvedValue(null) },
        events,
        dataSource: { transaction: vi.fn(async (fn: any) => fn(manager)) },
      });

      const result = await s.send(buyerId, conversationId, {
        clientMessageId,
        type: 'TEXT',
        text: 'Shop active message',
      });
      expect(result.message).toEqual(saved);
      expect(result.duplicate).toBe(false);
    });

    it('C6: send() blocks TEXT when shop is SUSPENDED with CHAT_SHOP_UNAVAILABLE (403)', async () => {
      const conversationRepo = {
        createQueryBuilder: vi.fn(() => ({
          setLock: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          getOne: vi.fn().mockResolvedValue(conversation),
        })),
      };
      const shopRepo = {
        findOne: vi
          .fn()
          .mockResolvedValue({ id: conversation.shopId, status: 'SUSPENDED' }),
      };
      const manager = {
        getRepository: vi.fn((entity: any) => {
          if (entity.name?.includes('Conversation')) return conversationRepo;
          if (entity.name?.includes('Shop') || entity === ShopEntity)
            return shopRepo;
          return {};
        }),
      };
      const s = service({
        messages: { findOne: vi.fn().mockResolvedValue(null) },
        dataSource: { transaction: vi.fn(async (fn: any) => fn(manager)) },
      });

      const promise = s.send(buyerId, conversationId, {
        clientMessageId,
        type: 'TEXT',
        text: 'Hello',
      });
      await expect(promise).rejects.toThrow(ForbiddenException);
      await promise.catch((err: ForbiddenException) => {
        expect(err.getStatus()).toBe(403);
        expect(err.getResponse()).toEqual({
          errorCode: 'CHAT_SHOP_UNAVAILABLE',
          message: 'Shop is currently unavailable',
        });
      });
    });

    it('C6: send() blocks IMAGE when shop is CLOSED with CHAT_SHOP_UNAVAILABLE (403)', async () => {
      const conversationRepo = {
        createQueryBuilder: vi.fn(() => ({
          setLock: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          getOne: vi.fn().mockResolvedValue(conversation),
        })),
      };
      const shopRepo = {
        findOne: vi
          .fn()
          .mockResolvedValue({ id: conversation.shopId, status: 'CLOSED' }),
      };
      const manager = {
        getRepository: vi.fn((entity: any) => {
          if (entity.name?.includes('Conversation')) return conversationRepo;
          if (entity.name?.includes('Shop') || entity === ShopEntity)
            return shopRepo;
          return {};
        }),
      };
      const s = service({
        messages: { findOne: vi.fn().mockResolvedValue(null) },
        dataSource: { transaction: vi.fn(async (fn: any) => fn(manager)) },
      });

      const promise = s.send(buyerId, conversationId, {
        clientMessageId,
        type: 'IMAGE',
        image: {
          url: 'https://nexus.supabase.co/storage/v1/object/public/nexus-media/chat/prod.jpg',
          key: 'chat/prod.jpg',
          size: 2000,
          mimeType: 'image/jpeg',
        },
      });
      await expect(promise).rejects.toThrow(ForbiddenException);
      await promise.catch((err: ForbiddenException) => {
        expect(err.getStatus()).toBe(403);
        expect(err.getResponse()).toEqual({
          errorCode: 'CHAT_SHOP_UNAVAILABLE',
          message: 'Shop is currently unavailable',
        });
      });
    });

    it('defaults chat image bucket to nexus-media when SUPABASE_STORAGE_BUCKET is empty', async () => {
      const saved = {
        id: 'm-img',
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
      const shopRepo = {
        findOne: vi
          .fn()
          .mockResolvedValue({ id: conversation.shopId, status: 'ACTIVE' }),
      };
      const messageRepo = { save: vi.fn().mockResolvedValue(saved) };
      const manager = {
        getRepository: vi.fn((entity: any) => {
          if (entity.name?.includes('Conversation')) return conversationRepo;
          if (entity.name?.includes('Shop') || entity === ShopEntity)
            return shopRepo;
          return messageRepo;
        }),
      };
      const s = new ChatService(
        { transaction: vi.fn(async (fn: any) => fn(manager)) } as any,
        {} as any,
        { findOne: vi.fn().mockResolvedValue(null) } as any,
        {
          get: vi.fn((key: string) =>
            key === 'SUPABASE_URL'
              ? 'https://nexus.supabase.co'
              : key === 'SUPABASE_STORAGE_BUCKET'
                ? '   '
                : undefined,
          ),
        } as any,
        { emit: vi.fn() } as any,
      );

      const res = await s.send(buyerId, conversationId, {
        clientMessageId,
        type: 'IMAGE',
        image: {
          url: 'https://nexus.supabase.co/storage/v1/object/public/nexus-media/chat/prod.jpg',
          key: 'chat/prod.jpg',
          size: 2000,
          mimeType: 'image/jpeg',
        },
      });
      expect(res.message).toEqual(saved);
    });

    it('C6: history() remains accessible and succeeds even if shop is CLOSED or SUSPENDED', async () => {
      const messages = [
        { id: 'm1', text: 'Old message', createdAt: new Date() },
      ];
      const qb: any = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(messages),
      };
      const s = service({
        conversations: { findOne: vi.fn().mockResolvedValue(conversation) },
        messages: { createQueryBuilder: vi.fn(() => qb) },
      });

      const result = await s.history(buyerId, conversationId, { limit: 10 });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('m1');
    });

    it('C6: list() remains accessible and succeeds even if shop is CLOSED or SUSPENDED', async () => {
      const conv = {
        id: 'c-closed',
        buyerId,
        sellerId,
        shopId: 'shop-closed',
        buyerUnreadCount: 0,
        sellerUnreadCount: 0,
        lastMessagePreview: 'Bye',
        lastMessageAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const shopClosed = {
        id: 'shop-closed',
        name: 'Closed Shop',
        slug: 'closed-shop',
        logoUrl: null,
      };

      const qb: any = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[conv], 1]),
      };

      const dataSource = {
        getRepository: vi.fn((_entity: any) => ({
          find: vi.fn().mockResolvedValue([shopClosed]),
        })),
      };

      const s = service({
        conversations: { createQueryBuilder: vi.fn(() => qb) },
        dataSource,
      });

      const result = await s.list(buyerId);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].shop?.name).toBe('Closed Shop');
    });
  });
});
