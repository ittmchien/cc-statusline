#!/usr/bin/env node
// Claude Code status line — Node.js port of statusline-command.sh
// Renders a 3-4 line status block from JSON received on stdin.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

// ---------- Read stdin ----------
let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch (_) {}
let data = {};
try { data = JSON.parse(raw || '{}'); } catch (_) {}

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
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

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

function fmt1(n) { return (Number(n) || 0).toFixed(1); }

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

// ---------- Build lines ----------
const lines = [];

let funny = '';
try {
  funny = execSync(`bash "${path.join(__dirname, 'statusline-funny.sh')}"`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trimEnd();
} catch (_) {}

// Line 1: cwd + git + funny message
let line1 = `${SL_YELLOW}📁 ${shortPath}${N}`;
if (branch) {
  const icon = branchEmoji(branch) || DEFAULT_BRANCH_ICON;
  line1 += ` ${SL_GIT}${icon} ${branch}${N}`;
}
if (funny) line1 += ` ${D}|${N} ${funny}`;
lines.push(line1);

// Line 2: model + context + cost (session / 7d / 30d)
let line2 = '';
if (modelId) {
  const ms = modelDisplay || formatModel(modelId, modelDisplay);
  line2 = `${B}◆ ${ms}${N} ${D}|${N}`;
}
const ctxBar = progressBar(ctxPct);
const ctxColor = pctColor(ctxPct);
line2 += ` ${D}🧠${N} ${ctxBar} ${ctxColor}${fmt1(ctxPct)}%${N}`;
const { weekCost, monthCost } = getRollingCosts();
line2 += ` ${D}|${N} ${D}💰${N} ${C}~$${fmtCost(sessionCost)}${N} ${D}|${N} ` +
  `${D}7d${N} ${C}~$${fmtCost(weekCost)}${N} ${D}|${N} ` +
  `${D}30d${N} ${C}~$${fmtCost(monthCost)}${N}`;
lines.push(line2);

// Line 3: rate limits
let line3 = '';
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
if (line3) lines.push(line3);

process.stdout.write(lines.join('\n'));
