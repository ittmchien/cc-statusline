#!/usr/bin/env node
// Claude Code status line — Node.js port of statusline-command.sh
// Renders a 3-4 line status block from JSON received on stdin.

const fs = require('fs');
const os = require('os');
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
// Sonnet 5 intro pricing ($2/$10) runs through 2026-08-31; falls back to
// standard ($3/$15) after that. Derive cacheRead/cacheWrite as 0.1x/1.25x input.
const SONNET_INTRO_CUTOFF = new Date('2026-08-31T23:59:59Z').getTime();
const sonnetBase = Date.now() <= SONNET_INTRO_CUTOFF
  ? { input: 2.00, output: 10.00 }
  : { input: 3.00, output: 15.00 };

const PRICING = {
  // Opus 4.6 / 4.7 / 4.8
  opus: { input: 5.00, output: 25.00, cacheRead: 0.50, cacheWrite: 6.25 },
  // Sonnet 5 (default)
  sonnet: {
    ...sonnetBase,
    cacheRead: sonnetBase.input * 0.1,
    cacheWrite: sonnetBase.input * 1.25,
  },
  // Haiku 4.5
  haiku: { input: 1.00, output: 5.00, cacheRead: 0.10, cacheWrite: 1.25 },
};

function getPricing(modelId) {
  if (!modelId) return PRICING.sonnet;
  const id = modelId.toLowerCase();
  if (/opus/.test(id)) return PRICING.opus;
  if (/haiku/.test(id)) return PRICING.haiku;
  return PRICING.sonnet;
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
const cwd = data.cwd || process.cwd();
const home = process.env.HOME || os.homedir();
const shortPath = cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;

let branch = '';
try {
  branch = execSync(`git -C "${cwd}" symbolic-ref --short HEAD 2>/dev/null`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch (_) {}

const modelId = data.model?.id || (typeof data.model === 'string' ? data.model : '');
const modelDisplay = data.model?.display_name || '';
const pricing = getPricing(modelId);

const ctxPct = parseFloat(data.context_window?.used_percentage ?? 0);
const totalIn = parseInt(data.context_window?.total_input_tokens ?? 0, 10);
const totalOut = parseInt(data.context_window?.total_output_tokens ?? 0, 10);
const cacheRead = parseInt(data.context_window?.current_usage?.cache_read_input_tokens ?? 0, 10);
const cacheWrite = parseInt(data.context_window?.current_usage?.cache_creation_input_tokens ?? 0, 10);

const sessionCost =
  totalIn    / 1e6 * pricing.input +
  totalOut   / 1e6 * pricing.output +
  cacheRead  / 1e6 * pricing.cacheRead +
  cacheWrite / 1e6 * pricing.cacheWrite;

const fiveHrPct = data.rate_limits?.five_hour?.used_percentage;
const fiveHrReset = data.rate_limits?.five_hour?.resets_at;
const weeklyPct = data.rate_limits?.seven_day?.used_percentage;
const weeklyReset = data.rate_limits?.seven_day?.resets_at;

// ---------- Build lines ----------
const lines = [];

// Line 1: cwd + git
let line1 = `${SL_YELLOW}📁 ${shortPath}${N}`;
if (branch) {
  const icon = branchEmoji(branch) || DEFAULT_BRANCH_ICON;
  line1 += ` ${SL_GIT}${icon} ${branch}${N}`;
}
lines.push(line1);

// Line 2: model + context + cost
let line2 = '';
if (modelId) {
  const ms = modelDisplay || formatModel(modelId, modelDisplay);
  line2 = `${B}◆ ${ms}${N} ${D}|${N}`;
}
const ctxBar = progressBar(ctxPct);
const ctxColor = pctColor(ctxPct);
line2 += ` ${D}🧠${N} ${ctxBar} ${ctxColor}${fmt1(ctxPct)}%${N}`;
line2 += ` ${D}|${N} ${D}💸${N} ${C}~$${fmtCost(sessionCost)}${N}`;
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

// Line 4: funny message
try {
  const funny = execSync(`bash "${home}/.claude/statusline-funny.sh"`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trimEnd();
  if (funny) lines.push(funny);
} catch (_) {}

process.stdout.write(lines.join('\n'));
