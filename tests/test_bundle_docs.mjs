// Tests for the self-driving docs embedded in every Capture Bundle
// (extension/src/bundle-docs.js). Run: node --test tests/test_bundle_docs.mjs
//
// P0 contract (2026-06-17): a bundle handed to any agent must work WITHOUT us — so
// every export carries CLAUDE.md + AGENTS.md, and those must tell a recipient how to
// recover narration from video.webm when transcript.vtt is a stub. These lock that.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bundleReadme, bundleClaudeMd, bundleAgentsMd, agentGuideBody, renderPurpose, PURPOSES,
} from "../extension/src/bundle-docs.js";

const baseManifest = {
  capture_id: "capture-2026-06-17T14-36-28-587Z",
  task: "Issue a refund for a damaged order",
  purposes: ["general"],
  video: "video.webm",
  narration_in_video: true,
  narration_error: null,
};

test("CLAUDE.md and AGENTS.md are both produced and non-trivial", () => {
  const c = bundleClaudeMd(baseManifest);
  const a = bundleAgentsMd(baseManifest);
  assert.match(c, /^# Analyze this Capture Bundle \(for Claude\)/);
  assert.match(a, /^# AGENTS\.md/);
  assert.ok(c.length > 1500 && a.length > 1500, "both should carry the full guide");
});

test("both files share the same body so they never drift", () => {
  const body = agentGuideBody(baseManifest);
  assert.ok(bundleClaudeMd(baseManifest).includes(body));
  assert.ok(bundleAgentsMd(baseManifest).includes(body));
});

test("AUDIO FALLBACK: both files tell the agent narration is in video.webm + how to transcribe", () => {
  for (const doc of [bundleClaudeMd(baseManifest), bundleAgentsMd(baseManifest)]) {
    assert.match(doc, /video\.webm/, "must name video.webm as the audio source");
    assert.match(doc, /Opus audio track/i, "must explain the audio is an Opus track");
    assert.match(doc, /ffmpeg -i video\.webm/, "must give the extraction command");
    assert.match(doc, /transcrib/i, "must tell the agent to transcribe it");
    assert.match(doc, /stub/i, "must explain the stub-transcript case");
  }
});

test("self-driving: states the bundle needs no external tool/pipeline", () => {
  const doc = bundleAgentsMd(baseManifest);
  assert.match(doc, /self-driving/i);
  assert.match(doc, /no external tool or pipeline|without us|no external help/i);
});

test("redaction rule is restated so the agent never bypasses it", () => {
  for (const doc of [bundleClaudeMd(baseManifest), bundleAgentsMd(baseManifest)]) {
    assert.match(doc, /‹redacted›/);
    assert.match(doc, /never.*(invent|bypass)/i);
  }
});

test("the one-clock contract is stated", () => {
  assert.match(agentGuideBody(baseManifest), /milliseconds since t0/i);
});

test("renderPurpose renders the chosen lens for each known purpose", () => {
  for (const key of Object.keys(PURPOSES)) {
    const out = renderPurpose([key]);
    assert.match(out, new RegExp(PURPOSES[key].label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("renderPurpose ignores unknown keys and falls back to the full set", () => {
  assert.match(renderPurpose(["bogus"]), /full set/i);
  assert.match(renderPurpose([]), /full set/i);
  assert.match(renderPurpose(undefined), /full set/i);
});

test("the stated task is surfaced in the guide", () => {
  assert.match(agentGuideBody(baseManifest), /Issue a refund for a damaged order/);
});

test("a missing task degrades gracefully (infer it)", () => {
  const m = { ...baseManifest, task: null };
  assert.match(agentGuideBody(m), /none stated — infer it/);
});

test("narration_error surfaces when no narration was captured", () => {
  const m = { ...baseManifest, narration_in_video: false, narration_error: "mic permission denied" };
  assert.match(agentGuideBody(m), /no microphone narration was captured/);
  assert.match(agentGuideBody(m), /mic permission denied/);
});

test("bundleReadme points at CLAUDE.md/AGENTS.md, not pack.py as the only path", () => {
  const r = bundleReadme(baseManifest);
  assert.match(r, /CLAUDE\.md/);
  assert.match(r, /AGENTS\.md/);
  assert.match(r, /self-driving/i);
  // pack.py may be mentioned as optional, but must not be framed as required.
  assert.doesNotMatch(r, /Hand it to \.\.\/analyze\/pack\.py to produce/);
});

test("bundleReadme notes video.webm presence/narration correctly", () => {
  assert.match(bundleReadme(baseManifest), /video\.webm — screen recording \(includes microphone narration/);
  const noVid = bundleReadme({ ...baseManifest, video: null });
  assert.doesNotMatch(noVid, /video\.webm — screen recording/);
});
