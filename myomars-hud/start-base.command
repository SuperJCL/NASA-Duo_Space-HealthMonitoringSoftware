#!/bin/bash
# Double-click in Finder to start the mock base station, then double-click hud.html.
cd "$(dirname "$0")"
echo "Starting MyoMars mock base on http://127.0.0.1:8787 … (close this window to stop)"
node server/mock-base.mjs
