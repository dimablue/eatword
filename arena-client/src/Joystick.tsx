import { useEffect, useRef, useState } from "react";

export interface Stick {
  dx: number;
  dy: number;
}

interface Props {
  stickRef: React.MutableRefObject<Stick>;
}

/** A thumb never lands perfectly still; this much drift is not a heading. */
const DEAD = 4;

/**
 * A fixed joystick: the ring stays put and the knob is dragged inside it. The
 * heading is the knob's offset from the ring's centre, and letting go springs
 * it back, so unlike the mouse a released stick means stop. Only one finger
 * steers; any others are free to type.
 */
export default function Joystick({ stickRef }: Props) {
  const id = useRef<number | null>(null);
  const centre = useRef({ x: 0, y: 0 });
  /** How far the knob can travel and stay inside the ring, which is also full
   *  speed. Measured, since the ring is smaller on short screens. */
  const radius = useRef(30);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  // Unmounted mid-drag (eaten, say), the stick must not keep you walking.
  useEffect(() => () => void (stickRef.current = { dx: 0, dy: 0 }), [stickRef]);

  const steer = (clientX: number, clientY: number) => {
    const ox = clientX - centre.current.x;
    const oy = clientY - centre.current.y;
    const mag = Math.hypot(ox, oy);
    const R = radius.current;
    const k = mag > R ? R / mag : 1;
    const scale = mag < DEAD ? 0 : Math.min(1, (mag - DEAD) / (R - DEAD)) / mag;
    stickRef.current = { dx: ox * scale, dy: oy * scale };
    setKnob({ x: ox * k, y: oy * k });
  };

  const release = (e: React.PointerEvent) => {
    if (e.pointerId !== id.current) return;
    id.current = null;
    stickRef.current = { dx: 0, dy: 0 };
    setKnob({ x: 0, y: 0 });
  };

  return (
    <div
      className={`stick ${id.current !== null ? "held" : ""}`}
      onPointerDown={(e) => {
        if (id.current !== null) return;
        e.preventDefault();
        id.current = e.pointerId;
        const ring = e.currentTarget;
        const r = ring.getBoundingClientRect();
        centre.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        const knobSize = (ring.firstElementChild as HTMLElement).offsetWidth;
        radius.current = Math.max(DEAD + 1, (ring.clientWidth - knobSize) / 2);
        steer(e.clientX, e.clientY);
        // Keeps the drag ours when the thumb slides off the ring. Can throw if
        // the pointer is already gone, which must not leave the stick half-set.
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* steer without capture */
        }
      }}
      onPointerMove={(e) => {
        if (e.pointerId === id.current) steer(e.clientX, e.clientY);
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div className="stick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
