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
