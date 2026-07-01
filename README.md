# cc-statusline

Custom status line for [Claude Code](https://code.claude.com) — folder, git branch (gitmoji icon by prefix), model, context usage, session/7d/30d cost, rate limits, and a random dev-joke line.

## Preview

```
📁 ~/company/diaflow-expo 🐛 fix/DP-1652 | 💬 It's not a bug, it's an undocumented feature with job security.
◆ Sonnet | 🧠 [██▌----------------------] 10.0% | 💰 ~$0.42 | 7d ~$453.36 | 30d ~$958.02
5h: [█████---------------] 20.0% ⏱ 4h12m | 7d: [█▎-----------------------] 5.0% ⏱ 6d3h
```

## Install

```bash
git clone git@github.com:ittmchien/cc-statusline.git ~/cc-statusline
bash ~/cc-statusline/install.sh
```

`install.sh` copies the `/sl` slash command into `~/.claude/commands/` and prints the `statusLine` config snippet — paste that into `~/.claude/settings.json` (all projects) or a project's `.claude/settings.local.json` (that project only, not committed):

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /Users/you/cc-statusline/index.js",
    "refreshInterval": 1
  }
}
```

## Cost accuracy

- **Session cost** prefers Claude Code's own `cost.total_cost_usd` (accurate, cumulative) — never recomputed from token counts unless that field is missing.
- **7d/30d rolling cost** scans `~/.claude/projects/**/*.jsonl`, dedupes by `message.id` (session resume/compaction can duplicate history across files), and bills cache writes by actual TTL (5m = 1.25x input, 1h = 2x input) instead of a flat rate. Cross-checked against [`ccusage`](https://github.com/ryoppippi/ccusage) — matches within ~0.5% on live data.
- Results are cached to disk for `CC_SL_CACHE_TTL_MS` (default 30s) since scanning transcripts on every 1s refresh would be too slow.

## Toggle sections — `/sl`

Inside Claude Code, in any project:

```
/sl funny            # flip the joke line on/off
/sl rolling off       # explicit on/off
/sl ratelimits on
```

Valid keys: `folder`, `git`, `funny`, `model`, `context`, `session`, `rolling`, `ratelimits`. Takes effect on the next render — no restart, since the toggle state lives in `~/.claude/cc-statusline-toggles.json` and `index.js` re-reads it every run.

Same toggles also work via env vars (`CC_SL_FUNNY=0`, `CC_SL_ROLLING=0`, etc.) if you'd rather bake them into the `statusLine.command` string or your shell profile — the toggle file takes precedence when both are set.

## Env vars

| Var | Default | Purpose |
|---|---|---|
| `CC_SL_<SECTION>` | `1` | Set to `0`/`false` to disable a section (see keys above) |
| `CC_SL_CACHE_TTL_MS` | `30000` | How long the 7d/30d scan result is cached before rescanning |

## Files

- `index.js` — the status line itself
- `statusline-funny.sh` — joke-line source, one message per 30s window, hashed by session id so concurrent chat windows don't show the same line
- `toggle.sh` — flips a key in the toggle-state file (used by `/sl`)
- `commands/sl.md` — the `/sl` slash command definition
- `install.sh` — one-time setup after cloning
