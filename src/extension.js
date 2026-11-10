const {Clutter, Gio, GLib, Meta, Shell} = imports.gi;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const {wrap, restoreModel, saveState} = Me.imports.model;
const {MonitorAnimation} = Me.imports.animation;
const {OverviewCards} = Me.imports.overview;
const {SwitchIndicator} = Me.imports.indicator;

const MODES = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;
const DIRECTIONS = {left: -1, right: 1, up: -1, down: 1};
const TARGETS = ['left', 'right', 'up', 'down', 'last',
    ...Array.from({length: 12}, (_, i) => `${i + 1}`)];
// Every workspace shortcut GNOME routes through its own switcher.
const BINDINGS = ['switch', 'move'].flatMap(action => TARGETS.map(target => `${action}-to-workspace-${target}`));
const SCROLL_INTERVAL = 150; // GNOME's own SCROLL_TIMEOUT_TIME
const SCROLL_RESET = 400;

class MonitorWorkspaces {
    enable() {
        this._signals = [];
        this._workspaceSignals = [];
        this._patches = [];
        this._mutating = false;
        this._nativeLater = 0;
        this._scrollAccumulated = 0;
        this._lastSmoothScroll = 0;
        this._lastScroll = 0;
        this._settings = ExtensionUtils.getSettings();
        this._mutter = new Gio.Settings({schema_id: 'org.gnome.mutter'});
        this._oldSettings = {
            dynamic: this._mutter.get_boolean('dynamic-workspaces'),
            primary: this._mutter.get_boolean('workspaces-only-on-primary'),
        };
        this._mutter.set_boolean('dynamic-workspaces', false);
        this._mutter.set_boolean('workspaces-only-on-primary', false);
        this._model = restoreModel(global.workspace_manager.n_workspaces,
            global.workspace_manager.get_active_workspace_index(),
            Main.layoutManager.monitors, this._settings.get_string('state'));
        this._animation = new MonitorAnimation();
        this._indicator = new SwitchIndicator();
        this._cards = new OverviewCards(this);

        this._connect(Main.overview, 'showing', () => this._animation.cancelAll());
        this._connect(global.workspace_manager, 'active-workspace-changed', () => this._queueNativeSwitch());
        this._connect(global.workspace_manager, 'notify::n-workspaces', () => {
            this._animation.cancelAll();
            this._model.count = global.workspace_manager.n_workspaces;
            this._model.physical = global.workspace_manager.get_active_workspace_index();
            this._saveState();
            this._connectWorkspaces();
            this._cards.queueRender();
        });
        this._connect(Main.layoutManager, 'monitors-changed', () => {
            this._animation.cancelAll();
            this._indicator.destroy();
            // Indices may have changed; restore each monitor's selection by
            // geometry. Windows are never moved by this.
            this._model = restoreModel(global.workspace_manager.n_workspaces,
                global.workspace_manager.get_active_workspace_index(),
                Main.layoutManager.monitors, this._settings.get_string('state'));
            this._saveState();
            this._cards.queueRender();
        });
        for (const signal of ['window-created', 'window-entered-monitor', 'window-left-monitor'])
            this._connect(global.display, signal, () => this._cards.queueRender());
        this._connectWorkspaces();

        const extension = this;
        // Shell code that asks for a neighbouring workspace (dock scrolling,
        // other extensions) steps the monitor under the pointer instead.
        this._patch(Main.wm, 'actionMoveWorkspace', function(workspace) {
            if (!Main.sessionMode.hasWorkspaces)
                return;
            const delta = workspace.index() - global.workspace_manager.get_active_workspace_index();
            if (delta)
                extension._step(extension._pointerMonitor(), delta, true);
        });
        // Super+scroll on the desktop, including smooth (high-resolution) wheels.
        this._patch(Main.wm, 'handleWorkspaceScroll', event => {
            const delta = this.scrollDelta(event);
            if (delta)
                this._step(this._pointerMonitor(), delta, true);
            return Clutter.EVENT_STOP;
        });
        this._patch(Main.wm._workspaceAnimation, 'canHandleScrollEvent', () => false);
        // Any native switch that still happens is absorbed per monitor below;
        // GNOME's all-monitor slide must not play for it.
        this._patch(Main.wm._workspaceAnimation, 'animateSwitch', (_from, _to, _direction, onComplete) => onComplete());
        // Alt+Tab, notifications, and the overview activate windows through here.
        const activateWindow = Main.activateWindow;
        this._patch(Main, 'activateWindow', (window, time, workspaceNum) => {
            if (workspaceNum === undefined)
                this._reveal(window);
            return activateWindow(window, time, workspaceNum);
        });

        this._oldKeybindingModes = {};
        for (const name of BINDINGS) {
            this._oldKeybindingModes[name] = Main.wm._allowedKeybindings[name];
            Main.wm.setCustomKeybindingHandler(name, MODES,
                (_display, window, binding) => this._onWorkspaceBinding(window, binding));
        }
        Main.wm.addKeybinding('next', this._settings, Meta.KeyBindingFlags.NONE, MODES,
            () => this._step(this._pointerMonitor(), 1, true));
        Main.wm.addKeybinding('previous', this._settings, Meta.KeyBindingFlags.NONE, MODES,
            () => this._step(this._pointerMonitor(), -1, true));
        log('[monitor-workspaces] enabled');
    }

