#!/usr/bin/env node
// Claude Code status line — Node.js port of statusline-command.sh
// Renders a 3-4 line status block from JSON received on stdin.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawn } = require('child_process');

// ---------- Read stdin ----------
let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch (_) {}
let data = {};
try { data = JSON.parse(raw || '{}'); } catch (_) {}

// ---------- Toggle/config file (flip live via toggle.sh / the /sl slash
// command — no restart needed since this whole script re-runs every
// refreshInterval). Booleans use `enabled()`, numeric intervals use
// `configNumber()`; both check this file first, then an env var, then
// the hardcoded default.
const TOGGLE_FILE = path.join(os.homedir(), '.claude', 'cc-statusline-toggles.json');
let toggleState = {};
try { toggleState = JSON.parse(fs.readFileSync(TOGGLE_FILE, 'utf8')); } catch (_) {}

function enabled(key, envVar) {
  if (Object.prototype.hasOwnProperty.call(toggleState, key)) return toggleState[key] !== false;
  return process.env[envVar] !== '0' && process.env[envVar] !== 'false';
}

function configNumber(key, envVar, defaultVal) {
  if (typeof toggleState[key] === 'number') return toggleState[key];
  const fromEnv = parseInt(process.env[envVar], 10);
  return Number.isFinite(fromEnv) ? fromEnv : defaultVal;
}

// ---------- ANSI helpers ----------
const N = '\x1b[0m';
const D = '\x1b[38;5;250m';
const C = '\x1b[36m';
const B = '\x1b[38;2;230;120;80m'; // warm orange/coral
const SL_YELLOW = '\x1b[33m';
const SL_GIT = '\x1b[38;5;197m';

// Smooth RGB gradient: 0→green(0,200,0), 50→yellow(230,230,0), 100→red(230,0,0)
function pctColor(pct, mode = 'fg') {
  let p = Math.max(0, Math.min(100, Math.floor(parseFloat(pct) || 0)));
  let r, g;
  if (p <= 50) {
    r = (p * 23 / 5) | 0;
    g = 200 + ((p * 3 / 5) | 0);
  } else {
    r = 230;
    g = 230 - (((p - 50) * 23 / 5) | 0);
  }
  const sgr = mode === 'bg' ? 48 : 38;
  return `\x1b[${sgr};2;${r};${g};0m`;
}

// Progress bar using Unicode block elements for sub-character precision.
const LIGHT_GRAY = '\x1b[38;5;247m';
const BLOCK_CHARS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

function progressBar(pct, width = 25) {
  const progress = Math.max(0, Math.min(1, (parseFloat(pct) || 0) / 100));
  const wholeWidth = Math.floor(progress * width);
  const remainderWidth = (progress * width) % 1;
  const partIndex = Math.floor(remainderWidth * 8);
  const partChar = BLOCK_CHARS[partIndex];
  const emptyWidth = width - wholeWidth - (partChar === ' ' ? 0 : 1);

  const fillColor = pctColor(pct);
  const filled = '█'.repeat(wholeWidth);
  const empty = '-'.repeat(Math.max(0, emptyWidth));

  return `[${fillColor}${filled}${partChar}${N}${LIGHT_GRAY}${empty}${N}]`;
}

// ---------- Model-aware pricing (per million tokens) ----------
// input/output/cacheRead are flat. Cache WRITES depend on the cache entry's
// TTL: 5-minute (1.25x input) or 1-hour (2x input) — see cacheWrite5m/1h below.
// Verified against `ccusage` (community tool reading the same transcripts):
// Sonnet 5 bills at the same standard rate as Sonnet 4.6, not the documented
// intro discount — cross-checked exactly on real usage data, so the intro
// price is dropped here rather than trusted against a single doc source.
function sonnetRate() { return { input: 3.00, output: 15.00 }; }
const RATES = {
  opus:   { input: 5.00, output: 25.00 },
  sonnet: sonnetRate(),
  haiku:  { input: 1.00, output: 5.00 },
};

function getPricing(modelId) {
  const base = (() => {
    if (!modelId) return RATES.sonnet;
    const id = modelId.toLowerCase();
    if (/opus/.test(id)) return RATES.opus;
    if (/haiku/.test(id)) return RATES.haiku;
    return RATES.sonnet;
  })();
  return {
    input: base.input,
    output: base.output,
    cacheRead: base.input * 0.1,
    cacheWrite5m: base.input * 1.25,
    cacheWrite1h: base.input * 2,
  };
}

