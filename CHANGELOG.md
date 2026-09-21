# Changelog

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
