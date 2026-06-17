# Automation suggestions: order refund workflow

## (a) Safe to fully automate

- **Order lookup** (`GET /api/orders?q=<order_id>`) — read-only, deterministic.
- **Refund submission mechanics** once eligibility is confirmed. The UI steps
  (issue → select full → reason → confirm) collapse to a single authenticated
  call: `POST /api/orders/<order_id>/refund` with
  `{"amount":"full","reason":"<reason>"}`. The four clicks are just a form over
  this one endpoint.

## (b) Keep human-in-the-loop

- **Eligibility decision** — the narrator explicitly checks the 30-day window and
  the eligibility badge before refunding. This is judgment + policy, and a refund
  is **irreversible** (money leaves). A human (or an explicit, auditable rule)
  should gate every refund.
- **Reason quality** — the reason feeds the finance team; free-text written by a
  person carries context an auto-filled string won't.

## (c) Highest-leverage automation

**A guarded one-call refund action.** Wrap `POST /api/orders/<order_id>/refund`
behind a check that (1) pulls the order, (2) verifies it's within 30 days and not
already refunded, and (3) requires a human confirmation + reason. This removes the
4-step UI dance and the login/search navigation while preserving the one decision
that actually matters. Everything before the confirm click is mechanical; the
confirm itself stays gated.
