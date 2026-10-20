// The data layer the dashboard talks to. Runs entirely in the browser:
// holds the watchlist, polls iTick within the rate budget, streams what it can, and
// falls back to a simulated market when no token is set.

import { RateLimiter } from './limiter.js';
import { createITickClient } from './itick.js';
import { createQuoteStream } from './stream.js';
import { createMockMarket } from './mock.js';
import * as store from './store.js';

export const REGIONS = ['US', 'HK', 'SH', 'SZ', 'SG', 'JP', 'TW', 'IN', 'GB', 'DE'];
const KTYPES = new Set([1, 2, 3, 4, 5, 8, 9, 10]);
const CODE_RE = /^[A-Za-z0-9.\-]{1,15}$/;

const DEFAULT_WATCHLIST = [
  { code: 'AAPL', region: 'US' },
  { code: 'NVDA', region: 'US' },
  { code: 'TSLA', region: 'US' },
  { code: '700', region: 'HK' },
];

const keyOf = (code, region) => `${code.toUpperCase()}$${region}`;
const newItem = (code, region) => ({ key: keyOf(code, region), code, region, name: null, alertAbove: null, alertBelow: null });

export function createFeed() {
  const events = new EventTarget();
  const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }));

  let settings = store.loadSettings();
  let watchlist = store.loadWatchlist() ?? DEFAULT_WATCHLIST.map((w) => newItem(w.code, w.region));
  const quotes = new Map(); // key -> { ...quote, source, receivedAt }

  let gen = 0; // bumps on every restart so stale async work is dropped
  let limiter, itick, mock, stream, pollTimer, demoTimer;
  let pollState;

  const mode = () => (settings.token ? 'live' : 'demo');

  function persist() {
    store.saveWatchlist(watchlist);
    emit('watchlist', items());
  }

  function items() {
    return watchlist.map((w) => ({ ...w, quote: quotes.get(w.key) ?? null }));
  }

  function storeQuote(key, q, source) {
    const merged = { ...quotes.get(key), ...q, source, receivedAt: Date.now() };
    quotes.set(key, merged);
    emit('quote', { key, quote: merged });
  }

  function status() {
    return {
      mode: mode(),
      rate: limiter.usage(),
      ws: stream ? stream.status() : { state: mode() === 'demo' ? 'demo' : 'idle', symbols: [] },
      poll: { ...pollState, intervalSec: settings.pollSec },
    };
  }

  // The first maxWsSubs symbols stream; the rest are polled.
  const wsKeys = () => (mode() === 'live' ? watchlist.slice(0, settings.maxWsSubs).map((w) => w.key) : []);
  const syncStream = () => stream?.setSymbols(wsKeys());

  async function poll() {
    if (mode() !== 'live' || pollState.inFlight) return;
    const myGen = gen;
    const streamed = new Set(stream?.status().state === 'live' ? wsKeys() : []);
    // Streamed symbols still get one REST snapshot so they show data before the first push.
    const due = watchlist.filter((w) => !streamed.has(w.key) || !quotes.has(w.key));
    if (!due.length) return;

    const byRegion = new Map();
    for (const w of due) byRegion.set(w.region, [...(byRegion.get(w.region) ?? []), w]);

    pollState.inFlight = true;
    try {
      for (const [region, group] of byRegion) {
        for (let i = 0; i < group.length; i += settings.batchSize) {
          const chunk = group.slice(i, i + settings.batchSize);
          const data = await itick.quotes(region, chunk.map((w) => w.code));
          if (myGen !== gen) return;
          for (const w of chunk) {
            const q = data?.[w.code] ?? data?.[w.code.toUpperCase()];
            if (q) storeQuote(w.key, q, 'poll');
          }
        }
      }
      pollState.lastError = null;
    } catch (err) {
      if (myGen === gen) pollState.lastError = err.message;
    } finally {
      if (myGen === gen) {
        pollState.inFlight = false;
        pollState.lastPollAt = Date.now();
        emit('status', status());
        // Names only after prices: otherwise they'd spend the minute's budget first.
        if (!pollState.lastError) watchlist.forEach(fetchName);
      }
    }
  }

  function schedulePoll(delayMs = settings.pollSec * 1000) {
    clearTimeout(pollTimer);
    const myGen = gen;
    pollState.nextPollAt = Date.now() + delayMs;
    pollTimer = setTimeout(async () => {
      await poll();
      if (myGen === gen) schedulePoll();
    }, delayMs);
  }

  const nameTried = new Set(); // one lookup per symbol per session, even if it fails

  async function fetchName(item) {
    if (item.name || mode() === 'demo' || nameTried.has(item.key)) return;
    nameTried.add(item.key);
    const myGen = gen;
    try {
      const info = await itick.info(item.region, item.code, -1); // names are nice-to-have: run after quotes
      if (myGen === gen && info?.n) {
        item.name = info.n;
        persist();
      }
    } catch {
      // Name stays blank; the row still works.
    }
  }

  function start() {
    gen++;
    clearTimeout(pollTimer);
    clearInterval(demoTimer);
    stream?.close();
    stream = null;
    quotes.clear();
    nameTried.clear();
    pollState ={ lastPollAt: null, nextPollAt: null, lastError: null, inFlight: false };

    limiter = new RateLimiter(settings.rateLimit, 'sm.rateWindow');
    limiter.onChange(() => emit('status', status()));
    itick = createITickClient({ token: settings.token, limiter });
    mock = mode() === 'demo' ? createMockMarket() : null;

    if (mode() === 'live') {
      if (settings.maxWsSubs > 0) {
        stream = createQuoteStream({
          token: settings.token,
          onQuote: (key, q) => watchlist.some((w) => w.key === key) && storeQuote(key, q, 'ws'),
          onStatus: () => emit('status', status()),
        });
        syncStream();
      }
      schedulePoll(300);
    } else {
      demoTimer = setInterval(() => {
        for (const w of watchlist) if (Math.random() < 0.6) storeQuote(w.key, mock.step(w.code, w.region), 'demo');
      }, 1500);
    }
    emit('watchlist', items());
    emit('status', status());
  }

  function parseSymbol(code, region) {
    code = String(code ?? '').trim().toUpperCase();
    region = String(region ?? '').trim().toUpperCase();
    if (!CODE_RE.test(code)) throw new Error('Invalid symbol code');
    if (!REGIONS.includes(region)) throw new Error('Invalid region');
    return { code, region };
  }

  return {
    on: (type, fn) => events.addEventListener(type, (e) => fn(e.detail)),
    start,
    items,
    status: () => status(),
    settings: () => ({ ...settings }),

    saveSettings(next) {
      settings = { ...settings, ...next };
      store.saveSettings(settings);
      start();
    },

    add(rawCode, rawRegion) {
      const { code, region } = parseSymbol(rawCode, rawRegion);
      const key = keyOf(code, region);
      if (watchlist.some((w) => w.key === key)) throw new Error(`${key} is already on the watchlist`);
      const item = newItem(code, region);
      watchlist.push(item);
      persist();
      syncStream();
      if (mode() === 'live') schedulePoll(500); // its name is fetched after this poll
      return item;
    },

    remove(key) {
      watchlist = watchlist.filter((w) => w.key !== key);
      quotes.delete(key);
      persist();
      syncStream();
    },

    setAlerts(key, { alertAbove, alertBelow }) {
      const item = watchlist.find((w) => w.key === key);
      if (!item) throw new Error('Not on watchlist');
      const norm = (v) => {
        if (v === null || v === '' || v === undefined) return null;
        const n = Number(v);
        if (!(n > 0)) throw new Error('Alert levels must be positive numbers');
        return n;
      };
      item.alertAbove = norm(alertAbove);
      item.alertBelow = norm(alertBelow);
      persist();
    },

    async kline(code, region, kType, limit = 150) {
      ({ code, region } = parseSymbol(code, region));
      if (!KTYPES.has(kType)) throw new Error('Invalid interval');
      const bars = mode() === 'demo' ? mock.kline(code, region, kType, limit) : await itick.kline(region, code, kType, limit);
      return bars ?? [];
    },

    async info(code, region) {
      ({ code, region } = parseSymbol(code, region));
      return mode() === 'demo' ? mock.info(code) : await itick.info(region, code);
    },
  };
}
