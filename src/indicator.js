// SPDX-License-Identifier: GPL-2.0-or-later
const {Clutter, GLib, St} = imports.gi;
const Main = imports.ui.main;

const VISIBLE_MS = 750;
const FADE_MS = 200;

/* A brief row of dots on the switched monitor: the monitor-local counterpart
 * of GNOME's workspace switcher popup, which only knows the global index. */
var SwitchIndicator = class SwitchIndicator {
    constructor() {
        this._popups = new Map();
    }

    show(monitorIndex, active, count) {
        const monitor = Main.layoutManager.monitors[monitorIndex];
        if (!monitor || count < 2)
            return;
        let popup = this._popups.get(monitorIndex);
        if (!popup) {
            popup = {
                box: new St.BoxLayout({style_class: 'monitor-workspaces-indicator', reactive: false}),
                timer: 0,
            };
            Main.layoutManager.uiGroup.add_child(popup.box);
            this._popups.set(monitorIndex, popup);
        }
        const {box} = popup;
        box.destroy_all_children();
        for (let i = 0; i < count; i++) {
            box.add_child(new St.Widget({
                style_class: `monitor-workspaces-dot${i === active ? ' active' : ''}`,
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        box.accessible_name = `Workspace ${active + 1} of ${count}`;
        const area = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
        const [, width] = box.get_preferred_width(-1);
        const [, height] = box.get_preferred_height(width);
        box.set_position(Math.round(area.x + (area.width - width) / 2),
            Math.round(area.y + area.height * 0.88 - height));
        box.remove_all_transitions();
        box.opacity = 255;
        box.show();
        if (popup.timer)
            GLib.source_remove(popup.timer);
        popup.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, VISIBLE_MS, () => {
            popup.timer = 0;
            box.ease({
                opacity: 0, duration: FADE_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => box.hide(),
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        for (const {box, timer} of this._popups.values()) {
            if (timer)
                GLib.source_remove(timer);
            box.destroy();
        }
        this._popups.clear();
    }
};
