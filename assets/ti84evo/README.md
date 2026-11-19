# TI-84 Evo browser mode

The browser engine and original SVG keypad are served from the fixed asset list
in `workers/calculator/evo.mjs`, using the public standalone source at
https://ti84evo.pages.dev/. The engine build is 7.0.0.4117. Its WebAssembly,
worker, default archive, scripts, stylesheet and font are cached by calc-sw.js
before offline setup reports ready. Cached startup does not contact that source.

The native SVG retains the physical layout, labels and key bindings shown in the
reference image. This browser engine includes its own calculator implementation;
the separate Rust hardware emulator and .84b2 restore bundle are not used here.
The vendor assets retain their original copyright. This is an unofficial integration.

The iframe isolates vendor globals from the other calculator modes. The hosting
router and cached document responses preserve COOP/COEP for WebAssembly threads.
The live Evo screen stays mounted when changing models; reloading starts a new
Evo session. Persistent calculator-memory snapshots are not exposed by this adapter.
