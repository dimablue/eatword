import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import Arena, { type Fx, type Snapshot } from "./Arena";
import Grid from "./Grid";
import Leaderboard from "./Leaderboard";
import MyWordle from "./MyWordle";
import { Net } from "./net";
import type {
  FinalBoard,
  GameEvent,
  Leader,
  PuzzleResult,
  ServerMsg,
  You,
} from "./types";

/** Everything the death screen shows: who took you, and the board they took. */
type Death = { by: string; mass: number } & FinalBoard;

/** Matches the .mine block in styles.css; the camera focuses above it.
 *  Covers the reveal slot, the grid, the letter tracker and the lunge rule.
 *  re-measure it whenever any of their sizes change, or your own board drifts
 *  under it. Measured in the browser, not derived: 287 at the time of writing. */
const PANEL_HEIGHT = 287;

type Phase = "name" | "playing";

export default function App() {
  const [phase, setPhase] = useState<Phase>("name");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");

  const [you, setYou] = useState<You | null>(null);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  /** A single explanatory card, with the life it was given so the CSS can fade
   *  it on the same clock the timer clears it on. */
  const [notice, setNotice] = useState<{ text: string; ms: number } | null>(null);
  const [death, setDeath] = useState<Death | null>(null);
  const [message, setMessage] = useState("");
  const [shake, setShake] = useState(0);
  const [result, setResult] = useState<PuzzleResult | null>(null);
  const [puzzleKey, setPuzzleKey] = useState(0);
  const [spectator, setSpectator] = useState(false);
  /** Why the server refused the name, shown back on the entry screen. */
  const [entryError, setEntryError] = useState("");

  const guessRef = useRef("");
  const [guess, setGuess] = useState("");
  const netRef = useRef<Net | null>(null);
  const snapshotRef = useRef<Snapshot>({
    players: [],
    you: null,
    myId: null,
    world: 4200,
    camera: null,
    at: 0,
  });
  const fxRef = useRef<Fx | null>(null);
  const lastPuzzleId = useRef<number | null>(null);
  const holdMs = useRef(850);
  const handoffMs = useRef(700);
  const resultTimer = useRef(0);
  const noticeTimer = useRef(0);
  const wasDone = useRef(false);

  /**
   * Every change to the typed word is mirrored to the server, so the letters
   * exist somewhere other than this browser when you are eaten mid-word, and that
   * is what lets your killer inherit them. `sync` is off only when we are
   * adopting the server's own value and must not echo it straight back.
   */
  const setBuffer = useCallback((text: string, sync = true) => {
    guessRef.current = text;
    setGuess(text);
    if (sync) netRef.current?.send({ type: "typing", text });
  }, []);

  /**
   * Long enough to read once and no longer, scaled by length, since the notices are
   * very different sizes and a fixed delay would rush one of them. `sticky`
   * means no timer at all: a state you are still in, rather than a thing that
   * just happened, stays up until it is closed or stops being true.
   */
  const showNotice = useCallback((text: string, sticky = false) => {
    const ms = sticky ? 0 : Math.min(10000, 2000 + text.split(/\s+/).length * 400);
    window.clearTimeout(noticeTimer.current);
    setNotice({ text, ms });
    if (ms) noticeTimer.current = window.setTimeout(() => setNotice(null), ms);
  }, []);

  const dismissNotice = useCallback(() => {
    window.clearTimeout(noticeTimer.current);
    setNotice(null);
  }, []);

  const flash = useCallback((text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage((m) => (m === text ? "" : m)), 1600);
  }, []);

  const handleEvent = useCallback(
    (e: GameEvent) => {
      switch (e.kind) {
        case "result":
          // Reveal the word, show the score, and kick off the board flourish.
          // Anything typed mid-reveal is dropped, so clear the buffer now.
          guessRef.current = "";
          setGuess("");
          setMessage("");
          setResult({ solved: e.solved, word: e.word, points: e.points, handoff: e.handoff });
          fxRef.current = { kind: e.solved ? "pop" : "shake", at: performance.now() };
          // The server's puzzle swap is what really ends the reveal (see below);
          // this only rescues the UI if that state update never arrives. An eat
          // is held for far less time, so it needs the shorter deadline too.
          window.clearTimeout(resultTimer.current);
          resultTimer.current = window.setTimeout(
            () => setResult(null),
            (e.handoff ? handoffMs.current : holdMs.current) + 600
          );
          break;
        // "ate" and "stole" are deliberately not surfaced. The handoff shows
        // the mass a kill paid, in the middle of the screen, and the inherited
        // board arrives full of someone else's guesses. Both are already said
        // better than a line of text in the corner could say them. The server
        // still sends both events; they are the record of what happened.
        case "decay":
          // Said once per life, and the only rule nothing on screen explains.
          // It bleeds *back down to* the threshold rather than eroding you
          // away, and the copy has to say so or it reads as a punishment.
          showNotice(
            `Your mass is past ${e.at}. At this size, it will slowly shrink ` +
              `back to ${e.at}. Keep solving or eating to stay ahead!`
          );
          break;
        case "lunge":
          // The trap worth naming is not the price itself, it is that paying it
          // can drop you under the size you need to eat the thing you were
          // chasing: you catch them and then cannot finish it.
          showNotice(`If your mass is above ${e.free}, lunging will cost ${e.pct}% of your mass.`);
          break;
        case "eaten":
          // The letters left with the board; don't leave them on screen. The
          // board itself is kept, frozen as the server saw it, for the review.
          guessRef.current = "";
          setGuess("");
          setResult(null);
          window.clearTimeout(resultTimer.current);
          dismissNotice();
          setDeath({ by: e.by, mass: e.mass, rows: e.rows, word: e.word, draft: e.draft });
          break;
      }
    },
    [dismissNotice, showNotice]
  );

  const onMessage = useCallback(
    (m: ServerMsg) => {
      if (m.type === "welcome") {
        // Sent again on promotion, so this also handles spectator -> player.
        snapshotRef.current.myId = m.id;
        snapshotRef.current.world = m.world;
        holdMs.current = m.holdMs;
        handoffMs.current = m.handoffMs;
        setSpectator(m.spectator);
        // Sent again on promotion, so this both raises the notice and clears it.
        if (m.spectator) {
          showNotice(
            "Arena is full. You\u2019re currently spectating the leaderboard leader. " +
              "You\u2019ll automatically join when a spot opens.",
            true
          );
        } else {
          dismissNotice();
          snapshotRef.current.camera = null;
        }
        return;
      }
      if (m.type === "denied") {
        // start() flips to "playing" before the server has had its say, so a
        // refusal has to walk that back rather than surface in-game.
        setEntryError(m.message);
        setPhase("name");
        netRef.current?.close();
        netRef.current = null;
        return;
      }
      if (m.type === "reject") {
        flash(m.message);
        setShake((s) => s + 1);
        window.setTimeout(() => setShake(0), 400);
        return;
      }
      snapshotRef.current.players = m.players;
      snapshotRef.current.you = m.you;
      snapshotRef.current.camera = m.camera ?? null;
      // Stamped on the rAF clock so the renderer can interpolate between packets.
      snapshotRef.current.at = performance.now();
      setYou(m.you);
      setLeaders(m.leaders);

      if (m.you) {
        if (m.you.alive) setDeath(null);
        // A different board means a solve, a respawn, or a steal. Only then does
        // the server's draft win. Mid-puzzle it would fight your own typing on
        // every packet. On respawn that draft is empty, so a half-typed word
        // cannot follow you to a new life; on a steal it is the victim's.
        if (m.you.puzzleId !== lastPuzzleId.current) {
          lastPuzzleId.current = m.you.puzzleId;
          if (m.you.puzzleId !== null) setBuffer(m.you.draft, false);
        }
        // The server drives the swap, so replay the grid's entrance off its state
        // rather than a local timer, so the two can never drift apart.
        if (wasDone.current && !m.you.done) {
          setPuzzleKey((n) => n + 1);
          setResult(null);
          window.clearTimeout(resultTimer.current);
        }
        wasDone.current = m.you.done;
      }

      for (const e of m.events) handleEvent(e);
    },
    [dismissNotice, flash, handleEvent, setBuffer, showNotice]
  );

  const start = () => {
    // Blank is allowed and is sent as blank: the server generates a name from
    // the same pool the bots draw from, so it is unique by construction.
    const clean = name.trim().slice(0, 12);
    setEntryError("");
    const net = new Net(onMessage, setStatus);
    netRef.current = net;
    net.connect(clean);
    setPhase("playing");
  };

  // Typing drives guesses; the mouse drives movement, so they never collide.
  useEffect(() => {
    if (phase !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (spectator) return;
      // The Enter that submits your name on the entry screen bubbles up to
      // window after this listener is mounted, and would read as an empty
      // guess. Ignore anything typed into a field, and ignore auto-repeat so
      // holding Enter to start doesn't fire guesses either.
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.repeat && e.key === "Enter") return;
      // Before every other branch: the mouse steers, so pointing at the card's
      // close button drives you across the arena to reach it. Escape is the
      // dismissal that costs you nothing.
      if (e.key === "Escape") {
        dismissNotice();
        return;
      }
      if (death) {
        if (e.key === "Enter") netRef.current?.send({ type: "respawn" });
        return;
      }
      // Above the reveal check on purpose: the lunge is movement, and movement
      // is never frozen. It stays live through the handoff, when typing is not.
      if (e.key === " ") {
        e.preventDefault(); // space scrolls the page otherwise
        if (!e.repeat) netRef.current?.send({ type: "lunge" });
        return;
      }
      // The reveal is brief and non-blocking; movement continues, typing waits.
      if (result) return;
      if (e.key === "Enter") {
        if (guessRef.current.length === 5) {
          netRef.current?.send({ type: "guess", guess: guessRef.current });
          setBuffer("");
        } else {
          setShake((s) => s + 1);
          window.setTimeout(() => setShake(0), 400);
          setMessage("Not enough letters");
          window.setTimeout(() => setMessage(""), 1200);
        }
        return;
      }
      if (e.key === "Backspace") {
        setBuffer(guessRef.current.slice(0, -1));
        return;
      }
      if (/^[a-zA-Z]$/.test(e.key) && guessRef.current.length < 5) {
        setBuffer(guessRef.current + e.key.toLowerCase());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, death, result, spectator, setBuffer, dismissNotice]);

  const sendInput = useCallback((dx: number, dy: number, w: number, h: number, zoom: number) => {
    netRef.current?.send({ type: "input", dx, dy, w, h, zoom });
  }, []);

  if (phase === "name") {
    return (
      <main className="entry">
        <h1>Eatword</h1>
        {/* The only place either of these can be learned: there is no tutorial,
            no help key, and nothing in the arena states the controls. */}
        <p className="pitch">
          You're solving a word puzzle while everyone else tries to eat you. Eat
          someone smaller than you and you continue their puzzle from where they
          left off. Every puzzle you solve and every board you eat makes you
          bigger.
        </p>
        <p className="controls">Mouse to move, type to guess, space to lunge.</p>
        <div className="entry-row">
          <input
            autoFocus
            value={name}
            maxLength={12}
            placeholder="name"
            onChange={(e) => {
              setName(e.target.value);
              setEntryError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && start()}
          />
          <button onClick={start}>Play</button>
        </div>
        <p className={`entry-error ${entryError ? "on" : ""}`}>{entryError || " "}</p>
      </main>
    );
  }

  return (
    <div className="game">
      {/* No panel while spectating, so the camera centres the whole viewport. */}
      <Arena
        snapshotRef={snapshotRef}
        panel={spectator ? 0 : PANEL_HEIGHT}
        fxRef={fxRef}
        onInput={sendInput}
      />

      <Leaderboard leaders={leaders} myId={snapshotRef.current.myId} />

      {notice && (
        <aside
          className={`notice ${notice.ms ? "" : "sticky"}`}
          style={{ "--life": `${notice.ms}ms` } as CSSProperties}
        >
          <span className="badge" aria-hidden="true">i</span>
          <p>{notice.text}</p>
          <button className="dismiss" onClick={dismissNotice} aria-label="Dismiss">
            ×
          </button>
        </aside>
      )}

      {/* No panel while spectating (there is no board to show) and none behind
          the death screen, which carries a board of its own. The curtain is
          only translucent, so leaving this mounted shows two of them at once. */}
      {spectator || death ? null : (
        <MyWordle
          rows={you?.rows ?? []}
          current={guess}
          message={message}
          shake={shake}
          result={result}
          puzzleKey={puzzleKey}
          handoffMs={handoffMs.current}
          lungeReady={you?.lungeReady ?? true}
        />
      )}

      {status === "closed" && (
        <div className="curtain">
          <p>Disconnected</p>
          <button onClick={() => location.reload()}>Reconnect</button>
        </div>
      )}

      {death && !spectator && status !== "closed" && (
        // The board you died on, exactly as you left it, with the answer you
        // never got to. Read-only, since the puzzle belongs to whoever ate you now.
        <div className="curtain death">
          <p className="headline">You were eaten</p>
          <p className="by">
            by <strong>{death.by}</strong> at {death.mass}
          </p>
          <Grid rows={death.rows} current={death.draft} />
          <p className="answer">
            The word was <strong>{death.word.toUpperCase()}</strong>
          </p>
          <button onClick={() => netRef.current?.send({ type: "respawn" })}>Respawn</button>
        </div>
      )}
    </div>
  );
}
