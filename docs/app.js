import { createFeed, REGIONS } from './js/feed.js';

const $ = (id) => document.getElementById(id);
const feed = createFeed();

const state = {
  items: [],          // watchlist entries from the feed, each with .quote
  status: null,
  selected: null,     // key
  kType: 8,
  lastPrice: new Map(), // key -> last price, for flashes and alert crossings
};

const fmt = {
  price: (n) => (n == null ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 })),
  compact: (n) => (n == null ? '—' : Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(n)),
  signed: (n, suffix = '') => (n == null ? '—' : `${n > 0 ? '+' : ''}${Number(n).toFixed(2)}${suffix}`),
  time: (t) => (t ? new Date(t).toLocaleTimeString() : '—'),
};
const dir = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('toasts').append(el);
  setTimeout(() => el.remove(), kind === 'alert' ? 12000 : 5000);
}

// ---------- watchlist table ----------

function renderWatchlist() {
  const body = $('watch-body');
  $('empty').hidden = state.items.length > 0;
  body.innerHTML = state.items.map(rowHtml).join('');
  if (state.selected && !state.items.some((i) => i.key === state.selected)) selectSymbol(state.items[0]?.key ?? null);
  else if (!state.selected && state.items.length) selectSymbol(state.items[0].key);
  updateFeedHint();
}

function rowHtml(item) {
  const q = item.quote;
  const hasAlert = item.alertAbove != null || item.alertBelow != null;
  return `<tr data-key="${esc(item.key)}" class="${item.key === state.selected ? 'selected' : ''}">
    <td><span class="sym">${esc(item.code)}</span> <span class="region-tag">${esc(item.region)}</span>${hasAlert ? '<span class="bell" title="Alert set">🔔</span>' : ''}
      <span class="sym-name">${esc(item.name ?? '')}</span></td>
    <td class="num"><span class="last" data-f="last">${fmt.price(q?.ld)}</span></td>
    <td class="num" data-f="chg">${chgHtml(q)}</td>
    <td class="num hide-sm" data-f="range">${q ? `${fmt.price(q.l)} – ${fmt.price(q.h)}` : '—'}</td>
    <td class="num hide-sm" data-f="vol">${fmt.compact(q?.v)}</td>
    <td class="hide-sm" data-f="feed">${feedHtml(q)}</td>
    <td class="num"><button class="remove" data-remove="${esc(item.key)}" title="Remove ${esc(item.code)}" aria-label="Remove ${esc(item.code)}">×</button></td>
  </tr>`;
}

function chgHtml(q) {
  if (!q) return '—';
  return `<span class="pill ${dir(q.ch)}">${fmt.signed(q.chp, '%')}</span><span class="sym-name ${dir(q.ch)}">${fmt.signed(q.ch)}</span>`;
}

function feedHtml(q) {
  if (!q) return '<span class="feed">waiting…</span>';
  const label = { ws: 'live', poll: 'polled', demo: 'demo' }[q.source] ?? q.source;
  return `<span class="feed ${q.source === 'ws' || q.source === 'demo' ? 'ws' : ''}" title="Updated ${fmt.time(q.receivedAt)}">${label} · ${fmt.time(q.receivedAt)}</span>`;
}

function updateRow(item) {
  const row = document.querySelector(`tr[data-key="${CSS.escape(item.key)}"]`);
  if (!row) return renderWatchlist();
  const q = item.quote;
  const prev = state.lastPrice.get(item.key);
  const last = row.querySelector('[data-f=last]');
  last.textContent = fmt.price(q.ld);
  if (prev != null && q.ld !== prev) {
    last.classList.remove('flash-up', 'flash-down');
    void last.offsetWidth; // restart the transition
    last.classList.add(q.ld > prev ? 'flash-up' : 'flash-down');
    setTimeout(() => last.classList.remove('flash-up', 'flash-down'), 150);
  }
  row.querySelector('[data-f=chg]').innerHTML = chgHtml(q);
  row.querySelector('[data-f=range]').textContent = `${fmt.price(q.l)} – ${fmt.price(q.h)}`;
  row.querySelector('[data-f=vol]').textContent = fmt.compact(q.v);
  row.querySelector('[data-f=feed]').innerHTML = feedHtml(q);
}

