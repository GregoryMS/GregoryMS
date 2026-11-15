#!/usr/bin/env bash
# ROM-free Firebird WebAssembly build. Emscripten 4.0.23.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
build="$(mktemp -d)"
trap 'rm -rf "$build"' EXIT
tar -xzf "$root/assets/tinspire/firebird-core-source.tar.gz" -C "$build"
flags=(-O3 -flto -I"$build" -sUSE_ZLIB=1)
objects=()
for source in "$build"/core/*.{c,cpp} "$build/core/os/os-emscripten.c" "$root/scripts/tinspire/adapter.cpp"; do
  case "$source" in *translate_*|*/gif.cpp) continue;; esac
  object="$build/$(basename "$source").o"
  if [[ "$source" == *.cpp ]]; then
    em++ "${flags[@]}" -std=c++17 -c "$source" -o "$object"
  else
    emcc "${flags[@]}" -std=gnu11 -Wno-incompatible-pointer-types -c "$source" -o "$object"
  fi
  objects+=("$object")
done
em++ "${flags[@]}" "${objects[@]}" --no-entry \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=GregleFirebird \
  -sENVIRONMENT=web,worker,node -sFILESYSTEM=1 -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=67108864 -sMAXIMUM_MEMORY=1073741824 -sSTACK_SIZE=1048576 \
  -sEXPORTED_RUNTIME_METHODS=FS,HEAPU8 \
  -sEXPORTED_FUNCTIONS=_gregle_start,_gregle_step,_gregle_reset,_gregle_key,_gregle_touch,_gregle_frame,_gregle_save \
  -o "$root/assets/tinspire/firebird.mjs"
