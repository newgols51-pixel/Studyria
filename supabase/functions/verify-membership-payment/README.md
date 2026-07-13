# verify-membership-payment — Phase 5C v2

Supabase Edge Function that verifies a Razorpay payment and activates a Premium Membership.

## What changed in v2

**v1** required the `membership_payment_orders` table (Phase 5B architecture).  
**v2** removes this dependency and reuses the existing payment flow pattern (same as PDF purchases).

## Flow

1. Client opens Razorpay checkout modal (no server-side order creation needed)
2. On payment success, client POSTs to this function:
   ```json
   {
     "razorpayOrderId":   "order_xxx",
     "razorpayPaymentId": "pay_xxx",
     "razorpaySignature": "<64-char hex>",
     "planSlug":          "monthly"
   }
   ```
3. Function:
   - Verifies JWT (user identity)
   - Validates plan slug → fetches plan from `membership_plans`
   - Checks `membership_transactions` for duplicate `payment_reference` (replay protection)
   - Verifies HMAC-SHA256 signature (server-side, timing-safe)
   - INSERTs into `user_memberships` (activates membership)
   - INSERTs into `membership_transactions` (audit trail)
   - INSERTs into `membership_logs` (lifecycle log)
   - Writes to `payment_audit_log` (security audit)

## Security guarantees

- JWT verified server-side — user identity cannot be forged
- HMAC-SHA256 signature verified server-side — payment cannot be faked
- `RAZORPAY_KEY_SECRET` never sent to client
- `payment_reference` UNIQUE in `membership_transactions` → no double-activation
- Plan and price fetched from DB — client-sent amount is completely ignored
- Timing-safe HMAC comparison
- Audit log on every path (success and failure)

## Tables used

| Table | Operation |
|---|---|
| `membership_plans` | SELECT (plan validation) |
| `membership_transactions` | SELECT (replay check), INSERT (record) |
| `user_memberships` | SELECT (dup check), INSERT (activate) |
| `membership_logs` | INSERT (lifecycle) |
| `payment_audit_log` | INSERT (security audit) |

## Tables NOT used

- `membership_payment_orders` — **removed in v2**

## Required env vars

```
RAZORPAY_KEY_SECRET        # Private Razorpay key (never sent to client)
SUPABASE_URL               # Auto-injected by Supabase
SUPABASE_SERVICE_ROLE_KEY  # Auto-injected by Supabase
SUPABASE_ANON_KEY          # Auto-injected by Supabase
```

## SQL migration required

Run `sql/phase-5c-v2/01_migrate_to_v2.sql` before deploying this function.