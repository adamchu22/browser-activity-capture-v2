// One-time microphone grant.
//
// An MV3 offscreen document can't surface a permission prompt, so we request the
// mic here — a normal extension page, which CAN prompt. Once the extension origin
// is granted, the offscreen recorder's getUserMedia({audio:true}) succeeds
// silently on every future recording. The grant persists across sessions, so this
// page only needs to run once.

const status = document.getElementById("status");
const retry = document.getElementById("retry");
const done = document.getElementById("done");

async function request() {
  status.className = "pending";
  status.textContent = "Requesting microphone access…";
  retry.hidden = true;
  done.hidden = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // We only needed the grant — release the device immediately.
    stream.getTracks().forEach((t) => t.stop());
    status.className = "ok";
    status.textContent = "✓ Microphone enabled.";
    done.hidden = false;
  } catch (e) {
    status.className = "err";
    status.textContent =
      "Microphone blocked: " + (e?.message || e) +
      ". Check the mic icon in the address bar, or macOS System Settings → " +
      "Privacy & Security → Microphone (allow Chrome), then try again.";
    retry.hidden = false;
  }
}

retry.addEventListener("click", request);
request();