    get model() {
        return this._model;
    }

    _connect(object, name, callback) {
        this._signals.push([object, object.connect(name, callback)]);
    }

    // Closing a window or moving it from another menu changes card contents.
    _connectWorkspaces() {
        for (const [workspace, id] of this._workspaceSignals)
            workspace.disconnect(id);
        this._workspaceSignals = [];
        for (let i = 0; i < global.workspace_manager.n_workspaces; i++) {
            const workspace = global.workspace_manager.get_workspace_by_index(i);
            for (const signal of ['window-added', 'window-removed'])
                this._workspaceSignals.push([workspace, workspace.connect(signal, () => this._cards.queueRender())]);
        }
    }

    _patch(object, name, replacement) {
        this._patches.push({object, name, replacement, original: object[name],
            own: Object.prototype.hasOwnProperty.call(object, name)});
        object[name] = replacement;
    }

    _unpatch() {
        for (const {object, name, replacement, original, own} of this._patches.reverse()) {
            if (object[name] !== replacement)
                continue;
            if (own)
                object[name] = original;
            else
                delete object[name];
        }
        this._patches = [];
    }

    _saveState() {
        this._settings.set_string('state', saveState(this._model, Main.layoutManager.monitors,
            this._settings.get_string('state')));
    }

    _pointerMonitor() {
        const index = global.display.get_current_monitor();
        return Main.layoutManager.monitors[index] ? index : Main.layoutManager.primaryIndex;
    }

    windows() {
        return global.get_window_actors().map(actor => actor.meta_window).filter(w => w && w.get_workspace())
            .map(w => ({id: w, monitor: w.get_monitor(), workspace: w.get_workspace().index(),
                sticky: w.is_on_all_workspaces(), attached: w.is_attached_dialog()}));
    }

    _apply(moves) {
        this._mutating = true;
        try {
            // Snapshot destinations before moving parents: attached dialogs follow them.
            for (const move of moves) {
                if (move.id.get_workspace())
                    move.id.change_workspace_by_index(move.target, false);
            }
        } finally {
            this._mutating = false;
        }
    }

