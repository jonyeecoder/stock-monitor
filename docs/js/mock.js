// Demo mode: simulated prices so the dashboard works without an iTick token.

const BASE_PRICES = { AAPL: 230, TSLA: 250, NVDA: 130, MSFT: 420, '700': 480, '9988': 120 };
const KTYPE_MS = { 1: 60e3, 2: 300e3, 3: 900e3, 4: 1800e3, 5: 3600e3, 8: 86400e3, 9: 604800e3, 10: 2592000e3 };

function seedPrice(code) {
  if (BASE_PRICES[code]) return BASE_PRICES[code];
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return 20 + h / 3;
}

export function createMockMarket() {
  const state = new Map(); // key -> quote

  function quote(code, region) {
    const key = `${code}$${region}`;
    let q = state.get(key);
    if (!q) {
      const p = seedPrice(code);
      q = { s: code, r: region, p, o: p, h: p, l: p, ld: p, v: 0, tu: 0, ts: 0, ch: 0, chp: 0, t: Date.now() };
      state.set(key, q);
    }
    return q;
  }

  function step(code, region) {
    const q = quote(code, region);
    const ld = Math.max(0.01, +(q.ld * (1 + (Math.random() - 0.5) * 0.004)).toFixed(2));
    const vol = Math.round(Math.random() * 5000);
    Object.assign(q, {
      ld,
      h: Math.max(q.h, ld),
      l: Math.min(q.l, ld),
      v: q.v + vol,
      tu: q.tu + vol * ld,
      ch: +(ld - q.p).toFixed(2),
      chp: +(((ld - q.p) / q.p) * 100).toFixed(2),
      t: Date.now(),
    });
    return { ...q };
  }

  function kline(code, region, kType, limit) {
    const span = KTYPE_MS[kType] ?? 86400e3;
    const now = Date.now();
    const bars = [];
    let c = quote(code, region).ld;
    for (let i = 0; i < limit; i++) {
      const o = c * (1 + (Math.random() - 0.5) * 0.02);
      const h = Math.max(o, c) * (1 + Math.random() * 0.01);
      const l = Math.min(o, c) * (1 - Math.random() * 0.01);
      bars.push({ t: Math.floor((now - i * span) / span) * span, o: +o.toFixed(2), h: +h.toFixed(2), l: +l.toFixed(2), c: +c.toFixed(2), v: Math.round(1e5 + Math.random() * 1e6), tu: 0 });
      c = o;
    }
    return bars.reverse();
  }

  function info(code) {
    return { c: code, n: `${code} (demo)`, e: 'DEMO', s: 'Simulated', i: 'Simulated data', fcc: 'USD' };
  }

  return { quote: (c, r) => ({ ...quote(c, r) }), step, kline, info };
}
