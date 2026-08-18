#!/bin/bash
# Runs every test. The preference tests build the real preferences window
# off-screen, so they need the extension reachable under its UUID directory.
set -u
cd "$(dirname "$0")"
export GI_TYPELIB_PATH=/usr/lib64/gnome-shell/girepository-1.0
status=0
for test in testMonitorSizing.js testPrefsWidgets.js testPrefsBehaviour.js; do
    echo "=== $test ==="
    output=$(gjs -m "$test" 2>&1)
    echo "$output" | grep -E "FAIL|ALL PASS|PASS$|FAILURE" || echo "$output" | tail -5
    echo "$output" | grep -q "FAIL" && status=1
done
exit $status
