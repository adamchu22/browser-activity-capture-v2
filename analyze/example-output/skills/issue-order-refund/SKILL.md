---
name: issue-order-refund
description: Issue a full refund on an order in the Acme admin dashboard, starting from an order ID, when a customer received a damaged item or is otherwise eligible within the 30-day window.
---

# Issue an order refund

## Trigger

A customer needs a refund and you have their **order ID**. Eligibility: the order
must be within the 30-day refund window.

## Inputs

- `order_id` (required) — e.g. `ORD-48213`
- `refund_reason` (required) — short free text for the finance team
- `refund_type` — `full` (the observed path; partial may exist `(inferred)`)

## Steps

1. Authenticate at `https://admin.acme.example.com/login`
   (`#email`, `#password`, submit `button[type=submit]`).
   Confirm: `POST /api/auth/login → 200`.
2. Search the order: click `#order-search`, type `order_id`, press `Enter`.
   Confirm: `GET /api/orders?q=<order_id> → 200`.
3. Open `/orders/<order_id>`.
4. **Gate (do not skip):** check the eligibility badge / 30-day window and order
   total. Abort if ineligible.
5. Click `#issue-refund`.
6. Select refund type: `input[name=refund-type][value=full]`.
7. Fill `#refund-reason` with `refund_reason`.
8. Click `#confirm-refund`.

## Direct API path (alternative to steps 5–8)

`POST /api/orders/<order_id>/refund`
body: `{"amount":"full","reason":"<refund_reason>"}`
(requires an authenticated session from step 1).

## Success signal

- `POST /api/orders/<order_id>/refund → 200` with `{"refund_id": "...", "emailed": true}`
- Redirect to `/orders/<order_id>?refunded=1`
- Confirmation email sent to the customer automatically.

## Guardrails

- The eligibility check in step 4 is a human judgment point — keep it.
- Never reconstruct or hardcode credentials; they are redacted in the source
  capture for a reason.
