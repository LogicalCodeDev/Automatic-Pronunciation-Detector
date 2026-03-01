/**
 * dashboard.js
 * Logic for the Pronunciation Trainer dashboard page.
 * Reads data written by callbacks.js via localStorage and renders
 * stats, a trend chart, and a filterable/sortable word table.
 */

'use strict';

// ── localStorage keys (must match callbacks.js) ──────────────
const HISTORY_KEY  = 'pt_history_v2';
const MISTAKES_KEY = 'pt_word_mistakes_v2';

// ── Sort state ───────────────────────────────────────────────
let sortKey = 'badCount';
let sortDir = -1;           // -1 = descending, 1 = ascending

// Aggregated word records (populated on init, re-used by filters)
let allAggregated = [];

// ── Theme ────────────────────────────────────────────────────

/**
 * Apply a theme to the document root and update the toggle icon.
 * @param {'dark'|'light'} theme
 */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
}

/** Toggle between dark and light themes, persist the choice, and redraw the chart. */
function toggleDarkMode() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next    = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('pt_theme', next); } catch (_) {}
  drawTrendChart(loadHistory());
}

// Apply saved theme immediately (before DOMContentLoaded) to avoid flash
(function applyStoredTheme() {
  let saved = 'dark';
  try { saved = localStorage.getItem('pt_theme') || 'dark'; } catch (_) {}
  applyTheme(saved);
})();

// ── Data helpers ─────────────────────────────────────────────

/** @returns {Array} Word-level mistake records from localStorage. */
function loadMistakes() {
  try { return JSON.parse(localStorage.getItem(MISTAKES_KEY) || '[]'); } catch (_) { return []; }
}

/** @returns {Array} Sentence-level history records from localStorage. */
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (_) { return []; }
}

/**
 * Aggregate flat word records into per-(word + language) summaries.
 * @param {Array} records - Raw mistake records.
 * @returns {Array} Aggregated word objects.
 */
function aggregateWords(records) {
  const map = {};

  for (const record of records) {
    const key = `${record.word.toLowerCase()}___${record.language}`;

    if (!map[key]) {
      map[key] = {
        word:       record.word,
        language:   record.language,
        realIpa:    record.realIpa,
        spokenIpas: [],
        categories: [],
        count:      0,
        badCount:   0,
      };
    }

    const entry = map[key];
    entry.count++;
    entry.categories.push(record.category);
    if (record.category === 2) entry.badCount++;
    if (record.spokenIpa && record.spokenIpa !== '-') entry.spokenIpas.push(record.spokenIpa);
    if (!entry.realIpa && record.realIpa) entry.realIpa = record.realIpa;
  }

  return Object.values(map);
}

/**
 * Return the worst (highest-severity) category seen for a word.
 * @param {number[]} cats
 * @returns {0|1|2}
 */
function worstCategory(cats) {
  if (cats.includes(2)) return 2;
  if (cats.includes(1)) return 1;
  return 0;
}

/**
 * Convert an array of category values to an approximate accuracy percentage.
 * Category map: 0 → 90 %, 1 → 65 %, 2 → 20 %
 * @param {number[]} cats
 * @returns {number}
 */
function avgAccuracy(cats) {
  if (!cats.length) return 0;
  const pctMap = [90, 65, 20];
  return Math.round(cats.reduce((sum, c) => sum + (pctMap[c] ?? 0), 0) / cats.length);
}

// ── Stats cards ──────────────────────────────────────────────

/**
 * Populate the six stat-card values at the top of the page.
 * @param {Array} records    - Flat mistake records.
 * @param {Array} historyArr - Sentence history records.
 */
function updateStats(records, historyArr) {
  const total    = records.length;
  const badCount = records.filter(r => r.category === 2).length;
  const goodCount= records.filter(r => r.category === 0).length;
  const unique   = new Set(records.map(r => r.word.toLowerCase())).size;
  const allCats  = records.map(r => r.category);
  const avg      = allCats.length ? avgAccuracy(allCats) : null;

  setText('statTotal',    total);
  setText('statBad',      badCount);
  setText('statGood',     goodCount);
  setText('statUnique',   unique);
  setText('statSessions', historyArr.length);

  const avgEl = document.getElementById('statAvg');
  if (avgEl) {
    if (avg === null) {
      avgEl.textContent = '—';
      avgEl.className   = 'stat-value';
    } else {
      avgEl.textContent = `${avg}%`;
      avgEl.className   = `stat-value ${avg >= 70 ? 'good' : avg >= 30 ? 'ok' : 'bad'}`;
    }
  }
}

