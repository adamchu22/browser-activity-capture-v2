// Minimal ZIP writer (STORE / no compression), zero dependencies.
//
// A Capture Bundle is just files, so a stored zip is enough and keeps the
// extension dependency-free. Produces a Blob ready for chrome.downloads.
//
// 32-BIT ONLY (no Zip64 yet). Every size/offset field below is a `setUint32` and
// the file count a `setUint16`. A long screen recording can push video.webm +
// frames past 4 GiB — at which point those fields would WRAP mod 2^32 and silently
// produce a corrupt, unreadable zip that still reports success (the worst kind of
// data loss, since the caller then clears the take). So we FAIL LOUD instead:
// makeZip throws ZIP_TOO_LARGE before writing, the caller treats it like any export
// failure (the loss guard keeps the take in IndexedDB for retry/discard), and the
// user is told rather than handed a broken file. Implementing real Zip64 is the
// eventual fix; until then, fail-loud is the bulletproof behaviour.

const enc = new TextEncoder();

// 32-bit ZIP field limits. A STORE archive must keep every individual file size,
// the central-directory offset, and the file count within these, or it corrupts.
export const ZIP_MAX_BYTES = 0xffffffff; // 4 GiB - 1
export const ZIP_MAX_FILES = 0xffff; // 65535

// Pure overflow check (no allocation) so it's unit-testable with fake sizes.
// `entries` = [{ nameLen, dataLen }]. Returns a human-readable reason string if a
// 32-bit STORE zip of these entries would overflow, or null if it fits.
export function zipOverflow(entries) {
  if (entries.length > ZIP_MAX_FILES) {
    return `too many files (${entries.length} > ${ZIP_MAX_FILES})`;
  }
  let offset = 0; // running local-header offset; also the central-directory start
  for (const e of entries) {
    if (e.dataLen > ZIP_MAX_BYTES) {
      return `a file is too large for a 32-bit zip (${e.dataLen} bytes > 4 GiB)`;
    }
    offset += 30 + e.nameLen + e.dataLen;
    if (offset > ZIP_MAX_BYTES) {
      return `archive too large for a 32-bit zip (${offset} bytes > 4 GiB)`;
    }
  }
  return null;
}

function crc32(bytes) {
  let crc = ~0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

// files: Array<{ name: string, data: Uint8Array | string }>
export function makeZip(files) {
  // Encode names + string data once, then guard BEFORE writing a single byte. We
  // have no Zip64 path, so anything past the 32-bit limits would corrupt the
  // archive — throw instead so the caller keeps the take (see header note).
  const prepared = files.map((f) => ({
    nameBytes: enc.encode(f.name),
    data: typeof f.data === "string" ? enc.encode(f.data) : f.data,
  }));
  const overflow = zipOverflow(
    prepared.map((p) => ({ nameLen: p.nameBytes.length, dataLen: p.data.length }))
  );
  if (overflow) {
    const err = new Error("ZIP_TOO_LARGE: " + overflow);
    err.code = "ZIP_TOO_LARGE";
    throw err;
  }

  const chunks = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosDateTime();

  for (const { nameBytes, data } of prepared) {
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header sig
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0, true); // flags
    local.setUint16(8, 0, true); // method = store
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); // compressed size
    local.setUint32(22, data.length, true); // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true); // extra len

    chunks.push(new Uint8Array(local.buffer), nameBytes, data);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); // central dir sig
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, time, true);
    cen.setUint16(14, date, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint32(42, offset, true); // local header offset
    central.push({ header: new Uint8Array(cen.buffer), name: nameBytes });

    offset += 30 + nameBytes.length + data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) {
    chunks.push(c.header, c.name);
    centralSize += c.header.length + c.name.length;
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, centralStart, true);
  chunks.push(new Uint8Array(end.buffer));

  return new Blob(chunks, { type: "application/zip" });
}
