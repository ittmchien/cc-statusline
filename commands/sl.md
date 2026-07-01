---
description: Toggle a cc-statusline section on or off, no restart needed
argument-hint: '[folder|git|funny|model|context|session|rolling|ratelimits] [on|off]'
---
Run this and report the one-line result back to the user, terse, no extra explanation:

```bash
bash ~/cc-statusline/toggle.sh $ARGUMENTS
```

Valid keys:
- `folder` — the 📁 cwd path
- `git` — the branch name (with gitmoji-by-prefix icon)
- `funny` — the random developer joke line
- `model` — the ◆ model name
- `context` — the 🧠 context-window usage bar
- `session` — the 💰 current-session cost
- `rolling` — the 7d / 30d rolling cost totals
- `ratelimits` — the 5h / 7d rate-limit bars

Usage: `/sl funny` (flips it), or `/sl funny off` (explicit on/off).
