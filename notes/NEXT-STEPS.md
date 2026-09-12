# browser-activity-capture — v2 status + next steps (2026-09-12)

## Where it's left off
- Branch `astra/v2` (local, from main @ 18514af) — **v2 fully built, UNCOMMITTED, UNPUSHED**
- 168 patches + 4 new files across 27 files (Astra gpt-6-astra SEARCH/REPLACE, hand-fixed where it missed)
- Suites: Node 128/128 pass · Python 279 OK (1 skipped) — all Windows failures fixed
- Fixed flake: autopack age<min_age_s skipped fresh zips on negative mtime skew (gate now only applies when min_age_s>0)
- Pipeline verified end-to-end on sample-bundle: validate PASS → pack → friction w/ new signals (2 dead clicks detected), automation candidates, moments.json, Intent Quotes, BRIEF requires "UI Improvement Hypotheses" every recording
- Redaction rule honored: only keys ON SCREEN masked (content.js synced to redact.js token set + drift test). HAR bodies, visual pixels, ASR transcript, errors.json left unchanged — Astra logged them ===SKIPPED per owner constraint
- notes/ has 5 blind reviews + SYNTHESIS.md (uncommitted); _v2* working files cleanup optional
- New files: analyze/insights.py, extension/src/download.js, tests/test_input_token_sync.mjs, tests/test_v2_analysis.py

## Next steps (in order)
1. Review `git diff main..astra/v2` (especially background.js's 59 edits) → commit → push branch → merge to main
2. Live-capture roundtrip: load extension in real Chrome, record a task incl. a re-share + download; verify chrome.downloads completion path (the critical durability fix)
3. Run pack.py on the real capture; check Intent Quotes/Automation candidates on real narration
4. Then: demonstrate the browser-recording activity tool to CS (Monday docket item) — first skill built yourself as the example
5. Backlog (SYNTHESIS.md P1): HAR pause-time clock fix, HAR key scoping per debugger target, transcribe.py segment offsets

## Monday docket (from Adam's voice note)
- Lead duplication for contacts · round-robin workflow ON for BDRs (Erica) new-company best-contact assignment + backfill · attribution processing redesign · content skill launch · CS assist on cannabis-specific skills (Adam builds first one as demo) · Dropbot internal signup
- HubSpot Redesign = top priority (Discovery Phase 0; interviews w/ team heads, present plan to Deb)
- Badger: August monthly financials
- License conversion (which license TBD) — "quickly"
- B2W2B stays parked (main @ 18dfc18, gates green, poller deploys)

## Model-routing notes
- Working OpenRouter key: config.yaml delegation api_key (tail 06f1); .env OPENROUTER key stale (401 User not found)
- Astra = openai/gpt-6-astra — 739K chars inline OK, ~$3/review, ~$3.7/build, ~340s
- GLM 5.3: mandatory reasoning, upstream crashes ~200s → use z-ai/glm-5 (204K ctx; trim docs/tests from prompt; ~$0.2)
- Hermes delegation children ALWAYS pin to deepseek-v4-flash (config delegation.model) — no per-child model override; for model diversity call OpenRouter directly via python urllib