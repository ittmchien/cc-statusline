# cc-statusline

Custom status line for [Claude Code](https://code.claude.com) — folder, git branch (gitmoji icon by prefix), model, context usage, session/7d/30d cost, rate limits, and a random dev-joke line.

## Preview

```
📁 ~/company/diaflow-expo 🐛 fix/DP-1652 | 💬 It's not a bug, it's an undocumented feature with job security.
◆ Sonnet | 🧠 [██▌----------------------] 10.0% | 💰 ~$0.42 | 7d ~$453.36 | 30d ~$958.02
5h: [█████---------------] 20.0% ⏱ 4h12m | 7d: [█▎-----------------------] 5.0% ⏱ 6d3h
```

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
- **7d/30d rolling cost** scans `~/.claude/projects/**/*.jsonl`, dedupes by `message.id` (session resume/compaction can duplicate history across files), and bills cache writes by actual TTL (5m = 1.25x input, 1h = 2x input) instead of a flat rate. Cross-checked against [`ccusage`](https://github.com/ryoppippi/ccusage) — matches within ~0.5% on live data.
- Results are cached to disk for `CC_SL_CACHE_TTL_MS` (default 30s) since scanning transcripts on every 1s refresh would be too slow.

## Toggle sections — `/sl`

Inside Claude Code, in any project:

```
/sl funny            # flip the joke line on/off
/sl rolling off       # explicit on/off
/sl ratelimits on
```

Valid keys: `folder`, `git`, `funny`, `jokeapi`, `model`, `context`, `session`, `rolling`, `ratelimits`. Takes effect on the next render — no restart, since the toggle state lives in `~/.claude/cc-statusline-toggles.json` and `index.js` re-reads it every run.

Same toggles also work via env vars (`CC_SL_FUNNY=0`, `CC_SL_ROLLING=0`, etc.) if you'd rather bake them into the `statusLine.command` string or your shell profile — the toggle file takes precedence when both are set.

## Joke line — JokeAPI, with a privacy-conscious fetch strategy

The joke line alternates every `jokeRotateMs` (default 30s) between the bundled local list (`statusline-funny.sh`) and [JokeAPI](https://jokeapi.dev) (`Programming` category, NSFW/political/religious/etc. content excluded) — offset by a hash of the session id, so concurrent chat windows land on different jokes at different points in the cycle. Since the status line reruns every `refreshInterval` (as low as every 1s), it **never calls the API on the render path** — that would spam JokeAPI and risk the caller's (hashed) IP getting rate-limited or blacklisted per [their privacy policy](https://jokeapi.dev/#footer):

- A batch of 10 jokes is cached to disk and reused for `jokeTtlMs` (default 15 minutes).
- When the cache goes stale, a **detached background process** fetches a fresh batch and exits — the current render never waits on it and just uses whatever's cached (or the local list) for its turn in the rotation.
- A lock file debounces concurrent statusline invocations so only one background fetch runs at a time.
- If the API is unreachable, slow (5s timeout), or the cache isn't populated yet, that turn in the rotation falls back to the local list instead. To skip JokeAPI entirely (local jokes only, no network calls at all): `/sl jokeapi off` or `CC_SL_JOKEAPI=0`.
- Embedded newlines in a joke's text are collapsed to ` | ` so one joke can never wrap the status line onto extra lines.

## Toggle numeric intervals — `/sl`

Same `/sl` command, but for the three tunable intervals. **These already ship with sane defaults — you don't need to touch them to use cc-statusline.** Only change them if you want, e.g., a slower joke rotation or a longer cost-scan cache window:

```
/sl jokeRotateMs 60000   # change the joke every 60s instead of 30s
/sl cacheTtlMs 60000     # rescan 7d/30d cost every 60s instead of 30s
/sl jokeTtlMs 1800000    # refetch a JokeAPI batch every 30min instead of 15
```

| Key | Default | Purpose |
|---|---|---|
| `cacheTtlMs` | `30000` (30s) | How long the 7d/30d cost scan is cached before rescanning |
| `jokeTtlMs` | `900000` (15min) | How long a batch of JokeAPI jokes is cached before refetching |
| `jokeRotateMs` | `30000` (30s) | How often the joke line changes / alternates source |
| `jokeMaxLen` | `100` | Max characters for the joke text before it's cut (on a word boundary where possible) with `…` |

Same env-var fallback pattern as the boolean toggles: `CC_SL_CACHE_TTL_MS`, `CC_SL_JOKE_TTL_MS`, `CC_SL_JOKE_ROTATE_MS` — the toggle file takes precedence when both are set.

## Env vars

| Var | Default | Purpose |
|---|---|---|
| `CC_SL_<SECTION>` | `1` | Set to `0`/`false` to disable a section (see toggle keys above) |
| `CC_SL_CACHE_TTL_MS` | `30000` | See "Toggle numeric intervals" above |
| `CC_SL_JOKE_TTL_MS` | `900000` | See "Toggle numeric intervals" above |
| `CC_SL_JOKE_ROTATE_MS` | `30000` | See "Toggle numeric intervals" above |

## Files

- `index.js` — the status line itself
- `statusline-funny.sh` — joke-line source, one message per 30s window, hashed by session id so concurrent chat windows don't show the same line
- `toggle.sh` — flips a key in the toggle-state file (used by `/sl`)
- `commands/sl.md` — the `/sl` slash command definition
- `install.sh` — one-time setup after cloning
