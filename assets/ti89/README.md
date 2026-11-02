# Gregle TI-89 emulator

The emulator is JavaScript TI-68k by Patrick Davidson, Lionel Debroux,
Xavier Andréani and Adrien Bertrand, under GPL-2.0-or-later. It is vendored
from [gbraad/ti89-simulator](https://github.com/gbraad/ti89-simulator), commit
`babdb7decdcc932ef346bba48cb2c89d3ace4dd3`.

`ti68k.js` is the complete engine source, including its original copyright
notices. Gregle implements the upstream snapshot stubs for CPU, RAM, flash,
hardware registers and link state. `worker.js` supplies the local display,
keyboard, bounded snapshots and worker scheduling. The frontend shares the
TI-84 CE session interface, with separate `gregle-ti89` IndexedDB storage.

The keypad follows the TI-89 Titanium, including all 50 hardware keys. Original
TI-89 (2 MB) and TI-89 Titanium (4 MB) ROMs are detected separately; their
snapshots cannot be interchanged. The supplied automatic download is the
TI-89 Titanium from the supplied link. A local ROM can also be selected.
Firmware is downloaded once through the fixed Gregle router endpoint,
which retrieves the user-configured URL in `rom-source.mjs`. The upstream host
does not allow direct cross-origin browser downloads. Firmware is
verified by size and SHA-256, then kept in device storage. Firmware and private
backups are not included in this repository. A local ROM file can also be
selected without uploading it. All runtime code is served by Gregle and cached
by `calc-sw.js`; after first setup no third-party connection is needed.

See [COPYING.txt](COPYING.txt) for the GNU GPL. Gregle is an independent project
and is not affiliated with Texas Instruments.