function updateFeedHint() {
  const s = feed.settings();
  const ws = state.status?.ws;
  if (!s.token) {
    $('feed-hint').innerHTML = 'Demo mode: prices are simulated. <a href="#" data-open-settings>Add your iTick token</a> for real market data.';
  } else if (ws?.state === 'live' || ws?.state === 'connecting') {
    $('feed-hint').textContent = `The first ${s.maxWsSubs} symbols stream in real time; the rest refresh every ${s.pollSec}s (limit ${s.rateLimit} API calls/min).`;
  } else {
    $('feed-hint').textContent = `Prices refresh every ${s.pollSec}s over iTick's REST API (limit ${s.rateLimit} calls/min).`;
  }
}

$('watch-body').addEventListener('click', async (e) => {
  const rm = e.target.closest('[data-remove]');
  if (rm) {
    e.stopPropagation();
    feed.remove(rm.dataset.remove);
    return;
  }
  const row = e.target.closest('tr[data-key]');
  if (row) selectSymbol(row.dataset.key);
});

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('add-code').value.trim();
  const region = $('add-region').value;
  $('add-error').hidden = true;
  try {
    const item = feed.add(code, region);
    $('add-code').value = '';
    selectSymbol(item.key);
  } catch (err) {
    $('add-error').textContent = err.message;
    $('add-error').hidden = false;
  }
});

// ---------- detail panel ----------

let chart, candles, volume, bars = [], chartReq = 0;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function ensureChart() {
  if (chart || !window.LightweightCharts) return;
  const el = $('chart');
  chart = LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { color: cssVar('--panel') }, textColor: cssVar('--muted') },
    grid: { vertLines: { color: cssVar('--border') }, horzLines: { color: cssVar('--border') } },
    rightPriceScale: { borderColor: cssVar('--border') },
    timeScale: { borderColor: cssVar('--border'), timeVisible: true },
    crosshair: { mode: 0 },
  });
  candles = chart.addCandlestickSeries({
    upColor: cssVar('--up'), downColor: cssVar('--down'), borderVisible: false,
    wickUpColor: cssVar('--up'), wickDownColor: cssVar('--down'),
  });
  volume = chart.addHistogramSeries({ priceScaleId: '', priceFormat: { type: 'volume' } });
  volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
}

// Lightweight Charts renders UTC; shift so the axis shows the viewer's local time.
const toChartTime = (ms) => Math.floor(ms / 1000) - new Date(ms).getTimezoneOffset() * 60;

function volumeBar(b) {
  return { time: b.time, value: b.v, color: b.close >= b.open ? cssVar('--up-bg') : cssVar('--down-bg') };
}

async function loadChart() {
  const item = currentItem();
  if (!item) return;
  ensureChart();
  const req = ++chartReq;
  const r = state.status?.rate;
  $('chart-status').textContent = r && r.used >= r.limit ? `Waiting for API slot (~${Math.ceil(r.resetInMs / 1000)}s)…` : 'Loading…';
  try {
    const data = await feed.kline(item.code, item.region, state.kType);
    if (req !== chartReq) return;
    const seen = new Set();
    bars = data
      .map((b) => ({ time: toChartTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c, v: b.v }))
      .sort((a, b) => a.time - b.time)
      .filter((b) => !seen.has(b.time) && seen.add(b.time));
    candles?.setData(bars);
    volume?.setData(bars.map(volumeBar));
    // autoSize measures on the next frame; fitting before that uses a zero-width scale.
    requestAnimationFrame(() => chart?.timeScale().fitContent());
    $('chart-status').textContent = bars.length ? '' : 'No chart data for this interval.';
  } catch (err) {
    if (req === chartReq) $('chart-status').textContent = err.message;
  }
}

// Fold live quotes into the newest candle so the chart moves between reloads.
function tickChart(q) {
  if (!bars.length || !candles) return;
  const b = bars[bars.length - 1];
  b.close = q.ld;
  b.high = Math.max(b.high, q.ld);
  b.low = Math.min(b.low, q.ld);
  candles.update(b);
}

