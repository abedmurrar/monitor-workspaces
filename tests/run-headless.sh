#!/bin/sh
set -eu
: "${MONITOR_WORKSPACES_TEST_HOME:=/tmp/monitor-workspaces-test}"
export MONITOR_WORKSPACES_TEST_HOME
export XDG_DATA_HOME="$MONITOR_WORKSPACES_TEST_HOME/data"
export XDG_CONFIG_HOME="$MONITOR_WORKSPACES_TEST_HOME/config"
export XDG_RUNTIME_DIR="$MONITOR_WORKSPACES_TEST_HOME/runtime"
export XDG_CACHE_HOME="$MONITOR_WORKSPACES_TEST_HOME/cache"
export XDG_SESSION_TYPE=wayland
export LIBGL_ALWAYS_SOFTWARE=1
export GNOME_SHELL_SESSION_MODE=user
export GSETTINGS_BACKEND=keyfile
export GDK_BACKEND=wayland
if [ "${1:-}" != inside ]; then
    exec dbus-run-session -- sh "$0" inside
fi
unset WAYLAND_DISPLAY
unset DISPLAY
gsettings set org.gnome.shell enabled-extensions "['monitor-workspaces@local', 'monitor-workspaces-test@local']"
gsettings set org.gnome.mutter dynamic-workspaces false
# Mirrors a real setup: the extension turns this off and must restore it.
gsettings set org.gnome.mutter workspaces-only-on-primary true
gsettings set org.gnome.desktop.wm.preferences num-workspaces 3
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-left "['<Control><Alt>Left']"
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-right "['<Control><Alt>Right']"
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-1 "['<Super>Home']"
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-last "['<Super>End']"
gsettings set org.gnome.desktop.wm.keybindings move-to-workspace-right "['<Shift><Control><Alt>Right']"
exec gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800 --virtual-monitor 1280x800 --virtual-monitor 800x1280 --wayland-display monitor-test
