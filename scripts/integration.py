#!/usr/bin/env python3
"""Run the extension and its driver in an isolated headless GNOME 42 session."""

import argparse
import importlib.util
import json
import os
import shutil
import signal
import subprocess
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UUID = "monitor-workspaces@local"
DRIVER_UUID = "monitor-workspaces-test@local"
PASS_MARKER = "[monitor-test] ALL TESTS PASSED"
FAIL_MARKERS = ("[monitor-test] FAILED", "JS ERROR")

spec = importlib.util.spec_from_file_location("extension_build", ROOT / "scripts" / "build.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def prepare(home):
    """Populate an isolated XDG data home with the extension and the test driver."""
    if home.exists():
        shutil.rmtree(home)
    extensions = home / "data" / "gnome-shell" / "extensions"
    extensions.mkdir(parents=True)
    for name in ("config", "cache", "output"):
        (home / name).mkdir()
    runtime = home / "runtime"
    runtime.mkdir()
    runtime.chmod(0o700)
    archive = builder.build(home / f"{UUID}.shell-extension.zip")
    with zipfile.ZipFile(archive) as package:
        package.extractall(extensions / UUID)
    driver = extensions / DRIVER_UUID
    driver.mkdir()
    metadata = json.loads((ROOT / "src" / "metadata.json").read_text())
    (driver / "metadata.json").write_text(json.dumps({
        "uuid": DRIVER_UUID,
        "name": "Monitor Workspaces integration driver",
        "description": "Test-only driver. Never install this into a real desktop profile.",
        "shell-version": metadata["shell-version"],
        "version": 1,
    }, indent=2) + "\n")
    shutil.copy2(ROOT / "tests" / "driver.js", driver / "extension.js")
    return home / "output"


def wait_for_result(log, deadline):
    """Return the log text once it reports success or failure, else raise on timeout."""
    while time.monotonic() < deadline:
        text = log.read_text(errors="replace") if log.exists() else ""
        if PASS_MARKER in text:
            return text
        for marker in FAIL_MARKERS:
            if marker in text:
                raise SystemExit(f"Integration tests failed ({marker}):\n{text[-4000:]}")
        time.sleep(1)
    raise SystemExit(f"Integration tests timed out:\n{log.read_text(errors='replace')[-4000:]}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path("/tmp/monitor-workspaces-test"),
                        help="Throwaway directory for the test session's XDG directories")
    parser.add_argument("--timeout", type=int, default=240, help="Seconds to wait for the driver")
    args = parser.parse_args()
    if shutil.which("gnome-shell") is None:
        raise SystemExit("gnome-shell is not installed; the integration test needs a GNOME 42 desktop")
    output = prepare(args.home)
    log = args.home / "gnome.log"
    environment = dict(os.environ,
                       MONITOR_WORKSPACES_TEST_HOME=str(args.home),
                       MONITOR_WORKSPACES_PROJECT=str(ROOT),
                       MONITOR_WORKSPACES_OUTPUT=str(output))
    with log.open("w") as stream:
        session = subprocess.Popen(["sh", str(ROOT / "tests" / "run-headless.sh")],
                                   stdout=stream, stderr=subprocess.STDOUT,
                                   env=environment, start_new_session=True)
    try:
        text = wait_for_result(log, time.monotonic() + args.timeout)
    finally:
        os.killpg(session.pid, signal.SIGTERM)
        session.wait(timeout=30)
    results = [line for line in text.splitlines() if "[monitor-test]" in line]
    (args.home / "verification.txt").write_text("\n".join(results) + "\n")
    print("\n".join(results))
    print(f"Screenshots and verification.txt in {args.home}")


if __name__ == "__main__":
    main()
