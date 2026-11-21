# BE-FD-04 checkout contract

`POST /api/v1/commerce/orders/checkout` accepts optional Flash Deal expectations:

```json
{
  "selectedCartItemIds": ["<cart-item-uuid>"],
  "addressId": "<address-uuid>",
  "paymentMethod": "PAYOS",
  "useCoins": 18000,
  "expectedFlashDeals": [
    {
      "cartItemId": "<cart-item-uuid>",
      "flashDealItemId": "<flash-deal-item-uuid>",
      "expectedUnitPrice": "60000.00"
    }
  ]
}
```

- `expectedUnitPrice` is a decimal string in VND per unit. It detects a stale client price; the server remains authoritative.
- `cartItemId` links the expectation to an item in `selectedCartItemIds` (or the selected cart when that field is omitted).
- If an expectation is present, its deal identity and price must still match the server. The backend never silently falls back to another deal or the regular price.
- Without an expectation, exactly one ACTIVE deal in its current time window is selected automatically. Two or more such rows for the SKU return ambiguity, including when one has exhausted quota.
- Cart responses expose `flashDeal.itemId`, `flashPrice`, `regularPrice`, `remainingQuota`, `maxPerBuyer`, and `endsAt`, plus `warningCode`/`warning` when unavailable.
- Coin remains allowed with Flash Deal. The 30% cap uses the subtotal after Flash pricing, and PayOS keeps its 10,000 VND minimum payable amount.

All checkout Flash Deal errors currently use HTTP 409:

| errorCode | Meaning |
| --- | --- |
| `FLASH_DEAL_SOLD_OUT` | The selected deal has insufficient quota. |
| `FLASH_DEAL_LIMIT_EXCEEDED` | The purchase would exceed `maxPerBuyer`. |
| `FLASH_DEAL_ENDED` | The explicitly selected deal or campaign has ended. |
| `FLASH_DEAL_PRICE_CHANGED` | `expectedUnitPrice` differs from the authoritative Flash price. |
| `FLASH_DEAL_IDENTITY_MISMATCH` | Cart item, SKU, product, seller, or deal identity does not match. |
| `FLASH_DEAL_AMBIGUOUS` | At least two ACTIVE, currently running deals exist for the SKU. |
| `FLASH_DEAL_UPCOMING` | The explicitly selected deal has not started. |
| `FLASH_DEAL_PAUSED` | The explicitly selected deal is paused. |
| `FLASH_DEAL_EXPECTATION_DUPLICATE` | More than one expectation targets the same cart item. |
