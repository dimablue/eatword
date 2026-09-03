// Wordle Agar — authoritative game server. Separate process and port from the
// original CoWordle server (server.js), which it does not touch.
const express = require("express");
const http = require("http");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { WebSocketServer } = require("ws");
const { World, driveBots, BOT_NAMES, C } = require("./arena/world");

// ARENA_PORT wins locally; PORT is what most hosts (Fly, Render) inject.
const PORT = process.env.ARENA_PORT || process.env.PORT || 3001;
const BOT_COUNT = process.env.ARENA_BOTS === undefined ? 5 : Number(process.env.ARENA_BOTS);

const app = express();

// Serve the built Vite client if it exists; in dev, Vite serves it on 5173.
const CLIENT_DIST = path.join(__dirname, "arena-client", "dist");
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get("*", (req, res) => res.sendFile(path.join(CLIENT_DIST, "index.html")));
} else {
  app.get("/", (req, res) =>
    res
      .status(200)
      .send("Arena client not built. Run `npm run arena:dev` (Vite on :5173) or `npm run arena:build`.")
  );
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const world = new World();
for (let i = 0; i < BOT_COUNT; i++) {
  world.add(BOT_NAMES[i % BOT_NAMES.length], true);
}

const sockets = new Map(); // playerId -> ws

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

wss.on("connection", (ws) => {
  ws.playerId = null;
  ws.view = { w: 1280, h: 720, zoom: 1 };

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "join") {
      if (ws.playerId) return;
      const name = String(msg.name || "player").slice(0, 12).trim() || "player";
      const p = world.add(name, false);
      ws.playerId = p.id;
      sockets.set(p.id, ws);
      send(ws, { type: "welcome", id: p.id, world: C.WORLD_SIZE, rows: C.ROWS, cols: C.COLS });
      return;
    }

    if (!ws.playerId) return;

    switch (msg.type) {
      case "input":
        world.setDirection(ws.playerId, Number(msg.dx) || 0, Number(msg.dy) || 0);
        if (msg.w && msg.h) ws.view = { w: msg.w, h: msg.h, zoom: Number(msg.zoom) || 1 };
        break;
      case "guess": {
        const res = world.guess(ws.playerId, msg.guess);
        if (res.error) send(ws, { type: "reject", message: res.error });
        break;
      }
      case "respawn":
        world.respawn(ws.playerId);
        break;
    }
  });

  ws.on("close", () => {
    if (ws.playerId) {
      world.remove(ws.playerId);
      sockets.delete(ws.playerId);
    }
  });
});

// ---------- loops ----------
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  driveBots(world, now);
  world.tick(dt);
}, 1000 / C.TICK_HZ);

setInterval(() => {
  const leaders = world.leaderboard();
  for (const [id, ws] of sockets) {
    const p = world.get(id);
    if (!p || ws.readyState !== ws.OPEN) continue;

    // Cull to a padded viewport: you only receive boards you could see.
    const halfW = ((ws.view.w / ws.view.zoom) * C.VIEW_PAD) / 2;
    const halfH = ((ws.view.h / ws.view.zoom) * C.VIEW_PAD) / 2;
    // While dead you keep watching the arena around where you fell.
    const visible = world.near(p, halfW, halfH);

    send(ws, {
      type: "state",
      you: world.privateView(p),
      players: visible.map((o) => world.publicView(o)),
      leaders,
      events: p.events,
    });
    p.events = [];
  }
}, 1000 / C.NET_HZ);

function lanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list) if (i.family === "IPv4" && !i.internal) return i.address;
  }
  return "localhost";
}

server.listen(PORT, () => {
  console.log(`\nWordle Agar arena running (${BOT_COUNT} bots):`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${lanIp()}:${PORT}\n`);
});
