import { useCallback, useEffect, useRef, useState } from "react";
import Arena, { type Fx, type Snapshot } from "./Arena";
import Leaderboard from "./Leaderboard";
import MyWordle from "./MyWordle";
import { Net } from "./net";
import type { GameEvent, Leader, PuzzleResult, ServerMsg, You } from "./types";

/** Matches the .mine block in styles.css; the camera focuses above it. */
const PANEL_HEIGHT = 280;

type Phase = "name" | "playing";

export default function App() {
  const [phase, setPhase] = useState<Phase>("name");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");

  const [you, setYou] = useState<You | null>(null);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [feed, setFeed] = useState<{ id: number; text: string }[]>([]);
  const [death, setDeath] = useState<{ by: string; mass: number } | null>(null);
  const [message, setMessage] = useState("");
  const [shake, setShake] = useState(0);
  const [result, setResult] = useState<PuzzleResult | null>(null);
  const [puzzleKey, setPuzzleKey] = useState(0);

  const guessRef = useRef("");
  const [guess, setGuess] = useState("");
  const netRef = useRef<Net | null>(null);
  const feedId = useRef(0);
  const snapshotRef = useRef<Snapshot>({ players: [], you: null, myId: null, world: 4200 });
  const fxRef = useRef<Fx | null>(null);
  const holdMs = useRef(850);
  const resultTimer = useRef(0);
  const wasDone = useRef(false);

  const flash = useCallback((text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage((m) => (m === text ? "" : m)), 1600);
  }, []);

  const push = useCallback((text: string) => {
    const id = ++feedId.current;
    setFeed((f) => [...f.slice(-4), { id, text }]);
    window.setTimeout(() => setFeed((f) => f.filter((e) => e.id !== id)), 4000);
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
          setResult({ solved: e.solved, word: e.word, points: e.points });
          fxRef.current = { kind: e.solved ? "pop" : "shake", at: performance.now() };
          // The server's puzzle swap is what really ends the reveal (see below);
          // this only rescues the UI if that state update never arrives.
          window.clearTimeout(resultTimer.current);
          resultTimer.current = window.setTimeout(() => setResult(null), holdMs.current + 600);
          break;
        case "ate":
          push(`ate ${e.name} · +${Math.round(e.mass * 0.7)}`);
          break;
        case "stole":
          push(
            e.active
              ? `stole ${e.from}'s puzzle · ${e.guesses} guesses in`
              : `banked ${e.from}'s puzzle · ${e.guesses} guesses in`
          );
          break;
        case "eaten":
          setDeath({ by: e.by, mass: e.mass });
          break;
      }
    },
    [push]
  );

  const onMessage = useCallback(
    (m: ServerMsg) => {
      if (m.type === "welcome") {
        snapshotRef.current.myId = m.id;
        snapshotRef.current.world = m.world;
        holdMs.current = m.holdMs;
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
      setYou(m.you);
      setLeaders(m.leaders);
      if (m.you.alive) setDeath(null);

      // The server drives the swap, so replay the grid's entrance off its state
      // rather than a local timer — the two can never drift apart.
      if (wasDone.current && !m.you.done) {
        setPuzzleKey((n) => n + 1);
        setResult(null);
        window.clearTimeout(resultTimer.current);
      }
      wasDone.current = m.you.done;

      for (const e of m.events) handleEvent(e);
    },
    [flash, handleEvent]
  );

  const start = () => {
    const clean = name.trim().slice(0, 12) || "player";
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
      if (death) {
        if (e.key === "Enter") netRef.current?.send({ type: "respawn" });
        return;
      }
      // The reveal is brief and non-blocking; movement continues, typing waits.
      if (result) return;
      if (e.key === "Enter") {
        if (guessRef.current.length === 5) {
          netRef.current?.send({ type: "guess", guess: guessRef.current });
          guessRef.current = "";
          setGuess("");
        } else {
          setShake((s) => s + 1);
          window.setTimeout(() => setShake(0), 400);
          setMessage("Not enough letters");
          window.setTimeout(() => setMessage(""), 1200);
        }
        return;
      }
      if (e.key === "Backspace") {
        guessRef.current = guessRef.current.slice(0, -1);
        setGuess(guessRef.current);
        return;
      }
      if (/^[a-zA-Z]$/.test(e.key) && guessRef.current.length < 5) {
        guessRef.current += e.key.toLowerCase();
        setGuess(guessRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, death, result]);

  const sendInput = useCallback((dx: number, dy: number, w: number, h: number, zoom: number) => {
    netRef.current?.send({ type: "input", dx, dy, w, h, zoom });
  }, []);

  if (phase === "name") {
    return (
      <main className="entry">
        <h1>Wordle Agar</h1>
        <div className="entry-row">
          <input
            autoFocus
            value={name}
            maxLength={12}
            placeholder="name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && start()}
          />
          <button onClick={start}>Play</button>
        </div>
      </main>
    );
  }

  return (
    <div className="game">
      <Arena snapshotRef={snapshotRef} panel={PANEL_HEIGHT} fxRef={fxRef} onInput={sendInput} />

      <Leaderboard leaders={leaders} myId={snapshotRef.current.myId} />

      <ul className="feed">
        {feed.map((e) => (
          <li key={e.id}>{e.text}</li>
        ))}
      </ul>

      <MyWordle
        rows={you?.rows ?? []}
        current={guess}
        queued={you?.queued ?? 0}
        message={message}
        shake={shake}
        result={result}
        puzzleKey={puzzleKey}
      />

      {status === "closed" && (
        <div className="curtain">
          <p>Disconnected</p>
          <button onClick={() => location.reload()}>Reconnect</button>
        </div>
      )}

      {death && status !== "closed" && (
        <div className="curtain">
          <p>
            Eaten by <strong>{death.by}</strong> at {death.mass}
          </p>
          <button onClick={() => netRef.current?.send({ type: "respawn" })}>Respawn</button>
        </div>
      )}
    </div>
  );
}
