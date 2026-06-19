// Tests for the minimal ZIP writer's 32-bit overflow guard (fail-loud, no Zip64).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeZip, zipOverflow, ZIP_MAX_BYTES, ZIP_MAX_FILES } from "../extension/src/zip.js";

test("zipOverflow: small bundle fits", () => {
  assert.equal(zipOverflow([{ nameLen: 10, dataLen: 100 }, { nameLen: 12, dataLen: 5_000_000 }]), null);
});

test("zipOverflow: a single >4 GiB file is rejected", () => {
  const reason = zipOverflow([{ nameLen: 10, dataLen: ZIP_MAX_BYTES + 1 }]);
  assert.match(reason, /file is too large/);
});

test("zipOverflow: archive crossing 4 GiB across several files is rejected", () => {
  // Three ~1.6 GiB files: each fits, the running offset does not.
  const big = Math.floor(ZIP_MAX_BYTES * 0.6);
  const reason = zipOverflow([
    { nameLen: 12, dataLen: big },
    { nameLen: 12, dataLen: big },
    { nameLen: 12, dataLen: big },
  ]);
  assert.match(reason, /archive too large/);
});

test("zipOverflow: too many files is rejected", () => {
  const entries = Array.from({ length: ZIP_MAX_FILES + 1 }, () => ({ nameLen: 1, dataLen: 0 }));
  assert.match(zipOverflow(entries), /too many files/);
});

test("zipOverflow: exactly at the boundary fits", () => {
  // one file whose total local entry lands exactly on the limit
  assert.equal(zipOverflow([{ nameLen: 0, dataLen: ZIP_MAX_BYTES - 30 }]), null);
});

test("makeZip: normal bundle produces a valid local-file-header signature", async () => {
  const blob = await makeZip([
    { name: "a.txt", data: "hello" },
    { name: "b.bin", data: new Uint8Array([1, 2, 3, 4]) },
  ]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // PK\x03\x04 local file header magic
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  // EOCD magic PK\x05\x06 at the tail
  assert.deepEqual([...bytes.slice(-22, -18)], [0x50, 0x4b, 0x05, 0x06]);
});

test("makeZip: rejects with ZIP_TOO_LARGE (not a corrupt zip) when a file overflows 32-bit", async () => {
  // A fake oversized entry: makeZip reads data.length, so a stub with a huge length
  // exercises the guard without allocating 4 GiB. makeZip is async → it rejects.
  const fakeHuge = { length: ZIP_MAX_BYTES + 10 };
  await assert.rejects(
    () => makeZip([{ name: "video.webm", data: fakeHuge }]),
    (e) => e.code === "ZIP_TOO_LARGE"
  );
});

test("makeZip: accepts a Blob part and CRCs it by streaming (matches the Uint8Array path)", async () => {
  const payload = new Uint8Array(Array.from({ length: 20_000 }, (_, i) => i & 0xff));
  const fromBytes = new Uint8Array(await (await makeZip([{ name: "v.bin", data: payload }])).arrayBuffer());
  const fromBlob = new Uint8Array(await (await makeZip([{ name: "v.bin", data: new Blob([payload]) }])).arrayBuffer());
  // Identical archives → identical CRC/sizes regardless of Uint8Array-vs-Blob input.
  assert.deepEqual([...fromBytes], [...fromBlob]);
});
