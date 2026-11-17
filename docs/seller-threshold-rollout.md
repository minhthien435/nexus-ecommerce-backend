# BE-REP-02: seller threshold 70 - clean review branch

The original branch was prepared on BE-REP-01 commit `0c8ba8ec84e3433870c00694118ee6cf21423771`. BE-REP-01 has since merged into `main` with the equivalent patch `6e6bda53efdf3d1ae71e42b0eb0614f30017be65` and merge `654401faf41f9a4dd2d00c45d2b60ca0d74cfde6`. The original worktree retains that base unchanged. The clean review branch `feat/duy/reputation-seller-threshold-70-clean` is based on `origin/main` at `9e9112022f48cbb7e5ae9d901aecb744aa210d81`; it cherry-picks only REP-02, without transferring the REP-01 parent. **Do not deploy before the shared database migrations and coordinated frontend release are verified.**

This dependent change requires an ACTIVE shop with `shop.reputationScore >= 70` for creation and the existing seller eligibility checks during scheduled activation. A shop at 50 or 69 is rejected with `SELLER_AUCTION_INELIGIBLE`; 70 and above pass the reputation requirement while other validations still apply. Personal reputation does not substitute for shop reputation. Bidder threshold 50 and payment penalties remain unchanged.

Frontend must release its threshold change in the same batch as this backend change. Read `reputationScore` from the authenticated seller shop API, not the personal user score. See [shop reward guidance](reputation-rewards.md): an eligible shop starts at 50, earns profile +10 once and eligible completed-order +5 per order, reaching 70 after two eligible orders. No per-shop GHN verification is required for the profile reward in this phase.

The repository had no demo-shop reputation seed. `node scripts/seed-demo-shop-reputation.mjs` now ensures an **existing** shop owned by `seller.demo@nexus.vn` is at least 70 and preserves a score of 100. Set DATABASE_URL explicitly for the intended authorized seed environment. It fails when no unique existing demo shop is found; it does not create accounts or alter other shops. This task never runs it against the shared database, where the plan records the demo shop already at 100.

The helper does not load `.env`; DATABASE_URL must already be in the process environment. All seed executions for this task used the dedicated isolated local database only.

## Original verification (2026-11-17, before this follow-up)

| Command | Exit | Result |
| --- | --- | --- |
| `npm.cmd exec -- vitest run src/modules/auction` | 0 | 6 files / 83 tests, including create and scheduled activation boundaries |
| `npm.cmd run test:cov -- --coverage.reporter=text --coverage.reporter=json-summary` | 0 | Full backend: 167 files / 1401 tests including 31 actual PostgreSQL tests |
| `npm.cmd run lint` | 0 | Passed |
| `npm.cmd run typecheck` | 0 | Passed after the final test changes |
| `npm.cmd run build` | 0 | Passed; backend production source unchanged thereafter |
| `node --check scripts/seed-demo-shop-reputation.mjs` | 0 | Passed |
| `git diff --check` | 0 | Passed |

Full coverage used `REPUTATION_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/nexus_reputation_test`: statements **86.77% (6642/7654)**, branches **75.26% (3993/5305)**, functions **82.74% (1189/1437)**, lines **87.96% (6413/7290)**. No coverage filters or thresholds changed. The [BE-REP-01 evidence and limits](reputation-verification.md) apply to inherited reward code.

Seed was executed with explicit DATABASE_URL pointing to the same isolated DB against demo fixtures at 50/70/100, twice each: results 70/70/100. Missing demo exited 1 as expected. With DATABASE_URL removed, the command exited 1 before connecting even when invoked from the parent repository containing `.env`. The fixture verifier itself exited 0 after asserting all outcomes. No shared DB seed was run.

BMAD quick review found the dotenv fallback risk and missing below-70 activation assertions. Both were patched; subsequent targeted tests, full coverage, lint and typecheck passed. The original integration target was `origin/main` at `ddb3d57173601d5bc174bcd7e727aaf105789326`, where BE-REP-01 had not yet merged. That historical status is superseded by the follow-up below. Frontend code is outside this workspace/scope; the coordinated threshold change is still required.

## Historical follow-up in the original worktree (2026-11-17)

Normal seller creation already uses `ShopEntity.reputationScore >= 70` and requires an ACTIVE shop. Internal Kaggle/demo creation previously saved directly without this check. It now checks the same eligibility predicate under a shop read lock and saves through the same transaction manager. Ineligible demo shops are skipped (`null`), preserving the importer's existing skip contract; scheduling happens only after the transaction completes. Bidder reputation 50 and shop profile rewards remain unchanged.

Frontend contract: use `GET /api/v1/identity/seller/shop/me`, field `reputationScore`, for the authenticated seller's shop. Personal user trust/reputation from authentication/profile APIs does not authorize seller auction creation. New shops start at 50 and receive the existing one-time profile reward of 10; a shop at 60 is correctly rejected. Normal creation rejects with HTTP 403, `SELLER_AUCTION_INELIGIBLE`, and a message naming minimum 70. PENDING, SUSPENDED, CLOSED and missing shops are ineligible. There is no separate per-shop verification flag in the current model; do not invent one for frontend gating.

Read-only inspection of the database configured by the parent checkout's `.env` found neither `DurableReputationRewards1794873600000` nor `AddCoinWallets1794888000000` in `public.migrations`. Both reward tables, their constraints, `commerce."IDX_order_delivered_reputation_clock"`, both Coin tables and `identity.record_coin_change(uuid,text,uuid,integer)` were absent. No migration, seed or database mutation was executed during this follow-up.

