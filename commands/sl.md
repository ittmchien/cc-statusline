---
description: Toggle a cc-statusline section, or set a numeric interval — no restart needed
argument-hint: '[remote|folder|git|worktree|funny|jokeapi|model|context|session|today|rolling|ratelimits|tokens|bars|cacheTtlMs|jokeTtlMs|jokeRotateMs] [on|off|<number>]'
---
Run this and report the one-line result back to the user, terse, no extra explanation:

```bash
bash ~/cc-statusline/toggle.sh $ARGUMENTS
```

Boolean keys (on/off, or omit the value to flip):
- `remote` — the `🔗 ✅/❌` Remote Control indicator before the 📁 cwd (✅ = active)
- `folder` — the 📁 cwd path
- `git` — the branch name (with gitmoji-by-prefix icon)
- `worktree` — the ⧉ linked-worktree name (only shown when the cwd is inside a linked git worktree)
- `funny` — the joke line (local list + JokeAPI, alternating)
- `jokeapi` — the JokeAPI half of the rotation specifically (off = local jokes only, no network calls)
- `model` — the ◆ model name
- `context` — the 🧠 context-window usage bar
- `session` — the 💰 current-session cost
- `today` — today's cost/tokens (local calendar day)
- `rolling` — the 7d / 30d rolling cost totals
- `ratelimits` — the 5h / 7d rate-limit usage
- `tokens` — the 🪙 token counts shown next to the session / today / 7d / 30d costs
- `bars` — the progress bars on the context + rate-limit segments (off = percentages only)

Numeric keys (pass a millisecond value):
- `cacheTtlMs` — how long the 7d/30d cost scan is cached (default 30000)
- `jokeTtlMs` — how long a JokeAPI batch is cached before refetching (default 900000)
- `jokeRotateMs` — how often the joke line changes / alternates source (default 30000)

Usage: `/sl funny` (flips it), `/sl funny off` (explicit on/off), `/sl jokeRotateMs 60000` (set a number).
