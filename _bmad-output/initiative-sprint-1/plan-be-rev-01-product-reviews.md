---
title: 'BE-REV-01 Product reviews and ratings'
type: 'feature'
ticket: ''
created: '2026-11-24'
status: 'built'
baseline_revision: '0e25cff3cd123145c61d3ca80765a4850e943ec5'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nexus has no product-review persistence or API, so completed purchases cannot produce trustworthy product/shop ratings and sellers cannot respond. Product cards and buyer order details also lack the rating/review state needed by FE-REV-01.

**Approach:** Add a review aggregate rooted in an immutable order item, expose buyer creation, public product/shop listings, and owner-only seller replies, and recompute denormalized product/shop ratings transactionally from review rows.

## Boundaries & Constraints

**Always:** Derive product, SKU, shop, order, and buyer identities server-side from the order item; require the owning buyer and a `COMPLETED` order; allow one review per order item; validate rating 1–5, comment at most 1000 characters, and at most five image URLs; lock the affected product and shop while recomputing both aggregates; preserve a shop's existing 5.00 rating until its first review; enforce seller ownership for replies; keep public reads paginated and return star distribution; add `reviewId` to buyer order-detail items.

**Never:** Accept ownership identifiers from the review-create payload, permit review edits/deletes or multiple seller replies as separate records, change order state rules, implement image upload, or include follow/wishlist/frontend work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create review | Owning buyer, completed order item, valid payload | One review is committed; product and shop counts/averages are recomputed; response includes created review | No error expected |
| Invalid eligibility | Foreign buyer, non-completed order, or unknown item | No review or aggregate change | Return 404 for non-owned/unknown item; 409/400 for ineligible state |
| Duplicate review | Existing review for the order item | Existing data and aggregates remain unchanged | Return conflict with stable error code |
| Public listing | Product slug or active shop reference with page/limit and optional 1–5 rating | Reviews plus pagination and five-star distribution | Invalid filters fail validation; unknown resource returns 404 |
| Seller reply | Product-owning seller and unreplied review | Reply and timestamp are persisted | Foreign seller/unknown review returns 404; duplicate reply conflicts |

</frozen-after-approval>

## Code Map

- `src/database/migrations/1795486400000-CreateProductReviews.ts` -- create `catalog.product_reviews`, constraints/indexes/FKs, and product rating columns with reversible `down()`.
- `src/modules/catalog/domain/entities/product-review.entity.ts` -- TypeORM mapping for review writes/reads; `product.entity.ts` gains numeric rating fields.
- `src/modules/catalog/dtos/product-review.dto.ts` -- validated create, reply, and pagination/rating query contracts.
- `src/modules/catalog/services/product-review.service.ts` -- eligibility/ownership checks, transactional creation and aggregate recomputation, public queries, and seller reply logic; reuse `DataSource.transaction` and raw-query conventions already used by catalog services.
- `src/modules/catalog/controllers/product-review.controller.ts` -- buyer and seller guarded write endpoints; public reads remain unguarded under existing catalog prefixes.
- `src/modules/catalog/catalog.module.ts` -- register the review entity, controller, and service alongside existing catalog resources.
- `src/modules/commerce/services/order.service.ts` -- attach review IDs to items returned by buyer `getOrderById` without changing seller order contracts.
- `src/modules/catalog/services/product-search.service.ts` and `src/modules/catalog/services/public-shop.service.ts` -- expose denormalized product `ratingAvg`/`reviewCount` in product detail/search/shop product cards; avoid per-row review aggregates.
- `src/modules/identity/rbac/rbac.constants.ts` -- reuse existing `REPUTATION.RATE` for buyer creation and `PRODUCT.UPDATE` for seller replies; no new privilege vocabulary.
- Existing `*.spec.ts` patterns -- controller metadata tests, mocked service transaction/query tests, DTO validation tests, and isolated-Postgres migration round-trip tests.

## Tasks & Acceptance

**Execution:**
- [x] `src/database/migrations/1795486400000-CreateProductReviews.ts` and `.spec.ts` -- add/revert schema and prove unique/check/FK constraints plus up-down-up behavior.
- [x] `src/modules/catalog/domain/entities/{product,product-review}.entity.ts` and `dtos/product-review.dto.ts` -- model persistence and reject malformed ratings, oversized text, excess/non-URL images, and invalid paging/filter values.
- [x] `src/modules/catalog/services/product-review.service.ts` and `.spec.ts` -- implement all review operations with atomic locks/recomputation and cover eligibility, concurrency-safe aggregates, ownership, duplicates, filters, distribution, and replies.
- [x] `src/modules/catalog/controllers/product-review.controller.ts` and `.spec.ts` -- publish the four specified routes with correct envelopes, guards, permissions, parameters, and status codes.
- [x] `src/modules/catalog/catalog.module.ts` -- wire the feature and repositories.
- [x] `src/modules/commerce/services/order.service.ts` and `.spec.ts` -- batch-load review IDs for buyer order-detail items and return null when absent.
- [x] `src/modules/catalog/services/{product-search,public-shop}.service.ts` and specs -- include product rating aggregates in existing public card/detail payloads.

**Acceptance Criteria:**
- Given two completed-order reviews are submitted concurrently for one product/shop, when both transactions finish, then stored product and shop averages/counts equal an aggregate over all committed review rows.
- Given a completed buyer order item, when its order detail is requested before and after review creation, then that item returns `reviewId: null` and then the created UUID.
- Given public product or shop review requests, when paging and filtering by a star value, then results are scoped correctly while distribution reports counts for ratings 1 through 5.
- Given products are returned by detail, search, or shop listing, when reviews exist, then each payload exposes the persisted product average and review count without per-card review-table aggregation.

## Implementation Notes

- Implemented the approved review schema/API, transactional aggregate recomputation, catalog cache invalidation, order-detail review state, and product rating projections. Full unit regression, lint, typecheck, build, and touched-file formatting pass. The isolated PostgreSQL migration round-trip is present but skipped locally because `TEST_POSTGRES_URL` is not configured.

## Plan Change Log

## Review Triage Log

- quick-1 — `medium`, route `patch`: verified that `ReplyProductReviewDto` accepts whitespace-only text and `ProductReviewService.reply()` trims it to an empty non-null value, permanently consuming the one allowed seller reply while displaying no content. The smallest correction is trim-aware non-empty DTO validation with a regression test.

## Design Notes

Keep aggregate recomputation inside the same transaction as review insert: lock product and shop rows in deterministic order, insert the review, aggregate by `product_id` and `shop_id`, then update both denormalized targets. Public review rows should include buyer display identity suitable for UI but never email/phone; use the existing user profile fields and product image/name joins where needed by shop reviews.

## Verification

**Commands:**
- `npm run format:check` -- all touched TypeScript is formatted.
- `npm run lint` -- zero lint errors.
- `npm run typecheck` -- all new contracts and entity mappings type-check.
- `npm run test` -- migration, DTO, controller, service, order, and catalog regression suites pass.
- `npm run build` -- Nest production build succeeds.
