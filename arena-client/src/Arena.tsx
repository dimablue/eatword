import { useEffect, useRef } from "react";
import { boardDims, focusY, render, zoomForMass, type Camera } from "./draw";
import type { PublicPlayer, You } from "./types";

export interface Snapshot {
  players: PublicPlayer[];
  you: You | null;
  myId: string | null;
  world: number;
  /** Camera anchor when you have no board of your own (spectating). */
  camera: { x: number; y: number } | null;
  /** When this snapshot arrived, on the same clock as requestAnimationFrame. */
  at: number;
}

/** A one-shot flourish on your own board when a puzzle ends. */
export interface Fx {
  kind: "pop" | "shake";
  at: number;
}

interface Props {
  snapshotRef: React.MutableRefObject<Snapshot>;
  /** Height of the Wordle panel, so the camera can keep your board clear of it. */
  panel: number;
  fxRef: React.MutableRefObject<Fx | null>;
  onInput: (dx: number, dy: number, w: number, h: number, zoom: number) => void;
}

interface Drawn extends PublicPlayer {
  dx: number;
  dy: number;
  /** Eased tile size, so growing reads as growth rather than a jump. */
  dtile: number;
}

const FX_MS = 420;

/** A board's position at one server instant. */
interface Sample {
  t: number;
  x: number;
  y: number;
}

/** Further than a board could travel between packets, so it must be a respawn. */
const TELEPORT = 500;

/** Error past which a correction is shown outright rather than smoothed away. */
const SELF_SNAP = 300;
/** How fast a mispredict is absorbed, per second. */
const SMOOTH = 12;

/**
 * Your own board, stepped forward by your own input rather than read from a
 * packet. The server stays authoritative: its position is blended back in every
 * frame, and a large disagreement (a respawn, or being moved by an eat) snaps
 * outright instead of sliding. On a local server the error is ~0 and this is
 * simply the server's own motion, one render delay earlier.
 */
export function predictSelf(
  s: { x: number; y: number; ox: number; oy: number; at: number; ok: boolean },
  server: { x: number; y: number; tile: number },
  snap: Snapshot,
  input: { dx: number; dy: number },
  dt: number
) {
  const speed = snap.you?.speed ?? 0;
  if (!s.ok) {
    s.x = server.x;
    s.y = server.y;
    s.ox = s.oy = 0;
    s.at = snap.at;
    s.ok = true;
  }

  // Each packet is the authority, adopted outright, but whatever we were
  // drawing is kept as an offset so accepting it never shows as a jump. Pulling
  // gradually toward a position that only moves every 50ms instead put a
  // sawtooth in the velocity, which is the stutter this is avoiding.
  if (snap.at !== s.at) {
    s.at = snap.at;
    const dx = s.x + s.ox - server.x;
    const dy = s.y + s.oy - server.y;
    const off = Math.hypot(dx, dy) > SELF_SNAP;
    s.ox = off ? 0 : dx;
    s.oy = off ? 0 : dy;
    s.x = server.x;
    s.y = server.y;
  }

  // Step forward on our own input. The server is applying the input we already
  // sent it, so this lands close to what the next packet will say. The packet
  // is stale by one trip, and this integration covers exactly that gap.
  s.x += input.dx * speed * dt;
  s.y += input.dy * speed * dt;

  // Same wall rule as the server: the board stays inside, not the hit circle.
  const { w, h } = boardDims(server.tile);
  s.x = Math.min(snap.world - w / 2, Math.max(w / 2, s.x));
  s.y = Math.min(snap.world - h / 2, Math.max(h / 2, s.y));

  const k = Math.exp(-SMOOTH * dt);
  s.ox *= k;
  s.oy *= k;
  return { x: s.x + s.ox, y: s.y + s.oy };
}

/**
 * Where a board was at time `t`, interpolated between the two samples that
 * bracket it. Past the end of the buffer we hold the last known position rather
 * than extrapolate, because guessing forward overshoots on every direction change,
 * which reads as a twitch.
 */
