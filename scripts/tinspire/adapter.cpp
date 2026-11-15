/* Gregle Firebird adapter. SPDX-License-Identifier: GPL-3.0-or-later */
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <emscripten.h>
#include "core/emu.h"
#include "core/mmu.h"
#include "core/schedule.h"
#include "core/keypad.h"
#include "core/lcd.h"

void gui_do_stuff(bool) {}
int gui_getchar() { return -1; }
void gui_putchar(char) {}
void gui_debug_printf(const char *, ...) {}
void gui_debug_vprintf(const char *, va_list) {}
void gui_perror(const char *) {}
void gui_set_busy(bool) {}
void gui_status_printf(const char *, ...) {}
void gui_show_speed(double) {}
void gui_usblink_changed(bool) {}
void gui_debugger_entered_or_left(bool) {}
void gui_debugger_request_input(debug_input_cb) {}
void throttle_timer_on() {}
void throttle_timer_off() {}
void throttle_timer_wait(unsigned int) {}
extern "C" void gif_new_frame() {}

extern "C" {
int gregle_start(int resume) {
    path_boot1 = "boot1.img";
    path_flash = "flash.img";
    do_translate = false;
    turbo_mode = true;
    if (!emu_start(0, 0, resume ? "session.bin" : nullptr)) return 0;
    if ((product >> 4) != 0x0F) { emu_cleanup(); return 0; }
    addr_cache_flush();
    sched_update_next_event(0);
    exiting = false;
    return 1;
}
int gregle_save() { return emu_suspend("session.bin"); }
void gregle_key(int row, int col, int down) {
    if (row >= 0 && row < 8 && col >= 0 && col < 11)
        keypad_set_key(row, col, down != 0);
}
void gregle_touch(float x, float y, int contact, int down) {
    touchpad_set_state(x, y, contact != 0, down != 0);
}
unsigned char *gregle_frame() {
    static uint16_t lcd[320 * 240];
    static unsigned char pixels[320 * 240 * 4];
    lcd_cx_draw_frame(lcd);
    for (int i = 0; i < 320 * 240; ++i) {
        pixels[i*4] = ((lcd[i] >> 11) & 31) * 255 / 31;
        pixels[i*4+1] = ((lcd[i] >> 5) & 63) * 255 / 63;
        pixels[i*4+2] = (lcd[i] & 31) * 255 / 31;
        pixels[i*4+3] = 255;
    }
    return pixels;
}
}
