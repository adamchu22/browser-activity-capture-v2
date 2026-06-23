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
  documentationSkill,
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
  assert.match(doc, /no external (tool or )?pipeline|without us|no external help/i);
});

test("Step 0: leads with building the fused spine via the pipeline pointer", () => {
  for (const doc of [bundleClaudeMd(baseManifest), bundleAgentsMd(baseManifest)]) {
    assert.match(doc, /Step 0/, "must have a Step 0 block");
    assert.match(doc, /spine/i, "must frame context.md as the fused spine");
    // the fixed, machine-local pointer path an agent reads to locate the pipeline
    assert.match(doc, /~\/\.config\/browser-activity-capture\/install\.json/);
    assert.match(doc, /pack\.py/, "must give the pack command");
    assert.match(doc, /context\.md/, "must tell the agent to read context.md");
    // and the first-run fallback that records the location for next time
    assert.match(doc, /install_pointer\.py/);
    // adjacent pre-built pack is the cheapest case
    assert.match(doc, /-pack\//);
  }
});

test("Step 0 still degrades to self-driving when no pipeline is available", () => {
  const doc = bundleAgentsMd(baseManifest);
  assert.match(doc, /self-driving/i);
  // an agent with no shell / no pipeline is told it can ignore Step 0
  assert.match(doc, /chat LLM|no shell|ignore Step 0/i);
});

test("README leads with the spine but keeps the self-driving fallback", () => {
  const r = bundleReadme(baseManifest);
  assert.match(r, /spine/i);
  assert.match(r, /~\/\.config\/browser-activity-capture\/install\.json/);
  assert.match(r, /-pack\//, "mentions an adjacent built pack");
  assert.match(r, /self-driving/i);
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

test("documentation skill ships in the zip and teaches screenshots + highlights", () => {
  const s = documentationSkill();
  assert.match(s, /^---\nname: documentation/, "must have skill frontmatter");
  assert.match(s, /description:/);
  assert.match(s, /screenshot/i, "must tell the agent to include screenshots");
  assert.match(s, /frames\//, "must reference the frames as the screenshot source");
  assert.match(s, /annotation:select|highlight/i, "must cover the user's highlights");
  assert.match(s, /ffmpeg.*crop/i, "must give the overlay-crop command");
  assert.match(s, /NOT pixel-redacted/i, "must flag frames aren't redacted (PII)");
});

test("documentation skill: Notion packaging is OPTIONAL, not the default", () => {
  const s = documentationSkill();
  assert.match(s, /Notion/i);
  assert.match(s, /Do NOT\s+build a Notion zip by default/i, "Notion zip must not be the default");
  assert.match(s, /only if the user asks/i);
  // and it documents the single-page import structure (the wrapper-folder gotcha)
  assert.match(s, /root of the zip/i);
  assert.match(s, /exactly one page/i);
  assert.match(s, /wrapper/i);
});

test("docs purpose points the agent at the documentation skill + screenshots", () => {
  const out = renderPurpose(["docs"]);
  assert.match(out, /screenshots/i);
  assert.match(out, /agent-skills\/documentation\/SKILL\.md/);
  // the bundle README lists the shipped skill file
  assert.match(bundleReadme(baseManifest), /agent-skills\/documentation\/SKILL\.md/);
});

test("renderPurpose renders the chosen lens for each known purpose", () => {
  for (const key of Object.keys(PURPOSES)) {
    const out = renderPurpose([key]);
    assert.match(out, new RegExp(PURPOSES[key].label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("no/unknown purpose defaults to notes.md only and asks the user", () => {
  for (const p of [["bogus"], [], undefined]) {
    const out = renderPurpose(p);
    assert.match(out, /notes\.md/);
    assert.match(out, /ask the user/i);
  }
});

test("general capture defaults to notes only + ask (no auto SOP/skill/suggestions)", () => {
  const out = renderPurpose(["general"]);
  assert.match(out, /notes\.md/);
  assert.match(out, /ask the user/i);
  assert.match(out, /do NOT auto-generate/i);
  // The body's What-to-produce section spells out the same rule.
  const doc = agentGuideBody({ ...baseManifest, purposes: ["general"] });
  assert.match(doc, /produce only `notes\.md` by default/i);
  assert.match(doc, /ask the user which other outputs they want/i);
});

test("AUDIO FALLBACK defaults to Parakeet, with Whisper only as a fallback", () => {
  const doc = agentGuideBody(baseManifest);
  assert.match(doc, /Default to Parakeet/);
  assert.match(doc, /parakeet-tdt/i, "gives a runnable Parakeet command");
  assert.match(doc, /fall back to Whisper/i, "Whisper is framed as the fallback, not the default");
  // Parakeet must be recommended before Whisper in the text.
  assert.ok(doc.indexOf("Parakeet") < doc.indexOf("whisper"), "Parakeet should come first");
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
