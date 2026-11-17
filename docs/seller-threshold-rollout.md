# BE-REP-02: dependent seller threshold change

This branch is prepared only: **do not integrate or deploy until BE-REP-01 shop reward support has been merged**. Its parent is BE-REP-01 commit `0c8ba8ec84e3433870c00694118ee6cf21423771`. The separate BE-REP-01 branch retains seller threshold 50.

This dependent change requires an ACTIVE shop with `shop.reputationScore >= 70` for creation and the existing seller eligibility checks during scheduled activation. A shop at 50 or 69 is rejected with `SELLER_AUCTION_INELIGIBLE`; 70 and above pass the reputation requirement while other validations still apply. Personal reputation does not substitute for shop reputation. Bidder threshold 50 and payment penalties remain unchanged.

Frontend must release its threshold change in the same batch as this backend change. Read `reputationScore` from the authenticated seller shop API, not the personal user score. See [shop reward guidance](reputation-rewards.md): an eligible shop starts at 50, earns profile +10 once and eligible completed-order +5 per order, reaching 70 after two eligible orders. No per-shop GHN verification is required for the profile reward in this phase.

The repository had no demo-shop reputation seed. `node scripts/seed-demo-shop-reputation.mjs` now ensures an **existing** shop owned by `seller.demo@nexus.vn` is at least 70 and preserves a score of 100. Set DATABASE_URL explicitly for the intended authorized seed environment. It fails when no unique existing demo shop is found; it does not create accounts or alter other shops. This task never runs it against the shared database, where the plan records the demo shop already at 100.

The helper does not load `.env`; DATABASE_URL must already be in the process environment. All seed executions for this task used the dedicated isolated local database only.

## Verification (2026-11-17)

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

BMAD quick review found the dotenv fallback risk and missing below-70 activation assertions. Both were patched; subsequent targeted tests, full coverage, lint and typecheck passed. Integration target checked is `origin/main` at `ddb3d57173601d5bc174bcd7e727aaf105789326`; BE-REP-01 has not been merged there, so this branch remains dependent and unintegrated. Frontend code is outside this workspace/scope; the coordinated threshold change is still required.