async function loadInfo() {
  const item = currentItem();
  if (!item) return;
  const key = item.key;
  $('d-info').innerHTML = '<dd class="muted">Loading…</dd>';
  try {
    const info = await feed.info(item.code, item.region);
    if (state.selected !== key) return;
    const rows = [
      ['Exchange', info.e],
      ['Sector', info.s],
      ['Industry', info.i],
      ['Market cap', info.mcb ? `${fmt.compact(info.mcb)} ${info.fcc ?? ''}` : null],
      ['Shares out', info.tso ? fmt.compact(info.tso) : null],
      ['P/E', info.pet ? Number(info.pet).toFixed(2) : null],
      ['Website', info.wu ? `<a href="${esc(info.wu)}" target="_blank" rel="noopener">${esc(info.wu.replace(/^https?:\/\//, ''))}</a>` : null],
    ].filter(([, v]) => v);
    $('d-info').innerHTML = rows.length
      ? rows.map(([k, v]) => `<dt>${k}</dt><dd>${k === 'Website' ? v : esc(v)}</dd>`).join('')
      : '<dd class="muted">No company details available.</dd>';
    if (info.n && !item.name) $('d-name').textContent = info.n;
  } catch (err) {
    if (state.selected === key) $('d-info').innerHTML = `<dd class="muted">${esc(err.message)}</dd>`;
  }
}

function currentItem() {
  return state.items.find((i) => i.key === state.selected);
}

function renderDetailQuote() {
  const item = currentItem();
  if (!item) return;
  const q = item.quote;
  $('d-last').textContent = fmt.price(q?.ld);
  $('d-change').textContent = q ? `${fmt.signed(q.ch)} (${fmt.signed(q.chp, '%')})` : '—';
  $('d-change').className = `chg ${dir(q?.ch)}`;
  const stats = [
    ['Open', fmt.price(q?.o)],
    ['Prev close', fmt.price(q?.p)],
    ['High', fmt.price(q?.h)],
    ['Low', fmt.price(q?.l)],
    ['Volume', fmt.compact(q?.v)],
    ['Turnover', fmt.compact(q?.tu)],
    ['Status', q ? ({ 0: 'Trading', 1: 'Halted', 2: 'Delisted', 3: 'Circuit breaker' }[q.ts] ?? '—') : '—'],
  ];
  $('d-stats').innerHTML = stats.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');
}

function selectSymbol(key) {
  state.selected = key;
  document.querySelectorAll('#watch-body tr').forEach((tr) => tr.classList.toggle('selected', tr.dataset.key === key));
  const item = currentItem();
  $('detail').hidden = !item;
  if (!item) return;
  $('d-code').textContent = item.code;
  $('d-region').textContent = item.region;
  $('d-name').textContent = item.name ?? '';
  $('alert-above').value = item.alertAbove ?? '';
  $('alert-below').value = item.alertBelow ?? '';
  renderDetailQuote();
  loadChart();
  loadInfo();
}

$('ktype').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-k]');
  if (!btn) return;
  state.kType = Number(btn.dataset.k);
  $('ktype').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
  loadChart();
});

