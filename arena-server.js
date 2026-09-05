// Eatword: authoritative game server. Separate process and port from the
// original CoWordle server (server.js), which it does not touch.
const express = require("express");
const http = require("http");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { WebSocketServer } = require("ws");
const { World, driveBots, C } = require("./arena/world");
const names = require("./arena/names");

// ARENA_PORT wins locally; PORT is what most hosts (Fly, Render) inject.
const PORT = process.env.ARENA_PORT || process.env.PORT || 3001;
// Seed population only: bots stand down for arriving humans, so this is how
// alive an empty arena feels, never a cap on how many people can play.
//
// Measured against density, 8 is on the sparse side: a wandering player has
// roughly 2.3 boards on screen and finds an empty one about 7% of the time,
// against 4.8 and 1% at 20. It reads as quiet when nobody else is on, and
// comes into its own the moment real players are. Raising it is a one-word
// change if the arena feels dead; above ~30 someone is inside your threat
// radius 94% of the time, which never leaves the quiet a word actually needs.
const BOT_COUNT = process.env.ARENA_BOTS === undefined ? 8 : Number(process.env.ARENA_BOTS);

const app = express();

// TEMPORARY recording hook: lets the driver force solves on camera.
app.get("/debug/answer/:name", (req, res) => {
  if (!process.env.ARENA_REC) return res.sendStatus(404);
  const p = [...world.players.values()].find((x) => x.name === req.params.name);
  res.json({ answer: p && p.puzzle ? p.puzzle.answer : null });
});

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


const sockets = new Map(); // playerId -> ws
const spectators = new Set(); // ws waiting for a slot

function countBots() {
  let n = 0;
  for (const p of world.players.values()) if (p.isBot) n++;
  return n;
}

/** Names are compared trimmed and case-folded: to anyone reading the arena,
 *  "Dima" and "dima " are the same player. */
function normalise(name) {
  return String(name || "").trim().toLowerCase();
}

/**
 * Who holds a name right now: a board in the world, or a spectator who has
 * already claimed it and is waiting for a seat. Spectators have to count, or
 * two of them could be promoted into the same name later.
 */
function holderOf(name) {
  const key = normalise(name);
  if (!key) return null;
  // Spectators first: a bot and a waiting spectator can hold the same name at
  // once, and it is the spectator's claim that has to win, or two of them queue
  // up behind it and collide when they are seated.
  for (const ws of spectators) if (normalise(ws.joinName) === key) return "spectator";
  for (const p of world.players.values()) if (normalise(p.name) === key) return p;
  return null;
}

/** A generated name nobody is using, for a bot or for anyone who pressed Play
 *  without typing one. Draws are cheap and the space is large, so retrying is
 *  enough; the suffix loop is only there so a pathologically unlucky run still
 *  terminates with a usable name rather than null. */
function freeName() {
  for (let i = 0; i < 60; i++) {
    const name = names.take();
    if (name && !holderOf(name)) return name;
  }
  const base = names.localName().slice(0, names.MAX_LEN - 3);
  for (let i = 2; i < 400; i++) {
    const name = `${base}${i}`;
    if (!holderOf(name)) return name;
  }
  return null;
}

/**
 * Free a seat by retiring a bot. Humans always outrank them: a person should
 * never be turned away while a bot plays.
 *
 * Prefers the bot holding the name being joined under, so one removal settles
 * both the seat and the name; otherwise the smallest, since the big boards are
 * the ones worth watching and the leaderboard should not lose its top entry to
 * an arrival. Returns false only when the arena is genuinely all humans.
 */
function dropOneBot(name) {
  const bots = [...world.players.values()].filter((p) => p.isBot);
  if (!bots.length) return false;
  const key = normalise(name);
  const target =
    bots.find((p) => normalise(p.name) === key) ||
    bots.reduce((a, b) => (b.mass < a.mass ? b : a));
  world.remove(target.id);
  return true;
}

/** Refill bots once humans leave, never past the cap and never onto a taken
 *  name, which the old modulo walk could hand two bots at once. */
function topUpBots() {
  while (world.players.size < C.MAX_PLAYERS && countBots() < BOT_COUNT) {
    const name = freeName();
    if (!name) return;
    world.add(name, true);
  }
}

// Below the helpers on purpose: freeName reads `spectators`, which is a
// const and so is not hoisted the way the functions are.
function seedBots() {
  for (let i = 0; i < Math.min(BOT_COUNT, C.MAX_PLAYERS); i++) {
    const name = freeName();
    if (!name) break;
    world.add(name, true);
  }

  if (process.env.ARENA_REC) {
    const spread = [900, 640, 420, 300, 220, 170, 130, 110, 100, 100];
    [...world.players.values()].forEach((p, i) => {
      if (spread[i]) p.mass = spread[i];
    });
  }
}

function seatPlayer(ws, name) {
  // A bot never keeps a name a person wants. This sits here rather than in the
  // join handler so it also covers a spectator being promoted later, and so it
  // can only ever run once a seat is genuinely available. Retiring the bot
  // during the join check would have been a way to manufacture one.
  const holder = holderOf(name);
  if (holder && holder !== "spectator" && holder.isBot) world.remove(holder.id);

  const p = world.add(name, false);
  ws.playerId = p.id;
  sockets.set(p.id, ws);
  send(ws, {
    type: "welcome",
    id: p.id,
    spectator: false,
    world: C.WORLD_SIZE,
    rows: C.ROWS,
    cols: C.COLS,
    holdMs: C.RESULT_HOLD_MS,
    handoffMs: C.HANDOFF_HOLD_MS,
  });
}