/** Set the text content of an element by ID, ignoring missing elements. */
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ── Trend chart ──────────────────────────────────────────────

/**
 * Draw a smooth score-trend line chart on #trendCanvas.
 * @param {Array} historyArr - Sentence history records (newest first).
 */
function drawTrendChart(historyArr) {
  const chartWrap = document.getElementById('chartWrap');

  if (!historyArr?.length) {
    chartWrap.style.display = 'none';
    return;
  }
  chartWrap.style.display = '';

  const canvas = document.getElementById('trendCanvas');
  const ctx    = canvas.getContext('2d');
  const dpr    = window.devicePixelRatio || 1;
  const rect   = canvas.getBoundingClientRect();

  canvas.width  = (rect.width  || 800) * dpr;
  canvas.height = (rect.height || 100) * dpr;
  ctx.scale(dpr, dpr);

  const W = canvas.width  / dpr;
  const H = canvas.height / dpr;

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  ctx.fillStyle = isDark ? '#101826' : '#f6f9ff';
  ctx.fillRect(0, 0, W, H);

  // Take the last 30 attempts (reverse so oldest is on the left)
  const pts = historyArr.slice(-30).reverse();
  if (pts.length < 2) return;

  const pad = { l: 10, r: 10, t: 10, b: 10 };
  const gW  = W - pad.l - pad.r;
  const gH  = H - pad.t - pad.b;

  // Grid lines at 25 %, 50 %, 75 %
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)';
  ctx.lineWidth   = 1;
  [25, 50, 75].forEach(pct => {
    const y = pad.t + gH - (pct / 100) * gH;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(W - pad.r, y);
    ctx.stroke();
  });

  const accentColor = isDark ? '#00c8ff' : '#0070e0';

  /**
   * Convert a data-point index to canvas {x, y} coordinates.
   * @param {number} i
   * @returns {{ x: number, y: number }}
   */
  const getXY = i => ({
    x: pad.l + (i / (pts.length - 1)) * gW,
    y: pad.t + gH - (Math.max(0, Math.min(100, pts[i].score)) / 100) * gH,
  });

  // Gradient fill under the line
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + gH);
  grad.addColorStop(0, isDark ? 'rgba(0,200,255,0.25)' : 'rgba(0,112,224,0.20)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');

  const drawCurve = (fill = false) => {
    const p0 = getXY(0);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);

    for (let i = 1; i < pts.length; i++) {
      const prev = getXY(i - 1);
      const curr = getXY(i);
      const cpx  = (prev.x + curr.x) / 2;
      ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
    }

    if (fill) {
      const pLast = getXY(pts.length - 1);
      ctx.lineTo(pLast.x, H - pad.b);
      ctx.lineTo(pad.l,   H - pad.b);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    } else {
      ctx.strokeStyle = accentColor;
      ctx.lineWidth   = 2;
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      ctx.stroke();
    }
  };

  drawCurve(true);   // filled area
  drawCurve(false);  // line on top

  // Coloured dots at each data point
  pts.forEach((pt, i) => {
    const { x, y } = getXY(i);
    const color    = pt.score >= 70 ? '#22c55e' : pt.score >= 30 ? '#f59e0b' : '#ef4444';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });
}

// ── Sorting ──────────────────────────────────────────────────

/**
 * Toggle sort direction for a column key, then re-render the table.
 * @param {string} key - Column identifier.
 */
function toggleSort(key) {
  sortDir = (sortKey === key) ? sortDir * -1 : -1;
  sortKey = key;
  applyFilters();
}

// ── Filtering & rendering ────────────────────────────────────

/** Read the current filter state and re-render the table. */
function applyFilters() {
  const lang  = document.querySelector('input[name="langFilter"]:checked')?.value || 'all';
  const cat   = document.querySelector('input[name="catFilter"]:checked')?.value  || 'all';
  const query = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();

  let rows = allAggregated.filter(r => {
    if (lang !== 'all' && r.language !== lang) return false;
    if (cat  !== 'all' && worstCategory(r.categories) !== parseInt(cat, 10)) return false;
    if (query && !r.word.toLowerCase().includes(query)) return false;
    return true;
  });

  // Sort
  rows.sort((a, b) => {
    let va, vb;
    switch (sortKey) {
      case 'word':     va = a.word.toLowerCase();       vb = b.word.toLowerCase(); break;
      case 'count':    va = a.count;                    vb = b.count; break;
      case 'acc':      va = avgAccuracy(a.categories);  vb = avgAccuracy(b.categories); break;
      case 'badCount':
      default:         va = a.badCount;                 vb = b.badCount;
    }
    if (va < vb) return -sortDir;
    if (va > vb) return  sortDir;
    return 0;
  });

  renderTable(rows);
}

