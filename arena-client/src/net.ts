import type { ServerMsg } from "./types";

// Dev: Vite serves the UI on :5173 while the game server listens on :3001.
// Prod: arena-server.js serves the built client, so use the page's own origin.
function wsUrl(): string {
  const override = import.meta.env.VITE_ARENA_WS;
  if (override) return override;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const host = location.port === "5173" ? `${location.hostname}:3001` : location.host;
  return `${proto}//${host}`;
}

export class Net {
  private ws: WebSocket | null = null;

  constructor(
    private onMessage: (m: ServerMsg) => void,
    private onStatus: (s: "connecting" | "open" | "closed") => void
  ) {}

  connect(name: string) {
    this.onStatus("connecting");
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.onStatus("open");
      this.send({ type: "join", name });
    };
    ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(e.data) as ServerMsg);
      } catch {
        /* ignore malformed frame */
      }
    };
    ws.onclose = () => this.onStatus("closed");
    ws.onerror = () => ws.close();
  }

  send(msg: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close() {
    this.ws?.close();
  }
}
