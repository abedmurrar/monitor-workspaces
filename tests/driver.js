const {GLib, Gio, Shell, Clutter} = imports.gi;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
function delay(ms) { return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {resolve(); return GLib.SOURCE_REMOVE;})); }
function assert(value, message) { if (!value) throw new Error(message); log(`[monitor-test] PASS ${message}`); }
function findActor(actor, predicate) {
    if (!actor) return null;
    if (predicate(actor)) return actor;
    for (const child of actor.get_children()) {
        const match = findActor(child, predicate);
        if (match) return match;
    }
    return null;
}
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
    const cards = () => ext._cards;
    const controls = () => ext._cards._controls;
    const layer = () => ext._cards._layer;
    const card = (monitor, workspace) => findActor(layer(), a => a._workspaceDropTarget?.monitor === monitor &&
        a._workspaceDropTarget.workspace === workspace);
    const preview = window => findActor(layer(), a => a._delegate?.metaWindow === window);
    assert(!!ext, 'Extension enabled');
    assert(Main.layoutManager.monitors.length === 3, 'Three monitors available, one of them portrait');
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
    const rendersBefore = cards().renders;
    Main.overview.show();
    assert(controls()._workspacesDisplay.opacity === 0 &&
        controls()._thumbnailsBox.opacity === 0 &&
        controls()._workspacesDisplay._workspacesViews.every(view => view.opacity === 0),
    'Native previews are suppressed synchronously before the first overview frame');
    await delay(80);
    assert(!!layer(), 'Cards render during the opening animation, not after it');
    await delay(1000);
    const openRenders = cards().renders - rendersBefore;
    log(`[monitor-test] METRIC card rebuilds while opening the overview: ${openRenders}`);
    assert(openRenders <= 2, `Opening the overview rebuilds the cards at most twice (was ${openRenders})`);
    assert(!!layer() && layer().get_n_children() === 3, 'Overview shows independent panels on all three monitors');
    const searchEntry = controls()._searchEntry;
    const [searchX, searchY] = searchEntry.get_transformed_position();
    const [searchWidth, searchHeight] = searchEntry.get_transformed_size();
    const picked = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE,
        searchX + searchWidth / 2, searchY + searchHeight / 2);
    assert(picked === searchEntry || searchEntry.contains(picked), 'Search field receives clicks above the cards');
    const primaryPanel = layer().get_child_at_index(Main.layoutManager.primaryIndex);
    const [, panelY] = primaryPanel.get_transformed_position();
    assert(panelY >= searchY + searchHeight, 'Cards do not overlap the search field');
    const portraitCard = card(2, 0);
    assert(!!portraitCard && portraitCard.height > portraitCard.width, 'Portrait monitor gets portrait cards');
    assert(cards()._backgrounds.length === 9, 'Every card shows its monitor wallpaper');
    assert(!!findActor(preview(leftA).get_parent(), a => a.style_class === 'window-close'),
        'Window previews carry a close button');
    const clickTarget = preview(leftA);
    const [px, py] = clickTarget.get_transformed_position();
    const [pw, ph] = clickTarget.get_transformed_size();
    const pickedPreview = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, px + pw / 2, py + ph / 2);
    assert(pickedPreview === clickTarget || clickTarget.contains(pickedPreview), 'Window previews receive clicks');
    card(0, 1).emit('clicked', 1);
    await delay(600);
    assert(ext._model.current(0) === 1, 'Overview card click selected left workspace 2');
    assert(leftB.get_workspace().index() === origin, 'Left workspace 2 window is now visible');
    assert(rightA.get_workspace().index() === rightBefore[0] && rightB.get_workspace().index() === rightBefore[1], 'Right monitor windows unchanged');
    assert(globalSwitches === 0, 'Overview click caused zero global switch animations');
    ext._step(1, 1);
    await delay(300);
    assert(ext._model.current(1) === 1 && rightB.get_workspace().index() === origin, 'Right monitor switches independently too');
    assert(leftB.get_workspace().index() === origin, 'Right switch leaves left monitor unchanged');
    const capture = async name => {
        const output = Gio.File.new_for_path(GLib.build_filenamev([GLib.getenv('MONITOR_WORKSPACES_OUTPUT'), `${name}.png`])).replace(null, false, Gio.FileCreateFlags.NONE, null);
        await new Shell.Screenshot().screenshot(false, output);
        output.close(null);
    };
    await capture('overview');
    log('[monitor-test] screenshot saved');
    await delay(500);
    const seat = Clutter.get_default_backend().get_default_seat();
    const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const pointAt = async (x, y) => {
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
        await delay(100);
    };
    // Smooth (high-resolution) scrolling over a monitor's cards.
    const [rx, ry] = layer().get_child_at_index(1).get_transformed_position();
    await pointAt(rx + 10, ry + 10);
    const scrollStart = ext._model.current(1);
    // Virtual devices speak libinput units: Clutter receives a tenth (0.3 here).
    for (let i = 0; i < 4; i++) {
        pointer.notify_scroll_continuous(GLib.get_monotonic_time(), 0, 3, Clutter.ScrollSource.FINGER, Clutter.ScrollFinishFlags.NONE);
        await delay(20);
    }
    await delay(300);
    assert(ext._model.current(1) === (scrollStart + 1) % 3, 'Smooth scrolling over cards accumulates into exactly one switch');
    ext._select(1, 1);
    await delay(300);
    const typeKeys = async keys => {
        for (const key of keys) {
            keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.RELEASED);
            await delay(50);
        }
    };
    await typeKeys([Clutter.KEY_t, Clutter.KEY_e, Clutter.KEY_r, Clutter.KEY_m]);
    await delay(500);
    assert(controls()._searchEntry.get_text() === 'term', 'Typing in overview starts native app search');
    assert(layer() === null, 'Search releases the custom workspace overlay');
    assert(controls()._workspacesDisplay.opacity === 0 &&
        controls()._thumbnailsBox.opacity === 0 &&
        controls()._workspacesDisplay._workspacesViews.every(view => view.opacity === 0),
    'Search never restores workspace previews over its results');
    await capture('search');
    controls()._searchEntry.set_text('');
    await delay(500);
    assert(!!layer(), 'Workspace cards return after clearing search');
    Main.overview.hide();
    await delay(90);
    assert(!!layer() && layer().opacity > 0 && layer().opacity < 255, 'Cards fade out with the overview instead of vanishing');
    await delay(500);
    assert(layer() === null, 'Closing overview cleans up card actors');
    assert(cards()._backgrounds.length === 0, 'Closing overview releases wallpaper actors');
    const first = Main.layoutManager.monitors[0];
    await pointAt(first.x + 400, first.y + 300);
    const press = async (keys, hold = 70) => {
        for (const keyval of keys)
            keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.PRESSED);
        await delay(hold);
        for (const keyval of [...keys].reverse())
            keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.RELEASED);
        await delay(300);
    };
    const pressArrow = key => press([Clutter.KEY_Control_L, Clutter.KEY_Alt_L, key]);
    await pressArrow(Clutter.KEY_Right);
    assert(ext._model.current(0) === 2, 'Actual Ctrl+Alt+Right switches only the pointer monitor');
    const popup = ext._indicator._popups.get(0);
    assert(!!popup && popup.box.visible && popup.box.opacity === 255 && !ext._indicator._popups.has(1),
        'Keyboard switch shows the workspace indicator on that monitor only');
    await capture('indicator');
    await pressArrow(Clutter.KEY_Left);
    assert(ext._model.current(0) === 1 && ext._model.current(1) === 1, 'Actual Ctrl+Alt+Left returns without changing the other monitor');
    assert(globalSwitches === 0, 'Arrow shortcuts caused zero global switch animations');
    await delay(1100);
    assert(!popup.box.visible, 'Workspace indicator hides itself');

    // Numbered shortcuts address monitor-local numbers, whatever the native index.
    await press([Clutter.KEY_Super_L, Clutter.KEY_End]);
    assert(ext._model.current(0) === 2, 'Super+End selects the last workspace on the pointer monitor');
    await press([Clutter.KEY_Super_L, Clutter.KEY_Home]);
    assert(ext._model.current(0) === 0 && ext._model.current(1) === 1, 'Super+Home selects workspace 1 on the pointer monitor only');
    ext._select(0, 1);
    await delay(300);

    // Move the focused window along with a switch.
    leftB.activate(global.get_current_time());
    await delay(200);
    const rightWorkspaces = () => [rightA, rightB].map(w => w.get_workspace().index()).join();
    const rightSnapshot = rightWorkspaces();
    await press([Clutter.KEY_Shift_L, Clutter.KEY_Control_L, Clutter.KEY_Alt_L, Clutter.KEY_Right]);
    assert(ext._model.current(0) === 2 && leftB.get_workspace().index() === ext._model.physical,
        'Shift+Ctrl+Alt+Right carries the focused window to the next workspace and stays on it');
    assert(ext._model.logical(0, leftA.get_workspace().index()) === 0, 'Moving a window leaves the others in place');
    assert(rightWorkspaces() === rightSnapshot && ext._model.current(1) === 1, 'Moving a window leaves the other monitor alone');
    assert(globalSwitches === 0, 'Moving a window caused zero global switch animations');
    await delay(300);
    ext._select(0, 1);
    await delay(300);
    // The same shortcut on a secondary monitor, with the focused window there.
    const secondary = Main.layoutManager.monitors[1];
    await pointAt(secondary.x + 1000, secondary.y + 700);
    rightB.activate(global.get_current_time());
    await delay(200);
    await press([Clutter.KEY_Shift_L, Clutter.KEY_Control_L, Clutter.KEY_Alt_L, Clutter.KEY_Right]);
    assert(ext._model.current(1) === 2 && rightB.get_workspace().index() === ext._model.physical,
        'Shift+Ctrl+Alt+Right works for a window on a secondary monitor');
    assert(ext._model.current(0) === 1, 'Moving a secondary-monitor window leaves the primary monitor alone');
    ext.moveWindow(rightB, 1, 1);
    ext._select(1, 1);
    await delay(300);
    // Click-to-focus: focus stays on the primary while the pointer is on monitor 2.
    // The shortcut follows the pointer, like every other one, and takes the
    // window used most recently there.
    rightB.activate(global.get_current_time());
    await delay(100);
    leftB.activate(global.get_current_time());
    await delay(200);
    const leftSnapshot = [leftA, leftB].map(w => w.get_workspace().index()).join();
    await press([Clutter.KEY_Shift_L, Clutter.KEY_Control_L, Clutter.KEY_Alt_L, Clutter.KEY_Right]);
    assert(ext._model.current(1) === 2 && rightB.get_workspace().index() === ext._model.physical &&
        global.display.focus_window === rightB,
    'With focus on another monitor, the move shortcut takes the pointer monitor\'s last-used window and focuses it');
    assert(ext._model.current(0) === 1 && [leftA, leftB].map(w => w.get_workspace().index()).join() === leftSnapshot,
        'The focused window\'s monitor is left alone');
    ext.moveWindow(rightB, 1, 1);
    ext._select(1, 1);
    await delay(300);

    // Super+scroll on the desktop, discrete and smooth, at both ends of the native range.
    const second = Main.layoutManager.monitors[1];
    await pointAt(second.x + 1000, second.y + 700);
    keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
    await delay(80);
    const seen = [];
    for (let i = 0; i < 4; i++) {
        pointer.notify_discrete_scroll(GLib.get_monotonic_time(), Clutter.ScrollDirection.DOWN, Clutter.ScrollSource.WHEEL);
        await delay(220);
        seen.push(ext._model.current(1));
    }
    pointer.notify_scroll_continuous(GLib.get_monotonic_time(), 0, -10, Clutter.ScrollSource.WHEEL, Clutter.ScrollFinishFlags.NONE);
    await delay(220);
    seen.push(ext._model.current(1));
    keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
    await delay(300);
    assert(seen.join() === '2,0,1,2,1', `Super+scroll steps and wraps on the pointer monitor (${seen.join()})`);
    assert(ext._model.current(0) === 1 && globalSwitches === 0, 'Super+scroll leaves other monitors alone without global switches');
    ext._select(1, 1);
    await delay(300);

    // Alt+Tab and notifications go through Main.activateWindow.
    const leftVisible = () => [leftA, leftB].map(w => w.get_workspace().index() === ext._model.physical).join();
    const leftState = leftVisible();
    ext._select(1, 0);
    await delay(300);
    assert(rightB.get_workspace().index() !== ext._model.physical, 'Right B is hidden before activation');
    Main.activateWindow(rightB);
    await delay(400);
    assert(rightB.get_workspace().index() === ext._model.physical && ext._model.current(1) === 1,
        'Activating a hidden window reveals its workspace on its own monitor');
    assert(leftVisible() === leftState && globalSwitches === 0, 'Activating a window leaves other monitors alone without global switches');

    // A native activation (an app raising itself, a dock click) is absorbed per monitor.
    ext._select(1, 0);
    // Pointer on the other monitor: the switch must follow the focused window.
    await pointAt(first.x + 1000, first.y + 700);
    const nativeTarget =global.workspace_manager.get_workspace_by_index(rightB.get_workspace().index());
    nativeTarget.activate_with_focus(rightB, global.get_current_time());
    await delay(80);
    assert(!Main.wm._switchInProgress && !Main.wm._workspaceAnimation._switchData,
        'GNOME\'s all-monitor slide does not play for native switches');
    await delay(400);
    assert(rightB.get_workspace().index() === global.workspace_manager.get_active_workspace_index() &&
        ext._model.physical === global.workspace_manager.get_active_workspace_index(),
    'A natively activated window ends up visible');
    assert(ext._model.current(1) === 1 && leftVisible() === leftState,
        'A native switch only changes the monitor of the activated window');
    globalSwitches = 0;

    // Monitors re-enumerating (waking from sleep) keep each monitor's numbering.
    const cursors = () => [0, 1, 2].map(i => ext._model.current(i)).join();
    ext._select(2, 2);
    await delay(300);
    const beforeRebuild = cursors();
    Main.layoutManager.emit('monitors-changed');
    await delay(200);
    assert(cursors() === beforeRebuild, `Monitor re-enumeration keeps each monitor's workspace number (${beforeRebuild})`);

    // Locking the screen must not disturb anything.
    const workspaces = () => global.get_window_actors().map(a => a.meta_window)
        .filter(w => w.get_workspace()).map(w => `${w.get_title()}:${w.get_workspace().index()}:${w.is_on_all_workspaces()}`).sort().join();
    const beforeLock = workspaces();
    const enabledObject = ext;
    Main.sessionMode.pushMode('unlock-dialog');
    await delay(500);
    assert(Main.extensionManager.lookup('monitor-workspaces@local').state === ExtensionUtils.ExtensionState.ENABLED,
        'The extension stays enabled on the lock screen');
    Main.sessionMode.popMode('unlock-dialog');
    await delay(800);
    assert(Main.extensionManager.lookup('monitor-workspaces@local').stateObj === enabledObject, 'Same extension instance after unlocking');
    assert(workspaces() === beforeLock, 'Lock and unlock keep every window on its workspace');
    assert(cursors() === beforeRebuild, 'Lock and unlock keep every monitor\'s workspace number');

    Main.overview.show();
    await delay(700);
    controls().dash.showAppsButton.checked = true;
    await delay(700);
    assert(layer() === null, 'App grid releases the workspace overlay');
    assert(controls()._workspacesDisplay.opacity === 0 && controls()._thumbnailsBox.opacity === 0,
        'App grid keeps native previews suppressed');
    controls().dash.showAppsButton.checked = false;
    await delay(700);
    assert(!!layer(), 'Cards return from the app grid');
    ext._select(0, 0);
    await delay(400);
    preview(leftA).emit('clicked', 1);
    await delay(600);
    assert(!Main.overview.visible && ext._model.current(0) === 0, 'Window preview click selects its workspace and exits overview');
    assert(leftA.get_workspace().index() === ext._model.physical && ext._model.current(1) === 1, 'Window preview activation preserves the other monitor');
    global.window_manager.disconnect(signal);
    const beforeDisable = cursors();
    const oldCards = ext._cards;
    ext.disable();
    assert(oldCards._suppressed.length === 0, 'Disabling restores native actor ownership');
    assert(!Object.prototype.hasOwnProperty.call(Main.wm, 'actionMoveWorkspace') &&
        !Object.prototype.hasOwnProperty.call(Main.wm, 'handleWorkspaceScroll') &&
        !Object.prototype.hasOwnProperty.call(Main.wm._workspaceAnimation, 'animateSwitch') &&
        Main.activateWindow.toString().includes('activate_with_focus'),
    'Disable restores native workspace switching and window activation');
    ext.enable();
    assert(cursors() === beforeDisable, 'Re-enabling keeps each monitor\'s workspace number');
    Main.overview.show();
    await delay(700);
    assert(!!layer(), 'Re-enable restores functional overview');
    Main.overview.hide();
    await delay(500);
    for (const [w, ws] of [[leftA, 0], [leftB, 1], [rightA, 0], [rightB, 1]])
        w.change_workspace_by_index(ext._model.storage(w.get_monitor(), ws), false);
    await delay(300);
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
    await delay(600);
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
    ext.moveWindow(leftA, 0, 0);
    await delay(500);
    const selected = [ext._model.current(0), ext._model.current(1)];
    const unchanged = [leftB, rightA, rightB].map(w => [w.get_monitor(), w.get_workspace().index()]);
    const dragWindow = async (window, monitor, workspace, cancel = false) => {
        const source = preview(window);
        const target = card(monitor, workspace);
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
        assert(cards()._dragging, 'Real pointer movement starts GNOME drag-and-drop');
        const current = layer();
        cards().queueRender();
        await delay(50);
        assert(layer() === current, 'Preview tree remains stable during a drag');
        for (let step = 1; step <= 8; step++) {
            pointer.notify_absolute_motion(GLib.get_monotonic_time(),
                startX + (tx + tw / 2 - startX) * step / 8,
                startY + (ty + 18 - startY) * step / 8);
            await delay(30);
        }
        await delay(80);
        assert(cards()._dropHighlight?.monitor === monitor && cards()._dropHighlight.workspace === workspace,
            'Destination workspace is highlighted during hover');
        if (cancel) {
            keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Escape, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Escape, Clutter.KeyState.RELEASED);
            await delay(300);
        }
        pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED);
        await delay(500);
        assert(!cards()._dragging && !cards()._dragMonitor && !cards()._dropHighlight, 'Drag state and highlight clean up');
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
    assert(JSON.stringify(selected) === JSON.stringify([ext._model.current(0), ext._model.current(1)]),
        'Drops do not change either monitor selected workspace');
    assert(JSON.stringify(unchanged) === JSON.stringify([leftB, rightA, rightB].map(w => [w.get_monitor(), w.get_workspace().index()])),
        'Dragging one window does not move other windows');

    // Closing a window from its preview removes it from the cards.
    const closeButton = findActor(preview(rightB).get_parent(), a => a.style_class === 'window-close');
    closeButton.emit('clicked', 1);
    await delay(800);
    assert(!global.get_window_actors().some(a => a.meta_window === rightB), 'The close button closes the window');
    assert(!preview(rightB) && Main.overview.visible, 'A closed window disappears from the cards immediately');
    Main.overview.hide();
    await delay(500);
    log('[monitor-test] ALL TESTS PASSED');
}
function init() { return {enable() {test().catch(e => logError(e, '[monitor-test] FAILED'));}, disable() {if(fixtures) fixtures.force_exit();}}; }
