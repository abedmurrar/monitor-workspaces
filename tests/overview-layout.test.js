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
