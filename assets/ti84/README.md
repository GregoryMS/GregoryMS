# Gregle TI-84 Plus CE emulator

CEmu core revision: `e5ffbb2c80ff241390bc3cc45a2bf01ba9748225`.
Upstream: https://github.com/CE-Programming/CEmu

The original core source and notices are in `cemu-core-source.tar.gz`.
Gregle's adapter is in `../../scripts/ti84/adapter.c`; rebuild from the site
root with `bash scripts/build_ti84.sh`, using Emscripten 4.0.23 (`emcc` on PATH).
The adapter, generated emulator and Gregle emulator controller are distributed
under GPL-3.0-or-later. See `COPYING.txt` and `LICENSE-CEmu.txt` for notices.
Emscripten-generated runtime support retains its upstream MIT/NCSA licensing;
see `LICENSE-Emscripten.txt`.

No TI ROM, operating system, proprietary skin or saved calculator state is
included in this repository. `rom-source.mjs` configures the user-supplied
Catbox ROM URL and its SHA-256 fingerprint. When no local ROM is available,
the calculator downloads that file directly to the browser, validates it and
saves it locally. The firmware is separate from CEmu's open-source licence.
Users can also select a ROM from their own TI-84 Plus CE in the local setup
screen. ROMs and state images stay in IndexedDB in that browser. Backup
files contain the ROM as well as state and should be kept private.

This single-threaded WebAssembly build needs no server, cookies, API keys,
cross-origin isolation headers or SharedArrayBuffer. GitHub Pages serves its
HTML, JavaScript and WASM files directly.
