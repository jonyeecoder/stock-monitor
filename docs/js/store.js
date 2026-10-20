// Everything persists in this browser only: the token never leaves the viewer's machine
// except in requests to api.itick.org.

const KEYS = { settings: 'sm.settings', watchlist: 'sm.watchlist' };

export const DEFAULT_SETTINGS = {
  token: '',
  rateLimit: 5,    // iTick free plan: 5 REST calls / minute
  maxWsSubs: 3,    // iTick free plan: 3 WebSocket subscriptions
  batchSize: 10,
  pollSec: 60,
};

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or storage blocked: keep working in memory.
  }
}

export const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...read(KEYS.settings) });
export const saveSettings = (s) => write(KEYS.settings, s);
export const loadWatchlist = () => read(KEYS.watchlist);
export const saveWatchlist = (list) => write(KEYS.watchlist, list);
