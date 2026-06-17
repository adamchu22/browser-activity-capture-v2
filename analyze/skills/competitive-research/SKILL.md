---
name: competitive-research
description: Turn a capture of someone using ANOTHER product into a competitive teardown — how the tool works, the patterns it does well, and reusable lessons for building your own version. Use when the capture's purpose is research / competitive research / learning how a tool works.
---

# Competitive research from a capture

This capture is someone using a product to learn from it — usually a competitor or a
tool worth understanding. A recording is a uniquely complete black-box teardown: the
**frames** show the design, the **steps + narration** show the flow and what the user
found notable, and the **network (HAR)** shows how it actually works underneath. Your
job is to extract what they do well and turn it into reusable lessons — patterns and
principles, never copied assets.

## What to extract (each grounded in the capture)

1. **Product & flow.** What tool is this, what task was performed, and the flow
   end-to-end (use the Steps). Note where it starts, the key decision points, and the
   success state.
2. **UX patterns.** Notable interactions worth learning from — layout, defaults,
   progressive disclosure, empty/loading/error states, microcopy, onboarding, shortcuts.
   Cite the frame for each. Say *why* it works (the friction it avoids, the heuristic it
   honors), not just that it exists.
3. **Under the hood (from the network).** The HAR is the highest-signal part. Pull out:
   - API endpoints and request/response shapes — what they reveal about the **data
     model** and core entities.
   - Third-party services (auth, payments, search, maps, analytics, feature flags,
     CDNs) — their **build-vs-buy** choices.
   - Patterns: REST vs. GraphQL, polling vs. websockets, pagination, caching, what's
     prefetched. Cite the requests.
4. **What they do well — and why.** The 3–7 things most worth learning. Tie each to an
   outcome (speed, clarity, trust, retention).
5. **Gaps / opportunities.** Friction or weaknesses you observed (reuse the friction
   lens: hesitation, dead-ends, slow steps, clunky flows). These are where a new
   version could differentiate.

## Output — write `research.md`

Sections: **Product & flow** · **UX patterns to learn from** (with frame refs) ·
**Architecture & data model (from the network)** (with endpoint cites) · **What they do
well** · **Gaps / opportunities to differentiate** · **For your version** — a concrete
takeaways list: the principles and requirements to adopt, and where you'd deliberately
do it differently.

## Ground rules — learn, don't lift

- Extract **patterns, principles, and ideas** — not their copy, branding, visual
  assets, proprietary data, or content. Describe *what* works and *why*; re-express it
  in your own product's terms.
- Don't reproduce proprietary text/code verbatim, scrape their data, or suggest
  bypassing their terms of service or auth. Respect IP.
- Ground every claim in the capture (frame / step / request). Mark guesses about their
  internals `(inferred)` — a HAR shows behavior, not their source.
