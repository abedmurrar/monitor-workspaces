#!/usr/bin/env python3
"""Build a deterministic, runtime-only GNOME Shell extension archive."""

import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_FILES = (
    "animation.js", "extension.js", "indicator.js", "metadata.json", "model.js", "overview.js",
    "overviewLayout.js", "stylesheet.css", "windowLayout.js",
    "schemas/org.gnome.shell.extensions.monitor-workspaces.gschema.xml",
)


def build(output=None):
    source = ROOT / "src"
    metadata = json.loads((source / "metadata.json").read_text())
    uuid = metadata["uuid"]
    if uuid != "monitor-workspaces@local" or metadata["shell-version"] != ["42"]:
        raise ValueError("Review build and integration configuration before changing UUID or compatibility")
    output = Path(output) if output else ROOT / "dist" / f"{uuid}.shell-extension.zip"
    output.parent.mkdir(parents=True, exist_ok=True)
    entries = {name: (source / name).read_bytes() for name in RUNTIME_FILES}
    entries["LICENSE"] = (ROOT / "LICENSE").read_bytes()
    with tempfile.TemporaryDirectory(prefix="monitor-workspaces-build-") as tmp:
        subprocess.run([
            "glib-compile-schemas", "--strict", f"--targetdir={tmp}", str(source / "schemas"),
        ], check=True)
        entries["schemas/gschemas.compiled"] = (Path(tmp) / "gschemas.compiled").read_bytes()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(entries.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Override the output ZIP path")
    args = parser.parse_args()
    print(build(args.output))


if __name__ == "__main__":
    main()
