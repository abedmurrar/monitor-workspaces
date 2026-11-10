const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync(`${__dirname}/../src/windowLayout.js`, 'utf8'), context);
const {windowSlots} = context;
const overlaps = slots => slots.some((a, i) => slots.slice(i + 1).some(b =>
    a.x < b.x + b.width - 0.01 && b.x < a.x + a.width - 0.01 &&
    a.y < b.y + b.height - 0.01 && b.y < a.y + a.height - 0.01));
for (const windows of [
    [{width: 1920, height: 1080}],
    [{width: 800, height: 600}, {width: 600, height: 400}, {width: 1200, height: 900}],
    Array.from({length: 7}, (_, i) => ({width: 400 + i * 90, height: 300 + i * 40})),
    [{width: 0, height: 0}, {width: 500, height: 2000}],
]) {
    const slots = windowSlots(windows, 600, 340, 12);
    assert.equal(slots.length, windows.length);
    assert(!overlaps(slots), 'Window previews never overlap');
    assert(slots.every(s => s.x >= 0 && s.y >= 0 && s.x + s.width <= 600.01 && s.y + s.height <= 340.01),
        'Window previews stay inside the card');
    windows.forEach((w, i) => {
        if (w.width && w.height)
            assert(Math.abs(slots[i].width / slots[i].height - w.width / w.height) < 0.01, 'Previews are not stretched');
    });
}
assert.equal(windowSlots([], 600, 340).length, 0);
assert.equal(windowSlots([{width: 10, height: 10}], 0, 340).length, 0);
console.log('PASS: window previews fit inside cards without overlap or stretching.');
