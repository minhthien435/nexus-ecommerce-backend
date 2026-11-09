# GHN two-level shipping

All endpoints require the existing access token. Location codes are GHN IDs, not national administrative codes. `GET /api/v1/fulfillment/shipping/locations/provinces` and the legacy district/ward routes remain available. The legacy province list excludes Sandbox-only `Hà Nội 02`, including from cached results. Use `GET /api/v1/fulfillment/shipping/locations/v2/provinces` and `GET /api/v1/fulfillment/shipping/locations/v2/wards?provinceId=<id>` for GHN v3 two-level locations.

Create or upgrade a saved address with `addressScheme: "ghn_v3"`, `provinceCode`, `wardCode`, recipient name, phone and street. Province and ward must come from the v3 catalogue; the server stores canonical names and clears the legacy district. Upgrades require both new IDs explicitly. Existing records remain legacy and readable, but cannot be used for checkout or GHN shipment until upgraded. IDs from the two schemes are not interchangeable.

Set `GHN_API_TOKEN`, `GHN_SHOP_ID`, `GHN_FROM_NAME`, `GHN_FROM_PHONE`, `GHN_FROM_ADDRESS`, `GHN_FROM_PROVINCE_NAME` and `GHN_FROM_WARD_NAME` to the actual pickup warehouse details. No origin is inferred from an incomplete shop. Missing configuration and GHN failures fail closed. Never commit credentials. Requests have a five-second timeout.

`POST /api/v1/commerce/orders/shipping-quote` accepts `{ "addressId": "<uuid>", "selectedCartItemIds": ["<uuid>"] }` and returns `data: { currency: "VND", totalFee, sellers: [{ sellerId, weightGrams, fee }] }`. Weight and seller are read from the server catalogue. Repeat the quote if the cart changes. Checkout accepts the same selected IDs and saved address ID and obtains fresh previews; the amount can change when GHN changes its quote. Each order stores its fee, and PayOS uses stored order totals. GHN preview does not create a shipment.

The seller shipment action uses the stored address snapshot and an order-specific client order code. Existing legacy order snapshots remain readable but cannot create a GHN shipment. No simulated tracking code is returned if GHN fails. A GHN response or a database failure after sending a create request may require reconciliation with GHN before retrying.

Parcels weighing 20 kg or more require GHN heavy-service item details and are currently rejected before preview or shipment creation. Product names are required to describe the parcel contents.
