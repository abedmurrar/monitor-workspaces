// SPDX-License-Identifier: GPL-2.0-or-later
// Choose the grid that gives the previews the most usable area, then fit each
// window inside its own cell without stretching or overlapping its neighbours.
var windowSlots = function(rectangles, width, height, spacing = 12) {
    const count = rectangles.length;
    if (!count || width <= 0 || height <= 0)
        return [];
    let best = null;
    for (let columns = 1; columns <= count; columns++) {
        const rows = Math.ceil(count / columns);
        const gap = Math.min(spacing, width / (columns * 4), height / (rows * 4));
        const cellWidth = (width - gap * (columns + 1)) / columns;
        const cellHeight = (height - gap * (rows + 1)) / rows;
        const score = rectangles.reduce((sum, rect) => {
            const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
            const scale = Math.min(cellWidth / w, cellHeight / h);
            return sum + w * h * scale * scale;
        }, 0);
        if (!best || score > best.score)
            best = {columns, rows, gap, cellWidth, cellHeight, score};
    }
    const {columns, gap, cellWidth, cellHeight} = best;
    return rectangles.map((rect, i) => {
        const row = Math.floor(i / columns), column = i % columns;
        const inRow = Math.min(columns, count - row * columns);
        const rowWidth = inRow * cellWidth + (inRow - 1) * gap;
        const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
        const scale = Math.min(cellWidth / w, cellHeight / h);
        const previewWidth = w * scale, previewHeight = h * scale;
        return {
            x: (width - rowWidth) / 2 + column * (cellWidth + gap) + (cellWidth - previewWidth) / 2,
            y: gap + row * (cellHeight + gap) + (cellHeight - previewHeight) / 2,
            width: previewWidth, height: previewHeight,
        };
    });
};
