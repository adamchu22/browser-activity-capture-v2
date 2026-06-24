# Plan — auto-pack-on-download install (one-time setup, reboot-proof local service)

Status: **SCOPING — not yet building.** This is a "Building Full" task. Nothing here is
committed as a decision until Adam signs off on the open questions at the bottom.

## Goal (Adam, 2026-06-23)

A user sets this up **once** on their machine. From then on, every recording the extension
downloads is **automatically turned into a `…-pack/` by their own local install**, in their own
location, with no manual `pack.py` and no us in the loop. This makes Step 0 case 1 (an adjacent
`…-pack/` beside the zip) always true, so a downstream agent reads `context.md` directly.

## What already exists (the foundation — do not rebuild)

- `analyze/autopack.py` — scans folder(s), finds capture zips with no pack, builds one per zip.
  Idempotent, best-effort per zip, Zip-Slip-guarded. `--watch` polls (default 30s). Reads
  `analyze/autopack.config.json` (`{watch_dirs, packs_dir}`, git-ignored).
- `analyze/install_pointer.py` — writes `~/.config/browser-activity-capture/install.json`
  (`analyze_dir`, venv `python`, `pack_cmd`).
- `analyze/setup.sh` / `setup.ps1` — build the `.venv`, hard-gate ffmpeg, run the transcribe
  selftest (pre-warms the model), register the pointer.
- `build_pack(...)` auto-transcribes with a 30-min timeout (`TRANSCRIBE_TIMEOUT_S`); needs the
  `.venv` + ffmpeg + the cached model for narration.

## What's missing (the actual build)

1. A **background trigger** per OS that runs an autopack pass automatically, survives reboot, and
   starts at login.
2. **Setup wiring**: prompt for / verify the watch dir(s), write `autopack.config.json`, install
   the trigger.
3. **Robustness fixes to `autopack.py`** that the manual path tolerates but a unattended service
   does not (atomic builds, a lock, failure memory, logging).
4. **Uninstall + status** commands.
5. **Docs**: first-time setup, changing locations, the trust boundary.

---

## Design decisions (with rationale)

### D1. Trigger = OS scheduler running a **one-pass** invocation on an interval — NOT a long-lived `--watch` daemon

Each OS already gives us "start at login / restart on crash / run on a timer." Layering our own
`--watch` loop on top doubles the restart logic and creates a new failure: a wedged poll loop that
the OS thinks is healthy. So the service invokes a **single `run()` pass** (new `--once` flag, or
just the no-`--watch` default) every N seconds and exits. The scheduler owns liveness.

- **macOS** — LaunchAgent at `~/Library/LaunchAgents/com.browseractivitycapture.autopack.plist`,
  `RunAtLoad=true` + `StartInterval=60`. Runs in the user's GUI session (needs `$HOME`, the venv,
  the model cache).
- **Windows** — Task Scheduler task, trigger "at log on" + "repeat every 1 minute", run as the
  logged-on user, **hidden** (run `pythonw.exe` so no console window flashes every minute).
- **Linux** — systemd **user** units: `autopack.service` (`Type=oneshot`) + `autopack.timer`
  (`OnBootSec`, `OnUnitActiveSec=60s`). `systemctl --user enable --now`.

Interval default **60s** (was 30s). A recording takes minutes to transcribe anyway, so latency to
*start* is irrelevant; 60s halves the idle wakeups.

### D2. Poll, don't watch the filesystem for events

inotify/FSEvents/ReadDirectoryChangesW would need a 3rd-party dep (e.g. `watchdog`) — against the
"security-vet every dep" rule and unnecessary. A 60s stdlib poll is fine and stays zero-dep.

### D3. The watch dir is the **browser's download directory**, prompted at setup

The extension downloads flat to the browser's Downloads dir (no subfolder anymore). We can't read
the browser's configured download path from outside, so setup must **ask** (default `~/Downloads`)
and **verify** by looking for existing `capture-*.zip` there. Support a **list** (Chrome + Comet may
differ; `watch_dirs` already accepts multiple).

### D4. Default packs **beside the zip** (`packs_dir=null`) — the Step-0-case-1 contract

The whole point is an adjacent `…-pack/` so the agent finds it with zero setup. A tidy central
`packs_dir` defeats that. Default = beside the zip, accept the Downloads clutter. Offer `packs_dir`
as an opt-out for users who want tidiness (they keep the pointer fallback but lose adjacent-pack).
**→ Open question Q1.**

### D4b. Tighten what counts as a capture zip

Today any zip with a `manifest.json` *or* `timeline.json` qualifies. For an unattended service
watching a low-trust Downloads folder, also require the filename to match the extension's pattern
`capture-<ISO8601>.zip` **and** the marker to be `manifest.json` carrying `capture_id`/`t0_wall`.
Cuts false positives (a random downloaded zip with a `manifest.json`) and shrinks the attack surface.

