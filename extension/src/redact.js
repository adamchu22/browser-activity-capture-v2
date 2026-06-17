// Shared redaction. This runs BEFORE anything touches disk or the timeline.
// The rule the whole project depends on: secrets never get captured in the
// clear. Password fields are masked at the input layer; auth headers and
// cookies are stripped from network entries.

export const REDACTED = "‹redacted›";
export const REDACTED_EMAIL = "‹redacted:email›";
export const REDACTED_SECRET = "‹redacted:secret›";

// Header names dropped from every captured request/response.
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
]);

// Field-name hints that indicate a value is a secret even outside a password
// input (e.g. JSON bodies, search params).
const SECRET_KEY_RE = /pass(word)?|secret|token|api[-_]?key|auth|ssn|card|cvv/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Values that are secrets regardless of their key — a JWT or a bearer token. A
// JWT can sit under an innocuous key (e.g. "software_statement"), so name-based
// redaction alone misses it; we redact by value SHAPE too. Kept in lockstep with
// the analyzer's validator (analyze/validate_bundle.py TOKEN_RE).
const TOKEN_VALUE_RE = /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]+)?|Bearer\s+[A-Za-z0-9._-]{12,}/g;

// Strip any JWT/bearer token sitting in a free-text string (header value, body,
// query string) — defense in depth on top of the key-name rules.
export function scrubTokens(text) {
  if (typeof text !== "string" || !text) return text;
  return text.replace(TOKEN_VALUE_RE, REDACTED_SECRET);
}

// Query-string parameter keys whose VALUE is a secret regardless of shape
// (?jwt=…, ?api_key=…, ?sig=…). Caught a real leak: GitHub serves private images
// as …png?jwt=eyJ… , so a token rode in the URL where the header/body scrubbers
// never look.
const SECRET_PARAM_RE = /^([^=&]*(?:pass|secret|token|api[-_]?key|auth|jwt|sig|signature|access[-_]?token)[^=&]*)$/i;

// Redact secrets embedded in a URL. URLs are recorded raw into the timeline, the
// HAR, the tab legend, and urls_visited — none of which went through the value
// scrubbers, so a token in a query string leaked in the clear. Mask secret-keyed
// params by name, then scrub any bare JWT/bearer shape anywhere in the URL. The
// host/path are left intact (the redacted record isn't a working URL, just a log).
export function redactUrl(url) {
  if (typeof url !== "string" || !url) return url;
  const masked = url.replace(
    /([?&])([^=&]+)=([^&#]*)/g,
    (m, sep, key, val) => (SECRET_PARAM_RE.test(key) ? `${sep}${key}=${REDACTED_SECRET}` : m)
  );
  return scrubTokens(masked);
}

// Decide the masked form for a single value given the field it came from.
export function maskValue(fieldName, value) {
  if (value == null || value === "") return value;
  const name = String(fieldName || "");
  if (SECRET_KEY_RE.test(name)) return REDACTED_SECRET;
  if (/email|e-mail/i.test(name) || EMAIL_RE.test(String(value))) return REDACTED_EMAIL;
  return scrubTokens(value);
}

// True if a DOM input should never have its value captured at all.
export function isSecretInput(el) {
  if (!el) return false;
  if (el.type === "password") return true;
  const hay = `${el.name || ""} ${el.id || ""} ${el.autocomplete || ""}`;
  return SECRET_KEY_RE.test(hay);
}

// Strip sensitive headers from a HAR-style header array. Non-sensitive header
// values are still token-scrubbed (a bearer can show up in a custom header).
export function redactHeaders(headers = []) {
  return headers.map((h) =>
    SENSITIVE_HEADERS.has(String(h.name).toLowerCase())
      ? { name: h.name, value: REDACTED }
      : { name: h.name, value: scrubTokens(h.value) }
  );
}

// Best-effort redaction of a request/response body string (JSON or form). A final
// token scrub runs over the serialized result so a JWT/bearer can't survive under
// an unexpected key or shape.
export function redactBody(text) {
  if (!text) return text;
  try {
    const obj = JSON.parse(text);
    return scrubTokens(JSON.stringify(redactObject(obj)));
  } catch {
    // Not JSON — redact obvious key=value secret pairs in form/query strings…
    const masked = text.replace(
      /([?&]?)([^=&]*(?:pass|secret|token|key|auth)[^=&]*)=([^&]*)/gi,
      (_, sep, key) => `${sep}${key}=${REDACTED_SECRET}`
    );
    // …then scrub any bare tokens left anywhere in the string.
    return scrubTokens(masked);
  }
}

function redactObject(obj) {
  if (Array.isArray(obj)) return obj.map(redactObject);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SECRET_KEY_RE.test(k)) out[k] = REDACTED_SECRET;
      else if (typeof v === "object") out[k] = redactObject(v);
      else out[k] = maskValue(k, v);
    }
    return out;
  }
  return typeof obj === "string" ? scrubTokens(obj) : obj;
}
