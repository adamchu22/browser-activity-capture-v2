# Notes: order refund capture

A 23.5-second screen capture of an admin issuing a full refund for a damaged item:
log in → search by order ID → open the order → verify 30-day eligibility → issue a
full refund with a reason → confirm. The workflow maps cleanly onto three API
calls (`auth/login`, `orders?q=`, `orders/<id>/refund`) and ends with an automatic
customer confirmation email.

## Open questions

- **Partial refunds:** the refund type is a radio with a `full` value, implying
  other options. Their flow, fields, and amount validation weren't captured.
- **Eligibility enforcement:** is the 30-day window enforced server-side, or only
  shown as a UI badge? Determines whether the API path can be trusted to reject
  ineligible refunds.
- **Idempotency / double-refund:** nothing in the capture shows what happens if
  `confirm-refund` is clicked twice or the order is already refunded.
- **Permissions:** what role is required? The capture shows one already-privileged
  user; it doesn't reveal the authorization boundary.
- **Off-screen:** the confirmation email content and any finance-side effects
  happen outside the browser and weren't observed.
