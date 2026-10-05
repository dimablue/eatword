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

/** Mirrors --font in styles.css. Canvas takes no CSS variables, so the two are
 *  kept in step by hand; letting them drift sets the arena and your own board
 *  in different typefaces. */
const FONT = '"Libre Franklin", "Franklin Gothic Medium", "Franklin Gothic", "Helvetica Neue", Arial, sans-serif';

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

/** Your board sits centred in the arena *above* the Wordle panel, never under it.
 *  `cap` is the most of the screen the panel may claim; a phone's panel carries
 *  a full-size keyboard, so it is allowed more. */
export function focusY(vh: number, panel: number, cap = 0.4) {
  return (vh - Math.min(panel, vh * cap)) / 2;
}

/** How far out the camera sits at starting mass. Lower shows more arena. */
const BASE_ZOOM = 0.6;

export function zoomForMass(mass: number) {
  const z = BASE_ZOOM * Math.pow(100 / mass, 0.22);
  return Math.max(0.28, Math.min(0.75, z));
}

/** Faint world edges and a sparse grid, enough to feel motion and nothing more. */
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
 * No card, bubble or badge around it; the grid is the character.
 */
function drawBoard(ctx: CanvasRenderingContext2D, p: PublicPlayer, isMe: boolean, zoom: number) {
  const { gap, w, h } = boardDims(p.tile);
  const left = p.x - w / 2;
  const top = p.y - h / 2;
  // Letters arrive only for a board we are allowed to read, which today means
  // the leader while you are spectating. Everyone else is colours, as ever.
  // The half-typed word sits on the row after the last submitted guess.
  const draftRow = p.guesses ? p.guesses.length : -1;
  const glyph = p.tile * 0.56;

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

      const ch = p.guesses?.[r]?.[c] ?? (r === draftRow ? p.draft?.[c] : undefined);
      if (ch) {
        ctx.fillStyle = color ? "#ffffff" : INK;
        ctx.font = `700 ${glyph}px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(ch.toUpperCase(), x + p.tile / 2, y + p.tile / 2 + p.tile * 0.03);
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
  ctx.font = `600 ${label}px ${FONT}`;
  ctx.fillText(p.name, p.x, top - label * 1.15 - gap);
  ctx.fillStyle = MUTED;
  ctx.font = `400 ${label * 0.85}px ${FONT}`;
  ctx.fillText(String(p.mass), p.x, top - gap * 2 - 2 / zoom);
}

/**
 * What an eat adds around your board: a green ring bursting outward from its
 * edge and the mass you gained rising off it. Drawn unscaled by the gulp, so
 * the ring leaves from where the board actually ends up.
 */
function drawGulp(ctx: CanvasRenderingContext2D, p: PublicPlayer, zoom: number, t: number, gain: number) {
  const { gap, w, h } = boardDims(p.tile);
  const out = 1 - Math.pow(1 - t, 3);

  const spread = (40 / zoom + w * 0.35) * out;
  ctx.globalAlpha = 1 - out;
  ctx.strokeStyle = TILE_FILL.green;
  ctx.lineWidth = (8 / zoom) * (1 - out) + 1 / zoom;
  ctx.strokeRect(
    p.x - w / 2 - gap - spread,
    p.y - h / 2 - gap - spread,
    w + (gap + spread) * 2,
    h + (gap + spread) * 2
  );

  if (gain > 0) {
    // In first, hold, then out: readable for most of the gulp.
    ctx.globalAlpha = Math.min(1, t * 8) * Math.min(1, (1 - t) * 3);
    const size = 30 / zoom;
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = 5 / zoom;
    ctx.strokeStyle = PAPER;
    ctx.lineJoin = "round";
    const y = p.y - h / 2 - 48 / zoom - (60 / zoom) * out;
    ctx.strokeText(`+${gain}`, p.x, y);
    ctx.fillStyle = TILE_FILL.green;
    ctx.fillText(`+${gain}`, p.x, y);
  }
  ctx.globalAlpha = 1;
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
    /** See focusY. */
    panelCap?: number;
    /** End-of-puzzle flourish applied to your own board only. */
    selfFx: { scale: number; shakeX: number; gulp?: { t: number; gain: number } };
  }
) {
  const { vw, vh, dpr, cam, world, players, myId, panel, panelCap, selfFx } = opts;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, vw, vh);

  ctx.save();
  ctx.translate(vw / 2, focusY(vh, panel, panelCap));
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  drawField(ctx, cam, vw, vh, world);

  // Smallest first, so the board about to eat you is drawn on top.
  const ordered = [...players].sort((a, b) => a.mass - b.mass);
  const hasFx = selfFx.scale !== 1 || selfFx.shakeX !== 0 || !!selfFx.gulp;
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
      if (selfFx.gulp) drawGulp(ctx, p, cam.zoom, selfFx.gulp.t, selfFx.gulp.gain);
    } else {
      drawBoard(ctx, p, isMe, cam.zoom);
    }
  }

  ctx.restore();

  // Boards drifting beneath the Wordle panel would read as debris. Fade the
  // arena into the paper at the bottom edge: no panel, no border, just falloff.
  const fade = Math.min(panel * 0.55, vh * 0.25);
  const grad = ctx.createLinearGradient(0, vh - fade, 0, vh);
  grad.addColorStop(0, "rgba(246, 246, 244, 0)");
  grad.addColorStop(1, "rgba(246, 246, 244, 1)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, vh - fade, vw, fade);
}
