/* Physical workspaces are storage slots. Each monitor has its own logical cursor. */
var wrap = (value, count) => ((value % count) + count) % count;

var MonitorModel = class MonitorModel {
    constructor(count, physical, cursors = []) {
        this.count = count;
        this.physical = physical;
        this.cursors = cursors;
    }

    current(monitor) {
        return wrap(this.cursors[monitor] === undefined ? this.physical : this.cursors[monitor], this.count);
    }

    logical(monitor, physical) {
        return wrap(physical - this.physical + this.current(monitor), this.count);
    }

    storage(monitor, logical) {
        return wrap(logical - this.current(monitor) + this.physical, this.count);
    }

    select(monitor, target, windows) {
        target = wrap(target, this.count);
        const delta = this.current(monitor) - target;
        const moves = windows.filter(w => w.monitor === monitor && !w.sticky && !w.attached)
            .map(w => ({id: w.id, target: wrap(w.workspace + delta, this.count)}));
        this.cursors[monitor] = target;
        return moves.filter(move => windows.find(w => w.id === move.id).workspace !== move.target);
    }

    nativeSwitch(monitor, target, windows, monitorCount) {
        const delta = target - this.physical;
        // Materialize cursors before changing the physical origin.
        for (let i = 0; i < monitorCount; i++)
            this.cursors[i] = this.current(i);
        const moves = windows.filter(w => w.monitor !== monitor && !w.sticky && !w.attached)
            .map(w => ({id: w.id, target: wrap(w.workspace + delta, this.count)}));
        this.cursors[monitor] = wrap(this.current(monitor) + delta, this.count);
        this.physical = target;
        return moves;
    }
};

/* Monitor indices change when screens reconnect or wake from sleep, so each
 * monitor's selection is remembered by its geometry instead. */
var monitorKey = monitor => `${monitor.x},${monitor.y},${monitor.width},${monitor.height}`;

var parseState = text => {
    try {
        const state = JSON.parse(text || 'null');
        return state && typeof state === 'object' && state.cursors && typeof state.cursors === 'object'
            ? state : null;
    } catch (_error) {
        return null;
    }
};

// Monitors that are absent right now keep their remembered selection.
var saveState = (model, monitors, previous) => {
    const old = parseState(previous);
    const cursors = old && old.count === model.count && old.physical === model.physical
        ? {...old.cursors} : {};
    for (const monitor of monitors)
        cursors[monitorKey(monitor)] = model.current(monitor.index);
    return JSON.stringify({count: model.count, physical: model.physical, cursors});
};

// Saved selections only apply while the native workspaces still line up
// with them; otherwise numbering starts fresh. Windows never move either way.
var restoreModel = (count, physical, monitors, saved) => {
    const model = new MonitorModel(count, physical);
    const state = parseState(saved);
    if (!state || state.count !== count || state.physical !== physical)
        return model;
    for (const monitor of monitors) {
        const cursor = state.cursors[monitorKey(monitor)];
        if (Number.isInteger(cursor))
            model.cursors[monitor.index] = wrap(cursor, count);
    }
    return model;
};
