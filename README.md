# cc-statusline

Custom status line for [Claude Code](https://code.claude.com) — Remote Control indicator, folder, git branch (gitmoji icon by prefix), linked-worktree name, model (+ running subagents' models), context usage, session/today/7d/30d cost with token counts, rate limits, and a random dev-joke line.

## Preview

```
🔗 ✅ | 📁 ~/company/diaflow-expo 🐛 fix/DP-1652 | ◆ Sonnet ⤷ Haiku 4.5 | 🧠 [██▌-------] 25.0%
💰 ~$0.42 🪙 5.1M | today 💰 ~$141.81 🪙 317.3M | 7d 💰 ~$453.36 🪙 2.0B | 30d 💰 ~$958.02 🪙 3.5B | 5h: [██--------] 20.0% ⏱ 4h12m | 7d: [█▎--------] 13.0% ⏱ 6d3h
💬 It's not a bug, it's an undocumented feature with job security.
```

`🔗 ✅/❌` shows whether this session is under [Remote Control](https://code.claude.com/docs/en/remote-control) (controllable from claude.ai/mobile). The statusline stdin JSON has no field for it, so it's detected from `~/.claude/sessions/<pid>.json` — a session file matching the current `session_id` (with a live pid) whose `bridgeSessionId` is non-null means active.

`⤷ Haiku 4.5` appears next to the model name while a subagent is running, showing which model it runs on (detected from fresh `subagents/agent-*.jsonl` transcripts next to the session transcript; disappears ~60s after the agent stops writing).

`today` sums the current **local** calendar day's cost/tokens from the same transcript scan as the 7d/30d totals (day buckets align to local midnight, not UTC).

## Prerequisites

- **Node.js 18+** (built-in `fetch` / `AbortSignal.timeout` are used for the JokeAPI fetch — no npm packages, no `node_modules`)
- **git** (to clone the repo)
- **bash** (runs `statusline-funny.sh` and `toggle.sh` — macOS/Linux out of the box; on Windows use WSL or Git Bash)
- **Claude Code** already installed, since this replaces its status line

Check your Node version:

```bash
node --version
```

## Install

**1. Clone the repo:**

```bash
git clone git@github.com:ittmchien/cc-statusline.git ~/cc-statusline
```

**2. Run the installer** — copies the `/sl` slash command into `~/.claude/commands/` and makes the shell scripts executable:

```bash
bash ~/cc-statusline/install.sh
```

**3. Wire it into Claude Code** — the installer prints a JSON snippet at the end; add it to `~/.claude/settings.json` (applies to every project) or to a project's `.claude/settings.local.json` (that project only, not committed to git):

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /Users/you/cc-statusline/index.js",
    "refreshInterval": 1
  }
}
```

**4. Restart Claude Code** (or open a new session) — settings are read once at session start, so an already-running window won't pick up the change.

## Cost accuracy

- **Session cost** prefers Claude Code's own `cost.total_cost_usd` (accurate, cumulative) — never recomputed from token counts unless that field is missing.
- **Token counts** (🪙, next to each cost figure) — the session total is summed from the session's own transcript file incrementally (only newly appended lines are parsed per refresh, deduped by `message.id`), since the stdin JSON only carries the last turn's snapshot, not a running total. 7d/30d totals come from the same scan as the rolling costs. Counted tokens = input + output + cache read + cache write.
- **Today / 7d / 30d rolling cost** scans `~/.claude/projects/**/*.jsonl`, dedupes by `message.id` (session resume/compaction can duplicate history across files), and bills cache writes by actual TTL (5m = 1.25x input, 1h = 2x input) instead of a flat rate. Cross-checked against [`ccusage`](https://github.com/ryoppippi/ccusage) — matches within ~0.5% on live data.
- Results are cached to disk for `CC_SL_CACHE_TTL_MS` (default 30s) since scanning transcripts on every 1s refresh would be too slow.

## Toggle sections — `/sl`

Inside Claude Code, in any project:

```
/sl funny            # flip the joke line on/off
/sl rolling off       # explicit on/off
/sl ratelimits on
```

Valid keys: `remote` (the `🔗 ✅/❌` Remote Control indicator, detected via `bridgeSessionId` in `~/.claude/sessions/<pid>.json`), `folder`, `git`, `worktree` (the ⧉ linked-worktree name, shown only when the cwd is inside a linked git worktree), `funny`, `jokeapi`, `model`, `context`, `session`, `today` (today's cost/tokens, local calendar day), `rolling`, `ratelimits`, `tokens` (the 🪙 counts next to the cost figures), `bars` (the progress bars on the context/rate-limit segments — off shows percentages only). Takes effect on the next render — no restart, since the toggle state lives in `~/.claude/cc-statusline-toggles.json` and `index.js` re-reads it every run.

Same toggles also work via env vars (`CC_SL_FUNNY=0`, `CC_SL_ROLLING=0`, etc.) if you'd rather bake them into the `statusLine.command` string or your shell profile — the toggle file takes precedence when both are set.

## Joke line — JokeAPI, with a privacy-conscious fetch strategy

The joke line alternates every `jokeRotateMs` (default 30s) between the bundled local list (`statusline-funny.sh`) and [JokeAPI](https://jokeapi.dev) (`Programming` category, NSFW/political/religious/etc. content excluded). Which joke is picked is a hash of the rotation slot (not sequential — it won't just walk the list in order), offset by a hash of the session id so concurrent chat windows land on different jokes at different points in the cycle. Since the status line reruns every `refreshInterval` (as low as every 1s), it **never calls the API on the render path** — that would spam JokeAPI and risk the caller's (hashed) IP getting rate-limited or blacklisted per [their privacy policy](https://jokeapi.dev/#footer):

- A batch of 10 jokes is cached to disk and reused for `jokeTtlMs` (default 15 minutes).
- When the cache goes stale, a **detached background process** fetches a fresh batch and exits — the current render never waits on it and just uses whatever's cached (or the local list) for its turn in the rotation.
- A lock file debounces concurrent statusline invocations so only one background fetch runs at a time.
- If the API is unreachable, slow (5s timeout), or the cache isn't populated yet, that turn in the rotation falls back to the local list instead. To skip JokeAPI entirely (local jokes only, no network calls at all): `/sl jokeapi off` or `CC_SL_JOKEAPI=0`.
- No truncation — a long or multi-line joke just wraps onto extra terminal lines naturally, styled consistently top to bottom.

## Toggle numeric intervals — `/sl`

Same `/sl` command, but for the tunable numbers. **These already ship with sane defaults — you don't need to touch them to use cc-statusline.** Only change them if you want, e.g., a slower joke rotation or a longer cost-scan cache window:

```
/sl jokeRotateMs 60000    # change the joke every 60s instead of 30s
/sl cacheTtlMs 60000      # rescan 7d/30d cost every 60s instead of 30s
/sl jokeTtlMs 1800000     # refetch a JokeAPI batch every 30min instead of 15
/sl agentActiveMs 90000   # consider a subagent "active" for 90s of mtime silence instead of 60s
/sl barWidth 20           # make the context/rate-limit progress bars 20 chars wide instead of 10
```

| Key | Default | Purpose |
|---|---|---|
| `cacheTtlMs` | `30000` (30s) | How long the 7d/30d cost scan is cached before rescanning |
| `jokeTtlMs` | `900000` (15min) | How long a batch of JokeAPI jokes is cached before refetching |
| `jokeRotateMs` | `30000` (30s) | How often the joke line changes / alternates source |
| `agentActiveMs` | `60000` (60s) | How long a subagent transcript's mtime silence still counts as "running" in the `⤷ Model` line |
| `barWidth` | `10` | Width (in characters) of the context/rate-limit progress bars |

Same env-var fallback pattern as the boolean toggles: `CC_SL_CACHE_TTL_MS`, `CC_SL_JOKE_TTL_MS`, `CC_SL_JOKE_ROTATE_MS`, `CC_SL_AGENT_ACTIVE_MS`, `CC_SL_BAR_WIDTH` — the toggle file takes precedence when both are set.

## Env vars

| Var | Default | Purpose |
|---|---|---|
| `CC_SL_<SECTION>` | `1` | Set to `0`/`false` to disable a section (see toggle keys above) |
| `CC_SL_CACHE_TTL_MS` | `30000` | See "Toggle numeric intervals" above |
| `CC_SL_JOKE_TTL_MS` | `900000` | See "Toggle numeric intervals" above |
| `CC_SL_JOKE_ROTATE_MS` | `30000` | See "Toggle numeric intervals" above |
| `CC_SL_AGENT_ACTIVE_MS` | `30000` | See "Toggle numeric intervals" above |
| `CC_SL_BAR_WIDTH` | `10` | See "Toggle numeric intervals" above |

## Files

- `index.js` — the status line itself
- `statusline-funny.sh` — joke-line source, one message per 30s window, hashed by session id so concurrent chat windows don't show the same line
- `toggle.sh` — flips a key in the toggle-state file (used by `/sl`)
- `commands/sl.md` — the `/sl` slash command definition
- `install.sh` — one-time setup after cloning
