import { useEffect, useRef } from "react";
import { focusY, render, zoomForMass, type Camera } from "./draw";
import type { PublicPlayer, You } from "./types";

export interface Snapshot {
  players: PublicPlayer[];
  you: You | null;
  myId: string | null;
  world: number;
}

interface Props {
  snapshotRef: React.MutableRefObject<Snapshot>;
  /** Height of the Wordle panel, so the camera can keep your board clear of it. */
  panel: number;
  onInput: (dx: number, dy: number, w: number, h: number, zoom: number) => void;
}

interface Drawn extends PublicPlayer {
  dx: number;
  dy: number;
}

/**
 * The arena canvas. State arrives at 15Hz; positions are eased toward their
 * targets every frame so movement reads as continuous.
 */
export default function Arena({ snapshotRef, panel, onInput }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointer = useRef({ x: 0, y: 0, active: false });
  const drawn = useRef(new Map<string, Drawn>());
  const cam = useRef<Camera>({ x: 2100, y: 2100, zoom: 1 });
  const input = useRef({ dx: 0, dy: 0, zoom: 1 });
  const panelRef = useRef(panel);
  panelRef.current = panel;

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

      // Ease every visible board toward its last known server position.
      const k = 1 - Math.exp(-14 * dt);
      const seen = new Set<string>();
      for (const p of snap.players) {
        seen.add(p.id);
        const d = drawn.current.get(p.id);
        if (!d) drawn.current.set(p.id, { ...p, dx: p.x, dy: p.y });
        else {
          Object.assign(d, p);
          d.dx += (p.x - d.dx) * k;
          d.dy += (p.y - d.dy) * k;
        }
      }
      for (const id of [...drawn.current.keys()]) if (!seen.has(id)) drawn.current.delete(id);

      const me = snap.myId ? drawn.current.get(snap.myId) : undefined;
      if (me) {
        cam.current.x += (me.dx - cam.current.x) * k;
        cam.current.y += (me.dy - cam.current.y) * k;
        const target = zoomForMass(me.mass);
        cam.current.zoom += (target - cam.current.zoom) * (1 - Math.exp(-3 * dt));
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

      const players = [...drawn.current.values()].map((d) => ({ ...d, x: d.dx, y: d.dy }));
      render(ctx, {
        vw,
        vh,
        dpr: Math.min(2, window.devicePixelRatio || 1),
        cam: cam.current,
        world: snap.world,
        players,
        myId: snap.myId,
        panel: panelRef.current,
      });

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [snapshotRef]);

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
    <canvas
      ref={canvasRef}
      className="arena"
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        pointer.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, active: true };
      }}
      onPointerLeave={() => {
        pointer.current.active = false;
        input.current.dx = 0;
        input.current.dy = 0;
      }}
    />
  );
}
