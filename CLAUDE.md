# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A stock-monitoring dashboard built on the iTick market-data API (https://docs.itick.org). It is a **static site with no build step, no dependencies, and no backend**. Everything under `docs/` is served as-is by GitHub Pages at https://jonyeecoder.github.io/stock-monitor/ (Pages source: branch `main`, folder `/docs`). Pushing to `main` redeploys in about a minute.

The plain ES modules and the browser-only design are deliberate, because GitHub Pages can't run a server. Don't add a bundler, a framework, or Node-only code unless the user asks to move off Pages.

## Commands

There are no tests, linter, or build. Serve locally with any static server:

```bash
python -m http.server 3000 --directory docs
```

Syntax-check a module without a browser: `node --check docs/js/feed.js`.

To see the live-API code path without a real token, set a dummy token in DevTools: `localStorage.setItem('sm.settings', JSON.stringify({token:'x'}))`, then reload. iTick returns 401, which exercises the error UI and the WebSocket fallback. Run `localStorage.clear()` to return to demo mode.

## Architecture

`docs/app.js` is the UI layer only: DOM rendering, the chart, alerts, and the Settings dialog. It never calls iTick directly. It talks to the **feed** (`docs/js/feed.js`), which plays the role a server would and emits three events: `watchlist`, `quote`, and `status`.

- **Two modes, chosen by whether a token is saved.** *Live* uses `itick.js` (REST) plus `stream.js` (WebSocket). *Demo* uses `mock.js` (a random walk). `feed.start()` rebuilds everything when settings change. A `gen` counter makes stale async results from the previous mode get dropped. Keep this guard on any new async path.
- **The rate limit is the central constraint.** iTick's free plan allows 5 REST calls per minute. Every REST call must go through `RateLimiter.schedule(fn, priority)` in `limiter.js`. The limiter keeps a sliding 60-second window and persists it to localStorage (`sm.rateWindow`) so reloads don't reset it.
  - Priorities: user-driven chart and info calls run at 10, watchlist polling at 0, background name lookups at -1.
  - Priority only reorders calls that are already waiting. A call scheduled while slots are free runs immediately whatever its priority. That's why name lookups are triggered after a poll finishes, not at startup.
- **Quote sources.** The first `maxWsSubs` watchlist symbols (3 on the free plan) are meant to stream over the WebSocket. Every other symbol is polled with batch `/stock/quotes`: one call per region, chunked by `batchSize`.
  - iTick documents header-only WebSocket auth, which browsers can't send. `stream.js` tries `?token=` instead and, if iTick never authenticates, moves to the `unavailable` state permanently. When that happens, polling covers every symbol.
  - Each quote carries `source`: `ws`, `poll`, or `demo`.
- **Caching.** Kline and info responses are cached in memory in `itick.js`, with TTLs that depend on the candle interval. In-flight requests are de-duplicated.
- **Persistence.** `store.js` wraps localStorage, which holds settings including the token (`sm.settings`) and the watchlist with its alert levels (`sm.watchlist`). Every storage access is wrapped in try/catch, so the app still runs when storage is blocked.

## iTick API notes

- Base URL: `https://api.itick.org`. Auth uses a `token` header. CORS allows all origins.
- Success is `code === 0`. Data is in `data`.
- Quote field names are terse: `ld` last price, `p` previous close, `o`/`h`/`l` open/high/low, `v` volume, `tu` turnover, `ch`/`chp` change and percent change, `ts` trading status, `t` timestamp in milliseconds.
- `kType` values: 1=1m, 2=5m, 3=15m, 4=30m, 5=1h, 8=1D, 9=1W, 10=1M. Values 6 and 7 don't exist.
- Symbol keys inside the app are `CODE$REGION`, for example `AAPL$US` or `700$HK`. The WebSocket uses the same format in its `params`.
- Region codes for stocks include `US`, `HK`, `SH`, `SZ`, and others. The allowed list is `REGIONS` in `feed.js`.