// ---------- Weekly / monthly cost (scans local transcript history) ----------
// Claude Code only exposes the CURRENT session's cost natively (data.cost.total_cost_usd).
// For rolling 7d/30d totals we sum token usage across every transcript under
// ~/.claude/projects/**/*.jsonl. Scanning that on every refresh (1s interval)
// is too slow, so results are cached to disk for CACHE_TTL_MS.
const USAGE_CACHE_FILE = path.join(os.tmpdir(), 'cc-statusline-usage-cache.json');
// No focus/refresh hook exists for statusline commands — Claude Code just
// re-runs this on its own refreshInterval. Shorter TTL = fresher numbers
// when you glance back at a stale terminal, at the cost of more frequent
// disk scans. Override with CC_SL_CACHE_TTL_MS if you want to tune it.
const CACHE_TTL_MS = configNumber('cacheTtlMs', 'CC_SL_CACHE_TTL_MS', 30 * 1000);

function costForUsage(usage, modelId) {
  if (!usage) return 0;
  // Historical transcripts can contain non-Claude entries (synthetic
  // follow-ups, third-party models routed through a proxy) — they aren't
  // billed at Claude per-token rates, so exclude rather than guess.
  if (!modelId || !/^claude-/i.test(modelId)) return 0;
  const p = getPricing(modelId);
  // cache_creation breaks down by TTL when present; older/partial records
  // may lack the breakdown — treat those as 5m (the API default TTL).
  const cc = usage.cache_creation || {};
  const cw1h = cc.ephemeral_1h_input_tokens || 0;
  const cw5m = cc.ephemeral_5m_input_tokens ||
    (cw1h === 0 ? (usage.cache_creation_input_tokens || 0) : 0);
  return (
    (usage.input_tokens || 0)            / 1e6 * p.input +
    (usage.output_tokens || 0)           / 1e6 * p.output +
    (usage.cache_read_input_tokens || 0) / 1e6 * p.cacheRead +
    cw5m / 1e6 * p.cacheWrite5m +
    cw1h / 1e6 * p.cacheWrite1h
  );
}

function findTranscripts(dir) {
  let out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(findTranscripts(full));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

function scanUsageCost(sinceMonthMs, sinceWeekMs) {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  let weekCost = 0;
  let monthCost = 0;
  // Session resume/compaction rewrites overlapping history into new
  // transcript files, so the same assistant message (by message.id) can
  // appear in several files. Dedupe globally or costs get double-counted.
  const seenMessageIds = new Set();

  for (const file of findTranscripts(projectsDir)) {
    let stat;
    try { stat = fs.statSync(file); } catch (_) { continue; }
    // A transcript's mtime is its last write — if that's older than the
    // month window, every line in it is too, so skip the whole file.
    if (stat.mtimeMs < sinceMonthMs) continue;

    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }

    for (const line of content.split('\n')) {
      if (!line) continue;
      let entry;
      try { entry = JSON.parse(line); } catch (_) { continue; }
      const usage = entry.message?.usage;
      if (!usage) continue;
      const ts = Date.parse(entry.timestamp);
      if (!Number.isFinite(ts) || ts < sinceMonthMs) continue;

      const msgId = entry.message?.id;
      if (msgId) {
        if (seenMessageIds.has(msgId)) continue;
        seenMessageIds.add(msgId);
      }

      const cost = costForUsage(usage, entry.message?.model);
      monthCost += cost;
      if (ts >= sinceWeekMs) weekCost += cost;
    }
  }

  return { weekCost, monthCost };
}

function getRollingCosts() {
  try {
    const cached = JSON.parse(fs.readFileSync(USAGE_CACHE_FILE, 'utf8'));
    if (Date.now() - cached.computedAt < CACHE_TTL_MS) return cached;
  } catch (_) {}

  const now = Date.now();
  const result = {
    ...scanUsageCost(now - 30 * 86400 * 1000, now - 7 * 86400 * 1000),
    computedAt: now,
  };
  try { fs.writeFileSync(USAGE_CACHE_FILE, JSON.stringify(result)); } catch (_) {}
  return result;
}

