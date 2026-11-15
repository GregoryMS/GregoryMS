# Gregle TI-Nspire CX CAS emulator

Firebird revision `f75e590fd43365654ea2bbe6683f15b54e57abfb`.
Upstream: https://github.com/nspire-emus/firebird
Licence: GPL-3.0, see [COPYING.txt](COPYING.txt).

The corresponding core source, including Gregle's bounded worker loop and
Emscripten OS include fix, is in [firebird-core-source.tar.gz](firebird-core-source.tar.gz).
The adapter is in `scripts/tinspire/adapter.cpp` in the Gregle repository.
Rebuild with Emscripten 4.0.23 on PATH: `bash scripts/build_tinspire.sh`.
No Qt, SharedArrayBuffer, cross-origin isolation or backend is needed.
Emscripten's runtime licence is in `../ti84/LICENSE-Emscripten.txt`.
Zlib 1.3.1 is built by Emscripten's USE_ZLIB port under the zlib licence.
GIF recording and desktop debug interfaces are not exposed by this build.

## Setup and offline use

Select **CX CAS** on the calculator. The user-supplied Boot1 (512 KiB) and
flash (132 MiB) download automatically through the fixed-file firmware relay.
Both expected lengths and SHA-256 fingerprints are checked before the files
are bundled and saved on the device. Subsequent launches use local storage.
The optional **Load Boot1 & flash** control accepts matching 512 KiB Boot1
and 33 or 132 MiB Firebird flash files from an original TI-Nspire CX CAS.
CX II, non-CAS and .tcc OS update files are not accepted. No TI firmware or
proprietary skin is committed to this repository.

Files are read locally, never uploaded. The selected firmware, compressed CPU,
RAM and modified-flash snapshot are saved in `gregle-tinspire` IndexedDB.
The shared calculator service worker caches this controller, firmware helper,
worker, engine and WebAssembly before claiming offline readiness. Offline
status lists CX CAS only after firmware is saved. Close all calculator windows
and reopen to apply a pending PWA update. Browser storage remains origin- and
device-specific and can be removed by clearing site data or by the browser.

The keypad follows the handheld layout, including split function keys and
alphabet rows. Its touchpad supports pointer movement, taps, held clicks and
four direction clicks, alongside hardware arrow keys. Hold Ctrl/Shift while pressing another key for
calculator modifiers. On touchscreens, hold one finger on a modifier and tap
another key. Tab is sent to the calculator when its LCD is focused; otherwise
it moves browser focus. Drag across the touchpad to move the pointer; tap its centre to click or its
edges for direction clicks. Holding a finger down engages a held click.

Session provides pause/resume, save, restart, export/restore (`.greglensp`) and
firmware replacement/removal. Backups include firmware and memory: keep them
private. Pop-out and multi-window ownership use the shared calculator handoff.
Program transfer is not exposed. Performance varies by device because the
ARM CPU is interpreted in a single Web Worker, paced to 10 ms emulated
throttle intervals to avoid excessive key repeat while idle.

## Verification

`node --test tests/calc-tinspire.test.cjs tests/calc-offline.test.cjs` runs the
actual WebAssembly core on original ARM diagnostic instructions, checks CPU
execution and complete snapshot restoration, rejects invalid firmware and
checks the offline dependency cache. No TI firmware is used in those tests.
