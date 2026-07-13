# create-membership-order — Supabase Edge Function

Phase 5B | Studyria Premium Membership

## What this does

Creates a Razorpay order for a membership plan purchase. Called by the
client-side `StudyriaPaymentOrderService.createOrder(planSlug)`.

## Security model

| Threat                    | Mitigation                                                    |
|---------------------------|---------------------------------------------------------------|
| Price manipulation        | Price fetched from `membership_plans` DB — client value ignored |
| Unauthenticated access    | JWT verified via `supabaseClient.auth.getUser()`             |
| Duplicate orders          | Idempotency key (SHA-256 of userId + plan + 15-min window)   |
| Replay attacks            | `idempotency_key` UNIQUE index in DB + expiry check          |
| Secret exposure           | `RAZORPAY_KEY_SECRET` read from env, never sent to client    |
| Membership auto-activation| Explicitly NOT done here — only `status = 'created'` stored  |
| SQL injection             | Supabase client uses parameterised queries                    |
| CORS                      | Origin allowlist enforced                                     |

## Environment variables

Set these in Supabase → Project Settings → Edge Functions → Secrets:

```
RAZORPAY_KEY_ID        rzp_live_xxx  (or rzp_test_xxx)
RAZORPAY_KEY_SECRET    <never expose>
SUPABASE_URL           https://xxx.supabase.co   (auto-injected)
SUPABASE_ANON_KEY      <public anon key>          (auto-injected)
SUPABASE_SERVICE_ROLE_KEY  <service role>         (auto-injected)
```

## Deploy

```bash
supabase functions deploy create-membership-order --no-verify-jwt
# Note: JWT verification is done manually inside the function
# so we can return proper 401s instead of Supabase's default 403.
```

## Request

```
POST /functions/v1/create-membership-order
Authorization: Bearer <user-jwt>
Content-Type: application/json
Idempotency-Key: <64-char hex>   (optional — generated server-side if absent)

{
  "planSlug": "monthly"
}
```

## Response 201

```json
{
  "order": {
    "razorpayOrderId": "order_xxx",
    "amountPaise":     9900,
    "currency":        "INR",
    "planSlug":        "monthly",
    "planName":        "Monthly Premium",
    "receiptId":       "rzp_monthly_...",
    "idempotencyKey":  "<64-char hex>",
    "expiresAt":       "2026-07-13T14:16:00Z",
    "keyId":           "rzp_live_xxx",
    "prefill": { "name": "...", "email": "..." }
  },
  "idempotent": false
}
```

## Response 200 (idempotent replay)

Same shape as 201, but `"idempotent": true`.

## What Phase 5C will add

- `verify-payment-signature` Edge Function
- HMAC verification of `razorpay_signature`
- Update order status to `paid`
- Trigger membership activation (not done in Phase 5B)
