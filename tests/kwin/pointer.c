/* The tests' pointer in a headless KWin: moves it and presses its left
 * button through KWin's fake input protocol (org_kde_kwin_fake_input),
 * which KWin gives any client with KWIN_WAYLAND_NO_PERMISSION_CHECKS=1.
 *
 * It reads lines of commands, "move X Y", "press", "release" and "escape"
 * (the key, pressed and let go), and sends
 * each line's in order to the compositor WAYLAND_DISPLAY names. It answers
 * a line with "ok" once KWin has answered a sync after it, so KWin has
 * taken its commands by then. It runs until its input ends: KWin lets go
 * of a button as the client that pressed it leaves. */
#include <linux/input-event-codes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wayland-client.h>

#include "fake-input-client-protocol.h"

static struct org_kde_kwin_fake_input *fake;

static void global(void *data, struct wl_registry *registry, uint32_t name, const char *interface, uint32_t version)
{
    (void)data;
    if (strcmp(interface, org_kde_kwin_fake_input_interface.name) == 0) {
        fake = wl_registry_bind(registry, name, &org_kde_kwin_fake_input_interface, version < 4 ? version : 4);
    }
}

static void global_remove(void *data, struct wl_registry *registry, uint32_t name)
{
    (void)data;
    (void)registry;
    (void)name;
}

static const struct wl_registry_listener listener = {global, global_remove};

/* Sends one line's commands. Returns whether they all made sense. */
static int send(char *line)
{
    char *save = NULL;
    for (char *word = strtok_r(line, " \n", &save); word; word = strtok_r(NULL, " \n", &save)) {
        if (strcmp(word, "move") == 0) {
            const char *x = strtok_r(NULL, " \n", &save);
            const char *y = strtok_r(NULL, " \n", &save);
            if (!x || !y) {
                fprintf(stderr, "pointer: move needs X and Y\n");
                return 0;
            }
            org_kde_kwin_fake_input_pointer_motion_absolute(fake, wl_fixed_from_double(atof(x)), wl_fixed_from_double(atof(y)));
        } else if (strcmp(word, "press") == 0) {
            org_kde_kwin_fake_input_button(fake, BTN_LEFT, WL_POINTER_BUTTON_STATE_PRESSED);
        } else if (strcmp(word, "release") == 0) {
            org_kde_kwin_fake_input_button(fake, BTN_LEFT, WL_POINTER_BUTTON_STATE_RELEASED);
        } else if (strcmp(word, "escape") == 0) {
            org_kde_kwin_fake_input_keyboard_key(fake, KEY_ESC, WL_KEYBOARD_KEY_STATE_PRESSED);
            org_kde_kwin_fake_input_keyboard_key(fake, KEY_ESC, WL_KEYBOARD_KEY_STATE_RELEASED);
        } else {
            fprintf(stderr, "pointer: move X Y, press, release or escape, not %s\n", word);
            return 0;
        }
    }
    return 1;
}

int main(void)
{
    struct wl_display *display = wl_display_connect(NULL);
    if (!display) {
        fprintf(stderr, "pointer: couldn't connect to the compositor\n");
        return 1;
    }
    struct wl_registry *registry = wl_display_get_registry(display);
    wl_registry_add_listener(registry, &listener, NULL);
    if (wl_display_roundtrip(display) < 0 || !fake) {
        fprintf(stderr, "pointer: the compositor has no org_kde_kwin_fake_input; KWin needs KWIN_WAYLAND_NO_PERMISSION_CHECKS=1\n");
        return 1;
    }
    if (org_kde_kwin_fake_input_get_version(fake) < 4) {
        fprintf(stderr, "pointer: the compositor's fake input can't place the pointer or press a key\n");
        return 1;
    }
    org_kde_kwin_fake_input_authenticate(fake, "tide-kde tests", "moving the pointer");
    char line[1024];
    while (fgets(line, sizeof line, stdin)) {
        if (!send(line)) {
            return 2;
        }
        if (wl_display_roundtrip(display) < 0) {
            fprintf(stderr, "pointer: the compositor went away\n");
            return 1;
        }
        puts("ok");
        fflush(stdout);
    }
    wl_display_disconnect(display);
    return 0;
}
