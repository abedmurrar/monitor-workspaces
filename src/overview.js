// SPDX-License-Identifier: GPL-2.0-or-later
const {Clutter, GLib, Graphene, Meta, Pango, Shell, St} = imports.gi;
const Main = imports.ui.main;
const DND = imports.ui.dnd;
const Background = imports.ui.background;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const {panelBounds, cardGrid} = Me.imports.overviewLayout;
const {windowSlots} = Me.imports.windowLayout;

// Logical pixels; multiplied by the display scale. CARD_RING must match the
// border plus padding of .monitor-workspaces-card in stylesheet.css.
const CARD_RING = 6;
const CARD_GAP = 28;
const LABEL_HEIGHT = 34;
const WALLPAPER_RADIUS = 9;
const WINDOW_PADDING = 12;
const ICON_SIZE = 40;
const TOOLTIP_DELAY = 350;

/* Per-monitor workspace cards that replace GNOME's single workspace strip in
 * the window-picker state of the overview. Search and the app grid stay native. */
var OverviewCards = class OverviewCards {
    constructor(controller) {
        this._controller = controller;
        this._controls = Main.overview._overview.controls;
        this._display = this._controls._workspacesDisplay;
        this._signals = [];
        this._suppressed = [];
        this._backgrounds = [];
        this._layer = null;
        this._layoutKey = null;
        this._dirty = true;
        this._idle = 0;
        // 'hidden', 'open', or 'closing' (cards fade out with the overview).
        this._state = Main.overview.visible ? 'open' : 'hidden';
        this._dragging = false;
        this._dragMonitor = null;
        this._dropHighlight = null;
        this._tooltip = null;
        this._tooltipTimer = 0;
        this._tooltipSource = null;
        this.renders = 0;

        // Keep the native workspace actors suppressed for the whole extension
        // lifetime, including search and transitions. Their visibility is not
        // the same thing as the visibility of our cards.
        this._oldUpdateViews = this._display._updateWorkspacesViews;
        const self = this;
        this._updateViews = function(...args) {
            const result = self._oldUpdateViews.apply(this, args);
            self._suppressNative();
            return result;
        };
        this._display._updateWorkspacesViews = this._updateViews;
        this._suppressNative();

        this._connect(Main.overview, 'showing', () => {
            this._state = 'open';
            if (this._layer)
                Shell.util_set_hidden_from_pick(this._layer, false);
            this.queueRender();
        });
        this._connect(Main.overview, 'hiding', () => this._beginClose());
        this._connect(Main.overview, 'hidden', () => {
            this._state = 'hidden';
            this._clear();
        });
        this._connect(this._controls._stateAdjustment, 'notify::value', () => this._syncMode());
        this._connect(this._controls._searchController, 'notify::search-active', () => this._syncMode());
        this._connect(this._controls._searchEntry.clutter_text, 'text-changed', () => this._syncMode());
        this._connect(this._controls.dash.showAppsButton, 'notify::checked', () => this._syncMode());
        this._connect(this._controls._searchEntryBin, 'notify::allocation', () => this._queueLayout());
        this._connect(this._controls.dash, 'notify::allocation', () => this._queueLayout());
        this._connect(global.display, 'workareas-changed', () => this._queueLayout());
    }

    get visible() {
        return this._state === 'open';
    }

    _connect(object, name, callback) {
        this._signals.push([object, object.connect(name, callback)]);
    }

    // Content changed: rebuild on the next frame.
    queueRender() {
        this._dirty = true;
        this._schedule();
    }

    // Something moved: rebuild only if the card areas actually changed.
    _queueLayout() {
        this._schedule();
    }

    _schedule() {
        if (this._state !== 'open' || this._idle || this._dragging)
            return;
        this._idle = Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._idle = 0;
            if (this._dragging || !this._showCards())
                return GLib.SOURCE_REMOVE;
            const bounds = this._bounds();
            const key = JSON.stringify(bounds);
            if (this._dirty || !this._layer || key !== this._layoutKey) {
                this._dirty = false;
                this._layoutKey = key;
                this._render(bounds);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _showCards() {
        return this._state === 'open' && this._controls._stateAdjustment.value <= 1.05 &&
            !this._controls._searchController.searchActive &&
            !this._controls._searchEntry.get_text().trim() &&
            !this._controls.dash.showAppsButton.checked;
    }

    _syncMode() {
        if (this._state === 'closing') {
            this._updateOpacity();
        } else if (this._state === 'open') {
            if (!this._showCards())
                this._clear();
            else if (this._layer)
                this._updateOpacity();
            else
                this.queueRender();
        }
    }

    _beginClose() {
        this._state = 'closing';
        this._hideTooltip();
        this._finishDrag();
        if (this._idle)
            Meta.later_remove(this._idle);
        this._idle = 0;
        // Fade out with the overview instead of vanishing, but take no input.
        if (this._layer)
            Shell.util_set_hidden_from_pick(this._layer, true);
    }

    _updateOpacity() {
        if (this._layer)
            this._layer.opacity = Math.round(255 * Math.min(1, this._controls._stateAdjustment.value));
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
        record.destroy = actor.connect('destroy', () => {
            record.actor = null;
        });
        this._suppressed.push(record);
        actor.opacity = 0;
    }

    _suppressNative() {
        this._suppress(this._display);
        this._suppress(this._controls._thumbnailsBox);
        for (const view of this._display._workspacesViews)
            this._suppress(view);
    }

    _restoreNative() {
        for (const record of this._suppressed) {
            if (!record.actor)
                continue;
            record.actor.disconnect(record.signal);
            record.actor.disconnect(record.destroy);
            record.actor.opacity = record.opacity;
        }
        this._suppressed = [];
    }

    _clear() {
        this._hideTooltip();
        this._finishDrag();
        // Background managers own actors inside the layer; release them first.
        for (const manager of this._backgrounds)
            manager.destroy();
        this._backgrounds = [];
        if (this._layer)
            this._layer.destroy();
        this._layer = null;
        this._layoutKey = null;
    }

    _bounds() {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const controls = [];
        for (const [actor, kind] of [[this._controls._searchEntryBin, 'search'], [this._controls.dash, 'dash']]) {
            if (!actor.mapped || !actor.visible || actor.opacity === 0)
                continue;
            const [x, y] = actor.get_transformed_position();
            const [width, height] = actor.get_transformed_size();
            controls.push({x: Math.round(x), y: Math.round(y),
                width: Math.round(width), height: Math.round(height), kind});
        }
        return Main.layoutManager.monitors.map(monitor =>
            panelBounds(Main.layoutManager.getWorkAreaForMonitor(monitor.index), scale, controls));
    }

    _render(bounds) {
        this.renders++;
        this._clear();
        this._suppressNative();
        this._layer = new St.Widget({name: 'monitor-workspaces-overview',
            x: 0, y: 0, width: global.stage.width, height: global.stage.height, reactive: false});
        Main.layoutManager.overviewGroup.add_child(this._layer);
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const windows = this._controller.windows()
            .sort((a, b) => a.id.get_stable_sequence() - b.id.get_stable_sequence());
        Main.layoutManager.monitors.forEach((monitor, index) => {
            if (bounds[index])
                this._renderMonitor(monitor, bounds[index], windows, scale);
        });
        this._updateOpacity();
    }

    _renderMonitor(monitor, bounds, windows, scale) {
        const model = this._controller.model;
        const [, x, y] = this._layer.transform_stage_point(bounds.x, bounds.y);
        const panel = new St.Widget({reactive: true, x, y, width: bounds.width, height: bounds.height});
        panel._monitorIndex = monitor.index;
        this._layer.add_child(panel);
        panel.connect('scroll-event', (_actor, event) => {
            if (!this._dragging) {
                const delta = this._controller.scrollDelta(event);
                if (delta)
                    this._controller.step(monitor.index, delta);
            }
            return Clutter.EVENT_STOP;
        });
        const slots = cardGrid(model.count, monitor.width / monitor.height,
            bounds.width, bounds.height, CARD_GAP * scale, LABEL_HEIGHT * scale);
        slots.forEach((slot, workspace) =>
            this._renderCard(panel, monitor, workspace, slot, windows, scale));
    }

    _renderCard(panel, monitor, workspace, slot, windows, scale) {
        const model = this._controller.model;
        const active = workspace === model.current(monitor.index);
        const ring = CARD_RING * scale;
        const width = slot.width - 2 * ring, height = slot.height - 2 * ring;
        const card = new St.Button({
            style_class: `monitor-workspaces-card${active ? ' active' : ''}`,
            x: slot.x, y: slot.y, width: slot.width, height: slot.height,
            can_focus: true, track_hover: true,
            accessible_name: `Workspace ${workspace + 1}${active ? ', current' : ''}`,
        });
        panel.add_child(card);
        card._workspaceDropTarget = {monitor: monitor.index, workspace, card};
        card._delegate = {
            handleDragOver: source => this._validDrag(source)
                ? DND.DragMotionResult.MOVE_DROP : DND.DragMotionResult.CONTINUE,
            acceptDrop: source => this._validDrag(source) &&
                this._controller.moveWindow(source.metaWindow, monitor.index, workspace),
        };
        card.connect('clicked', () => {
            if (this._controller.model.current(monitor.index) === workspace)
                Main.overview.hide();
            else
                this._controller.select(monitor.index, workspace);
        });

        const surface = new Clutter.Actor({width, height});
        card.set_child(surface);
        this._addWallpaper(surface, monitor, width, height, scale);

        const padding = WINDOW_PADDING * scale;
        const visible = windows.filter(w => w.monitor === monitor.index && !w.attached &&
            !w.id.skip_taskbar && w.id.get_window_type() !== Meta.WindowType.DESKTOP &&
            (w.sticky || model.logical(monitor.index, w.workspace) === workspace));
        const slots = windowSlots(visible.map(entry => entry.id.get_frame_rect()),
            width - 2 * padding, height - 2 * padding, padding);
        visible.forEach((entry, index) =>
            this._renderWindow(surface, entry.id, monitor, workspace, slots[index], padding, scale));

        panel.add_child(new St.Label({
            text: `${workspace + 1}`,
            style_class: `monitor-workspaces-label${active ? ' active' : ''}`,
            x: slot.x, y: slot.y + slot.height, width: slot.width, height: LABEL_HEIGHT * scale,
        }));
    }

    _addWallpaper(surface, monitor, width, height, scale) {
        const group = new Meta.BackgroundGroup({layout_manager: new Clutter.BinLayout(), width, height});
        surface.add_child(group);
        const manager = new Background.BackgroundManager({
            container: group, monitorIndex: monitor.index,
            controlPosition: false, useContentSize: false,
        });
        this._backgrounds.push(manager);
        // The background content works in monitor pixels, not card pixels.
        const round = () => {
            const content = manager.backgroundActor.content;
            const bounds = new Graphene.Rect();
            bounds.size.width = monitor.width;
            bounds.size.height = monitor.height;
            content.set_rounded_clip_bounds(bounds);
            content.rounded_clip_radius = WALLPAPER_RADIUS * scale * monitor.width / width;
        };
        round();
        manager.connect('changed', round);
    }

    _renderWindow(surface, window, monitor, workspace, slot, offset, scale) {
        const {width, height} = slot;
        const title = this._windowTitle(window);
        const preview = new St.Widget({x: offset + slot.x, y: offset + slot.y, width, height,
            reactive: true, track_hover: true});
        surface.add_child(preview);

        const button = new St.Button({style_class: 'monitor-workspaces-window',
            width, height, can_focus: true, accessible_name: title});
        preview.add_child(button);
        // GNOME's own layout maps the window body, not its shadow, onto the slot.
        const container = new Clutter.Actor();
        container.layout_manager = new Shell.WindowPreviewLayout();
        const clone = container.layout_manager.add_window(window);
        if (clone)
            Shell.util_set_hidden_from_pick(clone, true);
        button.set_child(container);
        // As GNOME's own previews do: go away with the window, before the
        // layout tears down its clone.
        window.get_compositor_private()?.connectObject('destroy', () => preview.destroy(), preview);

        const app = Shell.WindowTracker.get_default().get_window_app(window);
        const iconSize = Math.floor(Math.min(ICON_SIZE, width / scale * 0.4, height / scale * 0.4));
        if (app && iconSize >= 16) {
            const icon = app.create_icon_texture(iconSize);
            icon.set({reactive: false, x: Math.round((width - iconSize * scale) / 2),
                y: Math.round(height - iconSize * scale * 0.85)});
            preview.add_child(icon);
        }

        const close = new St.Button({style_class: 'window-close', visible: false,
            child: new St.Icon({icon_name: 'preview-close-symbolic'}),
            accessible_name: `Close ${title}`});
        close.add_constraint(new Clutter.AlignConstraint({source: preview,
            align_axis: Clutter.AlignAxis.X_AXIS, factor: 1}));
        preview.add_child(close);
        close.connect('clicked', () => {
            this._hideTooltip();
            window.delete(global.get_current_time());
        });

        preview.connect('notify::hover', () => {
            close.visible = preview.hover && !this._dragging;
            if (preview.hover)
                this._queueTooltip(preview, window, monitor);
            else if (this._tooltipSource === preview)
                this._hideTooltip();
        });
        preview.connect('destroy', () => {
            if (this._tooltipSource === preview)
                this._hideTooltip();
        });

        button._delegate = {
            owner: this,
            metaWindow: window,
            getDragActor: () => new Clutter.Clone({source: button, width, height}),
            getDragActorSource: () => button,
        };
        const draggable = DND.makeDraggable(button, {dragActorMaxSize: 240 * scale, dragActorOpacity: 220});
        draggable.connect('drag-begin', () => {
            close.visible = false;
            this._beginDrag();
        });
        draggable.connect('drag-cancelled', () => this._highlightDrop(null));
        draggable.connect('drag-end', () => {
            this._finishDrag();
            this.queueRender();
        });
        button.connect('clicked', () => {
            if (!this._dragging && window.get_workspace())
                this._controller.activate(window, monitor.index, workspace);
        });
    }

    _validDrag(source) {
        return source && source.owner === this && source.metaWindow &&
            source.metaWindow.get_workspace() && !source.metaWindow.is_attached_dialog();
    }

    _windowTitle(window) {
        const app = Shell.WindowTracker.get_default().get_window_app(window);
        const name = app ? app.get_name() : window.get_wm_class();
        const title = window.get_title();
        return name && title && name !== title ? `${name} — ${title}` : title || name || 'Window';
    }

    _hideTooltip() {
        if (this._tooltipTimer)
            GLib.source_remove(this._tooltipTimer);
        this._tooltipTimer = 0;
        this._tooltipSource = null;
        if (this._tooltip)
            this._tooltip.destroy();
        this._tooltip = null;
    }

    _queueTooltip(source, window, monitor) {
        this._hideTooltip();
        if (this._dragging || !this._showCards())
            return;
        this._tooltipSource = source;
        this._tooltipTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TOOLTIP_DELAY, () => {
            this._tooltipTimer = 0;
            if (!source.mapped || !source.hover || this._dragging || !window.get_workspace()) {
                this._tooltipSource = null;
                return GLib.SOURCE_REMOVE;
            }
            const label = new St.Label({text: this._windowTitle(window),
                style_class: 'monitor-workspaces-tooltip', reactive: false});
            label.clutter_text.line_wrap = true;
            label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            Main.uiGroup.add_child(label);
            this._tooltip = label;
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const margin = 12 * scale;
            const [, naturalWidth] = label.get_preferred_width(-1);
            label.width = Math.min(naturalWidth, 440 * scale, monitor.width - 2 * margin);
            const [, naturalHeight] = label.get_preferred_height(label.width);
            label.height = Math.min(naturalHeight, monitor.height - 2 * margin);
            const [x, y] = source.get_transformed_position();
            const [width, height] = source.get_transformed_size();
            const top = y - label.height - margin;
            label.set_position(
                Math.max(monitor.x + margin, Math.min(x + (width - label.width) / 2,
                    monitor.x + monitor.width - label.width - margin)),
                Math.max(monitor.y + margin, Math.min(top >= monitor.y + margin ? top : y + height + margin,
                    monitor.y + monitor.height - label.height - margin)));
            return GLib.SOURCE_REMOVE;
        });
    }

    _highlightDrop(target) {
        if (this._dropHighlight === target)
            return;
        if (this._dropHighlight)
            this._dropHighlight.card.remove_style_pseudo_class('drop-target');
        this._dropHighlight = target;
        if (target)
            target.card.add_style_pseudo_class('drop-target');
    }

    _beginDrag() {
        this._hideTooltip();
        this._dragging = true;
        this._dragMonitor = {
            dragMotion: event => {
                let actor = event.targetActor;
                while (actor && !actor._workspaceDropTarget)
                    actor = actor.get_parent();
                this._highlightDrop(actor && this._validDrag(event.source) ? actor._workspaceDropTarget : null);
                return DND.DragMotionResult.CONTINUE;
            },
        };
        DND.addDragMonitor(this._dragMonitor);
    }

    _finishDrag() {
        this._highlightDrop(null);
        if (this._dragMonitor)
            DND.removeDragMonitor(this._dragMonitor);
        this._dragMonitor = null;
        this._dragging = false;
    }

    destroy() {
        if (this._idle)
            Meta.later_remove(this._idle);
        this._idle = 0;
        this._state = 'hidden';
        this._clear();
        if (this._display._updateWorkspacesViews === this._updateViews)
            this._display._updateWorkspacesViews = this._oldUpdateViews;
        this._restoreNative();
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
    }
};
