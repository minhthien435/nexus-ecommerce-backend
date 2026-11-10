import { describe, expect, it, vi } from 'vitest';
import { CreateChatSchema1794355200000 } from './1794355200000-CreateChatSchema.js';

describe('CreateChatSchema1794355200000', () => {
  it('creates membership, idempotency, payload and cursor contracts', async () => {
    const runner = { query: vi.fn() } as any;
    await new CreateChatSchema1794355200000().up(runner);
    const sql = runner.query.mock.calls.flat().join(' ');
    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS "chat"');
    expect(sql).toContain('UQ_chat_conversations_buyer_shop');
    expect(sql).toContain('CHK_chat_conversations_distinct');
    expect(sql).toContain('UQ_chat_messages_sender_client');
    expect(sql).toContain('CHK_chat_messages_payload');
    expect(sql).toContain('IDX_chat_messages_conversation_cursor');
    expect(sql).toContain('"created_at" DESC, "id" DESC');
  });

  it('drops messages before conversations and schema', async () => {
    const runner = { query: vi.fn() } as any;
    await new CreateChatSchema1794355200000().down(runner);
    const sql = runner.query.mock.calls.flat() as string[];
    expect(sql[0]).toContain('"messages"');
    expect(sql[1]).toContain('"conversations"');
    expect(sql[2]).toContain('DROP SCHEMA');
  });
});
