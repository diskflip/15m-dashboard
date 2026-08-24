import type { ServerMessage } from "../types/market";

// Talks only to our local backend proxy (see server/index.ts), never to Kalshi
// directly — the browser never sees Kalshi credentials.
//
// Defaults to a same-origin "/ws" path, proxied to the backend by Vite's dev
// server (see vite.config.ts). This means whatever serves the frontend page
// — localhost, the LAN IP, or a Cloudflare tunnel — automatically reaches
// the right backend with no separate URL to configure or re-share whenever
// a tunnel restarts. VITE_BACKEND_WS_URL remains available as an explicit
// override if ever needed.
function defaultBackendWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

const BACKEND_WS_URL =
  (import.meta.env.VITE_BACKEND_WS_URL as string | undefined) ??
  defaultBackendWsUrl();

const RECONNECT_DELAY_MS = 2000;

type Listener = {
  onMessage: (msg: ServerMessage) => void;
  onStatusChange: (connected: boolean) => void;
};

// One real WebSocket for the whole app, shared by every caller (six
// useMarket instances plus useWallet), ref-counted via `listeners` — not one
// per caller. Every listener gets the same broadcast stream regardless (the
// backend doesn't scope messages per-connection), so seven independent
// sockets was pure redundancy: seven reconnect loops instead of one, and
// seven times the parsing work for identical data. It also meant seven
// separate things that could be left dangling by an imperfect teardown (e.g.
// Vite Fast Refresh recovering from a hook-shape-changed remount) instead of
// one — a long-lived dev tab through many hot-reloads is exactly the
// scenario where that adds up.
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastKnownConnected = false;
const listeners = new Set<Listener>();

function ensureSocket() {
  if (socket) return;

  socket = new WebSocket(BACKEND_WS_URL);

  socket.onopen = () => {
    lastKnownConnected = true;
    for (const l of listeners) l.onStatusChange(true);
  };

  socket.onmessage = (event) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return; // ignore malformed frames
    }
    for (const l of listeners) l.onMessage(msg);
  };

  socket.onclose = () => {
    socket = null;
    lastKnownConnected = false;
    for (const l of listeners) l.onStatusChange(false);
    if (listeners.size > 0) {
      reconnectTimer = setTimeout(ensureSocket, RECONNECT_DELAY_MS);
    }
  };

  socket.onerror = () => {
    socket?.close();
  };
}

export function connectToBackend(
  onMessage: (msg: ServerMessage) => void,
  onStatusChange: (connected: boolean) => void
): () => void {
  const listener: Listener = { onMessage, onStatusChange };
  listeners.add(listener);
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ensureSocket();
  // A caller that mounts after the shared socket is already up (the common
  // case past the very first one) needs its own current-status snapshot —
  // the real onopen already fired for everyone else.
  onStatusChange(lastKnownConnected);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.close();
      socket = null;
    }
  };
}
