// Sliding-window rate limiter with a priority queue.
// iTick's free plan allows 5 REST calls per minute, so every upstream call goes through here.
// Higher priority jobs (user clicking a chart) run before background polling.

const WINDOW_MS = 60_000;

export class RateLimiter {
  // persistKey keeps the window across page reloads, which would otherwise reset the count.
  constructor(perMinute, persistKey = null) {
    this.perMinute = perMinute;
    this.persistKey = persistKey;
    this.stamps = this.#load();
    this.queue = [];
    this.timer = null;
    this.listeners = new Set();
  }

  schedule(fn, priority = 0) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, priority, resolve, reject });
      // Array.prototype.sort is stable, so equal priorities stay FIFO.
      this.queue.sort((a, b) => b.priority - a.priority);
      this.#pump();
    });
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  usage() {
    this.#prune();
    const resetInMs = this.stamps.length ? Math.max(0, WINDOW_MS - (Date.now() - this.stamps[0])) : 0;
    return { used: this.stamps.length, limit: this.perMinute, pending: this.queue.length, resetInMs };
  }

  #load() {
    if (!this.persistKey) return [];
    try {
      const saved = JSON.parse(localStorage.getItem(this.persistKey) ?? '[]');
      return Array.isArray(saved) ? saved.filter((t) => Date.now() - t < WINDOW_MS) : [];
    } catch {
      return [];
    }
  }

  #save() {
    if (!this.persistKey) return;
    try {
      localStorage.setItem(this.persistKey, JSON.stringify(this.stamps));
    } catch {
      // Storage blocked: the in-memory window still works.
    }
  }

  #prune() {
    const now = Date.now();
    while (this.stamps.length && now - this.stamps[0] >= WINDOW_MS) this.stamps.shift();
  }

  #pump() {
    if (this.timer) return;
    this.#prune();
    while (this.queue.length && this.stamps.length < this.perMinute) {
      const job = this.queue.shift();
      this.stamps.push(Date.now());
      Promise.resolve().then(job.fn).then(job.resolve, job.reject);
    }
    this.#save();
    if (this.queue.length) {
      const wait = WINDOW_MS - (Date.now() - this.stamps[0]) + 50;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.#pump();
      }, wait);
    }
    for (const fn of this.listeners) fn(this.usage());
  }
}
