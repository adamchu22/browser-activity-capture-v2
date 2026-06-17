// Content script: runs in the page, owns in-page capture.
//
//  - rrweb records the full DOM mutation stream (raw, → events.jsonl)
//  - DOM listeners produce the high-level timeline events (click/input/key/nav)
//  - password/secret fields are masked HERE, before the value ever leaves the page
//
// Timestamps are page-local (performance-based) but every event is stamped by
// the background worker on arrival against the one master clock (t0), so all
// modalities share a single timeline. See docs/02-design.md ("one clock").
//
// NOTE: content scripts are classic scripts, so the small redaction helpers
// below mirror src/redact.js (the canonical version used by the worker). Keep
// them in sync.

(() => {
  // The manifest injects this script on every page load AND the worker may
  // inject it on demand (for a tab opened before the extension loaded). Guard
  // against a second copy attaching a duplicate set of listeners — that's what
  // made every click/hover/nav fire twice. Same isolated world per tab, so this
  // window flag is shared across both injection paths.
  if (window.__bacContentLoaded) return;
  window.__bacContentLoaded = true;

  const SECRET_KEY_RE = /pass(word)?|secret|token|api[-_]?key|auth|ssn|card|cvv/i;
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  // Mirrors redact.js TOKEN_VALUE_RE — redact a JWT/bearer by value shape even
  // when it sits in a field whose name looks innocent.
  const TOKEN_VALUE_RE = /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]+)?|Bearer\s+[A-Za-z0-9._-]{12,}/g;
  const DWELL_MS = 500; // cursor must rest this long on an element to log a hover

  let recording = false;
  let rrwebStop = null;

  // Surface in-page failures into the bundle's errors.json (only while recording,
  // so we don't spam the worker with unrelated page errors).
  function reportError(message, stack) {
    if (!recording) return;
    try {
      chrome.runtime.sendMessage({ type: "capture-error", where: "content", message, stack: stack || null });
    } catch {}
  }
  window.addEventListener("error", (e) => reportError(e.message, e.error?.stack));
  window.addEventListener("unhandledrejection", (e) =>
    reportError(e.reason?.message || String(e.reason), e.reason?.stack)
  );

  function isSecretInput(el) {
    if (!el) return false;
    if (el.type === "password") return true;
    const hay = `${el.name || ""} ${el.id || ""} ${el.autocomplete || ""}`;
    return SECRET_KEY_RE.test(hay);
  }

  function maskValue(fieldName, value) {
    if (value == null || value === "") return value;
    if (SECRET_KEY_RE.test(String(fieldName))) return "‹redacted:secret›";
    if (/email/i.test(String(fieldName)) || EMAIL_RE.test(String(value)))
      return "‹redacted:email›";
    return String(value).replace(TOKEN_VALUE_RE, "‹redacted:secret›");
  }

  // --- unique selector (finder-style) -------------------------------------
  //
  // The old impl returned id / name / tag only, so real pages logged useless
  // "div", "svg", "span" selectors you can't replay. This builds the SHORTEST
  // selector that resolves to exactly one element: a unique id or test-id wins
  // outright; otherwise we climb the tree adding one token per level (preferring
  // id / test-id / name, falling back to :nth-of-type) until the path matches a
  // single node. Verified against the live DOM with querySelectorAll, so a
  // returned selector is guaranteed unique at capture time.

  const ID_OK_RE = /^[A-Za-z][\w-]*$/; // skip ids needing escapes / starting odd
  const TESTID_ATTRS = ["data-testid", "data-test-id", "data-test", "data-cy", "data-qa", "data-automation-id"];
  const MAX_DEPTH = 8; // cap the climb so deep DOMs stay cheap on every hover

  function cssEsc(s) {
    return window.CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, "\\$&");
  }

  function isUnique(sel) {
    try {
      return document.querySelectorAll(sel).length === 1;
    } catch {
      return false; // malformed selector (exotic tag/attr) — treat as non-unique
    }
  }

  function attrToken(el) {
    for (const a of TESTID_ATTRS) {
      const v = el.getAttribute?.(a);
      if (v) return `[${a}="${cssEsc(v)}"]`;
    }
    return null;
  }

  function nthOfType(el) {
    const tag = (el.tagName || "*").toLowerCase();
    let i = 1;
    for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (sib.tagName === el.tagName) i++;
    }
    return `${tag}:nth-of-type(${i})`;
  }

  // One level's most specific available token.
  function levelToken(el) {
    if (el.id && ID_OK_RE.test(el.id)) return `#${cssEsc(el.id)}`;
    const tag = (el.tagName || "*").toLowerCase();
    const attr = attrToken(el);
    if (attr) return tag + attr;
    if (el.name) return `${tag}[name="${cssEsc(el.name)}"]`;
    return nthOfType(el);
  }

  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return el && el.tagName ? el.tagName.toLowerCase() : "?";
    if (el === document.body) return "body";

    // A unique id or test-id is the whole answer.
    if (el.id && ID_OK_RE.test(el.id)) {
      const s = `#${cssEsc(el.id)}`;
      if (isUnique(s)) return s;
    }
    const attr = attrToken(el);
    if (attr && isUnique(`${(el.tagName || "*").toLowerCase()}${attr}`)) {
      return `${el.tagName.toLowerCase()}${attr}`;
    }

    // Climb, prepending one token per level until the path is unique.
    const parts = [];
    let cur = el;
    for (let depth = 0; cur && cur.nodeType === 1 && cur !== document.body && depth < MAX_DEPTH; depth++) {
      parts.unshift(levelToken(cur));
      const candidate = parts.join(" > ");
      if (isUnique(candidate)) return candidate;
      cur = cur.parentElement;
    }
    // Anchor at body if we ran out of climb without a unique match.
    const anchored = "body > " + parts.join(" > ");
    if (isUnique(anchored)) return anchored;
    return parts.join(" > ") || (el.tagName ? el.tagName.toLowerCase() : "?");
  }

  function labelFor(el) {
    return (
      el.getAttribute?.("aria-label") ||
      el.textContent?.trim().slice(0, 40) ||
      el.getAttribute?.("placeholder") ||
      el.name ||
      ""
    );
  }

  // --- semantic context (what the element IS, for intent) -------------------
  //
  // A selector is for replay; this is for understanding. We capture the
  // accessible name, ARIA role, the section/landmark the element sits in, and
  // input/link/select specifics — so the analyst reads "click the 'Issue refund'
  // button in 'Order actions'" instead of "click div:nth-of-type(3)". Never reads
  // el.value, so it can't leak a typed secret.

  function accessibleName(el) {
    if (!el) return "";
    const aria = el.getAttribute?.("aria-label");
    if (aria) return aria.trim().slice(0, 80);
    const labelledby = el.getAttribute?.("aria-labelledby");
    if (labelledby) {
      const txt = labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean)
        .join(" ");
      if (txt) return txt.slice(0, 80);
    }
    if (el.id) {
      const lab = document.querySelector(`label[for="${cssEsc(el.id)}"]`);
      if (lab?.textContent?.trim()) return lab.textContent.trim().slice(0, 80);
    }
    const closestLabel = el.closest?.("label");
    if (closestLabel?.textContent?.trim()) return closestLabel.textContent.trim().slice(0, 80);
    // textContent is a good name for buttons/links, but for a <select> it's just the
    // concatenated <option> text — skip it (the chosen option is in `selected`).
    if ((el.tagName || "").toLowerCase() !== "select") {
      const text = el.textContent?.trim();
      if (text) return text.slice(0, 80);
    }
    return (el.getAttribute?.("placeholder") || el.getAttribute?.("title") || el.getAttribute?.("alt") || "").slice(0, 80);
  }

  function roleOf(el) {
    const explicit = el.getAttribute?.("role");
    if (explicit) return explicit;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "input") {
      const t = (el.getAttribute?.("type") || "text").toLowerCase();
      return { checkbox: "checkbox", radio: "radio", submit: "button", button: "button", range: "slider" }[t] || "textbox";
    }
    const map = {
      a: el.getAttribute?.("href") ? "link" : "",
      button: "button", select: "combobox", textarea: "textbox",
      h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading",
      nav: "navigation", main: "main",
    };
    return map[tag] || "";
  }

  // The section the element lives in: a labelled enclosing landmark, else the
  // nearest heading that precedes it in document order.
  function sectionFor(el) {
    const landmark = el.closest?.("[role], main, nav, header, footer, aside, section, form, dialog");
    if (landmark) {
      let label = landmark.getAttribute?.("aria-label") || "";
      if (!label) {
        const lid = landmark.getAttribute?.("aria-labelledby");
        if (lid) label = document.getElementById(lid)?.textContent?.trim() || "";
      }
      if (label) return label.slice(0, 80);
    }
    let node = el;
    for (let depth = 0; node && depth < 12; depth++) {
      for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
        const h = sib.matches?.("h1,h2,h3,h4,h5,h6") ? sib : sib.querySelector?.("h1,h2,h3,h4,h5,h6");
        if (h?.textContent?.trim()) return h.textContent.trim().slice(0, 80);
      }
      node = node.parentElement;
    }
    return "";
  }

  function describe(el) {
    if (!el || el.nodeType !== 1) return {};
    const tag = (el.tagName || "").toLowerCase();
    const d = { tag };
    const role = roleOf(el);
    if (role) d.role = role;
    const name = accessibleName(el);
    if (name) d.name = name;
    if (tag === "input" || tag === "textarea" || tag === "select") {
      const t = el.getAttribute?.("type");
      if (t) d.inputType = t;
    }
    if (tag === "a") {
      const href = el.getAttribute?.("href");
      if (href) d.href = href;
    }
    if (tag === "select" && el.options) {
      const opt = el.options[el.selectedIndex];
      if (opt?.textContent) d.selected = opt.textContent.trim().slice(0, 80);
    }
    const section = sectionFor(el);
    if (section) d.section = section;
    return d;
  }

  // Where on the page the pointer is — viewport pixel coords, a
  // resolution-independent percent, the viewport size, and the target's bounding
  // box. This is what lets an agent resolve "in this area" even when you click or
  // point at a spot with no obvious clickable element.
  function positionFor(x, y, el) {
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    const r = el?.getBoundingClientRect?.();
    return {
      x: Math.round(x),
      y: Math.round(y),
      xpct: vw ? Math.round((x / vw) * 100) : null,
      ypct: vh ? Math.round((y / vh) * 100) : null,
      viewport: { w: vw, h: vh },
      rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
    };
  }

  // Hand an event to the worker, which stamps it against t0 and buffers it.
  function emit(kind, payload) {
    if (!recording) return;
    chrome.runtime.sendMessage({ type: "timeline-event", event: { kind, ...payload } });
  }
  function emitRaw(node) {
    if (!recording) return;
    chrome.runtime.sendMessage({ type: "rrweb-event", node });
  }

  function onClick(e) {
    const el = e.target;
    lastHoverSelector = null; // let a re-hover on the same element log again
    emit("click", { selector: selectorFor(el), label: labelFor(el), ctx: describe(el), ...positionFor(e.clientX, e.clientY, el) });
  }

  // Pointer dwell → `hover`. When the cursor rests on an element for DWELL_MS we
  // record where you are (selector + label + position) so narration like "and in
  // this area" resolves to a real element without a click. Deduped per element so
  // a slow drag across one box doesn't spam the timeline; secret fields are never
  // referenced even by hover.
  let dwellTimer = null;
  let lastMove = null;
  let lastHoverSelector = null;
  const moveOpts = { capture: true, passive: true };

  function onMove(e) {
    lastMove = { x: e.clientX, y: e.clientY };
    if (dwellTimer) clearTimeout(dwellTimer);
    dwellTimer = setTimeout(emitDwell, DWELL_MS);
  }

  function emitDwell() {
    if (!recording || !lastMove) return;
    const el = document.elementFromPoint(lastMove.x, lastMove.y);
    if (!el || isSecretInput(el)) return;
    const selector = selectorFor(el);
    if (selector === lastHoverSelector) return;
    lastHoverSelector = selector;
    emit("hover", { selector, label: labelFor(el), ctx: describe(el), ...positionFor(lastMove.x, lastMove.y, el) });
  }

  function onChange(e) {
    const el = e.target;
    if (!("value" in el)) return;
    // describe() never reads el.value, so it's safe even for secret fields — it
    // gives the field's label/role so "type into the 'Reason' box" is legible.
    const ctx = describe(el);
    if (isSecretInput(el)) {
      emit("input", { selector: selectorFor(el), value: "‹redacted:secret›", ctx });
    } else {
      emit("input", { selector: selectorFor(el), value: maskValue(el.name || el.id, el.value), ctx });
    }
  }

  function onKey(e) {
    // Only emit semantically meaningful keys, never raw keystrokes (those would
    // leak passwords typed character by character).
    if (["Enter", "Tab", "Escape"].includes(e.key)) emit("key", { key: e.key });
  }

  function startCapture() {
    if (recording) return;
    recording = true;
    emit("nav", { url: location.href });

    // rrweb: full DOM recording. Loaded from src/lib/rrweb.min.js (see README
    // for how to vendor it). Guarded so the extension still loads without it.
    if (window.rrweb?.record) {
      rrwebStop = window.rrweb.record({
        emit: emitRaw,
        maskAllInputs: true, // belt-and-suspenders with our own masking
        maskInputOptions: { password: true },
      });
    }

    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousemove", onMove, moveOpts);
    window.addEventListener("popstate", () => emit("nav", { url: location.href }));
  }

  function stopCapture() {
    recording = false;
    rrwebStop?.();
    rrwebStop = null;
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("change", onChange, true);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousemove", onMove, moveOpts);
    if (dwellTimer) clearTimeout(dwellTimer);
    dwellTimer = null;
    lastHoverSelector = null;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "start") startCapture();
    if (msg.type === "stop") stopCapture();
    // The worker pings this (via tabs.sendMessage) to check we're already here
    // before injecting a second copy. Answer so it skips re-injection.
    if (msg.type === "is-recording") {
      sendResponse(true);
      return true;
    }
  });

  // If a recording is already in progress when this frame loads (SPA nav, new
  // page), ask the worker so we attach immediately.
  chrome.runtime.sendMessage({ type: "is-recording" }, (res) => {
    if (res?.recording) startCapture();
  });
})();
