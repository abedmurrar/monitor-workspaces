const {GLib, Gio, Shell, Clutter} = imports.gi;
const Main = imports.ui.main;
function delay(ms) { return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {resolve(); return GLib.SOURCE_REMOVE;})); }
function assert(value, message) { if (!value) throw new Error(message); log(`[monitor-test] PASS ${message}`); }
let fixtures;
async function test() {
    await delay(3000);
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    launcher.setenv('WAYLAND_DISPLAY', 'monitor-test', true);
    fixtures = launcher.spawnv(['gjs', GLib.build_filenamev([GLib.getenv('MONITOR_WORKSPACES_PROJECT'), 'tests', 'fixtures.js'])]);
    await delay(2000);
    Main.overview.hide();
    await delay(500);
    const ext = Main.extensionManager.lookup('monitor-workspaces@local').stateObj;
    assert(!!ext, 'Extension enabled');
    assert(Main.layoutManager.monitors.length === 2, 'Two monitors available');
    const find = name => global.get_window_actors().map(a => a.meta_window).find(w => w.get_title() === name);
    const leftA = find('Left A'), leftB = find('Left B'), rightA = find('Right A'), rightB = find('Right B');
    assert(!!leftA && !!leftB && !!rightA && !!rightB, 'Four real GTK test windows created');
    for (const [w, m, ws] of [[leftA, 0, 0], [leftB, 0, 1], [rightA, 1, 0], [rightB, 1, 1]]) {
        w.move_to_monitor(m);
        const mon = Main.layoutManager.monitors[m];
        w.move_frame(false, mon.x + 100, mon.y + 150);
        w.change_workspace_by_index(ws, false);
    }
    await delay(700);
    const origin = global.workspace_manager.get_active_workspace_index();
    const rightBefore = [rightA.get_workspace().index(), rightB.get_workspace().index()];
    let globalSwitches = 0;
    const signal = global.window_manager.connect('switch-workspace', () => globalSwitches++);
    Main.overview.show();
    assert(ext._controls._workspacesDisplay.opacity === 0 &&
        ext._controls._thumbnailsBox.opacity === 0 &&
        ext._controls._workspacesDisplay._workspacesViews.every(view => view.opacity === 0),
    'Native previews are suppressed synchronously before the first overview frame');
    await delay(80);
    assert(!!ext._layer, 'Cards render during the opening animation, not after it');
    await delay(1000);
    assert(!!ext._layer && ext._layer.get_n_children() === 2, 'Overview shows independent panels on both monitors');
    const searchEntry = ext._controls._searchEntry;
    const [searchX, searchY] = searchEntry.get_transformed_position();
    const [searchWidth, searchHeight] = searchEntry.get_transformed_size();
    const picked = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE,
        searchX + searchWidth / 2, searchY + searchHeight / 2);
    assert(picked === searchEntry || searchEntry.contains(picked), 'Search field receives clicks above the cards');
    const primaryPanel = ext._layer.get_child_at_index(Main.layoutManager.primaryIndex);
    const [, panelY] = primaryPanel.get_transformed_position();
    assert(panelY >= searchY + searchHeight, 'Cards do not overlap the search field');
    const panel = ext._layer.get_child_at_index(0);
    const secondCard = panel.get_child_at_index(3);
    secondCard.get_child_at_index(0).emit('clicked', 1);
    await delay(600);
    assert(ext._model.current(0) === 1, 'Overview card click selected left workspace 2');
    assert(leftB.get_workspace().index() === origin, 'Left workspace 2 window is now visible');
    assert(rightA.get_workspace().index() === rightBefore[0] && rightB.get_workspace().index() === rightBefore[1], 'Right monitor windows unchanged');
    assert(globalSwitches === 0, 'Overview click caused zero global switch animations');
    ext._step(1, 1);
    await delay(300);
    assert(ext._model.current(1) === 1 && rightB.get_workspace().index() === origin, 'Right monitor switches independently too');
    assert(leftB.get_workspace().index() === origin, 'Right switch leaves left monitor unchanged');
    const screenshot = new Shell.Screenshot();
    const stream = Gio.File.new_for_path(GLib.build_filenamev([GLib.getenv('MONITOR_WORKSPACES_OUTPUT'), 'overview.png'])).replace(null, false, Gio.FileCreateFlags.NONE, null);
    await screenshot.screenshot(false, stream);
    stream.close(null);
    log('[monitor-test] screenshot saved');
    await delay(500);
    const searchKeyboard = Clutter.get_default_backend().get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    for (const key of [Clutter.KEY_t, Clutter.KEY_e, Clutter.KEY_r, Clutter.KEY_m]) {
        searchKeyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.PRESSED);
        searchKeyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.RELEASED);
        await delay(50);
    }
    await delay(500);
    assert(ext._controls._searchEntry.get_text() === 'term', 'Typing in overview starts native app search');
    assert(ext._layer === null, 'Search releases the custom workspace overlay');
    assert(ext._controls._workspacesDisplay.opacity === 0 &&
        ext._controls._thumbnailsBox.opacity === 0 &&
        ext._controls._workspacesDisplay._workspacesViews.every(view => view.opacity === 0),
    'Search never restores workspace previews over its results');
    const searchStream = Gio.File.new_for_path(GLib.build_filenamev([
        GLib.getenv('MONITOR_WORKSPACES_OUTPUT'), 'search.png']))
        .replace(null, false, Gio.FileCreateFlags.NONE, null);
    await new Shell.Screenshot().screenshot(false, searchStream);
    searchStream.close(null);
    ext._controls._searchEntry.set_text('');
    await delay(500);
    assert(!!ext._layer, 'Workspace cards return after clearing search');
    Main.overview.hide();
    await delay(400);
    assert(ext._layer === null, 'Closing overview cleans up card actors');
    const seat = Clutter.get_default_backend().get_default_seat();
    const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const first = Main.layoutManager.monitors[0];
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), first.x + 400, first.y + 300);
    await delay(100);
    const pressArrow = async key => {
        for (const keyval of [Clutter.KEY_Control_L, Clutter.KEY_Alt_L, key])
            keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.PRESSED);
        await delay(70);
        for (const keyval of [key, Clutter.KEY_Alt_L, Clutter.KEY_Control_L])
            keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.RELEASED);
        await delay(300);
    };
    await pressArrow(Clutter.KEY_Right);
    assert(ext._model.current(0) === 2, 'Actual Ctrl+Alt+Right switches only the pointer monitor');
    await pressArrow(Clutter.KEY_Left);
    assert(ext._model.current(0) === 1 && ext._model.current(1) === 1, 'Actual Ctrl+Alt+Left returns without changing the other monitor');
    assert(globalSwitches === 0, 'Arrow shortcuts caused zero global switch animations');
    Main.overview.show();
    await delay(700);
    ext._controls.dash.showAppsButton.checked = true;
    await delay(700);
    assert(ext._layer === null, 'App grid releases the workspace overlay');
    assert(ext._controls._workspacesDisplay.opacity === 0 && ext._controls._thumbnailsBox.opacity === 0,
        'App grid keeps native previews suppressed');
    ext._controls.dash.showAppsButton.checked = false;
    await delay(700);
    assert(!!ext._layer, 'Cards return from the app grid');
    const windowButton = ext._layer.get_child_at_index(0).get_child_at_index(2).get_child_at_index(2).get_first_child();
    windowButton.emit('clicked', 1);
    await delay(600);
    assert(!Main.overview.visible && ext._model.current(0) === 0, 'Window preview click selects its workspace and exits overview');
    assert(leftA.get_workspace().index() === origin && ext._model.current(1) === 1, 'Window preview activation preserves the other monitor');
    global.window_manager.disconnect(signal);
    ext.disable();
    assert(ext._suppressed.length === 0, 'Disabling restores native actor ownership');
    assert(Main.wm.actionMoveWorkspace !== ext._action, 'Disable restores native workspace switching');
    ext.enable();
    Main.overview.show();
    await delay(700);
    assert(!!ext._layer, 'Re-enable restores functional overview');
    Main.overview.hide();
    await delay(500);
    const capture = async name => {
        const output = Gio.File.new_for_path(GLib.build_filenamev([GLib.getenv('MONITOR_WORKSPACES_OUTPUT'), `${name}.png`])).replace(null, false, Gio.FileCreateFlags.NONE, null);
        await new Shell.Screenshot().screenshot(false, output);
        output.close(null);
    };
    const rightActor = rightB.get_compositor_private();
    const rightState = [rightActor.x, rightActor.y, rightActor.opacity, rightActor.translation_x, rightActor.translation_y];
    ext._animation.duration = 1100;
    await capture('animation-before');
    ext._step(0, 1);
    await delay(180);
    assert(ext._animation.active.size === 1 && ext._animation.active.has(0), 'Slide overlay exists only on the selected monitor');
    const slide = ext._animation.active.get(0);
    assert(slide.root.clip_to_allocation && slide.root.x === first.x && slide.root.width === first.width, 'Slide is clipped to exact monitor bounds');
    assert(slide.outgoing.translation_x < 0 && slide.incoming.translation_x > 0, 'Outgoing and incoming pages slide in the expected direction');
    assert(JSON.stringify(rightState) === JSON.stringify([rightActor.x, rightActor.y, rightActor.opacity, rightActor.translation_x, rightActor.translation_y]), 'Other monitor actors are not transformed or hidden');
    await capture('animation-during');
    await delay(1200);
    assert(ext._animation.active.size === 0, 'Animation releases overlays after completion');
    await capture('animation-after');
    ext._step(0, 1);
    await delay(90);
    ext._step(0, 1);
    await delay(90);
    assert(ext._animation.active.size === 1, 'Rapid repeated switches replace the previous overlay');
    ext._step(1, -1);
    await delay(100);
    assert(ext._animation.active.size === 2, 'Different monitors can animate independently at the same time');
    Main.overview.show();
    await delay(300);
    assert(ext._animation.active.size === 0, 'Opening overview cancels desktop slide overlays');
    Main.overview.hide();
    await delay(400);
    const interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    interfaceSettings.set_boolean('enable-animations', false);
    await delay(100);
    ext._step(0, -1);
    assert(ext._animation.active.size === 0, 'Reduced-motion preference skips the animation');
    interfaceSettings.set_boolean('enable-animations', true);
    await delay(100);
    ext._step(0, 1);
    assert(ext._animation.active.size === 1, 'Animation starts again when enabled');
    ext.disable();
    assert(ext._animation.active.size === 0, 'Disabling mid-animation removes overlays');
    ext.enable();
    Main.overview.show();
    await delay(600);
    ext._select(0, 1);
    ext._select(1, 2);
    ext._moveWindow(leftA, 0, 0);
    await delay(500);
    const cursors = [ext._model.current(0), ext._model.current(1)];
    const unchanged = [leftB, rightA, rightB].map(w => [w.get_monitor(), w.get_workspace().index()]);
    const findActor = (actor, predicate) => {
        if (predicate(actor)) return actor;
        for (const child of actor.get_children()) {
            const match = findActor(child, predicate);
            if (match) return match;
        }
        return null;
    };
    const dragWindow = async (window, monitor, workspace, cancel = false) => {
        const source = findActor(ext._layer, a => a._delegate?.metaWindow === window);
        const target = findActor(ext._layer, a => a._workspaceDropTarget?.monitor === monitor &&
            a._workspaceDropTarget.workspace === workspace);
        assert(!!source && !!target, 'Drag source preview and destination card exist');
        const [sx, sy] = source.get_transformed_position();
        const [sw, sh] = source.get_transformed_size();
        const [tx, ty] = target.get_transformed_position();
        const [tw] = target.get_transformed_size();
        const startX = sx + sw / 2, startY = sy + sh / 2;
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), startX, startY);
        await delay(80);
        pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.PRESSED);
        await delay(80);
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), startX + 45, startY + 10);
        await delay(100);
        assert(ext._dragging, 'Real pointer movement starts GNOME drag-and-drop');
        const layer = ext._layer;
        ext._queueRender();
        await delay(50);
        assert(ext._layer === layer, 'Preview tree remains stable during a drag');
        for (let step = 1; step <= 8; step++) {
            pointer.notify_absolute_motion(GLib.get_monotonic_time(),
                startX + (tx + tw / 2 - startX) * step / 8,
                startY + (ty + 18 - startY) * step / 8);
            await delay(30);
        }
        await delay(80);
        assert(ext._dropHighlight?.monitor === monitor && ext._dropHighlight.workspace === workspace,
            'Destination workspace is highlighted during hover');
        if (cancel) {
            keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Escape, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Escape, Clutter.KeyState.RELEASED);
            await delay(300);
        }
        pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED);
        await delay(500);
        assert(!ext._dragging && !ext._dragMonitor && !ext._dropHighlight, 'Drag state and highlight clean up');
        assert(Main.overview.visible, 'Dropping a window keeps overview open');
    };
    await dragWindow(leftA, 0, 2);
    assert(leftA.get_monitor() === 0 && ext._model.logical(0, leftA.get_workspace().index()) === 2,
        'Real drop moves a window between workspaces on the same monitor');
    await dragWindow(leftA, 1, 0);
    assert(leftA.get_monitor() === 1 && ext._model.logical(1, leftA.get_workspace().index()) === 0,
        'Cross-monitor drop uses the destination monitor logical workspace');
    await dragWindow(leftA, 0, 1, true);
    assert(leftA.get_monitor() === 1 && ext._model.logical(1, leftA.get_workspace().index()) === 0,
        'Escape cancels a drag without moving the window');
    assert(JSON.stringify(cursors) === JSON.stringify([ext._model.current(0), ext._model.current(1)]),
        'Drops do not change either monitor selected workspace');
    assert(JSON.stringify(unchanged) === JSON.stringify([leftB, rightA, rightB].map(w => [w.get_monitor(), w.get_workspace().index()])),
        'Dragging one window does not move other windows');
    Main.overview.hide();
    log('[monitor-test] ALL TESTS PASSED');
}
function init() { return {enable() {test().catch(e => logError(e, '[monitor-test] FAILED'));}, disable() {if(fixtures) fixtures.force_exit();}}; }
