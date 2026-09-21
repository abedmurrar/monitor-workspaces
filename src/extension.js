const {Clutter, Gio, GLib, Meta, Shell, St} = imports.gi;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const {MonitorModel, wrap} = Me.imports.model;
const {MonitorAnimation} = Me.imports.animation;
const {panelBounds} = Me.imports.overviewLayout;

class MonitorWorkspaces {
    enable() {
        this._signals = [];
        this._animation = new MonitorAnimation();
        this._mutating = false;
        this._idle = 0;
        this._layer = null;
        this._suppressed = [];
        this._overviewOpen = false;
        this._settings = ExtensionUtils.getSettings();
        this._mutter = new Gio.Settings({schema_id: 'org.gnome.mutter'});
        this._wmPrefs = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
        this._oldSettings = {
            dynamic: this._mutter.get_boolean('dynamic-workspaces'),
            primary: this._mutter.get_boolean('workspaces-only-on-primary'),
        };
        this._mutter.set_boolean('dynamic-workspaces', false);
        this._mutter.set_boolean('workspaces-only-on-primary', false);
        this._model = new MonitorModel(global.workspace_manager.n_workspaces,
            global.workspace_manager.get_active_workspace_index());
        this._controls = Main.overview._overview.controls;
        // Keep the native workspace actors suppressed for the whole extension
        // lifetime, including search and transitions. Their visibility is not
        // the same thing as the visibility of our cards.
        this._display = this._controls._workspacesDisplay;
        this._oldUpdateViews = this._display._updateWorkspacesViews;
        const self = this;
        this._updateViews = function(...args) {
            const result = self._oldUpdateViews.apply(this, args);
            self._suppressNativeOverview();
            return result;
        };
        this._display._updateWorkspacesViews = this._updateViews;
        this._suppressNativeOverview();

        this._connect(Main.overview, 'showing', () => {
            this._animation.cancelAll();
            this._overviewOpen = true;
            this._queueRender();
        });
        this._connect(Main.overview, 'shown', () => this._queueRender());
        this._connect(Main.overview, 'hiding', () => {
            this._overviewOpen = false;
            this._clearOverview();
        });
        this._connect(this._controls._stateAdjustment, 'notify::value', () => this._syncMode());
        this._connect(this._controls._searchController, 'notify::search-active', () => this._syncMode());
        this._connect(this._controls._searchEntry.clutter_text, 'text-changed', () => this._syncMode());
        this._connect(this._controls.dash.showAppsButton, 'notify::checked', () => this._syncMode());
        this._connect(this._controls._searchEntryBin, 'notify::allocation', () => this._queueRender());
        this._connect(global.workspace_manager, 'active-workspace-changed', () => this._nativeSwitch());
        this._connect(global.workspace_manager, 'notify::n-workspaces', () => {
            this._animation.cancelAll();
            this._model.count = global.workspace_manager.n_workspaces;
            this._model.physical = global.workspace_manager.get_active_workspace_index();
            this._queueRender();
        });
        this._connect(Main.layoutManager, 'monitors-changed', () => {
            this._animation.cancelAll();
            // Re-enumeration may change monitor indices. Rebase without moving windows.
            this._model = new MonitorModel(global.workspace_manager.n_workspaces,
                global.workspace_manager.get_active_workspace_index());
            this._queueRender();
        });
        this._connect(global.display, 'window-created', () => this._queueRender());
        this._connect(global.display, 'window-entered-monitor', () => this._queueRender());

        this._oldAction = Main.wm.actionMoveWorkspace;
        const extension = this;
        this._action = function(workspace) {
            if (!Main.sessionMode.hasWorkspaces)
                return;
            const physical = global.workspace_manager.get_active_workspace_index();
            const delta = workspace.index() - physical;
            if (delta)
                extension._step(extension._pointerMonitor(), delta);
        };
        Main.wm.actionMoveWorkspace = this._action;
        this._directionKeys = [
            ['switch-to-workspace-left', -1], ['switch-to-workspace-right', 1],
            ['switch-to-workspace-up', -1], ['switch-to-workspace-down', 1],
        ];
        for (const [name, delta] of this._directionKeys)
            Main.wm.setCustomKeybindingHandler(name, Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                () => this._step(this._pointerMonitor(), delta));
        Main.wm.addKeybinding('next', this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this._step(this._pointerMonitor(), 1));
        Main.wm.addKeybinding('previous', this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this._step(this._pointerMonitor(), -1));
        log('[monitor-workspaces] enabled');
    }

    _connect(object, name, callback) {
        this._signals.push([object, object.connect(name, callback)]);
    }

    _pointerMonitor() {
        const [x, y] = global.get_pointer();
        const index = Main.layoutManager.monitors.findIndex(m =>
            x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height);
        return index < 0 ? Main.layoutManager.primaryIndex : index;
    }

