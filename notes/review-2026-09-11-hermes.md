# Independent Review — browser-activity-capture (Hermes pass #1, 2026-09-11)

Reviewer: Hermes (glm-5.3-flash via delegate subagent, deepseek-v4-flash:0731-cloud child)
Mode: deep code review, 6 core files + 5 supporting modules. NOT built — note only.

## Headline
BRIEF.md only asks for improvement signals when a purpose is declared (`ux`/`ui`/`improve`).
General-purpose recordings (the default) get NO improvement-signal extraction at all.
Quote: the only improvement-related ask is item 6 (BRIEF lines 75-78): "`improvements.md`
(better/faster purpose) — concrete ways to do the task in less time or fewer steps,
ranked by estimated time saved…" — gated entirely behind the 'improve' purpose.
BRIEF never mentions "improvement signal", "complaint", "desire", "confusion", "intent quote".

## Bugs (5)
1. MEDIUM analyze/validate_bundle.py:200 — check_coverage passes `manifest.get('frames')`
   instead of the canonical frame list from health.py's canonical_frames(). Manifest can
   under-index frames after a worker restart → coverage-gap warning misses real visual gaps.
2. MEDIUM analyze/friction.py:22 — friction detector misses: dead clicks (click with no
   network/nav within 3s), nav bounce-backs (X→Y→X within 15s), rapid input churn
   (type→clear→type on same field within 5s). Detects only long pauses, repeat clicks,
   retried actions, error labels/4xx.
3. MINOR extension/src/background.js:1549 — buildManifest() sets duration_ms from the last
   timeline event time, not recordingElapsed(now). Idle tail before Stop is under-reported.
4. MINOR extension/src/content.js:736 — applyReshare() called twice consecutively in
   update() (copy-paste; wastes a DOM toggle per state broadcast).
5. LOW analyze/pack.py:49 — events.jsonl (rrweb) excluded from pack by design → no DOM
   state (error toasts, validation text, overlay text invisible to analysis).

## AI-consumption improvements (ranked)
1. HIGH Intent Quotes — extract desire/complaint/confusion from VTT cues
   ("I wish this…", "why does it always…", "wait, where is…") → context.md section.
   Highest-leverage: richest improvement signal is unguarded user talk.
2. HIGH Friction classification — add dead clicks, bounce-backs, input churn to
   compute_friction(); data already in timeline.json; ~40% of real friction signals.
3. HIGH Moments view — per-segment record binding frame + speech + action in one record;
   joins already computed in render_steps + nearest_frame, just serialize.
4. MED Unconditional UI Improvement Hypotheses — purpose-agnostic 3-5 item section in
   every pack; most recordings are 'general' and lose all improvement signals today.
5. MED Automation-candidate detection — precompute repeated API call patterns (same
   endpoint, changing values), repeated click sequences, CRUD shapes, confidence scores.
6. MED todos.py sub-categories — "how-to" (UI discoverability failure) and
   "self-instruction" (best SOP source material) narration classes.
7. LOW duration accuracy fix (feeds friction/pause windows).
8. LOW --include-dom flag to optionally copy events.jsonl into the pack.

## Invariants
One-master-clock and redaction invariants: NOT broken by anything found.

## Proposed build order (NOT APPROVED — Adam said don't build yet)
Phase 1 (analyze/ only): intent quotes + friction classification + moments +
unconditional improvement section. Phase 2: automation candidates + duration fix + DOM flag.

---
## Sibling reviews (blind, same brief — to be appended)

### Review A (pending)
### Review B (pending)