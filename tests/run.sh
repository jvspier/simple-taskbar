#!/bin/bash
# Runs every test. The preference tests build the real preferences window
# off-screen, so they need a graphical session; the settings they change are
# private to the test run.
set -u
cd "$(dirname "$0")"
glib-compile-schemas ../schemas
export GI_TYPELIB_PATH=/usr/lib64/gnome-shell/girepository-1.0
# Any settings object the code under test creates on its own, such as
# another extension's schema, must not reach the real dconf database either.
export GSETTINGS_BACKEND=memory
status=0
for test in testMonitorSizing.js testPrefs.js; do
    echo "=== $test ==="
    output=$(gjs -m "$test" 2>&1)
    echo "$output" | grep -E "^FAIL|ALL PASS|FAILURE|SKIP" || echo "$output" | tail -5
    echo "$output" | grep -q "^ALL PASS" || status=1
done
exit $status
