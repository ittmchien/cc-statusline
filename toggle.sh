#!/usr/bin/env bash
# Flip a boolean section, or set a numeric interval config — no restart
# needed, index.js re-reads the state file on every run.
#
# Usage: toggle.sh <key> [on|off|<number>]
#   Boolean keys (folder, git, funny, jokeapi, model, context, session,
#     rolling, ratelimits): no value flips it, or pass on/off explicitly.
#   Numeric keys (cacheTtlMs, jokeTtlMs, jokeRotateMs, agentActiveMs,
#     barWidth): pass a value directly, e.g. `toggle.sh jokeRotateMs 30000`.
set -euo pipefail

KEY="${1:-}"
ARG="${2:-}"

if [ -z "$KEY" ]; then
  echo "Usage: toggle.sh <key> [on|off|<number>]"
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

if (arg !== "" && arg !== "on" && arg !== "off" && !isNaN(Number(arg))) {
  state[key] = Number(arg);
  fs.mkdirSync(require("path").dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
  console.log(key + " -> " + state[key]);
} else {
  const current = state[key] !== false;
  const next = arg === "on" ? true : arg === "off" ? false : !current;
  state[key] = next;
  fs.mkdirSync(require("path").dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
  console.log(key + " -> " + (next ? "ON" : "OFF"));
}
' "$FILE" "$KEY" "$ARG"
