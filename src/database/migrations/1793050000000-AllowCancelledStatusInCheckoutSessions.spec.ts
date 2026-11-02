import { AllowCancelledStatusInCheckoutSessions1793050000000 } from './1793050000000-AllowCancelledStatusInCheckoutSessions.js';

describe('AllowCancelledStatusInCheckoutSessions migration', () => {
  it('updates checkout_sessions_status_check to include CANCELLED', async () => {
    const statements: string[] = [];
    const runner = {
      query: vi.fn(async (sql: string) => statements.push(sql)),
    };
    await new AllowCancelledStatusInCheckoutSessions1793050000000().up(
      runner as never,
    );
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain(
      'DROP CONSTRAINT IF EXISTS checkout_sessions_status_check',
    );
    expect(statements[1]).toContain(
      "CHECK (status IN ('INITIATED', 'PROCESSING', 'COMPLETED', 'EXPIRED', 'FAILED', 'CANCELLED'))",
    );
  });

  it('reverts checkout_sessions_status_check without CANCELLED', async () => {
    const statements: string[] = [];
    const runner = {
      query: vi.fn(async (sql: string) => statements.push(sql)),
    };
    await new AllowCancelledStatusInCheckoutSessions1793050000000().down(
      runner as never,
    );
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain(
      'DROP CONSTRAINT IF EXISTS checkout_sessions_status_check',
    );
    expect(statements[1]).toContain(
      "CHECK (status IN ('INITIATED', 'PROCESSING', 'COMPLETED', 'EXPIRED', 'FAILED'))",
    );
  });
});
