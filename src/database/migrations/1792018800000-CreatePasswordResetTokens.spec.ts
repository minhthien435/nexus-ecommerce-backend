import { describe, expect, it, vi } from 'vitest';
import { CreatePasswordResetTokens1792018800000 } from './1792018800000-CreatePasswordResetTokens.js';

describe('CreatePasswordResetTokens migration', () => {
  it('creates the reset-token table and its lookup indexes', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new CreatePasswordResetTokens1792018800000().up({ query } as never);

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      expect.stringMatching(
        /CREATE TABLE IF NOT EXISTS "identity"\."password_reset_tokens"/,
      ),
      expect.stringMatching(
        /CREATE UNIQUE INDEX IF NOT EXISTS "UQ_password_reset_tokens_token_hash"/,
      ),
      expect.stringMatching(
        /CREATE INDEX IF NOT EXISTS "IDX_password_reset_tokens_user_active"/,
      ),
    ]);
    expect(query.mock.calls[0][0]).toContain(
      'REFERENCES "identity"."users"("id") ON DELETE CASCADE',
    );
    expect(query.mock.calls[0][0]).toContain(
      '"expires_at" TIMESTAMP WITH TIME ZONE NOT NULL',
    );
  });

  it('preserves an adopted reset-token table on rollback', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new CreatePasswordResetTokens1792018800000().down({ query } as never);

    expect(query).not.toHaveBeenCalled();
  });
});
