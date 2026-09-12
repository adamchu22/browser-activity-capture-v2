// Worker-only download acknowledgement. An accepted download id is NOT a saved
// file. Keep the source Blob/IndexedDB take until Chrome reports complete + exists.
export async function downloadComplete(options, downloads = chrome.downloads, timeoutMs = 90000) {
  const id = await downloads.download(options);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [item] = await downloads.search({ id });
    if (!item) throw new Error("Download disappeared");
    if (item.state === "interrupted") throw new Error(item.error || "Download interrupted");
    if (item.state === "complete") {
      if (item.exists === false) throw new Error("Downloaded file no longer exists");
      if (item.exists === true) return id;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Download completion timed out; recording retained");
}
