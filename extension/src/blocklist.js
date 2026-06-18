// Host-blocklist matching — the "Never record on" list.
//
// Pure + dependency-free so it can be unit-tested (tests/test_blocklist.mjs) and
// imported by the worker. The old worker logic did an exact `blocklist.includes(
// hostname)`, which silently failed the moment the entry and the live host weren't
// character-identical — e.g. a user typing `1password.com` never matched
// `my.1password.com`, so a sensitive tab got fully captured. This matches by
// hostname SUFFIX (a parent domain blocks its subdomains) and tolerates the messy
// things people actually paste: a full URL, a scheme, a path, credentials, a port,
// a leading `*.` or `www.`, and any casing.

// Reduce a user-entered blocklist entry (or a URL) to a bare lowercase hostname.
export function normalizeHost(entry) {
  if (!entry) return "";
  let s = String(entry).trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // strip scheme (http://, etc.)
  s = s.replace(/[/?#].*$/, ""); // strip path / query / fragment
  s = s.replace(/^[^@]*@/, ""); // strip user:pass@ credentials
  s = s.replace(/:\d+$/, ""); // strip :port
  s = s.replace(/^\*\./, ""); // a leading wildcard is implied by suffix matching
  s = s.replace(/^www\./, ""); // www. is noise — match the registrable host
  s = s.replace(/^\.+|\.+$/g, ""); // trim stray dots
  return s;
}

// True if `url`'s host is, or is a subdomain of, any blocklist entry.
export function hostOnBlocklist(url, blocklist) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false; // not a real URL (chrome://newtab, "", etc.) — nothing to block
  }
  if (!host) return false;
  for (const raw of blocklist || []) {
    const entry = normalizeHost(raw);
    if (!entry) continue;
    if (host === entry || host.endsWith("." + entry)) return true;
  }
  return false;
}