export function sampleAt(buf: Sample[] | undefined, t: number, fallback: { x: number; y: number }) {
  if (!buf || buf.length === 0) return fallback;
  if (buf.length === 1 || t <= buf[0].t) return buf[0];
  const last = buf[buf.length - 1];
  if (t >= last.t) return last;
  for (let i = buf.length - 1; i > 0; i--) {
    const a = buf[i - 1];
    const b = buf[i];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      const f = span > 0 ? (t - a.t) / span : 1;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  return last;
}

/**
 * The arena canvas. State arrives at 15Hz; positions are eased toward their
 * targets every frame so movement reads as continuous.
 */
export default function Arena({ snapshotRef, panel, fxRef, onInput }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointer = useRef({ x: 0, y: 0, active: false });
  const drawn = useRef(new Map<string, Drawn>());
  const cam = useRef<Camera>({ x: 2100, y: 2100, zoom: 1 });
  const input = useRef({ dx: 0, dy: 0, zoom: 1 });
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const tracks = useRef(new Map<string, Sample[]>());
  const self = useRef({ x: 0, y: 0, ox: 0, oy: 0, at: 0, ok: false });
  const lastAt = useRef(0);
  const interval = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const snap = snapshotRef.current;
      const vw = canvas.clientWidth;
      const vh = canvas.clientHeight;

      // Record each new snapshot instead of chasing it. Easing toward the newest
      // position decelerates as it closes the gap and then lurches when the next
      // packet lands: a velocity pulse at exactly NET_HZ, which is the stutter.
      if (snap.at !== lastAt.current) {
        const prev = lastAt.current;
        lastAt.current = snap.at;
        // Track the observed packet interval so the render delay follows the
        // real send rate rather than a hardcoded guess.
        if (prev) {
          const gap = snap.at - prev;
          interval.current = interval.current ? interval.current * 0.8 + gap * 0.2 : gap;
        }
        for (const p of snap.players) {
          let buf = tracks.current.get(p.id);
          if (!buf) tracks.current.set(p.id, (buf = []));
          const prevSample = buf[buf.length - 1];
          // Respawns move you across the map; sliding there would look absurd.
          if (prevSample && Math.hypot(p.x - prevSample.x, p.y - prevSample.y) > TELEPORT) {
            buf.length = 0;
          }
          buf.push({ t: snap.at, x: p.x, y: p.y });
          if (buf.length > 12) buf.shift();
        }
      }

      // Draw slightly in the past, so there is always a later sample to aim at
      // and every frame sits between two positions the server actually reported.
      const delay = Math.min(220, Math.max(60, (interval.current || 1000 / 15) * 1.8));
      const renderT = now - delay;

      const kTile = 1 - Math.exp(-6 * dt);
      const seen = new Set<string>();
      for (const p of snap.players) {
        seen.add(p.id);
        // Remote boards are interpolated, which means drawing them in the past.
        // Your own is not: you know your input and your speed, so it is stepped
        // forward locally and eased back onto the server's word. Interpolating
        // it too made your board answer the mouse a whole render delay late.
        const at =
          p.id === snap.myId && snap.you?.alive
            ? predictSelf(self.current, p, snap, input.current, dt)
            : sampleAt(tracks.current.get(p.id), renderT, p);
        const d = drawn.current.get(p.id);
        if (!d) drawn.current.set(p.id, { ...p, dx: at.x, dy: at.y, dtile: p.tile });
        else {
          const prevTile = d.dtile;
          Object.assign(d, p);
          d.dx = at.x;
          d.dy = at.y;
          // Size still eases, so growing reads as growth rather than a jump.
          d.dtile = prevTile + (p.tile - prevTile) * kTile;
        }
      }
      for (const id of [...drawn.current.keys()]) {
        if (!seen.has(id)) {
          drawn.current.delete(id);
          tracks.current.delete(id);
        }
      }

      const me = snap.myId ? drawn.current.get(snap.myId) : undefined;
      // Follow your own board, or the server's anchor while spectating.
      const focus = me
        ? { x: me.dx, y: me.dy, zoom: zoomForMass(me.mass) }
        : snap.camera
          ? { x: snap.camera.x, y: snap.camera.y, zoom: 0.5 }
          : null;
      if (focus) {
        // The camera still eases: it is chasing a target that is already smooth,
        // so there is no packet-rate stutter to inherit, and a little lag here
        // keeps the view from twitching on every direction change.
        const kCam = 1 - Math.exp(-14 * dt);
        cam.current.x += (focus.x - cam.current.x) * kCam;
        cam.current.y += (focus.y - cam.current.y) * kCam;
        cam.current.zoom += (focus.zoom - cam.current.zoom) * (1 - Math.exp(-3 * dt));
      }
      input.current.zoom = cam.current.zoom;

      // Direction is the pointer's offset from your board on screen, capped at one.
      if (pointer.current.active) {
        const ox = pointer.current.x - vw / 2;
        const oy = pointer.current.y - focusY(vh, panelRef.current);
        const mag = Math.hypot(ox, oy);
        const dead = 24;
        if (mag < dead) {
          input.current.dx = 0;
          input.current.dy = 0;
        } else {
          const scale = Math.min(1, (mag - dead) / 220) / mag;
          input.current.dx = ox * scale;
          input.current.dy = oy * scale;
        }
      }

      // A solve swells the board, a miss rattles it. Both decay to nothing.
      let fxScale = 1;
      let fxShake = 0;
      const fx = fxRef.current;
      if (fx) {
        const t = (now - fx.at) / FX_MS;
        if (t >= 1) fxRef.current = null;
        else if (fx.kind === "pop") fxScale = 1 + 0.16 * Math.sin(Math.PI * t);
        else fxShake = Math.sin(t * Math.PI * 8) * 14 * (1 - t);
      }

      const players = [...drawn.current.values()].map((d) => ({
        ...d,
        x: d.dx,
        y: d.dy,
        tile: d.dtile,
      }));
      render(ctx, {
        vw,
        vh,
        dpr: Math.min(2, window.devicePixelRatio || 1),
        cam: cam.current,
        world: snap.world,
        players,
        myId: snap.myId,
        panel: panelRef.current,
        selfFx: { scale: fxScale, shakeX: fxShake },
      });

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [snapshotRef, fxRef]);

  /**
   * Pointer tracking lives on the window rather than the canvas so the heading
   * survives the cursor leaving the page, the same as agar.io. Once the cursor
   * is outside, no more events arrive and `pointer` simply keeps its last value,
   * so you carry on in that direction until you move the mouse back. Zeroing on
   * leave instead made the arena feel like it stopped at the window edge.
   */
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      pointer.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, active: true };
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // Movement is sent on its own cadence, decoupled from the render loop.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const id = window.setInterval(() => {
      onInput(
        input.current.dx,
        input.current.dy,
        canvas.clientWidth,
        canvas.clientHeight,
        input.current.zoom
      );
    }, 50);
    return () => window.clearInterval(id);
  }, [onInput]);

  return (
    <canvas ref={canvasRef} className="arena" />
  );
}
