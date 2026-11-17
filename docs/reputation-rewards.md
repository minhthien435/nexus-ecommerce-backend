# Reputation rewards (BE-REP-01)

Scores for people and shops are independent. This change adds durable one-time claims; each reward records its actual credited delta, including zero at score100.

| Trigger                                                                                   | Destination                     | Reward      | Durable claim                                                                |
| ----------------------------------------------------------------------------------------- | ------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| Successful personal profile PATCH leaves valid fullName, phone and avatarUrl              | identity.reputation_scores      | +15, cap100 | identity.profile_completion_rewards, one per user                            |
| Shop registration or update leaves valid name, phone, warehouseAddress and identityNumber | identity.shops.reputation_score | +10, cap100 | identity.shop_reputation_rewards, SHOP_PROFILE_COMPLETION, reference=shop ID |
| Eligible completed order after complaint deadline                                         | identity.shops.reputation_score | +5, cap100  | Same shop ledger, ORDER_COMPLETION, reference=order ID                       |

## Frontend integration

Use existing authenticated APIs. There is no reward endpoint to call.

Personal profile: PATCH `/api/v1/users/profile` with any supplied fields. The saved full profile is checked in the transaction, so fields may be completed across several PATCHes. Existing validation applies: trimmed fullName1..150 characters, phone exactly10 digits or null, avatarUrl an HTTP/HTTPS URL up to2048 characters or null. Missing fields are preserved. A complete profile earns +15 once; clearing and refilling fields never earns another reward.

GET `/api/v1/auth/me` and the PATCH response now include `profileCompletionRewarded: boolean`. The public identity projection also exposes this flag. It means the one-time reward has been consumed, even if fields were later cleared or the score was already100. Existing fields, roles, trustLevel and addresses remain available. Trust recalculation and bidder eligibility are committed with the personal reward; is_restricted still follows score<50.

To earn shop +10, POST `/api/v1/identity/seller/register` with:

```json
{
  "name": "Example Shop",
  "phone": "0912345678",
  "warehouseAddress": "123 Example Street, Hanoi",
  "identityNumber": "012345678901"
}
```

The current registration DTO trims text and requires name3..150 characters, a Vietnamese mobile phone matching `^(?:\+84|0)(?:3|5|7|8|9)\d{8}$`, warehouseAddress5..1000 characters, and identityNumber5..100 characters. Slug is generated when omitted. Optional logo, banner, email, headline and description are not reward requirements. Read `reputationScore` in the successful registration response; a fresh shop normally changes from50 to60.

Existing shops earn +10 on their next successful PATCH `/api/v1/identity/seller/shop/me` if the complete persisted required profile is valid and has no claim yet. This endpoint currently permits phone and warehouseAddress updates (plus optional presentation/contact fields); name and identityNumber remain governed by existing APIs and cannot be repaired through this PATCH. For example, `{"warehouseAddress":"123 Example Street, Hanoi"}` preserves other saved required fields and evaluates the resulting profile. The PATCH response and GET `/api/v1/identity/seller/shop/me` expose `reputationScore`. Repeated updates are safe and cannot repeat the bonus.

Shop +10 does not require GHN verification in this phase. The global GHN origin is not a verified address for any shop. No per-shop GHN infrastructure is added.

## Completed order policy

The existing15-minute completion job handles two independent bounded scans (up to100 delivered orders and100 completed reward candidates per run). It never exits before the completed scan just because no delivered orders need completion. Consumed and currently ineligible rows are filtered before LIMIT, with deterministic order and SKIP LOCKED for overlapping workers.

The complaint deadline is strictly later than72 hours after the latest DELIVERED status-history timestamp. At the exact deadline a dispute can still be created, so no completion reward is minted there. Divergent orders.delivered_at cannot shorten that clock. Missing delivery history defers processing.

Only COMPLETED orders qualify. Pending disputes defer, REJECTED_PAY_SELLER permits a later reward after resolution is committed, and ACCEPTED_REFUND excludes. CANCELLED/REFUNDED orders are excluded. A full refund record with amount>=order.total and status REQUESTED, PROCESSING or COMPLETED excludes the reward conservatively, regardless fault. A REJECTED refund does not itself block a completed order. No seller-fault field is inferred or introduced.

Completed orders are terminal in the current state machine and late disputes cannot be opened for them. Consequently there is no reachable late-fault clawback flow; this change does not invent one. If late complaints or post-completion refunds become supported, their transaction must coordinate reward reversal before those new flows ship.

## Transactions and migration rollout

Apply `1794873600000-DurableReputationRewards` before deploying code that reads/writes the new ledgers. Run the normal migration process with an authorized deployment database; this implementation has not mutated the shared database. Pause profile/shop writes during deployment of the migration and new application versions so older workers cannot mint unclaimed historical rewards between backfill and rollout.

The migration backfills one personal claim per historical PROFILE_COMPLETION user using the earliest audit timestamp. Duplicate historical audit rows are preserved, and no historical score is changed. Existing valid shops receive their bonus only on their next successful registration/update flow, not during migration. Existing due completed orders are picked up by later job runs, at most100 per run.

Each personal transaction locks the saved user and score, inserts the unique claim, updates score and trust, writes actual-delta history, and syncs bidder eligibility. Auction payment rewards and timeout penalties take the same user-first lock before their idempotency checks and score access, avoiding a score/user-FK deadlock with a profile PATCH that updates unique phone. Each shop transaction locks the shop and inserts a unique (shop, source, reference) ledger row before updating the score. Order rewards also lock/recheck the order. The shop ledger retains old/new scores and delta; FK and check constraints enforce valid references and arithmetic. A unique (source, reference) additionally prevents an order from being rewarded again against a replacement shop. All new writes roll back together on failure. Shop update loads the row under a write lock to avoid overwriting a concurrently awarded reputationScore with a stale entity save.

A rollback that drops reward ledgers loses consumption state. Do not revert the migration after rewards have been issued without an explicit data-preservation/reconciliation procedure. User audit history remains present on down migration, but shop reward history would be removed.

BE-REP-02 remains a separate dependent change. Auction seller/bidder thresholds and existing payment penalties are unchanged here. The current seller threshold is 50. When BE-REP-01 has been merged and the team schedules BE-REP-02, frontend must switch its seller gate to 70 in the same release and read shop.reputationScore, independently of personal reputation. A new valid shop earns 50 + 10 = 60; two eligible completed orders add 5 each to reach 70. Bidder eligibility remains 50.

## Verification

See [verification evidence](reputation-verification.md) for exact commands, results, coverage gaps and pending final root revalidation. Real PostgreSQL tests are opt-in with `REPUTATION_TEST_DATABASE_URL` and never fall back to `.env`. The harness refuses all hosts except loopback and every database name except `nexus_reputation_test`; it recreates disposable identity/commerce/auction fixture schemas there. Do not point it at application data. Its fixtures match the reward-relevant actual columns and exercise the migration, row locks, unique constraints and rollbacks. It does not run the entire application's historical migrations or reproduce production load.
