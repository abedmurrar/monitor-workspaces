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
