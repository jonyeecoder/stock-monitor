// Real-time quotes from iTick's WebSocket (wss://api.itick.org/stock).
// iTick documents header auth only, which browsers can't send, so we try the token as a
// query parameter. If iTick never accepts it, the stream reports "unavailable" and the
// feed falls back to REST polling for every symbol.

const URL = 'wss://api.itick.org/stock';
const PING_MS = 20_000; // iTick drops connections after 60s without a ping

export function createQuoteStream({ token, onQuote, onStatus }) {
  let ws = null;
  let symbols = [];
  let pingTimer = null;
  let reconnectTimer = null;
  let retry = 0;
  let everAuthed = false;
  let state = 'idle';
  let lastError = null;

  function setState(next, error = null) {
    state = next;
    lastError = error;
    onStatus();
  }

  function setSymbols(list) {
    const next = [...list].sort();
    if (next.join(',') === symbols.join(',')) return;
    symbols = next;
    if (state === 'unavailable') return;
    // iTick has no documented unsubscribe, so changing the set means reconnecting.
    teardown();
    retry = 0;
    if (symbols.length) connect();
    else setState('idle');
  }

  function teardown() {
    clearInterval(pingTimer);
    clearTimeout(reconnectTimer);
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close();
      ws = null;
    }
  }

  function connect() {
    setState('connecting');
    const socket = new WebSocket(`${URL}?token=${encodeURIComponent(token)}`);
    ws = socket;

    socket.onopen = () => {
      pingTimer = setInterval(() => send({ ac: 'ping', params: String(Date.now()) }), PING_MS);
    };

    socket.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.resAc === 'auth') {
        if (msg.code === 1) {
          everAuthed = true;
          send({ ac: 'subscribe', params: symbols.join(','), types: 'quote' });
        } else {
          lastError = msg.msg || 'WebSocket authentication failed';
        }
        return;
      }
      if (msg.resAc === 'subscribe') {
        if (msg.code === 1) {
          retry = 0;
          setState('live');
        } else {
          setState('error', msg.msg || 'Subscription rejected');
        }
        return;
      }
      const d = msg.data;
      if (d?.type === 'quote' && d.s && d.r) onQuote(`${String(d.s).toUpperCase()}$${d.r}`, d);
    };

    socket.onclose = () => {
      if (ws !== socket) return;
      clearInterval(pingTimer);
      ws = null;
      if (!everAuthed) {
        setState('unavailable', 'iTick did not accept browser WebSocket auth, so all symbols use REST polling');
        return;
      }
      const delay = Math.min(60_000, 2_000 * 2 ** retry++);
      setState('reconnecting', lastError);
      reconnectTimer = setTimeout(connect, delay);
    };
  }

  function send(obj) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  return {
    setSymbols,
    status: () => ({ state, error: lastError, symbols }),
    close: teardown,
  };
}