// ---------- Helpers ----------
function formatModel(id, display) {
  if (!id) return display || '';
  let name;
  if (/opus/i.test(id)) name = 'Opus';
  else if (/sonnet/i.test(id)) name = 'Sonnet';
  else if (/haiku/i.test(id)) name = 'Haiku';
  else return display || id.slice(0, 20);
  const is1M = /1m/i.test(id) || /1m/i.test(display || '');
  const m = id.match(/(opus|sonnet|haiku)-(\d+)-(\d+)/i);
  const version = m ? `${m[2]}.${m[3]}` : null;
  const suffix = is1M ? ' 1M' : '';
  if (version) return `${name} ${version}${suffix}`;
  return (display || name) + suffix;
}

function timeUntil(ts) {
  if (!ts || ts === 'null' || ts === '0' || ts === 0) return '';
  const now = Math.floor(Date.now() / 1000);
  const diff = Number(ts) - now;
  if (diff <= 0) return 'now';
  const days = (diff / 86400) | 0;
  const hours = ((diff % 86400) / 3600) | 0;
  const mins = ((diff % 3600) / 60) | 0;
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}

// ---------- Gitmoji branch-prefix mapping ----------
// https://gist.github.com/parmentf/035de27d6ed1dce0b36a
const BRANCH_EMOJI = {
  feat: '✨', feature: '✨',
  fix: '🐛', bugfix: '🐛',
  hotfix: '🚑️',
  release: '🔖',
  chore: '🔧',
  docs: '📝', doc: '📝',
  refactor: '♻️',
  test: '🧪', tests: '🧪',
  perf: '⚡️',
  style: '💄',
  build: '📦️',
  ci: '👷',
  revert: '⏪️',
  wip: '🚧',
  security: '🔒️',
};

function branchEmoji(branchName) {
  const prefix = branchName.split(/[\/-]/)[0].toLowerCase();
  return BRANCH_EMOJI[prefix] || '';
}
const DEFAULT_BRANCH_ICON = '';

// ---------- JokeAPI (https://v2.jokeapi.dev) — batched, cached, never blocking ----------
// The render path is invoked every refreshInterval (as low as 1s), so it
// NEVER makes a network call itself — that would hammer JokeAPI and risk
// getting the caller's (hashed) IP rate-limited/blacklisted per their policy.
// Instead: read whatever's cached; if the cache is stale, fire a detached
// background process to refresh it (fetches a batch of 10 in one request)
// and move on immediately. Falls back to the local joke list in
// statusline-funny.sh whenever the cache is empty or the API is unreachable.
const JOKE_CACHE_FILE = path.join(os.tmpdir(), 'cc-statusline-jokeapi-cache.json');
const JOKE_REFRESH_LOCK_FILE = path.join(os.tmpdir(), 'cc-statusline-jokeapi-refresh.lock');
const JOKE_CACHE_TTL_MS = configNumber('jokeTtlMs', 'CC_SL_JOKE_TTL_MS', 15 * 60 * 1000); // 15 min
const JOKE_API_URL = 'https://v2.jokeapi.dev/joke/Programming?type=single,twopart' +
  '&blacklistFlags=nsfw,racist,sexist,religious,political,explicit&amount=10';

function readJokeCache() {
  try { return JSON.parse(fs.readFileSync(JOKE_CACHE_FILE, 'utf8')); } catch (_) { return null; }
}

