# Contributing

## Layout

- `src/` — everything that ships in the extension archive
- `tests/` — headless unit tests plus the in-shell integration driver
- `scripts/` — `build.py` (deterministic archive) and `integration.py` (test session)
- `docs/images/` — screenshots used by the README

## Before opening a pull request

```sh
make test
```

If your change touches the overview, keybindings, or the slide animation, also run
the in-shell suite on an Ubuntu 22.04 / GNOME 42 machine:

```sh
make integration
```

Both are described in the README's Development section. CI runs `make test` and
`make build`; it cannot run `make integration`, since hosted runners have no
GNOME 42 session.

## Conventions

- 4-space indentation, LF endings; `.editorconfig` covers the details.
- Keep the workspace mapping logic in `src/model.js` and the layout maths in
  `src/overviewLayout.js` and `src/windowLayout.js` free of GNOME imports so they
  stay testable under plain Node.
- Add a regression assertion for behaviour you fix. `tests/model.test.js` and
  `tests/animation-stacking.test.js` are the cheap place to do it;
  `tests/driver.js` is for behaviour that only exists inside a live shell.
- Never install `tests/driver.js` into a real desktop profile, and do not add it
  to `RUNTIME_FILES` in `scripts/build.py`.
- Bump `version` in `src/metadata.json` and add a `CHANGELOG.md` entry for changes
  that alter installed behaviour.

## Testing against a live desktop

Install with `make install`, then reload GNOME (X11: **Alt+F2**, `r`, Enter).
A broken extension can make the shell unusable on Wayland, so prefer testing
through `make integration` first.
