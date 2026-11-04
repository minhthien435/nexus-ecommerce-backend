# Seller fulfillment demo

Apply migration `1793757600000-AddOrderShipmentTracking` to the intended demo database before starting the updated application (`npm run migration:run` with the correct database configuration). It adds nullable `tracking_code` and `carrier_name` columns; existing orders retain null values. Reverting this migration drops the tracking data. The migration has not been run automatically.

Use the authenticated seller's own paid order:

1. `PATCH /api/v1/commerce/seller/orders/:id/confirm` with optional `{ "note": "Preparing parcel" }` changes `PAID` to `PROCESSING`.
2. `PATCH /api/v1/commerce/seller/orders/:id/ship` with `{ "carrierName": "Viettel Post", "trackingCode": "DEMO-123", "note": "Handed to carrier" }` changes `PROCESSING` to `SHIPPED` and saves both fields atomically with status/history.
3. Reload `GET /api/v1/commerce/seller/orders/:id` as the seller and `GET /api/v1/commerce/orders/:id` as the buyer. Both details return `carrierName` and `trackingCode` from storage.

This is a manual carrier/tracking flow; it does not create a shipment with GHN or another live carrier. Both strings are trimmed, required, nonblank and limited to 100 characters. The optional note is limited to 500 characters. Invalid payloads return 400 without mutation; invalid transitions (including repeated shipping) return 409. Requests for another shop's order intentionally return 404 to avoid revealing its existence.
