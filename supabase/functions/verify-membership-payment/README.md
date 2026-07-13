# verify-membership-payment — Supabase Edge Function

Phase 5C | Studyria Premium Membership

## What this does

Verifies a Razorpay payment using HMAC-SHA256 signature validation and, only
after a confirmed valid signature, activates the user's Premium Membership.

## Security model

| Threat                           | Mitigation                                                         |
|----------------------------------|--------------------------------------------------------------------|
| Forged user identity             | JWT verified via `supabaseClient.auth.getUser()` (Step 1)         |
| Signature forgery / tampering    | HMAC-SHA256 timing-safe comparison with RAZORPAY_KEY_SECRET        |
| Replay attacks                   | `razorpay_payment_id` UNIQUE index — any reuse is rejected (Step 4)|
| Order ownership theft            | `order.user_id !== userId` check — returns 404 (no info leak)     |
| Double activation                | `payment_order_id` UNIQUE index on `user_memberships`             |
| Stale / expired order replay     | `expires_at` check — rejects orders older than 15 min (Step 3c)  |
| Client-supplied price            | Amount fetched from `membership_plans` DB — never from request    |
| Secret exposure                  | `RAZORPAY_KEY_SECRET` read from `Deno.env` — never sent to client |
| Timing attacks on signature check| Constant-time byte comparison (bitwise OR accumulator)            |
| SQL injection                    | Supabase client uses parameterised queries                        |
| Membership activation w/o payment| Only activates after Steps 1–5 all pass                          |
| CORS abuse                       | Origin allowlist enforced on every response                       |

## Flow

```
Client sends: razorpayOrderId + razorpayPaymentId + razorpaySignature + Bearer JWT
                                    │
             ┌──────────────────────▼──────────────────────┐
             │  Step 1: Verify JWT → get userId            │
             │  Step 2: Validate input formats             │
             │  Step 3: Load order from DB + ownership +   │
             │          status + expiry checks             │
             │  Step 4: Replay detection                   │
             │  Step 5: HMAC-SHA256 signature verification │
             │  Step 6: Mark order 'paid'                  │
             │  Step 7: Resolve plan from DB               │
             │  Step 8: INSERT user_memberships (active)   │
             │  Step 9: INSERT membership_transactions     │
             │  Step 10: INSERT membership_logs            │
             │  Step 11: Write audit log + return 200      │
             └─────────────────────────────────────────────┘
```

## Environment variables

```
RAZORPAY_KEY_SECRET          Private key (NEVER send to client)
SUPABASE_URL                 Auto-injected by Supabase
SUPABASE_ANON_KEY            Auto-injected by Supabase
SUPABASE_SERVICE_ROLE_KEY    Auto-injected by Supabase
```

## Deploy

```bash
supabase functions deploy verify-membership-payment --no-verify-jwt
# JWT verification is done manually inside the function for proper 401 responses.
```

## Request

```
POST /functions/v1/verify-membership-payment
Authorization: Bearer <user-jwt>
Content-Type: application/json

{
  "razorpayOrderId":   "order_xxx",
  "razorpayPaymentId": "pay_xxx",
  "razorpaySignature": "<64-char hex>"
}
```

## Success response (200)

```json
{
  "success":      true,
  "membershipId": "uuid",
  "planSlug":     "monthly",
  "planName":     "Monthly",
  "expiresAt":    "2026-08-13T…",
  "durationDays": 30,
  "message":      "Your Monthly membership is now active!"
}
```

## Error responses

| HTTP | Code                   | Meaning                                        |
|------|------------------------|------------------------------------------------|
| 401  | UNAUTHENTICATED        | JWT missing / invalid                         |
| 400  | INVALID_ORDER_ID       | razorpayOrderId format wrong                  |
| 400  | INVALID_PAYMENT_ID     | razorpayPaymentId format wrong                |
| 400  | INVALID_SIGNATURE      | razorpaySignature format wrong                |
| 400  | SIGNATURE_MISMATCH     | HMAC-SHA256 verification failed               |
| 404  | ORDER_NOT_FOUND        | Order not found or wrong user                 |
| 409  | DUPLICATE_PAYMENT      | payment_id already used (replay blocked)      |
| 409  | INVALID_ORDER_STATUS   | Order is not in created/attempted state       |
| 410  | ORDER_EXPIRED          | Order is older than 15 minutes                |
| 500  | ACTIVATION_FAILED      | Signature OK but DB write failed              |
| 503  | CONFIG_ERROR           | Missing env secrets                           |

## Tables written

- `membership_payment_orders` — status→'paid', razorpay_payment_id saved
- `user_memberships`          — new 'active' row inserted
- `membership_transactions`   — immutable payment record
- `membership_logs`           — lifecycle event 'activated'
- `payment_audit_log`         — security audit events throughout
