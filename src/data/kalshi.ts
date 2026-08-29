import type { ServerMessage } from "../types/market";

// Talks only to our local backend proxy (see server/index.ts), never to
// Kalshi directly — the browser never sees Kalshi credentials. Defaults to
// a same-origin "/ws" path, proxied to the backend by Vite (see
// vite.config.ts), so localhost, a LAN IP, or a tunnel all just work.
function defaultBackendWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

const BACKEND_WS_URL =
  (import.meta.env.VITE_BACKEND_WS_URL as string | undefined) ??
  defaultBackendWsUrl();

const RECONNECT_DELAY_MS = 2000;
// Vite's dev-server WS proxy occasionally leaves a connection stuck in
// CONNECTING forever with no open/error/close event — force a retry.
const CONNECT_TIMEOUT_MS = 5000;
// A backgrounded/locked mobile tab can silently kill the TCP connection
// without ever firing close — readyState still reports OPEN but nothing
// arrives again. The backend rebroadcasts at least every 10s while
// connected (see FLIPS_REBROADCAST_MS in server/index.ts), so total
// silence past that means the socket is a zombie: force-close it and let
// the normal reconnect path take over.
const STALE_THRESHOLD_MS = 25_000;
const STALE_CHECK_INTERVAL_MS = 5_000;

type Listener = {
  onMessage: (msg: ServerMessage) => void;
  onStatusChange: (connected: boolean) => void;
};

// One shared WebSocket for the whole app, ref-counted via `listeners`
// instead of one per caller.
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastKnownConnected = false;
let lastMessageAt = Date.now();
const listeners = new Set<Listener>();

function checkStale() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  if (Date.now() - lastMessageAt > STALE_THRESHOLD_MS) {
    socket.close();
  }
}

if (typeof document !== "undefined") {
  setInterval(checkStale, STALE_CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkStale();
  });
}

function ensureSocket() {
  if (socket) return;

  const ws = new WebSocket(BACKEND_WS_URL);
  socket = ws;

  const connectTimeout = setTimeout(() => {
    if (ws.readyState === WebSocket.CONNECTING) ws.close();
  }, CONNECT_TIMEOUT_MS);

  ws.onopen = () => {
    clearTimeout(connectTimeout);
    lastKnownConnected = true;
    lastMessageAt = Date.now();
    for (const l of listeners) l.onStatusChange(true);
  };

  ws.onmessage = (event) => {
    lastMessageAt = Date.now();
    let msg: ServerMessage;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    for (const l of listeners) l.onMessage(msg);
  };

  ws.onclose = () => {
    clearTimeout(connectTimeout);
    socket = null;
    lastKnownConnected = false;
    for (const l of listeners) l.onStatusChange(false);
    if (listeners.size > 0) {
      reconnectTimer = setTimeout(ensureSocket, RECONNECT_DELAY_MS);
    }
  };

  ws.onerror = () => {
    ws.close();
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

export function sendToBackend(message: unknown) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}