    /* Show `target` on one monitor. A `carry` window stays on screen and
     * travels with the switch, which is how "move window to workspace" works. */
    _select(monitor, target, {direction = 0, carry = null, indicator = false} = {}) {
        const current = this._model.current(monitor);
        target = wrap(target, this._model.count);
        if (current !== target) {
            const travels = w => w === carry || (w.is_attached_dialog() && w.get_transient_for() === carry);
            const windows = this.windows().map(w => carry && travels(w.id) ? {...w, sticky: true} : w);
            const transition = Main.overview.visible ? null : this._animation.prepare(
                monitor, windows, this._model, target, direction || Math.sign(target - current));
            try {
                this._apply(this._model.select(monitor, target, windows));
                this._animation.play(monitor, transition);
            } catch (error) {
                this._animation.cancel(monitor);
                throw error;
            }
            this._saveState();
            this._cards.queueRender();
        }
        if (indicator && !Main.overview.visible)
            this._indicator.show(monitor, target, this._model.count);
    }

    _step(monitor, delta, indicator = false) {
        this._select(monitor, this._model.current(monitor) + delta, {direction: Math.sign(delta), indicator});
    }

    // Used by the overview cards.
    select(monitor, workspace) {
        this._select(monitor, workspace);
    }

    step(monitor, delta) {
        this._step(monitor, delta);
    }

    activate(window, monitor, workspace) {
        this._select(monitor, workspace);
        Main.overview.hide();
        window.unminimize();
        window.activate(global.get_current_time());
    }

    moveWindow(window, monitor, workspace) {
        if (!window.get_workspace() || !Main.layoutManager.monitors[monitor] ||
            workspace < 0 || workspace >= this._model.count)
            return false;
        const destination = global.workspace_manager.get_workspace_by_index(
            this._model.storage(monitor, workspace));
        this._mutating = true;
        try {
            // A drop onto a particular workspace makes a pinned window local to it.
            if (window.is_on_all_workspaces())
                window.unstick();
            if (window.get_monitor() !== monitor)
                window.move_to_monitor(monitor);
            window.change_workspace(destination);
        } finally {
            this._mutating = false;
        }
        // Rebuild only after DND releases its source actor and pointer grab.
        this._cards.queueRender();
        return true;
    }

