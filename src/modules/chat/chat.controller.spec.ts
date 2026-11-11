import { HttpStatus } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatController } from './chat.controller.js';
import type { ChatService } from './chat.service.js';
import type { ConversationQueryDto } from './dtos/chat.dto.js';

describe('ChatController', () => {
  let controller: ChatController;
  let chatService: Partial<Record<keyof ChatService, any>>;

  const userId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    chatService = {
      open: vi.fn(),
      list: vi.fn(),
      unread: vi.fn(),
      history: vi.fn(),
      send: vi.fn(),
      markRead: vi.fn(),
    };
    controller = new ChatController(chatService as unknown as ChatService);
  });

  describe('list', () => {
    it('delegates to ChatService.list with current user id and query', async () => {
      const query: ConversationQueryDto = { page: 2, limit: 10 };
      const serviceResult = {
        items: [
          {
            id: 'conv-1',
            shopId: 'shop-1',
            shop: { name: 'Nexus Store', slug: 'nexus-store', logoUrl: null },
            buyer: null,
            lastMessagePreview: 'Alo',
            lastMessageAt: new Date('2026-11-10T12:00:00Z'),
            myUnreadCount: 1,
            createdAt: new Date('2026-11-10T10:00:00Z'),
            updatedAt: new Date('2026-11-10T12:00:00Z'),
          },
        ],
        meta: {
          page: 2,
          limit: 10,
          totalItems: 1,
          totalPages: 1,
        },
      };

      chatService.list.mockResolvedValue(serviceResult);

      const response = await controller.list(userId, query);

      expect(chatService.list).toHaveBeenCalledWith(userId, query);
      expect(response).toEqual({
        success: true,
        statusCode: HttpStatus.OK,
        message: 'Lấy danh sách hội thoại thành công',
        data: serviceResult.items,
        meta: serviceResult.meta,
      });
    });

    it('returns standard envelope with empty items on empty result', async () => {
      const emptyResult = {
        items: [],
        meta: {
          page: 1,
          limit: 20,
          totalItems: 0,
          totalPages: 1,
        },
      };

      chatService.list.mockResolvedValue(emptyResult);

      const response = await controller.list(userId, { page: 1, limit: 20 });

      expect(response).toEqual({
        success: true,
        statusCode: HttpStatus.OK,
        message: 'Lấy danh sách hội thoại thành công',
        data: [],
        meta: {
          page: 1,
          limit: 20,
          totalItems: 0,
          totalPages: 1,
        },
      });
    });
  });

  describe('existing endpoints regression check', () => {
    it('delegates open conversation to ChatService', async () => {
      const dto = { shopId: 'shop-1' } as any;
      const expected = { id: 'conv-1', shopId: 'shop-1' };
      chatService.open.mockResolvedValue(expected);

      const result = await controller.open(userId, dto);
      expect(chatService.open).toHaveBeenCalledWith(userId, dto);
      expect(result).toBe(expected);
    });

    it('delegates unread summary to ChatService', async () => {
      const expected = { unreadConversations: 2, totalUnreadMessages: 5 };
      chatService.unread.mockResolvedValue(expected);

      const result = await controller.unread(userId);
      expect(chatService.unread).toHaveBeenCalledWith(userId);
      expect(result).toBe(expected);
    });
  });
});
