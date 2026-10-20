# Stock Monitor

A stock-watching dashboard powered by the [iTick API](https://itick.org). It is a static site that runs entirely in the browser, so it can be hosted on GitHub Pages.

- A watchlist across US, HK, and A-share markets (and more), with live price flashes
- Candlestick charts from 1-minute to monthly candles
- Company details: sector, market cap, P/E
- Price alerts above or below a level, shown as on-page toasts and browser notifications
- A status bar showing the feed state and your API budget for the current minute

## Using it

Open the site and click **Settings** to paste your iTick token (the free plan works). Without a token, the app runs in **demo mode** with simulated prices.

Your token, watchlist, and alert levels are stored in your own browser (localStorage). They are never part of this repository, and the token is sent only to `api.itick.org`. Each visitor uses their own token.

## How it handles iTick's limits

The free plan allows **5 REST calls per minute**. Every request goes through a rate-limit queue that survives page reloads:

| What | How |
| --- | --- |
| Watchlist prices | Batch `/stock/quotes`, one call per market every 60 s |
| Charts / company info | `/stock/kline` and `/stock/info`, cached and given priority over background work |
| Live streaming | The app tries iTick's WebSocket. iTick documents only header auth, which browsers can't send, so if the socket is rejected the app falls back to polling |

On a paid plan, raise the limits in Settings.

Alerts fire only while the page is open. Several open tabs share one token's budget, so keep one tab open.

## Run locally

Any static file server works:

```bash
python -m http.server 3000 --directory docs
```

## Deploy to GitHub Pages

Push this repo to GitHub, then go to **Settings → Pages**, choose **Deploy from a branch**, and select branch `main` and folder `/docs`.

## Files

- `docs/index.html`, `docs/styles.css`, `docs/app.js`: the dashboard UI
- `docs/js/feed.js`: data layer (watchlist, polling, streaming, demo mode)
- `docs/js/itick.js`: iTick REST client with caching
- `docs/js/stream.js`: iTick WebSocket client
- `docs/js/limiter.js`: sliding-window rate limiter with a priority queue
- `docs/js/mock.js`: simulated market for demo mode
- `docs/js/store.js`: localStorage persistence
