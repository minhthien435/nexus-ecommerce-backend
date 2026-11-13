import { describe, expect, it, vi } from 'vitest';
import { AddNotificationDeliveryFields1794531600000 } from './1794531600000-AddNotificationDeliveryFields.js';

describe('AddNotificationDeliveryFields1794531600000', () => {
  it('adds delivery fields and indexes', async () => {
    const runner = { query: vi.fn() } as any;
    await new AddNotificationDeliveryFields1794531600000().up(runner);
    const sql = runner.query.mock.calls.flat().join(' ');

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "action_url"');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "metadata" jsonb');
    expect(sql).toContain('idx_notifications_user_channel_created');
    expect(sql).toContain('idx_notifications_user_unread');
    expect(sql).toContain('WHERE "read_at" IS NULL');
    expect(sql).toContain('uq_notifications_source_event_dedup');
    expect(sql).toContain('uq_notification_preferences_user_type_channel');
  });

  it('reverts fields and indexes', async () => {
    const runner = { query: vi.fn() } as any;
    await new AddNotificationDeliveryFields1794531600000().down(runner);
    const sql = runner.query.mock.calls.flat().join(' ');

    expect(sql).toContain('DROP INDEX IF EXISTS');
    expect(sql).toContain('DROP COLUMN IF EXISTS "metadata"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "action_url"');
  });
});
