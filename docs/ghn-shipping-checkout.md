# GHN locations and checkout shipping

All routes require the existing access-token authentication and use the normal API response envelope.

| Route                                                                 | Input                                                                 | Response data                                                                                                        |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/fulfillment/shipping/locations/provinces`                | None                                                                  | Array of `{ code: string, name: string }`                                                                            |
| `GET /api/v1/fulfillment/shipping/locations/districts?provinceId=202` | Positive GHN province ID                                              | Same location shape                                                                                                  |
| `GET /api/v1/fulfillment/shipping/locations/wards?districtId=1452`    | Positive GHN district ID                                              | Same location shape                                                                                                  |
| `POST /api/v1/fulfillment/shipping/calculate-fee`                     | `{ toDistrictId: number, toWardCode: string, weightInGrams: number }` | `{ fee: number, currency: "VND", weightGrams: number, serviceTypeId: number, expectedDeliveryTime: string \| null }` |

Codes come from GHN, not national administrative-code datasets. This deliberately uses GHN's legacy three-level address model to match the current checkout fields. Ward codes remain strings. Weight must be a positive integer, at most 5,000,000 grams; invalid inputs fail with 400. Location results are cached in Redis for 24 hours. Redis failures fall through to GHN. No failed upstream response is cached.

## Configuration and origin

Set `GHN_API_TOKEN`, `GHN_SHOP_ID` and optionally `GHN_API_URL` using private environment configuration. The default URL is `https://dev-online-gateway.ghn.vn/shiip/public-api`; a trailing `/v2` is supported. Redis uses the existing `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB` and `REDIS_CONNECT_TIMEOUT_MS` settings. No new dependency or database migration is required.

For this demo all sellers use the configured Sandbox shop's registered origin. The client finds that exact shop through GHN's paginated shop API and reads its district and ward. It never invents origin codes. Each request times out after five seconds, and shop traversal is capped at 20 pages. Available services are checked for each route; standard service type 2 is used below 20kg, heavy type 5 from 20kg. Fees are requested with the exact total gram weight and zero declared insurance value. Delivery estimates are optional. Invalid fees, missing credentials, unavailable routes and fee request failures return 503; shipment mock fallback does not apply to quotes.

## Checkout and PayOS

The existing checkout API still accepts `shippingAddress.districtCode` and `wardCode`, or a saved address. Every chosen SKU must have a positive persisted `weightGrams`. Checkout groups selected rows by seller, sums `weightGrams * quantity`, and obtains one independent quote per seller before opening its database transaction. Client-supplied prices or fee estimates are never used.

Under the transaction, the active cart and chosen rows are locked and the SKU projection is reread. Changes to row identity, SKU, quantity, seller or persisted weight reject checkout with `SHIPPING_QUOTE_STALE` (409); retry checkout. Inventory reservation, order creation and cart reservation/deletion retain the existing atomic behavior. The exact integer-VND quotes are converted through existing bigint monetary arithmetic into each order's `shippingFee`, order total, session shipping fee and session total.

PayOS remains one payment link per seller order. Each link uses that order's stored total, including its fee. The sum of those links equals the checkout total. This change does not introduce a session-wide PayOS link or change webhook behavior.

## Handoff to Minh: existing shipment creation compatibility

`shipSellerOrderWithGhn` still has a separate shipment-creation contract: it reads `phone`, `street`/`address`, `districtId`/`district`, assumes 200g per item, and its client has hardcoded origin defaults and a development mock fallback. Checkout snapshots use `recipientPhone`, `addressLine`, `districtCode`, and persisted SKU weights. Shipment creation must be aligned with these fields and the registered shop origin before relying on label creation matching checkout quotations. This work intentionally does not create shipments or change that existing lifecycle. Fee quotations are estimates and can differ when shipment parcel dimensions, insurance or pickup details change.

## Contract references

Official contracts checked during implementation: [locations](https://developer.ghn.vn/en/docs/master-data/get-province), [districts](https://developer.ghn.vn/en/docs/master-data/get-district), [wards](https://developer.ghn.vn/en/docs/master-data/get-ward), [shop origin](https://developer.ghn.vn/en/docs/shop/get-shop), [available services](https://developer.ghn.vn/en/docs/master-data/get-service), [fee](https://developer.ghn.vn/en/docs/order/calculate-fee), [delivery estimate](https://developer.ghn.vn/en/docs/order/leadtime).

Unit tests cover location caching and Redis failure, validation, upstream/configuration failures, shop cursor selection, per-seller weight and money arithmetic, stale cart rejection, and aggregate PayOS amounts. No live shipment is created by these tests.

## Live Sandbox check (2026-11-07)

The configured token successfully retrieved the province catalogue and the configured shop. That shop has no populated legacy district/ward origin, so quoting currently returns `GHN_ORIGIN_UNAVAILABLE`. Configure a Sandbox shop with valid three-level origin codes before running the checkout demo. Supporting a shop with only the newer address model requires a separately agreed address-contract change; the service deliberately does not guess the origin. No live fee success or end-to-end payment is claimed by this check.
