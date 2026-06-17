# SOP: Issue a full refund for a damaged item

Derived from capture `capture-2026-06-04-1430` (refund workflow, 23.5s). This is a
human-reviewed starting point, not an auto-published procedure.

## Preconditions

- You have admin access to the Acme admin dashboard (`admin.acme.example.com`).
- You have the customer's **order ID** (e.g. `ORD-48213`). The narrator is
  explicit: "We always start from the order, never the customer record."
- The order is **within the 30-day refund window** — refunds are only allowed
  within 30 days (stated by narrator; enforced by an "eligibility badge" on the
  order page).

## Procedure

1. Go to `https://admin.acme.example.com/login` and sign in (`#email`,
   `#password`, then **Sign in** / `button[type=submit]`). A successful login is
   `POST /api/auth/login → 200`.
2. From the dashboard, click **Search orders** (`#order-search`), type the order
   ID, and press **Enter**. This issues `GET /api/orders?q=<ORDER_ID> → 200`.
3. Open the matching order (`/orders/<ORDER_ID>`).
4. **Verify eligibility (decision point):** confirm the order total and check the
   eligibility badge. Do not proceed if the order is outside the 30-day window.
5. Click **Issue refund** (`#issue-refund`).
6. Select **Full refund** (`input[name=refund-type][value=full]`).
7. Enter a **reason** in `#refund-reason` (e.g. "Customer received damaged item")
   so the finance team has context.
8. Click **Confirm refund** (`#confirm-refund`). This issues
   `POST /api/orders/<ORDER_ID>/refund` with body
   `{"amount":"full","reason":"<reason>"}`.

## Success signal

- `POST /api/orders/<ORDER_ID>/refund → 200`, response
  `{"refund_id": "...", "emailed": true}`.
- Page redirects to `/orders/<ORDER_ID>?refunded=1`.
- The customer **receives an email confirmation automatically** — no separate
  step required (stated by narrator).

## Notes

- Partial refunds appear possible (the refund type is a radio with a `full`
  value, implying other values exist) but were not exercised in this capture
  `(inferred)`.
