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

// Same language the popup is set to (shared table in i18n.js, stored under `lang`).
const I18N = window.BAC_I18N;
let lang = "en";
const T = (key, vars) => (I18N ? I18N.t(lang, key, vars) : key);

function applyStatic() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = T(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-html]")) el.innerHTML = T(el.dataset.i18nHtml);
}

async function request() {
  status.className = "pending";
  status.textContent = T("micRequesting");
  retry.hidden = true;
  done.hidden = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // We only needed the grant — release the device immediately.
    stream.getTracks().forEach((t) => t.stop());
    status.className = "ok";
    status.textContent = T("micOkMsg");
    done.hidden = false;
  } catch (e) {
    status.className = "err";
    status.textContent = T("micBlocked", { e: e?.message || e });
    retry.hidden = false;
  }
}

retry.addEventListener("click", request);

chrome.storage.local.get(["lang"]).then(({ lang: saved }) => {
  lang = (I18N && I18N.normalize(saved)) || (I18N ? I18N.detect() : "en");
  applyStatic();
  request();
});
