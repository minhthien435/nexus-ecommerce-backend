import { describe, expect, it, vi } from 'vitest';
import { ReconcileChatSchema1794450000000 } from './1794450000000-ReconcileChatSchema.js';

describe('ReconcileChatSchema1794450000000', () => {
  it('idempotently aligns chat.conversations and chat.messages with TypeORM entities', async () => {
    const runner = { query: vi.fn() } as any;
    await new ReconcileChatSchema1794450000000().up(runner);
    const sql = runner.query.mock.calls.flat().join(' ');

    expect(sql).toContain('DROP COLUMN IF EXISTS "last_message_type"');
    expect(sql).toContain('ALTER COLUMN "last_message_at" DROP NOT NULL');
    expect(sql).toContain('UQ_chat_conversations_buyer_shop');
    expect(sql).toContain('CHK_chat_conversations_distinct');
    expect(sql).toContain('FK_chat_conversations_shop');
    expect(sql).toContain('IDX_chat_conversations_buyer_recent');
    expect(sql).toContain('IDX_chat_conversations_seller_recent');
    expect(sql).toContain('RENAME COLUMN "content" TO "text"');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "context" jsonb');
    expect(sql).toContain('ALTER COLUMN "client_message_id" TYPE varchar(100)');
    expect(sql).toContain(
      "CHECK (\"type\" IN ('TEXT','IMAGE','PRODUCT','ORDER'))",
    );
    expect(sql).toContain('CHK_chat_messages_payload');
    expect(sql).toContain('FK_chat_messages_sender');
    expect(sql).toContain('IDX_chat_messages_conversation_cursor');
    expect(sql).toContain('"created_at" DESC, "id" DESC');
  });

  it('keeps down() non-destructive', async () => {
    const runner = { query: vi.fn() } as any;
    await new ReconcileChatSchema1794450000000().down(runner);
    expect(runner.query).not.toHaveBeenCalled();
  });
});
