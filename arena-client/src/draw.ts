import type { Color, PublicPlayer } from "./types";

export const INK = "#1a1a1b";
export const MUTED = "#787c7e";
export const LINE = "#d3d6da";
export const PAPER = "#f6f6f4";
export const TILE_FILL: Record<Color, string> = {
  green: "#6aaa64",
  yellow: "#c9b458",
  gray: "#787c7e",
};

const ROWS = 6;
const COLS = 5;
const GAP_RATIO = 0.14;

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** Boards are drawn from the tile size the server sends, so client and server agree. */
export function boardDims(tile: number) {
  const gap = tile * GAP_RATIO;
  return { gap, w: COLS * tile + (COLS - 1) * gap, h: ROWS * tile + (ROWS - 1) * gap };
}

/** Your board sits centred in the arena *above* the Wordle panel, never under it. */
export function focusY(vh: number, panel: number) {
  return (vh - Math.min(panel, vh * 0.4)) / 2;
}

/** How far out the camera sits at starting mass. Lower shows more arena. */
const BASE_ZOOM = 0.6;

export function zoomForMass(mass: number) {
  const z = BASE_ZOOM * Math.pow(100 / mass, 0.22);
  return Math.max(0.28, Math.min(0.75, z));
}

/** Faint world edges and a sparse grid — enough to feel motion, nothing more. */
function drawField(ctx: CanvasRenderingContext2D, cam: Camera, vw: number, vh: number, world: number) {
  const step = 400;
  ctx.strokeStyle = "#efefeb";
  ctx.lineWidth = 1 / cam.zoom;
  ctx.beginPath();
  const spanX = (vw / cam.zoom) * 0.9;
  const spanY = (vh / cam.zoom) * 0.9;
  const x0 = Math.floor((cam.x - spanX) / step) * step;
  const x1 = cam.x + spanX;
  for (let x = x0; x <= x1; x += step) {
    ctx.moveTo(x, cam.y - spanY);
    ctx.lineTo(x, cam.y + spanY);
  }
  const y0 = Math.floor((cam.y - spanY) / step) * step;
  const y1 = cam.y + spanY;
  for (let y = y0; y <= y1; y += step) {
    ctx.moveTo(cam.x - spanX, y);
    ctx.lineTo(cam.x + spanX, y);
  }
  ctx.stroke();

  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2 / cam.zoom;
  ctx.strokeRect(0, 0, world, world);
}

/**
 * One player: a Wordle grid with their name and mass in small text above it.
 * No card, bubble or badge around it — the grid is the character.
 */
function drawBoard(ctx: CanvasRenderingContext2D, p: PublicPlayer, isMe: boolean, zoom: number) {
  const { gap, w, h } = boardDims(p.tile);
  const left = p.x - w / 2;
  const top = p.y - h / 2;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = left + c * (p.tile + gap);
      const y = top + r * (p.tile + gap);
      const color = p.colors[r]?.[c];
      if (color) {
        ctx.fillStyle = TILE_FILL[color];
        ctx.fillRect(x, y, p.tile, p.tile);
      } else {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x, y, p.tile, p.tile);
        ctx.strokeStyle = LINE;
        ctx.lineWidth = Math.max(1 / zoom, p.tile * 0.05);
        ctx.strokeRect(x, y, p.tile, p.tile);
      }
    }
  }

  // Your own board carries a thin outline so you never lose yourself in a crowd.
  if (isMe) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2 / zoom;
    ctx.strokeRect(left - gap, top - gap, w + gap * 2, h + gap * 2);
  }

  const label = Math.max(11 / zoom, p.tile * 0.5);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  ctx.font = `600 ${label}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(p.name, p.x, top - label * 1.15 - gap);
  ctx.fillStyle = MUTED;
  ctx.font = `400 ${label * 0.85}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(String(p.mass), p.x, top - gap * 2 - 2 / zoom);
}

export function render(
  ctx: CanvasRenderingContext2D,
  opts: {
    vw: number;
    vh: number;
    dpr: number;
    cam: Camera;
    world: number;
    players: PublicPlayer[];
    myId: string | null;
    /** Height of the fixed Wordle panel; the camera focuses above it. */
    panel: number;
    /** End-of-puzzle flourish applied to your own board only. */
    selfFx: { scale: number; shakeX: number };
  }
) {
  const { vw, vh, dpr, cam, world, players, myId, panel, selfFx } = opts;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, vw, vh);

  ctx.save();
  ctx.translate(vw / 2, focusY(vh, panel));
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  drawField(ctx, cam, vw, vh, world);

  // Smallest first, so the board about to eat you is drawn on top.
  const ordered = [...players].sort((a, b) => a.mass - b.mass);
  const hasFx = selfFx.scale !== 1 || selfFx.shakeX !== 0;
  for (const p of ordered) {
    const isMe = p.id === myId;
    if (isMe && hasFx) {
      // Pulse/shake about the board's own centre so it stays put on screen.
      ctx.save();
      ctx.translate(p.x + selfFx.shakeX, p.y);
      ctx.scale(selfFx.scale, selfFx.scale);
      ctx.translate(-p.x, -p.y);
      drawBoard(ctx, p, isMe, cam.zoom);
      ctx.restore();
    } else {
      drawBoard(ctx, p, isMe, cam.zoom);
    }
  }

  ctx.restore();

  // Boards drifting beneath the Wordle panel would read as debris. Fade the
  // arena into the paper at the bottom edge — no panel, no border, just falloff.
  const fade = Math.min(panel * 0.55, vh * 0.25);
  const grad = ctx.createLinearGradient(0, vh - fade, 0, vh);
  grad.addColorStop(0, "rgba(246, 246, 244, 0)");
  grad.addColorStop(1, "rgba(246, 246, 244, 1)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, vh - fade, vw, fade);
}
