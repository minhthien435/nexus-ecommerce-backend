import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ChatGateway } from './chat.gateway.js';

const userId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';

function socket(token = 'token') {
  return {
    handshake: { auth: { token }, headers: {} },
    data: {},
    join: vi.fn(),
    disconnect: vi.fn(),
    emit: vi.fn(),
  } as any;
}

describe('ChatGateway', () => {
  it('authenticates current token version and joins only the personal room', async () => {
    const client = socket();
    const gateway = new ChatGateway(
      {
        verifyAsync: vi
          .fn()
          .mockResolvedValue({ sub: userId, tokenVersion: 2 }),
      } as any,
      {
        findOne: vi.fn().mockResolvedValue({ id: userId, tokenVersion: 2 }),
      } as any,
      {} as any,
      {} as any,
    );
    await gateway.handleConnection(client);
    expect(client.join).toHaveBeenCalledWith(`user:${userId}`);
    expect(client.join).toHaveBeenCalledTimes(1);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it.each([
    [{ verifyAsync: vi.fn().mockRejectedValue(new Error('expired')) }, null],
    [
      {
        verifyAsync: vi
          .fn()
          .mockResolvedValue({ sub: userId, tokenVersion: 1 }),
      },
      { id: userId, tokenVersion: 2 },
    ],
    [
      {
        verifyAsync: vi
          .fn()
          .mockResolvedValue({ sub: userId, tokenVersion: 1 }),
      },
      null,
    ],
  ])('rejects invalid, stale, or inactive JWT identity', async (jwt, found) => {
    const client = socket();
    const gateway = new ChatGateway(
      jwt as any,
      { findOne: vi.fn().mockResolvedValue(found) } as any,
      {} as any,
      {} as any,
    );
    await gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it('ACKs sender while service routes the durable new message', async () => {
    const client = socket();
    client.data.userId = userId;
    const result = { message: { id: 'm1' }, duplicate: false };
    const chat = { send: vi.fn().mockResolvedValue(result) };
    const gateway = new ChatGateway(
      {} as any,
      {} as any,
      chat as any,
      {} as any,
    );
    await gateway.send(client, {
      conversationId,
      message: { clientMessageId: otherId, type: 'TEXT', text: 'hi' },
    });
    expect(chat.send).toHaveBeenCalledWith(
      userId,
      conversationId,
      expect.objectContaining({ text: 'hi' }),
    );
    expect(client.emit).toHaveBeenCalledWith('message:ack', result);
  });

  it('relays approved typing events only to the authorized counterpart', async () => {
    const client = socket();
    client.data.userId = userId;
    const chat = { counterpart: vi.fn().mockResolvedValue(otherId) };
    const events = { emit: vi.fn() };
    const gateway = new ChatGateway(
      {} as any,
      {} as any,
      chat as any,
      events as any,
    );
    await gateway.typingStart(client, { conversationId });
    await gateway.typingStop(client, { conversationId });
    expect(chat.counterpart).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenNthCalledWith(
      1,
      otherId,
      'typing:start',
      expect.objectContaining({ userId, isTyping: true }),
    );
    expect(events.emit).toHaveBeenNthCalledWith(
      2,
      otherId,
      'typing:stop',
      expect.objectContaining({ userId, isTyping: false }),
    );
  });

  it('handles message:read through membership-enforcing service', async () => {
    const client = socket();
    client.data.userId = userId;
    const chat = { markRead: vi.fn().mockResolvedValue({ updated: 2 }) };
    const gateway = new ChatGateway(
      {} as any,
      {} as any,
      chat as any,
      {} as any,
    );
    await expect(gateway.read(client, { conversationId })).resolves.toEqual({
      updated: 2,
    });
    expect(chat.markRead).toHaveBeenCalledWith(userId, conversationId);
  });
});
