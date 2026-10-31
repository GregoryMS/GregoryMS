#!/usr/bin/env bash
# Rebuild the ROM-free browser emulator. Requires Emscripten 4.0.23.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
build="$(mktemp -d)"
trap 'rm -rf "$build"' EXIT
tar -xzf "$root/assets/ti84/cemu-core-source.tar.gz" -C "$build"
core="$build/CEmu/core"
emcc -O3 -flto -I"$core" \
  "$core"/*.c "$core"/usb/*.c "$root/scripts/ti84/adapter.c" \
  --no-entry -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=GregleCEmu \
  -sENVIRONMENT=web,worker,node -sFILESYSTEM=1 -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=134217728 -sSTACK_SIZE=1048576 \
  -sEXPORTED_RUNTIME_METHODS=FS,HEAPU8 \
  -sEXPORTED_FUNCTIONS=_gregle_load_rom,_gregle_load_state,_gregle_save_state,_gregle_step,_gregle_reset,_gregle_key,_gregle_lcd_on,_gregle_frame,_gregle_send_file,_gregle_transfer_status \
  -o "$root/assets/ti84/cemu.mjs"