/** A seat opened, so let the longest-waiting spectator in. */
function promoteSpectator() {
  if (world.players.size >= C.MAX_PLAYERS) return;
  for (const ws of spectators) {
    spectators.delete(ws);
    if (ws.readyState !== ws.OPEN) continue;
    seatPlayer(ws, ws.joinName || "player");
    return;
  }
}

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
      if (ws.playerId || spectators.has(ws)) return;
      const typed = String(msg.name || "").slice(0, 12).trim();

      // Leaving it blank is not an error: you are handed a generated name, the
      // same way bots are. Defaulting to "player" would collide the moment two
      // people did it, which the duplicate check would then read as a refusal.
      const name = typed || freeName();
      if (!name) {
        send(ws, { type: "denied", message: "The arena has run out of names. Try again." });
        return;
      }

      // Two boards with one name is unreadable: the leaderboard, the label over
      // a board, and "eaten by X" all stop identifying anyone in particular.
      // Only what was typed needs checking; a generated name is unused already.
      if (typed) {
        const holder = holderOf(name);
        if (holder === "spectator" || (holder && !holder.isBot)) {
          send(ws, {
            type: "denied",
            message: "This name is currently taken by someone in the game.",
          });
          return;
        }
      }
      // A bot holding the name does not block a person; seatPlayer retires it
      // at the moment they actually take a seat.
      ws.joinName = name;

      // Room, or room a bot can vacate: play. Only an arena that is genuinely
      // full of people sends you to watch.
      if (world.players.size < C.MAX_PLAYERS || dropOneBot(name)) {
        seatPlayer(ws, name);
      } else {
        spectators.add(ws);
        send(ws, {
          type: "welcome",
          id: null,
          spectator: true,
          world: C.WORLD_SIZE,
          rows: C.ROWS,
          cols: C.COLS,
          holdMs: C.RESULT_HOLD_MS,
          handoffMs: C.HANDOFF_HOLD_MS,
        });
      }
      return;
    }

    if (!ws.playerId) return;

    switch (msg.type) {
      case "input":
        world.setDirection(ws.playerId, Number(msg.dx) || 0, Number(msg.dy) || 0);
        if (msg.w && msg.h) ws.view = { w: msg.w, h: msg.h, zoom: Number(msg.zoom) || 1 };
        break;
      case "typing":
        world.setDraft(ws.playerId, msg.text);
        break;
      case "guess": {
        const res = world.guess(ws.playerId, msg.guess);
        if (res.error) send(ws, { type: "reject", message: res.error });
        break;
      }
      case "lunge": {
        const res = world.lunge(ws.playerId);
        if (res.error) send(ws, { type: "reject", message: res.error });
        break;
      }
      case "respawn":
        world.respawn(ws.playerId);
        break;
    }
  });

  ws.on("close", () => {
    spectators.delete(ws);
    if (ws.playerId) {
      world.remove(ws.playerId);
      sockets.delete(ws.playerId);
      promoteSpectator();
      topUpBots();
    }
  });
});

// ---------- loops ----------
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  driveBots(world);
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

  // Everyone else's queue is dropped here. Bots generate events exactly like
  // players do (solves, kills, deaths) but hold no socket, so the loop above
  // never reaches them and their arrays would grow for the life of the process.
  for (const p of world.players.values()) if (p.events.length) p.events = [];

  // Spectators ride along on the leader's shoulder until a seat opens.
  if (spectators.size) {
    const lead = leaders[0] ? world.get(leaders[0].id) : null;
    const camera = lead
      ? { x: Math.round(lead.x), y: Math.round(lead.y) }
      : { x: C.WORLD_SIZE / 2, y: C.WORLD_SIZE / 2 };
    // Computed once: every spectator is watching the same board.
    const letters = lead ? world.watchView(lead) : null;
    for (const ws of spectators) {
      if (ws.readyState !== ws.OPEN) continue;
      const halfW = ((ws.view.w / ws.view.zoom) * C.VIEW_PAD) / 2;
      const halfH = ((ws.view.h / ws.view.zoom) * C.VIEW_PAD) / 2;
      send(ws, {
        type: "state",
        spectator: true,
        you: null,
        camera,
        // The leader's own board carries its letters; every other board in the
        // packet is the ordinary colours-only view.
        players: world.near(camera, halfW, halfH).map((o) => {
          const view = world.publicView(o);
          return letters && o === lead ? { ...view, ...letters } : view;
        }),
        leaders,
        events: [],
      });
    }
  }
}, 1000 / C.NET_HZ);

function lanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list) if (i.family === "IPv4" && !i.internal) return i.address;
  }
  return "localhost";
}

// Listen first: bots wait on a name lookup that can be slow or fail, and none
// of that should keep the arena unreachable.
server.listen(PORT, () => {
  console.log(`\nEatword arena running:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${lanIp()}:${PORT}`);
});

names.prime(BOT_COUNT).then((r) => {
  seedBots();
  // countBots(), not BOT_COUNT: report what is actually in the arena, and say
  // where the names came from, so a dead API is visible rather than silent.
  const source = !names.USE_API
    ? "generated locally, API off"
    : `${r.fromApi} names from the API, rest generated locally`;
  console.log(`  ${countBots()} bots (${source})\n`);
});