function maybeRefreshJokeCacheInBackground() {
  const cache = readJokeCache();
  if (cache && Date.now() - cache.fetchedAt < JOKE_CACHE_TTL_MS) return; // still fresh
  // Debounce: many statusline invocations can pile up while stale (1s
  // refreshInterval) — only let one background fetch run at a time.
  try {
    const lock = fs.statSync(JOKE_REFRESH_LOCK_FILE);
    if (Date.now() - lock.mtimeMs < 60 * 1000) return; // a fetch is already in flight
  } catch (_) {}
  try { fs.writeFileSync(JOKE_REFRESH_LOCK_FILE, ''); } catch (_) { return; }

  const fetchScript = `
    fetch(${JSON.stringify(JOKE_API_URL)}, { signal: AbortSignal.timeout(5000) })
      .then(r => r.json())
      .then(data => {
        if (!data || data.error || !Array.isArray(data.jokes)) return;
        const jokes = data.jokes
          .map(j => j.type === 'single' ? j.joke : \`\${j.setup} — \${j.delivery}\`)
          .filter(Boolean)
          .filter(j => !/[\\r\\n]/.test(j));
        if (jokes.length) {
          require('fs').writeFileSync(${JSON.stringify(JOKE_CACHE_FILE)},
            JSON.stringify({ jokes, fetchedAt: Date.now() }));
        }
      })
      .catch(() => {})
      .finally(() => { try { require('fs').unlinkSync(${JSON.stringify(JOKE_REFRESH_LOCK_FILE)}); } catch (_) {} });
  `;
  try {
    const child = spawn(process.execPath, ['-e', fetchScript], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch (_) {}
}

const JOKE_ROTATE_MS = configNumber('jokeRotateMs', 'CC_SL_JOKE_ROTATE_MS', 30 * 1000);

function sessionHash(sessionId) {
  let hash = 0;
  for (const ch of String(sessionId || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash;
}

// A single slot number, ticking every JOKE_ROTATE_MS and offset per session
// so concurrent windows land on different jokes. Reused for both picking an
// item from a list AND alternating which source (local vs JokeAPI) to show.
function rotationSlot(sessionId) {
  return Math.floor(Date.now() / JOKE_ROTATE_MS) + sessionHash(sessionId);
}

// Mix the slot number so consecutive rotations land on unrelated list
// indices (genuinely random-looking) instead of just walking the list in
// order — still deterministic per slot, so it stays stable within one
// JOKE_ROTATE_MS window.
function mixHash(n) {
  n = Number(n) >>> 0;
  n ^= n >>> 16; n = Math.imul(n, 0x45d9f3b);
  n ^= n >>> 16; n = Math.imul(n, 0x45d9f3b);
  n ^= n >>> 16;
  return n >>> 0;
}

function pickFromList(list, slot) {
  if (!list.length) return '';
  return list[mixHash(slot) % list.length];
}

function fmt1(n) {
  const v = Number(n) || 0;
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : v.toFixed(1);
}

function fmtCost(c) {
  c = Number(c) || 0;
  if (c >= 1.0) return c.toFixed(2);
  if (c >= 0.01) return c.toFixed(3);
  return c.toFixed(4);
}

// ---------- Extract metrics ----------
const cwd = data.workspace?.current_dir || data.cwd || process.cwd();
const home = process.env.HOME || os.homedir();
const shortPath = cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;

let branch = '';
try {
  branch = execSync(`git -C "${cwd}" symbolic-ref --short HEAD 2>/dev/null`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch (_) {}

const modelId = data.model?.id || (typeof data.model === 'string' ? data.model : '');
const modelDisplay = data.model?.display_name || '';

const ctxPct = parseFloat(data.context_window?.used_percentage ?? 0);

// Prefer Claude Code's own cumulative cost (data.cost.total_cost_usd) — it
// sums every turn across the whole session. context_window.current_usage is
// only the last turn's usage snapshot, not a running total, and undercounts
// badly once turns/compactions pile up. Fall back to it only when the
// native field is absent, reusing the same TTL-aware cost math as the
// historical scan below.
const nativeCost = parseFloat(data.cost?.total_cost_usd);
const sessionCost = Number.isFinite(nativeCost)
  ? nativeCost
  : costForUsage(data.context_window?.current_usage, modelId || 'claude-sonnet-5');

const fiveHrPct = data.rate_limits?.five_hour?.used_percentage;
const fiveHrReset = data.rate_limits?.five_hour?.resets_at;
const weeklyPct = data.rate_limits?.seven_day?.used_percentage;
const weeklyReset = data.rate_limits?.seven_day?.resets_at;

// ---------- Feature toggles ----------
const SHOW_FOLDER = enabled('folder', 'CC_SL_FOLDER');
const SHOW_GIT = enabled('git', 'CC_SL_GIT');
const SHOW_FUNNY = enabled('funny', 'CC_SL_FUNNY');
const SHOW_MODEL = enabled('model', 'CC_SL_MODEL');
const SHOW_CONTEXT = enabled('context', 'CC_SL_CONTEXT');
const SHOW_SESSION = enabled('session', 'CC_SL_SESSION');
const SHOW_ROLLING = enabled('rolling', 'CC_SL_ROLLING');
const SHOW_RATELIMITS = enabled('ratelimits', 'CC_SL_RATELIMITS');
// Separate from SHOW_FUNNY: this one gates the network call specifically —
// off means "local jokes only", never touching JokeAPI at all.
const SHOW_JOKEAPI = enabled('jokeapi', 'CC_SL_JOKEAPI');

// ---------- Build lines ----------
const lines = [];

let funny = '';
if (SHOW_FUNNY) {
  const sessionId = data.session_id || '';
  const slot = rotationSlot(sessionId);
  let apiText = '';
  if (SHOW_JOKEAPI) {
    maybeRefreshJokeCacheInBackground();
    const cache = readJokeCache();
    if (cache?.jokes?.length) apiText = pickFromList(cache.jokes, slot);
  }
  // Alternate source every JOKE_ROTATE_MS: even slot -> local list, odd
  // slot -> JokeAPI (falls back to local if the API cache isn't ready yet).
  let jokeText = '';
  if (slot % 2 === 1 && apiText) {
    jokeText = apiText;
  } else {
    try {
      jokeText = execSync(`bash "${path.join(__dirname, 'statusline-funny.sh')}" "${sessionId}" "${Math.round(JOKE_ROTATE_MS / 1000)}"`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trimEnd();
    } catch (_) {}
    if (!jokeText) jokeText = apiText;
  }
  if (jokeText) {
    // No collapsing or truncation — long jokes (and JokeAPI's embedded
    // newlines) just wrap onto extra terminal lines naturally.
    funny = `\x1b[3m\x1b[38;2;230;120;80m💬 ${jokeText}${N}`;
  }
}

// Line 1: cwd + git + funny message
let line1 = '';
if (SHOW_FOLDER) line1 += `${SL_YELLOW}📁 ${shortPath}${N}`;
if (SHOW_GIT && branch) {
  const icon = branchEmoji(branch) || DEFAULT_BRANCH_ICON;
  if (line1) line1 += ' ';
  line1 += `${SL_GIT}${icon} ${branch}${N}`;
}
if (funny) line1 += line1 ? ` ${D}|${N} ${funny}` : funny;
if (line1) lines.push(line1.trimStart());

// Line 2: model + context + cost (session / 7d / 30d)
let line2 = '';
if (SHOW_MODEL && modelId) {
  const ms = modelDisplay || formatModel(modelId, modelDisplay);
  line2 = `${B}◆ ${ms}${N}`;
}
if (SHOW_CONTEXT) {
  const ctxBar = progressBar(ctxPct);
  const ctxColor = pctColor(ctxPct);
  if (line2) line2 += ` ${D}|${N}`;
  line2 += ` ${D}🧠${N} ${ctxBar} ${ctxColor}${fmt1(ctxPct)}%${N}`;
}
if (SHOW_SESSION) {
  if (line2) line2 += ` ${D}|${N}`;
  line2 += ` ${D}💰${N} ${C}~$${fmtCost(sessionCost)}${N}`;
}
if (SHOW_ROLLING) {
  const { weekCost, monthCost } = getRollingCosts();
  if (line2) line2 += ` ${D}|${N}`;
  line2 += ` ${D}7d${N} ${C}~$${fmtCost(weekCost)}${N} ${D}|${N} ` +
    `${D}30d${N} ${C}~$${fmtCost(monthCost)}${N}`;
}
if (line2) lines.push(line2.trimStart());

// Line 3: rate limits
let line3 = '';
if (SHOW_RATELIMITS) {
  if (fiveHrPct != null && fiveHrPct !== '') {
    const p = parseFloat(fiveHrPct);
    line3 = `${D}5h:${N} ${progressBar(p)} ${pctColor(p)}${fmt1(p)}%${N}`;
    const r = timeUntil(fiveHrReset);
    if (r) line3 += ` ${D}⏱${N} ${r}`;
  }
  if (weeklyPct != null && weeklyPct !== '') {
    const p = parseFloat(weeklyPct);
    if (line3) line3 += ` ${D}|${N} `;
    line3 += `${D}7d:${N} ${progressBar(p)} ${pctColor(p)}${fmt1(p)}%${N}`;
    const r = timeUntil(weeklyReset);
    if (r) line3 += ` ${D}⏱${N} ${r}`;
  }
}
if (line3) lines.push(line3.trimStart());

process.stdout.write(lines.join('\n'));
