# Changelog

## 7

Fixes:

- Locking the screen no longer collects every hidden window on secondary monitors
  onto the visible workspace. The extension now stays enabled on the lock screen;
  disabling it there restored "Workspaces on primary display only", and unlocking
  re-applied the extension's setting, which makes mutter gather those windows.
- Alt+Tab, notifications, and other window activations reveal the window's
  workspace on its own monitor without GNOME's all-monitor slide.
- When an app raises itself or a dock click activates a native workspace, the
  switch is applied to the monitor of the window that took focus (before, the
  monitor under the pointer), and GNOME's all-monitor slide no longer plays.
- Super+Home/End and "switch to workspace N" select that monitor-local number;
  before, they did nothing or picked the wrong workspace.
- "Move window to workspace" shortcuts carry the window on its own monitor
  instead of switching every monitor.
- Super+scroll on the desktop steps the pointer's monitor and wraps; before, it
  slid every monitor or stopped at an arbitrary end.
- Closed windows disappear from the cards immediately.
- Each monitor's workspace numbering survives Shell restarts and monitors waking
  from sleep or being re-enumerated.
- The overview builds the cards once while opening (it was twice), and later
  layout changes only rebuild them when the card areas actually move.
- Card and label offsets follow the display scale.

New look:

- Cards show the monitor's wallpaper with rounded corners and live window
  thumbnails with app icons, sized by a grid that makes them as large as the
  monitor allows (portrait monitors get portrait cards).
- Close button on window thumbnails, and full window titles on hover.
- Cards fade out with the overview instead of vanishing.
- A small per-monitor indicator shows the workspace after keyboard and scroll
  switches.

## 6

- Drag window previews between workspace cards, including across monitors with
  different active workspace selections, without switching either monitor.
- Highlight drop targets and support Escape cancellation with GNOME's drag handler.
- Keep preview actors stable during dragging and refresh after the drop completes.

## 5

- Keep GNOME's native workspace previews hidden during search and the app grid,
  instead of restoring them when the custom cards disappear.
- Suppress newly created native previews before their first frame and render
  workspace cards before redraw, fading them with the overview opening animation.
- Restore native preview ownership only when the extension is disabled.

## 4

- Workspace cards reserve GNOME's actual search and launcher bounds, including
  offset monitor layouts and display scaling, instead of using fixed spacing.
- Cards disappear immediately when typing a search or opening the app grid.
- Added layout regression tests and real keyboard/click-target search checks.

## 3

- Desktop icons no longer draw on top of application windows during the slide.
  Ubuntu's desktop-icon surface is marked visible on all workspaces, so it was
  being placed in the layer reserved for pinned application windows.

## 2

- Added a 260 ms slide transition clipped to the switched monitor. Other monitors
  stay pixel-identical throughout. Repeated presses, simultaneous per-monitor
  transitions, cancellation, and GNOME's "reduce animations" preference are
  handled.

## 1

- Per-monitor workspace selection backed by native workspaces, with no global
  workspace activation and therefore no all-monitor animation.
- Independent workspace cards per monitor in the Super overview, with card
  clicks, scrolling, and window-preview activation.
- Ctrl+Alt+Left/Right, Ctrl+Alt+A/Q, and the other GNOME directional workspace
  shortcuts act on the monitor under the mouse pointer.