    _windows() {
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

    _select(monitor, target, direction = 0) {
        const current = this._model.current(monitor);
        target = wrap(target, this._model.count);
        if (current === target)
            return;
        const windows = this._windows();
        const transition = this._overviewOpen ? null : this._animation.prepare(
            monitor, windows, this._model, target, direction || Math.sign(target - current));
        try {
            this._apply(this._model.select(monitor, target, windows));
            this._animation.play(monitor, transition);
        } catch (error) {
            this._animation.cancel(monitor);
            throw error;
        }
        this._queueRender();
    }

    _step(monitor, delta) {
        this._select(monitor, this._model.current(monitor) + delta, Math.sign(delta));
    }

    _nativeSwitch() {
        if (this._mutating)
            return;
        const physical = global.workspace_manager.get_active_workspace_index();
        if (physical === this._model.physical)
            return;
        this._animation.cancelAll();
        this._apply(this._model.nativeSwitch(this._pointerMonitor(), physical, this._windows(),
            Main.layoutManager.monitors.length));
        this._queueRender();
    }

    _showCards() {
        return this._overviewOpen && this._controls._stateAdjustment.value <= 1.05 &&
            !this._controls._searchController.searchActive &&
            !this._controls._searchEntry.get_text().trim() &&
            !this._controls.dash.showAppsButton.checked;
    }

    _syncMode() {
        if (!this._overviewOpen)
            return;
        if (this._showCards())
            this._layer ? this._updateCardOpacity() : this._queueRender();
        else
            this._clearOverview();
    }

    _queueRender() {
        if (!this._overviewOpen || this._idle)
            return;
        this._idle = Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._idle = 0;
            if (this._showCards())
                this._render();
            return GLib.SOURCE_REMOVE;
        });
    }

    _suppress(actor) {
        this._suppressed = this._suppressed.filter(entry => entry.actor);
        if (!actor || this._suppressed.some(entry => entry.actor === actor))
            return;
        const record = {actor, opacity: actor.opacity, signal: 0, destroy: 0};
        record.signal = actor.connect('notify::opacity', () => {
            if (actor.opacity !== 0) {
                record.opacity = actor.opacity;
                actor.opacity = 0;
            }
        });
        record.destroy = actor.connect('destroy', () => {record.actor = null;});
        this._suppressed.push(record);
        actor.opacity = 0;
    }

    _clearOverview() {
        if (this._layer) {
            this._layer.destroy();
            this._layer = null;
        }
    }

    _restoreNativeOverview() {
        for (const record of this._suppressed) {
            if (!record.actor)
                continue;
            record.actor.disconnect(record.signal);
            record.actor.disconnect(record.destroy);
            record.actor.opacity = record.opacity;
        }
        this._suppressed = [];
    }

    _suppressNativeOverview() {
        this._suppress(this._display);
        this._suppress(this._controls._thumbnailsBox);
        for (const view of this._display._workspacesViews)
            this._suppress(view);
    }

    _updateCardOpacity() {
        if (this._layer)
            this._layer.opacity = Math.round(255 * Math.min(1, this._controls._stateAdjustment.value));
    }

    _render() {
        if (this._layer)
            this._layer.destroy();
        this._suppressNativeOverview();
        this._layer = new St.Widget({name: 'monitor-workspaces-overview',
            x: 0, y: 0, width: global.stage.width, height: global.stage.height,
            reactive: false});
        Main.layoutManager.overviewGroup.add_child(this._layer);
        const windows = this._windows();
        for (const monitor of Main.layoutManager.monitors)
            this._renderMonitor(monitor, windows);
        this._updateCardOpacity();
    }

    _renderMonitor(monitor, windows) {
        const area = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const controls = [];
        for (const [actor, kind] of [[this._controls._searchEntryBin, 'search'],
            [this._controls.dash, 'dash']]) {
            if (!actor.mapped || !actor.visible || actor.opacity === 0)
                continue;
            const [x, y] = actor.get_transformed_position();
            const [width, height] = actor.get_transformed_size();
            controls.push({x, y, width, height, kind});
        }
        const bounds = panelBounds(area, scale, controls);
        if (!bounds)
            return;
        const [, localX, localY] = this._layer.transform_stage_point(bounds.x, bounds.y);
        const panel = new St.Widget({reactive: true, x: localX, y: localY,
            width: bounds.width, height: bounds.height, clip_to_allocation: true});
        this._layer.add_child(panel);
        panel.add_child(new St.Label({text: `Monitor ${monitor.index + 1}  ·  Workspace ${this._model.current(monitor.index) + 1}`,
            style_class: 'monitor-workspaces-heading'}));
        panel.add_child(new St.Label({text: 'Choose a workspace · Click a window to open it', y: 30,
            style_class: 'monitor-workspaces-hint'}));
        let lastScroll = 0;
        panel.connect('scroll-event', (_actor, event) => {
            if (event.get_time() - lastScroll < 180)
                return Clutter.EVENT_STOP;
            const direction = event.get_scroll_direction();
            const delta = direction === Clutter.ScrollDirection.UP || direction === Clutter.ScrollDirection.LEFT ? -1 :
                direction === Clutter.ScrollDirection.DOWN || direction === Clutter.ScrollDirection.RIGHT ? 1 : 0;
            if (delta) {
                lastScroll = event.get_time();
                this._step(monitor.index, delta);
            }
            return Clutter.EVENT_STOP;
        });
        const count = this._model.count;
        const columns = Math.min(count, 3);
        const rows = Math.ceil(count / columns);
        const gap = 18;
        const width = Math.floor((panel.width - (columns - 1) * gap) / columns);
        const height = Math.min(Math.floor((panel.height - 62 - (rows - 1) * gap) / rows),
            Math.round(width * area.height / area.width) + 65);
        for (let workspace = 0; workspace < count; workspace++) {
            const card = new St.Widget({x: (workspace % columns) * (width + gap),
                y: 62 + Math.floor(workspace / columns) * (height + gap), width, height});
            panel.add_child(card);
            const active = workspace === this._model.current(monitor.index);
            const button = new St.Button({style_class: `monitor-workspaces-card${active ? ' active' : ''}`,
                width, height, can_focus: true, accessible_name: `Monitor ${monitor.index + 1}, workspace ${workspace + 1}`});
            card.add_child(button);
            button.connect('clicked', () => {
                if (this._model.current(monitor.index) === workspace)
                    Main.overview.hide();
                else
                    this._select(monitor.index, workspace);
            });
            card.add_child(new St.Label({text: `${workspace + 1}${active ? '  ·  Active' : ''}`,
                x: 14, y: 10, style_class: 'monitor-workspaces-title'}));
            const content = new St.Widget({x: 10, y: 40, width: width - 20, height: height - 50,
                clip_to_allocation: true});
            card.add_child(content);
            const visible = windows.filter(w => w.monitor === monitor.index && !w.attached &&
                !w.id.skip_taskbar && (w.sticky || this._model.logical(monitor.index, w.workspace) === workspace));
            if (!visible.length)
                content.add_child(new St.Label({text: 'Empty workspace', x: 8, y: 12, style_class: 'monitor-workspaces-hint'}));
            for (const entry of visible)
                this._renderWindow(content, entry.id, monitor, workspace);
        }
    }

    _renderWindow(content, window, monitor, workspace) {
        const rect = window.get_frame_rect();
        const scale = Math.min(content.width / monitor.width, content.height / monitor.height);
        const x = Math.max(0, (rect.x - monitor.x) * scale);
        const y = Math.max(0, (rect.y - monitor.y) * scale);
        const width = Math.max(24, Math.min(content.width - x, rect.width * scale));
        const height = Math.max(20, Math.min(content.height - y, rect.height * scale));
        const button = new St.Button({x, y, width, height, can_focus: true,
            style_class: 'monitor-workspaces-window', accessible_name: window.get_title() || 'Window'});
        content.add_child(button);
        const actor = window.get_compositor_private();
        if (actor) {
            const clone = new Clutter.Clone({source: actor, reactive: false});
            button.set_child(clone);
        }
        button.connect('clicked', () => {
            if (!window.get_workspace())
                return;
            this._select(monitor.index, workspace);
            Main.overview.hide();
            window.unminimize();
            window.activate(global.get_current_time());
        });
    }

    disable() {
        this._animation.cancelAll();
        this._overviewOpen = false;
        if (this._idle)
            Meta.later_remove(this._idle);
        this._idle = 0;
        this._clearOverview();
        if (this._display._updateWorkspacesViews === this._updateViews)
            this._display._updateWorkspacesViews = this._oldUpdateViews;
        this._restoreNativeOverview();
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        Main.wm.removeKeybinding('next');
        Main.wm.removeKeybinding('previous');
        for (const [name] of this._directionKeys)
            Main.wm.setCustomKeybindingHandler(name, Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                Main.wm._showWorkspaceSwitcher.bind(Main.wm));
        if (Main.wm.actionMoveWorkspace === this._action)
            Main.wm.actionMoveWorkspace = this._oldAction;
        // Windows stay in native workspaces and remain reachable after disabling.
        this._mutter.set_boolean('dynamic-workspaces', this._oldSettings.dynamic);
        this._mutter.set_boolean('workspaces-only-on-primary', this._oldSettings.primary);
        log('[monitor-workspaces] disabled');
    }
}

function init() {
    return new MonitorWorkspaces();
}
