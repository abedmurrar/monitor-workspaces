// SPDX-License-Identifier: GPL-2.0-or-later
/* Keep monitor-local cards inside the space left by GNOME's native controls. */
var panelBounds = function(area, scale, controls) {
    const padding = 24 * scale;
    let left = area.x + Math.max(padding, area.width * 0.035);
    let right = area.x + area.width - Math.max(padding, area.width * 0.035);
    let top = area.y + padding;
    let bottom = area.y + area.height - padding;
    for (const control of controls) {
        const {x, y, width, height} = control;
        if (width <= 0 || height <= 0 || x >= right || x + width <= left ||
            y >= bottom || y + height <= top)
            continue;
        if (control.kind === 'search')
            top = Math.max(top, y + height + padding);
        else if (height > width) {
            if (x + width / 2 < area.x + area.width / 2)
                left = Math.max(left, x + width + padding);
            else
                right = Math.min(right, x - padding);
        } else if (y + height / 2 < area.y + area.height / 2) {
            top = Math.max(top, y + height + padding);
        } else {
            bottom = Math.min(bottom, y - padding);
        }
    }
    if (right - left < 120 * scale || bottom - top < 120 * scale)
        return null;
    return {x: left, y: top, width: right - left, height: bottom - top};
};

/* Pick the column count that makes the cards largest, keep each card at the
 * monitor's aspect ratio with room for its label, and centre the grid. */
var cardGrid = function(count, aspect, width, height, gap, labelHeight) {
    let best = null;
    for (let columns = 1; columns <= count; columns++) {
        const rows = Math.ceil(count / columns);
        const cardWidth = Math.min((width - gap * (columns - 1)) / columns,
            ((height - gap * (rows - 1)) / rows - labelHeight) * aspect);
        if (cardWidth > 0 && (!best || cardWidth > best.cardWidth))
            best = {columns, rows, cardWidth};
    }
    if (!best)
        return [];
    const {columns, rows} = best;
    const cardWidth = Math.floor(best.cardWidth);
    const cardHeight = Math.floor(cardWidth / aspect);
    const top = (height - (rows * (cardHeight + labelHeight) + (rows - 1) * gap)) / 2;
    return Array.from({length: count}, (_, index) => {
        const row = Math.floor(index / columns), column = index % columns;
        const inRow = Math.min(columns, count - row * columns);
        const left = (width - (inRow * cardWidth + (inRow - 1) * gap)) / 2;
        return {
            x: Math.round(left + column * (cardWidth + gap)),
            y: Math.round(top + row * (cardHeight + labelHeight + gap)),
            width: cardWidth, height: cardHeight,
        };
    });
};
