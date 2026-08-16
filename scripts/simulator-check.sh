#!/usr/bin/env bash
#
# Install, launch and prove out the Constructly app on a booted iOS Simulator.
#
# Compilation success says nothing about whether the app actually runs: the
# classic Capacitor failure is a native shell that launches perfectly and shows
# a white rectangle because the WebView never loaded. This script therefore
# proves four separate things, in order of increasing strength:
#
#   1. the bundle installs and the bundle id is recognised
#   2. the process launches AND is still alive after an observation window
#      (an immediate crash would pass a naive `simctl launch` check)
#   3. the simulator log contains no fatal native/WebView error
#   4. a screenshot contains actual rendered content, not a blank screen
#
# Usage:
#   simulator-check.sh <udid> <app-path> <bundle-id> <label> <artifact-dir> \
#                      [settle-seconds] [expected-screen]
set -euo pipefail

UDID="$1"
APP_PATH="$2"
BUNDLE_ID="$3"
LABEL="$4"
OUT_DIR="$5"
SETTLE="${6:-12}"
EXPECTED_SCREEN="${7:-}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$OUT_DIR"

echo "── ${LABEL}: install ──"
# A stale copy from a previous check would make the next launch meaningless.
xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl uninstall "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl install "$UDID" "$APP_PATH"
echo "installed: $APP_PATH"

echo "── ${LABEL}: launch ──"
# --console-pipe streams the app's stdout/stderr to us. That is load-bearing:
# Capacitor forwards the WebView's console output to the native side via
# Swift `print()`, which goes to stdout and NEVER reaches os_log — so
# `log show` cannot see our boot markers no matter what predicate it uses.
# The pipe runs in the background because it streams until the app exits.
STDOUT_LOG="${OUT_DIR}/${LABEL}.stdout.log"
: > "$STDOUT_LOG"
xcrun simctl launch --console-pipe --terminate-running-process "$UDID" "$BUNDLE_ID" \
  > "$STDOUT_LOG" 2>&1 &
CONSOLE_PID=$!
# Make sure the pipe is torn down however this script exits.
trap 'kill "$CONSOLE_PID" 2>/dev/null || true' EXIT

# Give simctl a moment to print the "<bundle-id>: <pid>" header line.
sleep 5
PID="$(grep -m1 -oE "${BUNDLE_ID}: *[0-9]+" "$STDOUT_LOG" | grep -oE '[0-9]+$' || true)"

if [ -z "$PID" ]; then
  echo "x ${LABEL}: launch did not report a PID"
  head -30 "$STDOUT_LOG" || true
  exit 1
fi
echo "pid: $PID"

echo "── ${LABEL}: observing for ${SETTLE}s ──"
sleep "$SETTLE"

# Simulator apps are ordinary host processes, so the runner's own `ps` is the
# most direct liveness check available. A crash-on-launch shows up here.
if ! ps -p "$PID" >/dev/null 2>&1; then
  echo "x ${LABEL}: process $PID is gone — the app crashed or exited after launch."
  echo "── app stdout (tail) ──"
  tail -60 "$STDOUT_LOG" || true
  echo "── os_log (tail) ──"
  xcrun simctl spawn "$UDID" log show --predicate 'process == "App"' \
    --style compact --last 3m 2>/dev/null | tail -60 || true
  exit 1
fi
echo "OK process $PID still alive after ${SETTLE}s"

echo "── ${LABEL}: screenshot ──"
SHOT="${OUT_DIR}/${LABEL}.png"
xcrun simctl io "$UDID" screenshot "$SHOT"
node "${REPO_ROOT}/scripts/analyze-screenshot.mjs" "$SHOT" "$LABEL"

echo "── ${LABEL}: application log ──"
LOG_FILE="${OUT_DIR}/${LABEL}.log"
# Scoped to this simulator and this process so the artifact stays readable and
# contains no unrelated system or runner information.
xcrun simctl spawn "$UDID" log show --predicate 'process == "App"' \
  --style compact --last 3m > "$LOG_FILE" 2>/dev/null || true
echo "log lines: $(wc -l < "$LOG_FILE" | tr -d ' ')"

# Capacitor's own log wording is not a stable contract, so it is reported but
# not required.
echo "── ${LABEL}: Capacitor log lines ──"
grep -iE "Loading app at|WebView loaded" "$LOG_FILE" | head -5 || \
  echo "(no Capacitor banner line found — not fatal)"

# OUR markers, however, are a contract we control (mobile/src/boot-marker.ts),
# forwarded from the WebView's console into os_log. These turn "a process is
# alive and something painted" into "our SPA ran, at the right origin, and
# settled on the right screen".
echo "── ${LABEL}: SPA boot markers ──"
# Markers may surface on stdout (the normal path) or, if Capacitor's logging
# behaviour changes, in os_log — accept either rather than depending on one.
MARKER_SOURCES="$STDOUT_LOG $LOG_FILE"

if ! grep -hF "[constructly-boot] react-mounted" $MARKER_SOURCES >/dev/null 2>&1; then
  echo "x ${LABEL}: the SPA never mounted — WebView did not execute the bundle."
  echo "── app stdout (tail) ──"; tail -40 "$STDOUT_LOG" || true
  echo "── os_log (tail) ──";     tail -40 "$LOG_FILE" || true
  exit 1
fi
grep -hF "[constructly-boot]" $MARKER_SOURCES | sed 's/^/  /' | head -10

# The bundle must be served by Capacitor's scheme handler. A file:// or http://
# origin would mean the app is not running the way it will on a device.
if ! grep -hF "origin=capacitor://localhost" $MARKER_SOURCES >/dev/null 2>&1; then
  echo "x ${LABEL}: unexpected runtime origin — expected capacitor://localhost"
  grep -hF "react-mounted" $MARKER_SOURCES | head -3
  exit 1
fi
echo "OK runtime origin is capacitor://localhost"

if [ -n "$EXPECTED_SCREEN" ]; then
  if ! grep -hF "[constructly-boot] screen=${EXPECTED_SCREEN}" $MARKER_SOURCES >/dev/null 2>&1; then
    echo "x ${LABEL}: expected screen '${EXPECTED_SCREEN}' was not reached."
    grep -hF "screen=" $MARKER_SOURCES | head -5 || echo "  (no screen marker at all)"
    exit 1
  fi
  echo "OK settled on expected screen: ${EXPECTED_SCREEN}"
fi

# Fatal patterns only. Apple/WebKit system chatter is expected and must not fail
# the build; these are unambiguous failures.
echo "── ${LABEL}: fatal error scan ──"
FATAL_PATTERN='Fatal error|Terminating app due to uncaught exception|Could not find the web assets directory|Unable to open .*public|didFailProvisionalNavigation|did fail provisional navigation'
if grep -nEi "$FATAL_PATTERN" "$LOG_FILE" >/dev/null 2>&1; then
  echo "x ${LABEL}: fatal runtime error found:"
  grep -nEi "$FATAL_PATTERN" "$LOG_FILE" | head -20
  exit 1
fi
echo "OK no fatal native/WebView errors"

echo "OK ${LABEL}: install + launch + alive + rendered"
