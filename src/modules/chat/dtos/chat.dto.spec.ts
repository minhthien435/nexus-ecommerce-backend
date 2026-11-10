import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  HistoryQueryDto,
  SendMessageDto,
  SocketSendMessageDto,
} from './chat.dto.js';

describe('chat DTOs', () => {
  it('accepts text and enforces a UUID idempotency key', async () => {
    const valid = plainToInstance(SendMessageDto, {
      clientMessageId: '8c786d8d-5971-4e0e-a511-c6f3d840ab82',
      type: 'TEXT',
      text: 'hello',
    });
    expect(await validate(valid)).toHaveLength(0);
    const invalid = plainToInstance(SendMessageDto, {
      clientMessageId: 'retry-1',
      type: 'TEXT',
      text: '',
    });
    expect((await validate(invalid)).length).toBeGreaterThan(0);
  });

  it('rejects oversized image metadata and excessive page sizes', async () => {
    const image = plainToInstance(SendMessageDto, {
      clientMessageId: '8c786d8d-5971-4e0e-a511-c6f3d840ab82',
      type: 'IMAGE',
      image: {
        url: 'https://example.test/chat/a.png',
        key: 'chat/a.png',
        size: 5 * 1024 * 1024 + 1,
        mimeType: 'image/png',
      },
    });
    expect((await validate(image)).length).toBeGreaterThan(0);
    const query = plainToInstance(HistoryQueryDto, { limit: 101 });
    expect((await validate(query)).length).toBeGreaterThan(0);
  });

  it('transforms and validates the nested socket message payload', async () => {
    const invalid = plainToInstance(SocketSendMessageDto, {
      conversationId: '33333333-3333-4333-8333-333333333333',
      message: { clientMessageId: 'bad', type: 'TEXT', text: '' },
    });
    expect(invalid.message).toBeInstanceOf(SendMessageDto);
    expect((await validate(invalid)).length).toBeGreaterThan(0);

    const valid = plainToInstance(SocketSendMessageDto, {
      conversationId: '33333333-3333-4333-8333-333333333333',
      message: {
        clientMessageId: '55555555-5555-4555-8555-555555555555',
        type: 'TEXT',
        text: 'hello',
      },
    });
    expect(await validate(valid)).toHaveLength(0);
  });
});