---

## Robustness fixes to autopack.py (needed for unattended operation)

These are the gaps that the manual run survives by having a human watching, but a silent service
does not. **This project's recurring failure is silent loss — every one of these is that risk.**

### R1. Atomic pack builds (else interrupted builds become permanent half-packs)

`build_pack` writes directly into `dest`, and idempotency is "does `dest` exist." If a build is
killed mid-way (sleep, logout, crash, the 30-min transcribe timeout firing), `dest` exists but is
incomplete — and is **skipped forever**. Fix: build into a sibling temp dir, then atomically
`os.replace` to the final name; on startup, sweep stale `*-pack.tmp-*` dirs. Idempotency check
stays "final dir exists" (now only true for *complete* packs).

### R2. A single-instance lock

The service + a manual `--watch` + an overlapping interval tick could pack the same zip at once →
racing writes. Take a machine-wide lock (a pidfile with `fcntl.flock` / `msvcrt.locking`, or an
atomically-created lock dir) at the start of `run()`; if held, exit quietly. The lock also makes a
slow transcribe pass safely skip the next tick instead of stacking.

### R3. Failure memory + backoff

A genuinely corrupt zip (failed/aborted download) fails extraction every pass → log spam + wasted
CPU forever. Persist `autopack.state.json` (per-zip: attempts, last error, give-up-after-N, e.g.
3). Surfaces *what* failed, and stops the infinite retry. A zip that's still downloading is handled
separately (R4) and must NOT count as a failure.

### R4. Don't touch a zip that's still being written

Chrome writes `*.zip.crdownload` then atomically renames to `*.zip` on completion, so a `*.zip`
glob already skips in-progress Chrome downloads. Defense in depth for other browsers / edge cases:
skip a zip whose mtime is < ~10s old, and treat a `BadZipFile` as "retry next pass" (not a hard
failure under R3) for the first few attempts.

### R5. Logging (the service must never fail silently)

Route each pass's summary (packed / failed / skipped) to a rotating log at
`~/.config/browser-activity-capture/autopack.log` (and the launchd plist's
`StandardOut/ErrorPath`). The `run()` summary already prints to stderr — just redirect + rotate.

### R6. Decompressed-size cap on extraction (zip-bomb guard)

`pack_zip` extracts to a temp dir with no size ceiling. Sum `ZipInfo.file_size` before extracting
and refuse over a sane cap (e.g. 4 GiB). Pairs with the existing Zip-Slip guard.

---

## Setup / install flow (what `setup.sh` / `setup.ps1` gain)

After the existing venv + ffmpeg + selftest + pointer steps, add an **opt-in** install step
(prompt: "Auto-build a pack for every new recording? [Y/n]"):

1. Prompt for the **download folder(s)** to watch (default `~/Downloads`); verify by scanning for
   `capture-*.zip`. Allow more than one.
2. Prompt for **packs location** (default: beside each zip — see Q1).
3. Write `analyze/autopack.config.json`.
4. **Capture the absolute ffmpeg path** found during the ffmpeg gate and bake it into the trigger's
   environment (see F1) — the service env won't have Homebrew/PATH.
5. Install the OS trigger (plist / task / unit) pointing at the **venv python** + `autopack.py`.
   Idempotent: overwrite + reload, never duplicate.
6. Print how to check status and how to uninstall.

New commands (cross-platform via small wrappers, or flags on a new `analyze/service.py`):
`--install`, `--uninstall`, `--status` (is the trigger loaded? last run time? last pass summary
from the log/state file).

---

## Predicted failure modes (where this breaks)

### F1. ffmpeg not on PATH in the service environment — **most likely breakage**

launchd / Task Scheduler / systemd run with a **minimal environment**: no Homebrew, no user shell
PATH. `transcribe.py` shells out to `ffmpeg` by name → "ffmpeg not found" → every auto-pack ships
a stub transcript, silently losing narration. Mitigation: bake the absolute ffmpeg path captured at
setup into the trigger env (plist `EnvironmentVariables.PATH`, systemd `Environment=PATH=`, Windows
task env) — **or** teach `transcribe.py` to honor an `FFMPEG_BIN` override and pass it. Verify the
chain runs from the *service* context, not just the interactive shell.

### F2. Interrupted build → permanent half-pack

Covered by R1. Without atomic finalize this is a guaranteed bug the first time a laptop sleeps
mid-transcribe.

### F3. Repo moved or deleted → dangling service fails every 60s forever

The trigger hardcodes absolute paths to the venv python + autopack.py. If the user moves/renames/
deletes the repo, the service errors every tick. Mitigations: (a) document "re-run setup after
moving the repo"; (b) `--status` should detect the missing path and say so loudly; (c) the
uninstall must be runnable even when the repo is gone (ship a copy of the uninstall logic in the
trigger dir, or document the manual `launchctl unload` / `schtasks /delete` / `systemctl --user
disable`).

