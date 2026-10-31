/* Gregle browser adapter for CEmu. SPDX-License-Identifier: GPL-3.0-or-later */
#include "emu.h"
#include "asic.h"
#include "lcd.h"
#include "keypad.h"
#include "link.h"
#include <stdarg.h>

static uint32_t pixels[LCD_SIZE];
static int transfer_status = -1;

FILE *fopen_utf8(const char *path, const char *mode) { return fopen(path, mode); }
void gui_console_clear(void) {}
void gui_console_printf(const char *format, ...) { (void)format; }
void gui_console_err_printf(const char *format, ...) { (void)format; }
asic_rev_t gui_handle_reset(const boot_ver_t *boot, asic_rev_t loaded,
    asic_rev_t suggested, emu_device_t device, bool *python) {
    (void)boot; (void)loaded; (void)device; (void)python;
    return suggested;
}

int gregle_load_rom(void) {
    int result = emu_load(EMU_DATA_ROM, "/calculator.rom");
    if (result == EMU_STATE_VALID) {
        emu_set_run_rate(60);
        emu_set_lcd_dma(1);
        emu_set_lcd_gamma(1);
    }
    return result;
}
int gregle_load_state(void) {
    /* The snapshot already contains its scheduler clocks and pending events. */
    return emu_load(EMU_DATA_IMAGE, "/calculator.state");
}
int gregle_save_state(void) { return emu_save(EMU_DATA_IMAGE, "/calculator.state"); }
void gregle_step(void) { emu_run(1); }
void gregle_reset(void) { emu_reset(); }
void gregle_key(int row, int col, int down) { emu_keypad_event(row, col, down != 0); }
int gregle_lcd_on(void) { return lcd.control & 1; }
uint32_t *gregle_frame(void) {
    emu_lcd_drawframe(pixels);
    /* The panel holds ARGB words; Canvas ImageData requires RGBA bytes. */
    for (size_t i = 0; i < LCD_SIZE; i++) {
        uint32_t p = pixels[i];
        pixels[i] = 0xFF000000u | ((p & 0xFFu) << 16) | (p & 0xFF00u) | ((p >> 16) & 0xFFu);
    }
    return pixels;
}
static bool transfer_progress(void *context, int value, int total) {
    (void)context;
    transfer_status = total > 0 ? (int)((int64_t)value * 100 / total) : -2;
    return false;
}
int gregle_send_file(void) {
    const char *path = "/program.8xp";
    transfer_status = 0;
    int result = emu_send_variables(&path, 1, LINK_FILE, transfer_progress, NULL);
    if (result != LINK_GOOD) transfer_status = -2;
    return result;
}
int gregle_transfer_status(void) { return transfer_status; }
