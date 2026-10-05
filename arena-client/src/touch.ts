import { useEffect, useState } from "react";

/** A touch-first device: no mouse to steer with and no keyboard to type on, so
 *  it gets the joystick, the tappable keyboard and the lunge button instead. */
const QUERY = "(pointer: coarse)";

/** `?touch=1` or `?touch=0` overrides detection, for trying the phone layout
 *  in a desktop browser, or the desktop one on a tablet with a keyboard. */
const FORCED = new URLSearchParams(location.search).get("touch");

export function useTouch() {
  const [touch, setTouch] = useState(() =>
    FORCED !== null ? FORCED === "1" : matchMedia(QUERY).matches
  );
  useEffect(() => {
    if (FORCED !== null) return;
    const m = matchMedia(QUERY);
    const on = () => setTouch(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return touch;
}