$('alert-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const item = currentItem();
  if (!item) return;
  try {
    feed.setAlerts(item.key, { alertAbove: $('alert-above').value, alertBelow: $('alert-below').value });
    toast(`Alerts saved for ${item.code}`);
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ---------- alerts ----------

function checkAlerts(item, prev, price) {
  if (prev == null || price == null) return;
  const hits = [];
  if (item.alertAbove != null && prev < item.alertAbove && price >= item.alertAbove) hits.push(`rose above ${fmt.price(item.alertAbove)}`);
  if (item.alertBelow != null && prev > item.alertBelow && price <= item.alertBelow) hits.push(`fell below ${fmt.price(item.alertBelow)}`);
  for (const h of hits) {
    const msg = `${item.code} ${h} — now ${fmt.price(price)}`;
    toast(`🔔 ${msg}`, 'alert');
    if ('Notification' in window && Notification.permission === 'granted') new Notification('Price alert', { body: msg });
  }
}

// ---------- status bar ----------

function renderStatus() {
  const s = state.status;
  if (!s) return;
  const badge = $('mode-badge');
  badge.textContent = s.mode === 'live' ? 'LIVE' : 'DEMO';
  badge.className = `badge ${s.mode}`;

  const ws = s.ws;
  const labels = { live: `Streaming ${ws.symbols.length}`, connecting: 'Connecting…', reconnecting: 'Reconnecting…', error: 'Stream error', idle: 'Polling', unavailable: 'Polling', demo: 'Simulated feed' };
  $('ws-dot').className = `dot ${{ live: 'live', demo: 'live', idle: 'live', unavailable: 'live', connecting: 'warn', reconnecting: 'warn', error: 'err' }[ws.state] ?? ''}`;
  $('ws-label').textContent = labels[ws.state] ?? ws.state;
  $('ws-label').parentElement.title = ws.error ? `WebSocket: ${ws.error}` : `WebSocket: ${ws.symbols.join(', ') || 'none'}`;
  if (s.mode === 'live' && s.poll.lastError) {
    $('ws-dot').className = 'dot err';
    $('ws-label').textContent = 'API error';
  }

  const r = s.rate;
  $('rate-bar').style.width = `${Math.min(100, (r.used / r.limit) * 100)}%`;
  $('rate-bar').className = r.used >= r.limit ? 'full' : '';
  $('rate-label').textContent = `${r.used}/${r.limit}${r.pending ? ` (+${r.pending} queued)` : ''}`;

  const p = s.poll;
  $('poll-label').textContent = s.mode === 'live' && p.lastError ? `⚠ ${p.lastError}` : s.mode === 'live' && p.lastPollAt ? `Polled ${fmt.time(p.lastPollAt)}` : '';
  $('poll-label').className = `status-item ${p.lastError ? 'down' : 'muted'}`;
}

// ---------- settings ----------

function openSettings() {
  const s = feed.settings();
  $('set-token').value = s.token;
  $('set-rate').value = s.rateLimit;
  $('set-subs').value = s.maxWsSubs;
  $('set-poll').value = s.pollSec;
  $('settings').showModal();
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-open-settings]')) {
    e.preventDefault();
    openSettings();
  }
});

$('settings-form').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'save') return; // Cancel just closes the dialog
  const int = (id, min, fallback) => Math.max(min, Math.round(Number($(id).value)) || fallback);
  feed.saveSettings({
    token: $('set-token').value.trim(),
    rateLimit: int('set-rate', 1, 5),
    maxWsSubs: int('set-subs', 0, 3),
    pollSec: int('set-poll', 10, 60),
  });
  state.lastPrice.clear();
  selectSymbol(state.selected);
  toast(feed.settings().token ? 'Settings saved — loading live data' : 'Settings saved — demo mode');
});

$('clear-token').addEventListener('click', () => {
  $('set-token').value = '';
});

// ---------- feed events ----------

feed.on('watchlist', (incoming) => {
  for (const i of incoming) if (i.quote && !state.lastPrice.has(i.key)) state.lastPrice.set(i.key, i.quote.ld);
  state.items = incoming;
  renderWatchlist();
  const cur = currentItem();
  if (cur) {
    $('d-name').textContent = cur.name ?? $('d-name').textContent;
    renderDetailQuote();
  }
});

feed.on('quote', ({ key, quote }) => {
  const item = state.items.find((i) => i.key === key);
  if (!item) return;
  item.quote = quote;
  const prev = state.lastPrice.get(key);
  updateRow(item);
  checkAlerts(item, prev, quote.ld);
  state.lastPrice.set(key, quote.ld);
  if (key === state.selected) {
    renderDetailQuote();
    tickChart(quote);
  }
});

feed.on('status', (s) => {
  state.status = s;
  renderStatus();
  updateFeedHint();
});

// ---------- boot ----------

$('add-region').innerHTML = REGIONS.map((r) => `<option>${r}</option>`).join('');
feed.start();