// Static lookup tables
const LANG_FLAG = { en: '🇬🇧', hi: '🇮🇳', mr: '🇮🇳' };
const CAT_NAMES = ['Good', 'Okay', 'Needs Work'];
const CAT_CLS   = ['good', 'ok', 'bad'];

/**
 * Return an HTML sort-indicator icon for a column header.
 * @param {string} key
 * @returns {string}
 */
function sortIcon(key) {
  if (sortKey !== key) {
    return '<span class="material-icons sort-icon">unfold_more</span>';
  }
  const icon = sortDir === -1 ? 'keyboard_arrow_down' : 'keyboard_arrow_up';
  return `<span class="material-icons sort-icon">${icon}</span>`;
}

/**
 * Render (or replace) the word analysis table.
 * @param {Array} rows - Filtered and sorted aggregated rows.
 */
function renderTable(rows) {
  const container = document.getElementById('tableContainer');
  const countEl   = document.getElementById('tableCount');

  if (countEl) countEl.textContent = `${rows.length} word${rows.length !== 1 ? 's' : ''}`;

  if (!rows.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-icons">search_off</span>
        <p>No words match your current filters.</p>
      </div>`;
    return;
  }

  const thead = `
    <thead><tr>
      <th onclick="toggleSort('word')">Word ${sortIcon('word')}</th>
      <th>Real IPA</th>
      <th>Spoken IPA</th>
      <th onclick="toggleSort('count')">Times ${sortIcon('count')}</th>
      <th onclick="toggleSort('acc')">Avg Accuracy ${sortIcon('acc')}</th>
      <th onclick="toggleSort('badCount')">Mistakes ${sortIcon('badCount')}</th>
      <th>Category</th>
      <th>Lang</th>
    </tr></thead>`;

  const tbody = '<tbody>' + rows.slice(0, 200).map(r => {
    const wc          = worstCategory(r.categories);
    const acc         = avgAccuracy(r.categories);
    const accColor    = acc >= 70 ? '#22c55e' : acc >= 30 ? '#f59e0b' : '#ef4444';
    const lastSpoken  = r.spokenIpas.at(-1) ?? '—';

    return `<tr>
      <td class="word-cell">${esc(r.word)}</td>
      <td class="ipa-cell" title="${esc(r.realIpa)}">${esc(r.realIpa || '—')}</td>
      <td class="ipa-cell ipa-spoken" title="${esc(lastSpoken)}">${esc(lastSpoken)}</td>
      <td class="count-cell">${r.count}</td>
      <td>
        <div class="acc-bar-wrap">
          <div class="acc-bar-bg">
            <div class="acc-bar-fill" style="width:${acc}%;background:${accColor}"></div>
          </div>
          <span class="acc-val" style="color:${accColor}">${acc}%</span>
        </div>
      </td>
      <td class="count-cell" style="color:var(--bad)">${r.badCount}</td>
      <td><span class="cat-badge ${CAT_CLS[wc]}">${CAT_NAMES[wc]}</span></td>
      <td><span class="lang-badge">${LANG_FLAG[r.language] ?? '🌐'} ${r.language.toUpperCase()}</span></td>
    </tr>`;
  }).join('') + '</tbody>';

  container.innerHTML = `<table>${thead}${tbody}</table>`;
}

/**
 * Escape a string for safe insertion into HTML.
 * @param {string} str
 * @returns {string}
 */
function esc(str) {
  return (str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Clear all data ───────────────────────────────────────────

/** Prompt the user and, on confirmation, wipe all localStorage data. */
function clearAllData() {
  if (!confirm('Clear ALL pronunciation history and word data? This cannot be undone.')) return;
  try {
    localStorage.removeItem(MISTAKES_KEY);
    localStorage.removeItem(HISTORY_KEY);
  } catch (_) {}
  init();
}

// ── Initialisation ───────────────────────────────────────────

/** Load data, render stats, chart, and table; attach filter listeners. */
function init() {
  const records    = loadMistakes();
  const historyArr = loadHistory();

  allAggregated = aggregateWords(records);

  updateStats(records, historyArr);
  drawTrendChart(historyArr);
  applyFilters();

  // Wire up tab-style radio filters
  document.querySelectorAll('input[name="langFilter"], input[name="catFilter"]')
    .forEach(el => el.addEventListener('change', applyFilters));
}

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('resize', () => drawTrendChart(loadHistory()));