    scrollDelta(event) {
        let delta = 0;
        const time = event.get_time();
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
        case Clutter.ScrollDirection.LEFT:
            delta = -1;
            break;
        case Clutter.ScrollDirection.DOWN:
        case Clutter.ScrollDirection.RIGHT:
            delta = 1;
            break;
        case Clutter.ScrollDirection.SMOOTH: {
            const [dx, dy] = event.get_scroll_delta();
            if (time - this._lastSmoothScroll > SCROLL_RESET)
                this._scrollAccumulated = 0;
            this._lastSmoothScroll = time;
            // One wheel notch is 1.0; touchpads arrive in smaller pieces.
            this._scrollAccumulated += Math.abs(dx) > Math.abs(dy) ? dx : dy;
            if (Math.abs(this._scrollAccumulated) >= 1) {
                delta = Math.sign(this._scrollAccumulated);
                this._scrollAccumulated = 0;
            }
            break;
        }
        }
        if (!delta || time - this._lastScroll < SCROLL_INTERVAL)
            return 0;
        this._lastScroll = time;
        return delta;
    }

    /* Like every other shortcut, moving acts on the monitor under the pointer:
     * the focused window if it is there, otherwise the window used most
     * recently on that monitor (focus does not follow the pointer). */
    _windowToMove(focused) {
        const monitor = this._pointerMonitor();
        const root = window => {
            while (window && window.is_attached_dialog() && window.get_transient_for())
                window = window.get_transient_for();
            return window;
        };
        focused = root(focused);
        if (focused && focused.get_monitor() === monitor)
            return focused;
        return global.display.get_tab_list(Meta.TabList.NORMAL, null).map(root).find(window =>
            window && window.get_monitor() === monitor && !window.minimized && !window.is_on_all_workspaces() &&
            window.get_workspace() && window.get_workspace().index() === this._model.physical) || null;
    }

    _onWorkspaceBinding(window, binding) {
        const [action, , , target] = binding.get_name().split('-');
        let subject = null;
        if (action === 'move') {
            const focused = window || global.display.focus_window;
            subject = this._windowToMove(focused);
            if (!subject || !subject.get_workspace() || subject.is_on_all_workspaces())
                return;
            if (subject !== focused)
                subject.activate(global.get_current_time());
        }
        const monitor = subject ? subject.get_monitor() : this._pointerMonitor();
        const current = this._model.current(monitor);
        let destination, direction;
        if (target in DIRECTIONS) {
            direction = DIRECTIONS[target];
            destination = current + direction;
        } else {
            destination = target === 'last' ? this._model.count - 1 : Number(target) - 1;
            if (!(destination >= 0 && destination < this._model.count))
                return;
            direction = Math.sign(destination - current);
        }
        if (subject && subject.get_workspace().index() !== this._model.physical) {
            this._mutating = true;
            try {
                subject.change_workspace_by_index(this._model.physical, false);
            } finally {
                this._mutating = false;
            }
        }
        this._select(monitor, destination, {direction, carry: subject, indicator: true});
    }

    // Bring a hidden window's workspace forward on its own monitor only.
    _reveal(window) {
        if (!window || !window.get_workspace() || window.is_on_all_workspaces())
            return;
        const physical = window.get_workspace().index();
        if (physical === this._model.physical)
            return;
        const monitor = window.get_monitor();
        this._select(monitor, this._model.logical(monitor, physical));
    }

    _queueNativeSwitch() {
        if (this._mutating || this._nativeLater)
            return;
        // Run before mutter recomputes which windows are showing, once the
        // activated window has focus, so nothing flashes on other monitors.
        this._nativeLater = Meta.later_add(Meta.LaterType.RESIZE, () => {
            this._nativeLater = 0;
            this._absorbNativeSwitch();
            return GLib.SOURCE_REMOVE;
        });
    }

    /* Something activated a native workspace directly (an app raising itself,
     * a dock click). Treat it as a switch on the monitor of the window that
     * asked for focus, and keep every other monitor where it was. */
    _absorbNativeSwitch() {
        const physical = global.workspace_manager.get_active_workspace_index();
        if (physical === this._model.physical)
            return;
        const focus = global.display.focus_window;
        const monitor = focus && !focus.is_on_all_workspaces() && focus.get_workspace() &&
            focus.get_workspace().index() === physical ? focus.get_monitor() : this._pointerMonitor();
        const windows = this.windows();
        const current = this._model.current(monitor);
        const target = this._model.logical(monitor, physical);
        const transition = Main.overview.visible ? null : this._animation.prepare(
            monitor, windows, this._model, target, Math.sign(target - current) || 1);
        this._apply(this._model.nativeSwitch(monitor, physical, windows, Main.layoutManager.monitors.length));
        this._animation.play(monitor, transition);
        this._saveState();
        this._cards.queueRender();
    }

    disable() {
        if (this._nativeLater)
            Meta.later_remove(this._nativeLater);
        this._nativeLater = 0;
        this._animation.cancelAll();
        this._indicator.destroy();
        this._cards.destroy();
        for (const [object, id] of [...this._signals, ...this._workspaceSignals])
            object.disconnect(id);
        this._signals = [];
        this._workspaceSignals = [];
        this._unpatch();
        Main.wm.removeKeybinding('next');
        Main.wm.removeKeybinding('previous');
        const native = Main.wm._showWorkspaceSwitcher.bind(Main.wm);
        for (const name of BINDINGS)
            Main.wm.setCustomKeybindingHandler(name, this._oldKeybindingModes[name] ?? MODES, native);
        // Windows stay in native workspaces and remain reachable after disabling.
        this._mutter.set_boolean('dynamic-workspaces', this._oldSettings.dynamic);
        this._mutter.set_boolean('workspaces-only-on-primary', this._oldSettings.primary);
        log('[monitor-workspaces] disabled');
    }
}

function init() {
    return new MonitorWorkspaces();
}
