const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Actor {
    constructor(properties = {}) { Object.assign(this, properties); this.children = []; }
    add_child(child) { this.children.push(child); }
    set_size(width, height) { this.width = width; this.height = height; }
    insert_child_above(child) { this.add_child(child); }
    destroy() { this.destroyed = true; }
}
const monitor = {index: 0, x: 0, y: 0, width: 1280, height: 800};
const wallpaper = new Actor({width: 1280, height: 800});
const parent = new Actor();
const context = {
    imports: {gi: {Clutter: {Actor, Clone: Actor, Color: Actor},
        Meta: {WindowType: {DESKTOP: 1}}, St: {Settings: {get: () => ({enable_animations: true})}}},
    ui: {main: {layoutManager: {monitors: [monitor], _bgManagers: [{backgroundActor: wallpaper}]}}}},
    global: {window_group: {get_parent: () => parent}},
    logError(error) { throw error; },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(`${__dirname}/../src/animation.js`, 'utf8'), context);
function windowEntry(name, type, workspace, sticky = false, monitorIndex = 0) {
    const actor = new Actor({name, x: 20, y: 20, width: 300, height: 200});
    return {monitor: monitorIndex, workspace, sticky,
        id: {minimized: false, get_window_type: () => type, get_compositor_private: () => actor}};
}
const normal = windowEntry('outgoing-app', 0, 0);
const incoming = windowEntry('incoming-app', 0, 1);
const desktop = windowEntry('desktop-icons', 1, 0, true);
const pinned = windowEntry('pinned-app', 0, 0, true);
const otherDesktop = windowEntry('other-monitor-icons', 1, 0, true, 1);
// Put desktop after the app to prove the layer is explicit, not accidental order.
const windows = [normal, incoming, desktop, pinned, otherDesktop];
const animation = new context.MonitorAnimation();
const transition = animation.prepare(0, windows, {current: () => 0, logical: (_m, w) => w}, 1, 1);
const names = actor => Array.from(actor.children, child => child.source === wallpaper ? 'wallpaper' : child.source?.name);
assert.deepEqual(names(transition.outgoing), ['wallpaper', 'desktop-icons', 'outgoing-app']);
assert.deepEqual(names(transition.incoming), ['wallpaper', 'desktop-icons', 'incoming-app']);
assert.deepEqual(names(transition.root), [undefined, 'pinned-app']);
assert.equal(transition.moving.children.length, 2);
animation.cancelAll();
assert.equal(animation.active.size, 0);
console.log('PASS: desktop icons stay below apps on both sliding pages; pinned apps remain above; other monitor icons excluded.');
