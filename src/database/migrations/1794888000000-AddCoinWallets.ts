import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoinWallets1794888000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE identity.coin_wallets (
        user_id uuid PRIMARY KEY REFERENCES identity.users(id),
        balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
        locked_bonus integer NOT NULL DEFAULT 0 CHECK (locked_bonus BETWEEN 0 AND balance),
        lifetime_earned bigint NOT NULL DEFAULT 0,
        lifetime_spent bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );

      CREATE TABLE identity.coin_transactions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES identity.coin_wallets(user_id),
        amount_delta integer NOT NULL,
        balance_after integer NOT NULL CHECK (balance_after >= 0),
        source_type text NOT NULL CHECK (source_type IN (
          'REGISTER_BONUS', 'ORDER_PAYMENT_REWARD', 'AUCTION_PAYMENT_REWARD',
          'CHECKOUT_REDEEM', 'CHECKOUT_REFUND', 'REWARD_REVOKE'
        )),
        reference_id uuid NOT NULL,
        description text,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        UNIQUE (user_id, source_type, reference_id)
      );

      CREATE INDEX coin_transactions_user_history_idx
        ON identity.coin_transactions (user_id, created_at DESC, id DESC);

      CREATE FUNCTION identity.record_coin_change(
        p_user_id uuid, p_source text, p_reference uuid, p_delta integer
      ) RETURNS boolean LANGUAGE plpgsql AS $$
      DECLARE
        wallet identity.coin_wallets%ROWTYPE;
        actual_delta integer := p_delta;
        entry_description text;
      BEGIN
        INSERT INTO identity.coin_wallets (user_id) VALUES (p_user_id)
          ON CONFLICT DO NOTHING;
        SELECT * INTO STRICT wallet FROM identity.coin_wallets
          WHERE user_id = p_user_id FOR UPDATE;

        IF EXISTS (
          SELECT 1 FROM identity.coin_transactions
           WHERE user_id = p_user_id AND source_type = p_source
             AND reference_id = p_reference
        ) THEN
          RETURN true;
        END IF;

        IF p_source = 'REWARD_REVOKE' THEN
          actual_delta := GREATEST(p_delta, -(wallet.balance - wallet.locked_bonus));
          IF actual_delta <> p_delta THEN
            entry_description := format('%s Coin could not be recovered', actual_delta - p_delta);
          END IF;
        ELSIF wallet.balance - wallet.locked_bonus + p_delta < 0 THEN
          RETURN false;
        END IF;

        UPDATE identity.coin_wallets
           SET balance = wallet.balance + actual_delta,
               locked_bonus = wallet.locked_bonus +
                 CASE WHEN p_source = 'REGISTER_BONUS' THEN actual_delta ELSE 0 END,
               lifetime_earned = lifetime_earned +
                 CASE WHEN p_source IN ('REGISTER_BONUS', 'ORDER_PAYMENT_REWARD', 'AUCTION_PAYMENT_REWARD')
                      THEN actual_delta ELSE 0 END,
               lifetime_spent = lifetime_spent +
                 CASE WHEN p_source = 'CHECKOUT_REDEEM' THEN -actual_delta ELSE 0 END,
               updated_at = clock_timestamp()
         WHERE user_id = p_user_id;

        INSERT INTO identity.coin_transactions (
          user_id, amount_delta, balance_after, source_type, reference_id, description
        ) VALUES (
          p_user_id, actual_delta, wallet.balance + actual_delta,
          p_source, p_reference, entry_description
        );
        RETURN true;
      END;
      $$;

      CREATE FUNCTION identity.apply_order_coin_transition()
        RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE
        redeemed integer;
        reward integer;
      BEGIN
        IF NEW.status = 'PAID' THEN
          -- PayOS charges a whole VND amount, rounded from the authoritative order total.
          reward := floor(round(NEW.total) / 100)::integer;
          IF reward > 0 THEN
            PERFORM identity.record_coin_change(
              NEW.buyer_id,
              CASE WHEN NEW.source = 'AUCTION' THEN 'AUCTION_PAYMENT_REWARD'
                   ELSE 'ORDER_PAYMENT_REWARD' END,
              NEW.id, reward
            );
          END IF;

          UPDATE identity.coin_wallets
             SET locked_bonus = 0, updated_at = clock_timestamp()
           WHERE user_id = NEW.buyer_id AND locked_bonus > 0;
        ELSIF NEW.status = 'REFUNDED' OR
          (OLD.status = 'PENDING_PAYMENT' AND NEW.status::text IN ('CANCELLED', 'EXPIRED')) THEN
          SELECT -amount_delta INTO redeemed FROM identity.coin_transactions
           WHERE user_id = NEW.buyer_id AND reference_id = NEW.id
             AND source_type = 'CHECKOUT_REDEEM';

          IF redeemed > 0 THEN
            PERFORM identity.record_coin_change(NEW.buyer_id, 'CHECKOUT_REFUND', NEW.id, redeemed);
          END IF;

          IF NEW.status = 'REFUNDED' THEN
            SELECT amount_delta INTO reward FROM identity.coin_transactions
             WHERE user_id = NEW.buyer_id AND reference_id = NEW.id
               AND source_type IN ('ORDER_PAYMENT_REWARD', 'AUCTION_PAYMENT_REWARD');
            IF reward > 0 THEN
              PERFORM identity.record_coin_change(NEW.buyer_id, 'REWARD_REVOKE', NEW.id, -reward);
            END IF;
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER order_coin_transition
        AFTER UPDATE OF status ON commerce.orders
        FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
        EXECUTE FUNCTION identity.apply_order_coin_transition();
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER order_coin_transition ON commerce.orders;
      DROP FUNCTION identity.apply_order_coin_transition();
      DROP FUNCTION identity.record_coin_change(uuid, text, uuid, integer);
      DROP TABLE identity.coin_transactions;
      DROP TABLE identity.coin_wallets;
    `);
  }
}
