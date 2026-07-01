#!/usr/bin/env bash
# Flip a cc-statusline feature toggle on/off (no restart needed — index.js
# re-reads the state file on every run).
#
# Usage: toggle.sh <funny|rolling> [on|off]
#   No on/off arg: flips the current state.
set -euo pipefail

KEY="${1:-}"
ARG="${2:-}"

if [ -z "$KEY" ]; then
  echo "Usage: toggle.sh <funny|rolling> [on|off]"
  exit 1
fi

FILE="$HOME/.claude/cc-statusline-toggles.json"

node -e '
const fs = require("fs");
const file = process.argv[1];
const key = process.argv[2];
const arg = process.argv[3];
let state = {};
try { state = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) {}
const current = state[key] !== false;
const next = arg === "on" ? true : arg === "off" ? false : !current;
state[key] = next;
fs.mkdirSync(require("path").dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(state, null, 2));
console.log(key + " -> " + (next ? "ON" : "OFF"));
' "$FILE" "$KEY" "$ARG"
