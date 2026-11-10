const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync(`${__dirname}/../src/model.js`, 'utf8'), context);
const {MonitorModel} = context;
function apply(windows, moves) {
    for (const move of moves)
        windows.find(w => w.id === move.id).workspace = move.target;
}
function logicalSnapshot(model, windows) {
    return windows.filter(w => !w.sticky && !w.attached).map(w =>
        [w.id, model.logical(w.monitor, w.workspace)]);
}
for (let origin = 0; origin < 3; origin++) {
    const model = new MonitorModel(3, origin);
    const windows = [];
    for (let m = 0; m < 3; m++)
        for (let w = 0; w < 3; w++)
            windows.push({id: `${m}:${w}`, monitor: m, workspace: w});
    windows.push({id: 'sticky', monitor: 1, workspace: origin, sticky: true});
    windows.push({id: 'dialog', monitor: 1, workspace: origin, attached: true});
    const before = logicalSnapshot(model, windows);
    for (let cursor = 0; cursor < 3; cursor++) {
        const targetModel = new MonitorModel(3, origin, [cursor]);
        for (let logical = 0; logical < 3; logical++)
            assert.equal(targetModel.logical(0, targetModel.storage(0, logical)), logical,
                'Drop destinations map to the target monitor workspace independently of its cursor');
    }
    for (const [monitor, target] of [[1, 2], [0, 1], [2, 0], [1, 0], [0, 2], [2, 2]]) {
        const inactive = windows.filter(w => w.monitor !== monitor).map(w => [w.id, w.workspace]);
        apply(windows, model.select(monitor, target, windows));
        assert.deepEqual(logicalSnapshot(model, windows), before, 'Logical membership survives switches');
        assert.deepEqual(windows.filter(w => w.monitor !== monitor).map(w => [w.id, w.workspace]), inactive);
        assert.equal(model.current(monitor), target);
    }
    assert.equal(windows.find(w => w.id === 'sticky').workspace, origin);
    assert.equal(windows.find(w => w.id === 'dialog').workspace, origin);
    const inactiveCursors = [model.current(0), model.current(2)];
    const destination = (origin + 1) % 3;
    apply(windows, model.nativeSwitch(1, destination, windows, 3));
    assert.deepEqual(logicalSnapshot(model, windows), before, 'Native fallback preserves membership');
    assert.deepEqual([model.current(0), model.current(2)], inactiveCursors);
}
console.log('PASS: scoped switching, arbitrary jumps, wraparound, sticky windows, attached dialogs, native fallback (3 monitors × 3 physical origins)');
