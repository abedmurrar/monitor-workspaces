# Monitor Workspaces

A GNOME Shell 42 extension that gives every monitor its own workspace selection.
Switching workspaces on one monitor leaves the other monitors exactly where they
are — no windows moved, no shared transition animation.

GNOME's own "Workspaces on all displays" option switches every monitor together,
and its per-monitor alternatives still activate a global workspace, so all screens
animate. This extension keeps native workspaces as window storage but tracks the
selected workspace per monitor, so a switch only touches the monitor you asked for.

![Per-monitor workspace cards in the overview](docs/images/overview.png)

## Requirements

- GNOME Shell 42 (developed and tested on Ubuntu 22.04 with GNOME 42.9, X11)
- Fixed workspaces on all displays. The extension sets both options while it is
  enabled and keeps your existing workspace count.

## Install

From a release archive:

```sh
gnome-extensions install --force monitor-workspaces@local.shell-extension.zip
gnome-extensions enable monitor-workspaces@local
```

From a clone:

```sh
make install
gnome-extensions enable monitor-workspaces@local
```

GNOME must reload before it sees a newly installed extension. On X11 press
**Alt+F2**, type `r`, and press Enter; this keeps your applications open. On
Wayland, log out and back in.

## Use

- **Ctrl+Alt+Left/Right** switches the monitor under the mouse pointer, wrapping
  at the ends. **Ctrl+Alt+A/Q** do the same. The other GNOME directional
  workspace shortcuts are routed through the same handler.
- **Super** opens the overview with an independent row of workspace cards on every
  monitor. Click a card to select that workspace on that monitor; click the active
  card to close the overview. Click a window preview to select its workspace, exit
  the overview, and focus the window.
- Scrolling over a monitor's cards switches that monitor.
- Search and the app grid keep GNOME's normal interfaces.
- Cards leave room for the search field and launcher using their actual on-screen
  positions. Typing a search or opening the app grid hides the cards immediately.
- Native workspace previews stay hidden during search and overview transitions;
  only GNOME's search results or app grid are shown when the cards are hidden.

Desktop switches slide left or right over 260 ms, clipped to the selected
monitor's bounds. The panel, dock, and sticky windows stay fixed, desktop icons
slide with the wallpaper behind application windows, and GNOME's
"reduce animations" preference is respected.

![A slide confined to one monitor](docs/images/transition.png)

## How it works

`src/model.js` holds the pure logic: for each monitor it maps a monitor-local
workspace number onto a native workspace index, and computes the window moves
that make a selection visible. Because the mapping is per monitor, selecting a
workspace only rewrites the workspace membership of windows on that monitor and
never calls `Workspace.activate()`, which is what would drag every monitor along.

`src/animation.js` snapshots the outgoing and incoming contents of the affected
monitor into two actors inside a clipped container and slides them, leaving the
real window actors on other monitors untouched.

`src/extension.js` wires this into the overview, the keybindings, and the
`actionMoveWorkspace` hook, and restores GNOME's handlers on disable.

## Development

```sh
make help          # list targets
make test          # syntax, model, animation-stacking, and packaging checks
make build         # deterministic archive in dist/
make integration   # isolated headless GNOME session (needs GNOME 42)
make install       # build and install into the current user profile
```

`make test` runs without a desktop: `tests/model.test.js` covers monitor
isolation, arbitrary jumps, wraparound, sticky windows, attached dialogs, and the
native fallback path for three monitors against three physical origins;
`tests/animation-stacking.test.js` covers the desktop-icon and pinned-window
stacking on both sliding pages; `tests/test_build.py` checks that the archive is
reproducible and contains only runtime files.

`make integration` builds the extension into a throwaway XDG data home, installs
`tests/driver.js` beside it as a test-only extension, and starts a private
GNOME Shell 42 session (`--headless --wayland`, two 1280×800 virtual monitors, a
private D-Bus session, and the keyfile GSettings backend) with four real GTK
windows from `tests/fixtures.js`. It asserts card selection, independent window
placement, real Ctrl+Alt+arrow input, **zero global workspace-switch signals**,
monitor-bounded animation with pixel-identical neighbouring monitors mid-slide,
repeated and simultaneous transitions, reduced motion, search, the app grid,
window-preview clicks, overview cleanup, disable, and re-enable. Results and
screenshots land in the test home, by default `/tmp/monitor-workspaces-test`.

`tests/driver.js` is never part of the built archive; do not install it into a
real profile.

## Known limitations

- GNOME 42 only. It has not been ported to the newer extension API.
- Cards do not support dragging windows between them yet. The window menu can
  still move a window to a native workspace, whose numbering may differ from the
  monitor-local numbers.
- Native workspace indicators show the underlying global workspace index. Use the
  cards' **Active** markers for each monitor's real selection.
- Monitor-local numbering rebases when the extension or Shell restarts, or when
  monitors are rearranged. No windows are closed or lost.
- Direct numbered shortcuts, external tools, window activation, and gestures go
  through a fallback window-rotation handler and may still produce GNOME's global
  animation. The card clicks and directional shortcuts avoid it entirely.
- Other extensions that replace the overview or its key handlers, and very large
  workspace counts, need additional integration work.

## Uninstall

```sh
gnome-extensions disable monitor-workspaces@local
gnome-extensions uninstall monitor-workspaces@local
```

Windows stay in ordinary native workspaces and remain accessible afterwards.

## Acknowledgements

This project exists because of
[Switch workspaces on active monitor](https://github.com/micheledaros/gnome-shell-extension-simulate-switching-workspaces-on-active-monitor),
first published by **Xiaoguang Wang (sunwxg)** in 2019 and later carried forward
and published to extensions.gnome.org by **Michele Da Ros**, with contributions
from Jakob Probst, Callum Iddon, and others. It established that per-monitor
workspace switching was worth having on GNOME, and its Ctrl+Alt+Q/A shortcuts are
kept here so it can be swapped in and out without relearning anything.

Their history is grafted into this repository as an ancestor so that credit lives
in `git log`, and their MIT notice is preserved in [LICENSE.upstream](LICENSE.upstream).
No code is shared: this is an independent GNOME 42 implementation with a different
mechanism, as described in the sections above.

## Related work

The upstream extension keeps inactive monitors' contents in place after a global
switch, but cannot avoid the shared animation. V-Shell's overview thumbnails call
native workspace activation directly.
[Workspace Islands](https://github.com/danielbernalo/gnome-workspace-islands)
integrates more deeply but requires a much newer GNOME.

## License

[GPL-2.0-or-later](LICENSE), matching the GNOME Shell ecosystem. The grafted
upstream history remains under its own [MIT license](LICENSE.upstream).
