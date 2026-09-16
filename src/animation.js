const {Clutter, Meta, St} = imports.gi;
const Main = imports.ui.main;

// Animate compositor clones instead of transforming real windows. In particular,
// a window straddling two screens must never animate on the neighbouring screen.
var MonitorAnimation = class MonitorAnimation {
    constructor() {
        this.active = new Map();
        this.duration = 260;
    }

    _clone(actor, x, y) {
        return new Clutter.Clone({
            source: actor,
            x, y, width: actor.width, height: actor.height,
        });
    }

    _page(monitor, windows, model, workspace) {
        const page = new Clutter.Actor({width: monitor.width, height: monitor.height,
            background_color: new Clutter.Color({red: 35, green: 35, blue: 35, alpha: 255})});
        const background = Main.layoutManager._bgManagers[monitor.index];
        if (background && background.backgroundActor) {
            const actor = background.backgroundActor;
            const clone = this._clone(actor, 0, 0);
            clone.set_size(monitor.width, monitor.height);
            page.add_child(clone);
        }
        // Desktop icon surfaces are sticky too, but belong above the wallpaper
        // and below application windows, never in the foreground sticky layer.
        for (const entry of windows) {
            const window = entry.id;
            if (entry.monitor !== monitor.index || window.minimized ||
                window.get_window_type() !== Meta.WindowType.DESKTOP)
                continue;
            const actor = window.get_compositor_private();
            if (actor)
                page.add_child(this._clone(actor, actor.x - monitor.x, actor.y - monitor.y));
        }
        // get_window_actors() is in compositor stacking order, bottom to top.
        for (const entry of windows) {
            const window = entry.id;
            if (entry.monitor !== monitor.index || entry.sticky || window.minimized ||
                window.get_window_type() === Meta.WindowType.DESKTOP ||
                model.logical(monitor.index, entry.workspace) !== workspace)
                continue;
            const actor = window.get_compositor_private();
            if (!actor || !actor.width || !actor.height)
                continue;
            page.add_child(this._clone(actor, actor.x - monitor.x, actor.y - monitor.y));
        }
        return page;
    }

    prepare(monitorIndex, windows, model, target, direction) {
        const monitor = Main.layoutManager.monitors[monitorIndex];
        if (!monitor || !St.Settings.get().enable_animations) {
            this.cancel(monitorIndex);
            return null;
        }
        let root = null;
        try {
            const previous = this.active.get(monitorIndex);
            // Freeze the current composition on rapid repeats, then slide that
            // composition out. Keep sticky windows outside this moving group.
            let outgoing;
            if (previous && previous.depth < 6) {
                previous.outgoing.remove_all_transitions();
                previous.incoming.remove_all_transitions();
                outgoing = previous.moving;
                previous.root.remove_child(outgoing);
            } else {
                outgoing = this._page(monitor, windows, model, model.current(monitorIndex));
            }
            this.cancel(monitorIndex);
            root = new Clutter.Actor({x: monitor.x, y: monitor.y,
                width: monitor.width, height: monitor.height, clip_to_allocation: true,
                reactive: false, name: `monitor-workspaces-slide-${monitorIndex}`});
            const moving = new Clutter.Actor({width: monitor.width, height: monitor.height,
                clip_to_allocation: true});
            root.add_child(moving);
            moving.add_child(outgoing);
            const incoming = this._page(monitor, windows, model, target);
            incoming.translation_x = direction * monitor.width;
            moving.add_child(incoming);

            // Sticky windows are fixed above the moving pages, as are Shell's
            // panel and dock (which are siblings above this overlay).
            for (const entry of windows) {
                if (entry.monitor !== monitorIndex || !entry.sticky || entry.id.minimized ||
                    entry.id.get_window_type() === Meta.WindowType.DESKTOP)
                    continue;
                const actor = entry.id.get_compositor_private();
                if (actor)
                    root.add_child(this._clone(actor, actor.x - monitor.x, actor.y - monitor.y));
            }
            const parent = global.window_group.get_parent();
            parent.insert_child_above(root, global.window_group);
            const transition = {root, moving, outgoing, incoming, direction, width: monitor.width,
                depth: previous && previous.depth < 6 ? previous.depth + 1 : 1};
            this.active.set(monitorIndex, transition);
            return transition;
        } catch (error) {
            if (root)
                root.destroy();
            this.cancel(monitorIndex);
            // Animation failure must never prevent a workspace switch.
            logError(error, '[monitor-workspaces] Could not prepare monitor animation');
            return null;
        }
    }

    play(monitorIndex, transition) {
        if (!transition)
            return;
        const {outgoing, incoming, direction, width} = transition;
        outgoing.ease({translation_x: -direction * width, duration: this.duration,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        incoming.ease({translation_x: 0, duration: this.duration,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                if (this.active.get(monitorIndex) === transition)
                    this.cancel(monitorIndex);
            }});
    }

    cancel(monitorIndex) {
        const transition = this.active.get(monitorIndex);
        if (!transition)
            return;
        this.active.delete(monitorIndex);
        transition.root.destroy();
    }

    cancelAll() {
        for (const monitor of Array.from(this.active.keys()))
            this.cancel(monitor);
    }
};