### F4. Wrong watch dir — browser downloads elsewhere

User changed Chrome's download location, or uses Comet with a different one, or the OS localizes
the folder name. Setup's "scan for existing `capture-*.zip`" check catches the common case; if none
found, warn rather than silently watching an empty folder. **A watched-but-empty folder is a silent
no-op — exactly the failure to avoid.** `--status` should report "watching X, last saw a capture N
ago."

### F5. Heavy compute surprise (battery / fans)

A recording silently triggers minutes of ASR on the CPU/GPU. Acceptable, but: the 30-min transcribe
timeout means a pathological audio pegs a core for 30 min. The R2 lock prevents *overlapping* runs;
document that auto-pack does real work and how to pause it (uninstall, or a config `enabled:false`).

### F6. Model not pre-warmed → first auto-pack needs network + is slow

If setup fell back to bare `python3` (no engine) or the selftest was skipped, the model isn't
cached. The first service pass downloads weights (network, slow) or fails offline. Setup should make
the auto-pack install **conditional on a passing selftest** (no engine → don't install the service,
or install it in `--no-transcribe` mode and say so).

### F7. Two browsers, two download dirs, one filename collision

Both Chrome and Comet name files `capture-<t0>.zip`. If both watch dirs are the same folder it's
fine; if a user records in two browsers at the same second the stems could collide — extremely
unlikely (ISO ms timestamp), note and move on.

### F8. Security / trust boundary

The service auto-extracts and runs **ffmpeg on attacker-controllable `video.webm`** for any zip in
Downloads that matches the capture shape. Downloads is a low-trust folder. Guards: Zip-Slip
(exists), decompressed-size cap (R6), tightened marker + filename pattern (D4b). Honest statement
for the docs: *"This watches your Downloads folder and will extract and process any zip that looks
like a capture (manifest + `capture-*.zip` name). Only the extension produces these, but a zip you
download from elsewhere that fits the shape would also be processed, and ffmpeg runs on its video.
The trust boundary is: you trust the files in your own Downloads folder."*

### F9. Double-pack with the manual interim run

Adam may still run `autopack.py --watch` by hand. The R2 lock makes the second instance a no-op.
Document it.

### F10. Permission prompts (macOS TCC)

A background agent reading `~/Downloads` may trip macOS's "wants to access files in your Downloads
folder" TCC prompt the first time — and a non-interactive agent can't answer it. Needs a live check
on a real machine; may require the user to approve once. Predict, then verify.

---

## Testable vs. live-only

- **Unit-testable (stdlib):** R1 atomic finalize, R2 lock, R3 failure memory + backoff, R4 skip
  fresh/partial, R6 size cap, D4b tightened detection, config writing, `--status` output shape.
  Extend `tests/test_autopack.py`.
- **Live-only (per OS, no unit test):** the trigger actually firing at login + on interval; the
  service env having ffmpeg (F1); the TCC prompt (F10); reboot survival; uninstall. Needs a real
  macOS run first (Adam's machine), then Windows/Linux later or marked unsupported until tested.

## Suggested build order (each a coherent commit)

1. autopack robustness: R1 atomic, R2 lock, R3 failure memory, R4 fresh-skip, R6 size cap, D4b
   detection (+ tests). *Pure Python, fully testable, no OS coupling — lands the risky logic first.*
2. `--once` / `--status` flags + the log/state files (+ tests).
3. macOS install: `service.py --install/--uninstall` writing the LaunchAgent, ffmpeg-path env (F1),
   setup.sh prompts + config write. **Live-verify on Adam's Mac.**
4. Docs: first-time setup, change-locations, trust boundary, "re-run after moving the repo."
5. (Later, gated on demand) Windows Task Scheduler + Linux systemd, each with its own live verify.

## Decisions (Adam, 2026-06-24)

- **Q1 → packs beside each zip** (`packs_dir=null`). Satisfies Step 0 case 1; accept the Downloads
  clutter. `packs_dir` stays available as an opt-out but is not the default.
- **Q2 → macOS first.** Build + live-verify the launchd path on Adam's Mac. Scaffold Windows/Linux
  but mark them untested until there's a machine to verify on (build order step 5, gated on demand).
- **Q3 → process anything capture-shaped in Downloads.** Trust boundary = "you trust files in your
  own Downloads folder." No extension-written signature needed; rely on the tightened marker +
  `capture-*.zip` filename (D4b), Zip-Slip guard, and the R6 size cap. State it plainly in the docs.
- **Q4 → opt-in, prompted.** Setup asks "Auto-build a pack for every recording? [Y/n]" — the user
  consciously turns on a background service that runs ffmpeg/ASR.
