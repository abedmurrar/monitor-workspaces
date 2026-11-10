const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync(`${__dirname}/../src/overviewLayout.js`, 'utf8'), context);
for (const scale of [1, 2]) {
    const area = {x: 0, y: 571, width: 2560, height: 1440};
    const search = {kind: 'search', x: 600, y: 600, width: 1000, height: 140 * scale};
    const dash = {kind: 'dash', x: 800, y: 1800, width: 1000, height: 100};
    const panel = context.panelBounds(area, scale, [search, dash]);
    assert(panel.y > search.y + search.height, 'Cards start below actual search field');
    assert(panel.y + panel.height < dash.y, 'Cards end above app launcher');
    const secondary = context.panelBounds({x: 5120, y: 0, width: 1440, height: 2560}, scale, [search, dash]);
    assert(secondary.x >= 5120 && secondary.y < 100, 'Unrelated monitor controls do not shift portrait monitor cards');
}
const verticalDock = {kind: 'dash', x: 0, y: 100, width: 100, height: 700};
const panel = context.panelBounds({x: 0, y: 0, width: 1280, height: 800}, 1, [verticalDock]);
assert(panel.x > 100, 'Vertical dock remains outside card area');
assert.equal(context.panelBounds({x: 0, y: 0, width: 100, height: 100}, 2, []), null);
console.log('PASS: native search and launcher reserved across offset monitors, scaling, portrait screens, and vertical docks.');

// Card grid: the largest cards that fit, at the monitor's aspect ratio, centred.
const fits = (cards, width, height, label) => cards.every(c =>
    c.x >= 0 && c.y >= 0 && c.x + c.width <= width + 1 && c.y + c.height + label <= height + 1);
const overlaps = cards => cards.some((a, i) => cards.slice(i + 1).some(b =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height));
for (const [count, aspect, width, height, columns] of [
    [3, 16 / 9, 2400, 1100, 2], // landscape between search and dock: 2 + 1 beats 3 in a row
    [3, 16 / 9, 2400, 500, 3], // short area: one row
    [3, 9 / 16, 1340, 2400, 2], // portrait monitor
    [4, 16 / 9, 1200, 700, 2],
    [1, 16 / 9, 1000, 600, 1],
    [9, 16 / 9, 2400, 1100, 3],
]) {
    const cards = context.cardGrid(count, aspect, width, height, 28, 34);
    assert.equal(cards.length, count);
    assert(fits(cards, width, height, 34), `Cards stay inside the panel (${count} at ${width}x${height})`);
    assert(!overlaps(cards), 'Cards never overlap');
    assert(cards.every(c => Math.abs(c.width / c.height - aspect) < 0.02), 'Cards keep the monitor aspect ratio');
    assert.equal(new Set(cards.map(c => c.y)).size, Math.ceil(count / columns), `Expected ${columns} columns`);
    const rows = [...new Set(cards.map(c => c.y))];
    const last = cards.filter(c => c.y === rows[rows.length - 1]);
    const span = last[last.length - 1].x + last[0].width - last[0].x;
    assert(Math.abs(last[0].x - (width - span) / 2) <= 1, 'The last row is centred');
}
assert.equal(context.cardGrid(3, 16 / 9, 10, 10, 28, 34).length, 0, 'No room yields no cards');
console.log('PASS: card grid maximises card size for landscape and portrait monitors, keeps aspect, centres rows.');
