#!/usr/bin/env bash
# One-time setup after cloning this repo:
#   1. Copies commands/sl.md -> ~/.claude/commands/sl.md so `/sl` works
#      inside Claude Code (any project, any window).
#   2. Ensures the shell scripts are executable.
#   3. Prints the statusLine config snippet to add to Claude Code settings
#      (not done automatically — that means touching the user's settings.json).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$HOME/.claude/commands"
cp "$REPO_DIR/commands/sl.md" "$HOME/.claude/commands/sl.md"
chmod +x "$REPO_DIR/toggle.sh" "$REPO_DIR/statusline-funny.sh"

echo "Installed /sl slash command -> ~/.claude/commands/sl.md"
echo
echo "Now add this to your Claude Code settings (global ~/.claude/settings.json,"
echo "or per-project .claude/settings.local.json to override just one project):"
echo
cat <<EOF
{
  "statusLine": {
    "type": "command",
    "command": "node $REPO_DIR/index.js",
    "refreshInterval": 1
  }
}
EOF
