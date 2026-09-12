// Helpers for capturing HAR response bodies (D1). The migration outcome infers a
// source app's data model from its API traffic, but network.har carried no response
// bodies — so only what the client SENT was visible, not what the server RETURNED.
//
// These pure helpers decide WHICH responses to capture and how to bound them; the
// actual chrome.debugger.getResponseBody call + redaction lives in background.js.
// Worker-only (no content-script mirror needed). Two scoping rules keep the new
// secret/PII surface small:
//   • same-SITE only — the app's own API (incl. api.* subdomains), not third parties.
//   • JSON only — the data-model shapes that matter, not HTML/images/binary.

// Common two-level public suffixes. Chrome exposes no Public Suffix List, so this is a
// pragmatic allowlist: hosts ending in one of these collapse to THREE labels (so
// foo.co.uk → foo.co.uk, not co.uk). A missed exotic suffix only ever makes the
// same-site test STRICTER (under-captures) — never looser — so it can't leak a
// cross-site body. Not exhaustive by design; extend if a target domain needs it.
const TWO_LEVEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk",
  "com.au", "net.au", "org.au", "gov.au", "edu.au",
  "co.jp", "or.jp", "ne.jp", "go.jp",
  "co.nz", "co.za", "co.in", "co.kr", "com.br", "com.mx", "com.sg",
]);

// The registrable domain (eTLD+1) of a URL's hostname, e.g.
//   app.foo.com → foo.com   |   api.foo.co.uk → foo.co.uk   |   localhost → localhost
// Returns "" for anything without a usable host (chrome://, file://, an IP, garbage),
// which makes isSameSite() reject it — the safe default.
export function registrableDomain(url) {
  let host;
  try {
    const u = new URL(url);
    // Only web traffic has a registrable domain we care about; chrome://, file://,
    // data:, etc. are never capturable sites, so they're never same-site.
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    host = u.hostname;
  } catch {
    return "";
  }
  if (!host) return "";
  // Bare hostnames (localhost) and IPv4/IPv6 literals have no registrable domain to
  // collapse — compare them whole, but never treat a dotted IP as same-site by suffix.
  if (!host.includes(".")) return host; // localhost, single-label intranet host
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return ""; // IP literal
  const labels = host.split(".");
  const lastTwo = labels.slice(-2).join(".");
  // Pragmatic eTLD+1 folding over a small two-level public-suffix allowlist. A
  // missed exotic suffix only ever makes the same-site test STRICTER
  // (under-captures; exact-host match) — never looser — so it can't leak a
  // cross-site body. Trailing dots are stripped first so "bank.example." can't
  // dodge a suffix match.
  const clean = host.toLowerCase().replace(/\.+$/, "");
  const cleanLabels = clean.split(".");
  const cleanLastTwo = cleanLabels.slice(-2).join(".");
  const take = TWO_LEVEL_SUFFIXES.has(cleanLastTwo) ? 3 : 2;
  return cleanLabels.slice(-take).join(".");
}

// True if two URLs share a registrable domain (so app.foo.com and api.foo.com match,
// but foo.com and analytics.other.com don't). An empty registrable domain (one URL
// has no usable host) is never same-site.
export function isSameSite(urlA, urlB) {
  const a = registrableDomain(urlA);
  return a !== "" && a === registrableDomain(urlB);
}

// True if a response MIME type carries JSON we want to capture: REST JSON, any
// vendor +json (e.g. application/vnd.api+json), GraphQL, or text/json. A MIME can
// carry a ;charset suffix, so match the type prefix, not the whole string.
export function isJsonMime(mime) {
  if (typeof mime !== "string" || !mime) return false;
  const type = mime.split(";")[0].trim().toLowerCase();
  return (
    type === "application/json" ||
    type === "text/json" ||
    type.endsWith("+json") ||
    type.startsWith("application/graphql")
  );
}

// Size-cap a response body string. Bodies go into network.har (and the pack's API
// table), so an unbounded body bloats the bundle. Over the cap, slice and append a
// marker that names how much was dropped; under it, return unchanged. Redaction runs
// BEFORE this in the caller, so the kept prefix is already scrubbed.
export function capResponseBody(text, cap) {
  if (typeof text !== "string") return text;
  if (text.length <= cap) return text;
  return text.slice(0, cap) + `…‹truncated ${text.length - cap} bytes›`;
}
