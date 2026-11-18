#!/bin/sh
# Tests for tide-kde-report-bug, with stubs for tide, systemd-run and
# busctl on a PATH of their own.

here=$(cd "$(dirname "$0")" && pwd)
script=$here/tide-kde-report-bug
failures=0

# Makes a fresh stub directory, $T, with the tools the script uses. The
# stubs log their arguments to $T/calls. $1 is tide's stub, or empty for
# none.
setup() {
    T=$(mktemp -d) || exit 1
    for tool in mktemp cat grep rm; do
        ln -s "$(command -v "$tool")" "$T/$tool"
    done
    printf '#!/bin/sh\necho "busctl $*" >>"%s/calls"\n' "$T" >"$T/busctl"
    printf '#!/bin/sh\necho "systemd-run $*" >>"%s/calls"\nwhile test "$1" != --; do shift; done\nshift\nexec "$@"\n' "$T" >"$T/systemd-run"
    if test -n "$1"; then
        printf '#!/bin/sh\n%s\n' "$1" >"$T/tide"
    fi
    chmod 755 "$T"/busctl "$T"/systemd-run "$T"/tide 2>/dev/null
}

run() {
    PATH=$T /bin/sh "$script" >"$T/out" 2>&1
    status=$?
}

check() {
    if ! eval "$2"; then
        echo "FAIL: $1" >&2
        sed 's/^/  /' "$T/out" "$T/calls" >&2 2>/dev/null
        failures=$((failures + 1))
    fi
}

setup ""
run
check "no tide: exits 127" 'test "$status" -eq 127'
check "no tide: says to install it" 'grep -q "Notify.*To report a bug, install tide" "$T/calls"'
rm -rf "$T"

# As every tide before report-bug answers it
setup 'echo "usage: tide launch [--workspace NAME] [--app ID]... [--] COMMAND [ARG...]" >&2; echo "       tide doctor" >&2; exit 2'
run
check "old tide: exits 2" 'test "$status" -eq 2'
check "old tide: says to update it" 'grep -q "Notify.*To report a bug, update tide" "$T/calls"'
rm -rf "$T"

setup 'echo "tide report-bug: saved ~/.local/state/tide/reports/x.txt"; test "$*" = report-bug'
run
check "tide: exits 0" 'test "$status" -eq 0'
check "tide: runs in a scope of its own" 'grep -q "^systemd-run --user --scope .* -- tide report-bug$" "$T/calls"'
check "tide: no notification" '! grep -q Notify "$T/calls"'
check "tide: its output is in the log" 'grep -q "tide report-bug: saved" "$T/out"'
check "tide: the log says it started and ended" 'grep -q "started" "$T/out" && grep -q "ended: reported" "$T/out"'
rm -rf "$T"

setup 'echo "tide report-bug: no clipboard" >&2; exit 1'
run
check "failing tide: exits 1" 'test "$status" -eq 1'
check "failing tide: says it failed" 'grep -q "Notify.*tide report-bug failed" "$T/calls"'
check "failing tide: its exit is in the log" 'grep -q "exited 1" "$T/out"'
rm -rf "$T"

if test "$failures" -ne 0; then
    echo "$failures failed" >&2
    exit 1
fi
echo "tide-kde-report-bug: all passed"
