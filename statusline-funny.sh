#!/usr/bin/env bash
# Claude Code status line - random funny developer message

messages=(
  "It works on my machine. Ship the machine."
  "undefined is not a function, but my frustration is."
  "99 little bugs in the code, 99 little bugs... patch one down, compile it around... 127 little bugs in the code."
  "The best code is no code at all. So why do I keep writing it?"
  "git blame yourself."
  "Have you tried turning the requirements off and on again?"
  "TODO: fix this before code review. (since 2019)"
  "I'm not a magician. Actually, wait... sudo."
  "A 'quick fix' later became a legacy system."
  "It's not a bug, it's an undocumented feature with job security."
  "Coffee: because napping under your desk is frowned upon."
  "There are 10 types of developers: those who understand binary, and those who don't."
  "Recursion: see 'Recursion'."
  "Always code as if the guy maintaining your code is a violent psychopath."
  "That feeling when your regex works on the first try. Brief. Suspicious."
  "var = works; // I have no idea why, do not touch."
  "Ship it. Fear is just a state machine with bad transitions."
  "Senior dev: someone who knows where not to click."
  "Naming things is hard. This function is now called doStuff2_FINAL_v3."
  "The cloud is just someone else's computer crying for help."
  "Clean code is like a love letter to your future self."
  "Stack Overflow is down. Productivity: also down."
  "console.log('why'); // left from debugging in 2022"
  "It compiles. Ship it."
  "Premature optimisation is the root of all evil. Late optimisation is the root of all apologies."
  "Works in dev, works in staging, prod has other plans."
  "I don't always test my code, but when I do, it's in production."
  "// I'm sorry. — past me"
  "The bug was in the last place I looked. It's always the last place I look."
  "Merge conflicts: git's way of saying 'you and past you should talk more.'"
  "Refactoring: the art of making the diff bigger to make the code smaller."
  "It's called technical debt because eventually someone repossesses your sanity."
  "My code doesn't have bugs. It has surprise features."
  "Documentation is a love letter that you write to yourself that you'll never read."
  "npm install: downloading the internet, one node_module at a time."
  "The fastest way to fix a bug is to add a comment saying you'll fix it later."
  "Two spaces, four spaces, tabs — the real bug is in the room with us."
  "I named the variable 'temp' in 2015. It is still there."
  "Every 'this will only take 5 minutes' has a 3-day expansion pack."
  "The demo gods giveth, and the demo gods taketh away — usually mid-presentation."
  "YAGNI, they said. Six months later: 'we need that thing we didn't build.'"
  "My rubber duck has seen things it can never unsee."
  "404: Motivation not found."
  "Half of debugging is printing. The other half is deleting the prints you forgot."
  "Works on Friday. Deploy on Monday. Prevention is not a QA strategy."
  "I read the error message this time. It didn't help."
  "The commit message says 'fix'. It has never once been just a fix."
  "Legacy code: any code that works and that you're afraid to touch."
  "Add a try/catch and pray — the enterprise architecture pattern."
  "AI wrote this comment. AI is also unsure why this function exists."
)

# Pick a message based on the current N-second window (so it doesn't change
# every refresh — N comes from arg2, default 15s, kept in sync with
# JOKE_ROTATE_MS in index.js), offset by a hash of the session id (arg1) so
# different chat windows land on different messages instead of the same one.
session_id="${1:-}"
rotate_secs="${2:-15}"
session_hash=0
if [ -n "$session_id" ]; then
  session_hash=$(printf '%s' "$session_id" | cksum | awk '{print $1}')
fi
now_s=$(date +%s)
window=$(( now_s / rotate_secs ))
idx=$(( (window + session_hash) % ${#messages[@]} ))
msg="${messages[$idx]}"

# Plain text only — index.js applies the emoji/color styling and truncation
# uniformly for whichever source (this or JokeAPI) ends up being shown.
printf '%s' "$msg"
