---
title: 'BE-NOTI-01/02 Auction notifications and payment reminder'
type: 'feature'
ticket: ''
created: '2026-11-16'
status: 'built'
baseline_revision: '5d62f8d9d55974668c5c069733ba1fa578076f05'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Auction participants currently receive only outbid notifications. Winners, losing bidders, late-bid participants, and winners approaching or missing their payment deadline lack durable in-app notifications.

**Approach:** Dispatch idempotent push notifications after committed auction state changes, and schedule a BullMQ reminder four hours before the existing 24-hour payment deadline.

## Boundaries & Constraints

**Always:** Keep notification delivery best-effort and post-commit so it cannot roll back bidding, settlement, or timeout processing. Use stable `sourceEventId` values for deduplication. Send winner links to `/orders/<orderId>` and auction-related links to `/auctions/<auctionId>`. A reminder runs only while the settlement is `PENDING_PAYMENT`, and is not scheduled when fewer than four hours remain.

**Never:** Change settlement/payment rules, email behavior, reputation penalties, auction status transitions, or frontend code. Do not expose reserve prices or unmasked participant data in notification payloads.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Successful settlement | Reserve met with winner and losing bidders | Winner gets `AUCTION_WON`; distinct losers get `AUCTION_LOST`; reminder and timeout jobs are scheduled | Notification/queue failure is logged without reverting settlement |
| Failed settlement | Reserve not met | Every distinct bidder gets the failed-auction variant of `AUCTION_LOST` | Empty bidder set is a no-op |
| Anti-sniping extension | Late bid extends auction | All prior distinct bidders except triggering bidder get `AUCTION_SNIPED` | Dispatch failure does not fail bid |
| Reminder executes | Deadline is four hours away and settlement remains pending | Winner gets one `AUCTION_PAYMENT_REMINDER` | Paid/timed-out/missing settlement is skipped |
| Payment expires | Timeout transition commits | Winner gets `AUCTION_PAYMENT_EXPIRED` with penalty metadata | Dispatch failure does not revert cancellation or penalty |

</frozen-after-approval>

## Code Map

- `src/modules/auction/auction-settlement.constants.ts` -- defines queue job names and payload shared by settlement scheduling and the processor.
- `src/modules/auction/services/auction-settlement.service.ts` -- commits `SETTLED`/`FAILED`, creates orders, schedules timeout, and runs socket/email post-commit effects; add winner/loser dispatch and reminder scheduling here.
- `src/modules/auction/processors/auction-settlement.processor.ts` -- handles delayed settlement jobs and timeout post-commit email; route reminder jobs and add expired push dispatch here.
- `src/modules/auction/auction.service.ts` -- commits bids, detects anti-sniping extension, and already dispatches `AUCTION_OUTBID`; reuse its post-commit notification pattern for affected bidders.
- `src/modules/notification/notification-dispatch.api.ts` -- existing `notify`/`notifyMany` abstraction; reuse without modifying notification persistence.
- `src/modules/auction/services/auction-settlement.service.spec.ts` -- settlement, queue, socket, and email unit fixtures.
- `src/modules/auction/processors/auction-settlement.processor.spec.ts` -- delayed-job and timeout unit fixtures.
- `src/modules/auction/auction.service.spec.ts` -- bid/extension tests and optional notification mock constructor slot.

## Tasks & Acceptance

**Execution:**
- [x] `src/modules/auction/auction-settlement.constants.ts` -- add the payment-reminder job constant and compatible payload typing.
- [x] `src/modules/auction/services/auction-settlement.service.ts` -- inject notification dispatch, schedule the four-hour reminder with deterministic job ID, query distinct bidders, and emit idempotent won/lost notifications after commit.
- [x] `src/modules/auction/auction.service.ts` -- after a committed extension, notify distinct prior bidders except the current bidder using an extension-specific source ID.
- [x] `src/modules/auction/processors/auction-settlement.processor.ts` -- process reminder jobs only for pending settlements and emit payment-expired notification only after a committed timeout.
- [x] Auction unit specs -- cover successful/failed settlement recipients, queue timing and short-deadline skip, anti-sniping recipients, reminder state guards, timeout notification, and notification failure isolation.

**Acceptance Criteria:**
- Given a settled auction, when post-commit effects run, then the winner receives one order-linked won notification and each other distinct bidder receives one lost notification.
- Given a reserve-failed auction, when settlement commits, then every distinct bidder receives the no-winner lost message.
- Given a late bid that extends an auction, when the bid commits, then all other prior bidders receive one notification keyed by auction and extension count.
- Given a settlement with at least four hours remaining, when jobs are scheduled, then a deterministic reminder job runs at `paymentDeadlineAt - 4h`; otherwise no reminder job is created.
- Given a pending settlement, when its reminder job executes, then one order-linked reminder is dispatched; non-pending settlements are skipped.
- Given payment timeout commits, when post-commit effects run, then the winner receives one expired notification stating cancellation and the 30-point penalty.

## Implementation Notes

- Added deterministic reminder jobs at `paymentDeadlineAt - 4h`; recovery settlements with shorter deadlines intentionally retain only the timeout job.
- Captured distinct bidder recipients inside the domain transaction and dispatched notifications only after commit.
- Kept winner, loser, reminder, expired, and anti-sniping delivery failures isolated from auction/payment state changes.
- Targeted auction suites pass (62 tests), followed by successful build and lint.

## Plan Change Log

## Review Triage Log

- `medium` / `patch` — Recovery with an already-linked order did not retry reminder scheduling; verified in the existing-settlement early return. Centralized deterministic reminder enqueue for every pending recovered settlement with an order.
- `low` / `rejected` — A payment can commit after the reminder's pending-state read and before push dispatch. The race is real but eliminating it would require dispatching inside the database transaction or an outbox redesign, contradicting the approved post-commit invariant; the processor still checks canonical status at execution time.
- `medium` / `patch` — Reminder delivery trusted recipient and link fields from the BullMQ payload. It now reads canonical winner, auction, order, and status from the settlement and skips reminders without an order link.

## Design Notes

The existing notification service already deduplicates `(user, channel, sourceEventId)` and swallows dispatch errors. Callers will still wrap post-commit dispatch in `try/catch` to preserve explicit domain logging. Bidder recipient queries use `SELECT DISTINCT bidder_id` and exclude the winner/triggering bidder at SQL level.

## Verification

**Commands:**
- `npm test -- src/modules/auction/services/auction-settlement.service.spec.ts src/modules/auction/processors/auction-settlement.processor.spec.ts src/modules/auction/auction.service.spec.ts` -- expected: targeted Vitest suites pass.
- `npm run build` -- expected: NestJS TypeScript build succeeds.
- `npm run lint` -- expected: no new lint errors in changed files.
