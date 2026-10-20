// Thin REST client for https://api.itick.org (docs: https://docs.itick.org).
// All calls are rate limited and cached so the dashboard stays within plan limits.

const BASE = 'https://api.itick.org';

export class ITickError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createITickClient({ token, limiter }) {
  const cache = new Map(); // key -> { value, expires } | { promise }

  async function request(path, params, priority) {
    return limiter.schedule(async () => {
      const url = new URL(path, BASE);
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
      const res = await fetch(url, {
        headers: { accept: 'application/json', token },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 401 || res.status === 403) {
        throw new ITickError(`iTick rejected the token (HTTP ${res.status}). Check your token in Settings`, res.status);
      }
      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new ITickError(`iTick HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
      }
      if (!res.ok || body.code !== 0) {
        throw new ITickError(body.msg || `iTick HTTP ${res.status}`, res.status === 200 ? 502 : res.status);
      }
      return body.data;
    }, priority);
  }

  // Cache with in-flight de-duplication, so two browser tabs asking for the same chart cost one call.
  function cached(key, ttlMs, fn) {
    const hit = cache.get(key);
    if (hit?.promise) return hit.promise;
    if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
    const promise = fn().then(
      (value) => {
        cache.set(key, { value, expires: Date.now() + ttlMs });
        return value;
      },
      (err) => {
        cache.delete(key);
        throw err;
      },
    );
    cache.set(key, { promise });
    return promise;
  }

  return {
    // Batch quotes: returns { [code]: quote }
    quotes(region, codes) {
      return request('/stock/quotes', { region, codes: codes.join(',') }, 0);
    },
    kline(region, code, kType, limit) {
      const ttl = kType <= 2 ? 30_000 : kType <= 5 ? 120_000 : 600_000;
      return cached(`kline|${region}|${code}|${kType}|${limit}`, ttl, () =>
        request('/stock/kline', { region, code, kType, limit }, 10),
      );
    },
    info(region, code, priority = 10) {
      return cached(`info|${region}|${code}`, 24 * 3600_000, () =>
        request('/stock/info', { type: 'stock', region, code }, priority),
      );
    },
  };
}