| Dependency | Evidence and owner action |
| --- | --- |
| BE-REP-01 / database owner | Durable Rewards migration is already inherited here and merged into main. Its primary/unique constraints and claim inserts with `ON CONFLICT` provide idempotency; they are currently absent from the inspected DB. The DB owner must apply the existing migration through the approved rollout and verify rewards before releasing the threshold change. No duplicate migration was added. |
| Coin Wallet / Hoang and database owner | Coin source and `AddCoinWallets` are present on main but absent from this older REP-02 checkout. On main, ordinary registration and new Google-account creation call `CoinService.welcome` inside their transactions. Its four-argument call matches the migration's `(uuid,text,uuid,integer)` signature. With the function absent, PostgreSQL raises undefined-function and account creation rolls back. Existing Google-account login does not enter this welcome branch. Apply the existing Coin migration through its owner's rollout; do not suppress failures or copy Coin into REP-02. |
| BE-ADM-01 / Admin developer | This checkout lacks `GET /admin/auctions`, `GET /admin/auctions/:idOrCode` (and their `/api/v1` aliases) and `AUCTION.ADMIN_LIST`; only admin cancel exists. The privilege was also absent from `identity.privileges` in the inspected DB. Admin must implement/verify GET guards and privilege provisioning separately. |

GitLab heads were verified read-only: main `9e9112022f48cbb7e5ae9d901aecb744aa210d81`; remote `feat/duy/reputation-seller-threshold-70` did not exist. `git cherry origin/main HEAD` marks the old REP-01 parent as patch-equivalent to main. The current committed branch is 13 commits behind and 2 ahead of main, and its three-dot MR diff still includes 18 inherited REP-01 files plus the original five REP-02 files. Base reconciliation and a fresh diff review require a separately authorized merge/rebase; neither was performed. No commit or push was performed.

Follow-up validation: focused auction suites passed **7 files / 120 tests**, with zero failed/skipped. Full `npm.cmd test` passed **167 files / 1,407 tests**, with zero failed and **1 file / 31 PostgreSQL tests skipped**. `REPUTATION_TEST_DATABASE_URL` was removed from the test process to respect the no-migrations requirement: that suite's setup invokes migration code, so these integration tests were not verified in this run. Historical integration/coverage evidence above does not establish correctness of the new transaction against live PostgreSQL. The separate new HTTP suite uses actual Nest guards, JWT and validation with repository/RBAC/service test doubles; it does not claim end-to-end database verification. Typecheck and build passed. No claim of production or coordinated frontend readiness is made.

Historical result in the original worktree: database/environment deployment blockers remained, and that older branch needed a clean base. The clean preparation below resolves the branch-base issue for Leader code review. Shared migrations, isolated PostgreSQL verification and coordinated frontend rollout remain deployment dependencies.

The original-worktree final review found no issues in its follow-up diff. Final lint, typecheck, changed-code Prettier check and `git diff --check` passed. Exactly four files are changed: this REP-02 rollout document, the auction service, its existing unit suite and the new auction creation HTTP suite. No BE-REP-01, Coin, Admin, environment, generated or unrelated files are included; those changes remained unstaged in the original worktree.

## Clean branch validation and review handoff (2026-11-17)

Worktree: `D:/ProjectFPT/BE/nexus-ecommerce-backend-rep-02-clean`. Branch: `feat/duy/reputation-seller-threshold-70-clean`. A fresh fetch verified base `9e9112022f48cbb7e5ae9d901aecb744aa210d81`. Original REP-02 commit `1eddece880b38fa97c7b130783d8c33dc2eef364` was cherry-picked as `3d161e2790512daf3841c49dfb4a32ffbe650c3f`. REP-01 commit `0c8ba8ec84e3433870c00694118ee6cf21423771` was not cherry-picked. The two tracked code changes were transferred as patches and the new HTTP test separately, preserving newer main notification code. Code fix commit: `f64a3bf054e02a95b422c7aa2c9392acec08c3b8`. Rollout documentation is committed separately.

| Check on clean base | Result |
| --- | --- |
| `npm.cmd exec -- vitest run src/modules/auction` | 7 suites, 126 passed, 0 failed, 0 skipped |
| `npm.cmd run lint` | Passed |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run build` | Passed |
| `git diff --check` | Passed |

The full-suite counts in the historical section belong to the older worktree and were not rerun or claimed for this clean branch. PostgreSQL integration was not run: its setup invokes migration code, and no migrations or seeds are authorized in this preparation. The focused suite uses no shared database. No shared database migration or frontend rollout is claimed complete.

The intended three-dot MR diff has exactly six REP-02 paths: `src/modules/auction/auction-lifecycle.constants.ts`, `src/modules/auction/auction.service.ts`, `src/modules/auction/auction.service.spec.ts`, `src/modules/auction/controllers/auction-create-access.spec.ts`, `docs/seller-threshold-rollout.md`, and `scripts/seed-demo-shop-reputation.mjs`. Coin, Admin, REP-01, migration, environment and generated files are excluded. The demo seed file is included from the original approved commit but was not executed.

This branch is prepared for Leader code review. Deployment remains dependent on the DB owner applying and verifying the existing Durable Rewards and Coin migrations, isolated PostgreSQL verification, and FE releasing its seller gate with the backend. Admin Monitor remains a separate BE-ADM-01 task. The original branch and its four uncommitted files are preserved.
