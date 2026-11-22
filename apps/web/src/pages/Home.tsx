import {
  animate,
  motion,
  useInView,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { newBoardId, upsertBoard } from "../boards";
import { linkProps, navigate } from "../router";
import { Icon, Logo, softSpring, spring, type IconName } from "../ui/kit";
import { ThemeToggle } from "../ui/ThemeToggle";

// --- tiny animation math (pure functions of scroll progress) -------------------------

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
/** 0 before a, 1 after b, linear between. */
const seg = (v: number, a: number, b: number): number => clamp01((v - a) / (b - a));
/** 0 → 1 → 0 over [a, b]. */
const tri = (v: number, a: number, b: number): number => {
  const t = seg(v, a, b);
  return t < 0.5 ? t * 2 : (1 - t) * 2;
};
const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

function useP<T>(progress: MotionValue<number>, fn: (v: number) => T): MotionValue<T> {
  return useTransform(progress, fn);
}

function startDemo(template = "flowchart"): void {
  const id = newBoardId();
  upsertBoard(id, { title: "Demo board" });
  navigate(`/b/${id}?template=${template}`);
}

// --- chapters ---------------------------------------------------------------------------

interface Chapter {
  readonly kicker: string;
  readonly title: ReactNode;
  readonly body: string;
  readonly points: readonly string[];
}

const CHAPTERS: readonly Chapter[] = [
  {
    kicker: "01 · Create",
    title: (
      <>
        An infinite canvas that <em>keeps up</em> with you.
      </>
    ),
    body: "Sticky notes, shapes, frames, a pen, and connectors that stay attached when you move things. Snapping and alignment guides make it tidy without trying.",
    points: ["Connectors that follow shapes", "Resize, rotate, snap, align", "5,000+ shapes at 60 fps"],
  },
  {
    kicker: "02 · Together",
    title: (
      <>
        Everyone, <em>live</em>, on the same board.
      </>
    ),
    body: "See your team's cursors glide in real time, chat right next to your cursor, drop a reaction, and follow someone's view while they present.",
    points: ["Live cursors and selections", "Cursor chat and emoji reactions", "Follow a teammate's view"],
  },
  {
    kicker: "03 · Offline",
    title: (
      <>
        No signal? <em>Keep going.</em>
      </>
    ),
    body: "Every edit is saved on your device first. Lose the connection on a train and keep working: your changes queue up and slip back in the moment you're online.",
    points: ["Saved to your device instantly", "Edits queue while offline", "Survives reloads and crashes"],
  },
  {
    kicker: "04 · No conflicts",
    title: (
      <>
        Two people, one note, <em>zero</em> lost work.
      </>
    ),
    body: "Tandem is built on CRDTs written from scratch: every device can edit at once and they always end up identical. Maya moves a card while Leo recolors it — both changes stay.",
    points: ["Mathematically guaranteed to converge", "Undo only touches your own edits", "No locks, no “someone else is editing”"],
  },
  {
    kicker: "05 · Time travel",
    title: (
      <>
        Scrub back to <em>any moment</em>.
      </>
    ),
    body: "Every change is kept in order. Drag the slider to watch the board rewind, then restore an old version in one click — and undo that too, if you change your mind.",
    points: ["Full history of every board", "Animated rewind", "Restore is just another undoable edit"],
  },
  {
    kicker: "06 · Local AI",
    title: (
      <>
        An assistant that <em>never phones home</em>.
      </>
    ),
    body: "Describe a plan, a flowchart or a mind map and watch it stream onto the canvas. Ask it to summarize or tidy a messy board. It runs on your machine — your ideas never leave it.",
    points: ["Boards, flowcharts and mind maps", "Summarize and organize", "Private: runs on-device with Ollama"],
  },
];

// --- the stage: a canvas that builds itself as you scroll ----------------------------------

const N = CHAPTERS.length;
/** Progress window of chapter i. */
const ch = (i: number): [number, number] => [i / N, (i + 1) / N];

function Card({
  x,
  y,
  w,
  h,
  color,
  children,
  shape = "rect",
  style,
}: {
  x: MotionValue<string> | string;
  y: MotionValue<string> | string;
  w: string;
  h: string;
  color: MotionValue<string> | string;
  children?: ReactNode;
  shape?: "rect" | "ellipse" | "diamond";
  style?: Record<string, MotionValue<number> | MotionValue<string> | number | string>;
}) {
  return (
    <motion.div className="absolute" style={{ left: x, top: y, width: w, height: h, ...style }}>
      {shape === "diamond" ? (
        <motion.div className="absolute inset-[12%] rotate-45 rounded-[10px]" style={{ backgroundColor: color }} />
      ) : (
        <motion.div
          className={`absolute inset-0 shadow-[0_10px_24px_rgba(40,32,20,0.16)] ${shape === "ellipse" ? "rounded-[50%]" : "rounded-[12px]"}`}
          style={{ backgroundColor: color }}
        />
      )}
      <div className={`relative flex h-full p-[7%] text-[clamp(9px,1.15vw,14px)] font-bold leading-tight text-[#111318] ${shape === "rect" ? "items-start" : "items-center justify-center text-center"}`}>
        {children}
      </div>
    </motion.div>
  );
}

function Cursor({ x, y, name, color, chat, opacity }: { x: MotionValue<string>; y: MotionValue<string>; name: string; color: string; chat?: MotionValue<string>; opacity: MotionValue<number> }) {
  return (
    <motion.div className="pointer-events-none absolute z-20" style={{ left: x, top: y, opacity }}>
      <svg width="18" height="22" viewBox="0 0 18 22" className="drop-shadow">
        <path d="M1 1v17l4.6-4.3 3 6.6 2.9-1.3-2.9-6.4H15z" fill={color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <span className="ml-4 inline-block -translate-y-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: color }}>
        {name}
      </span>
      {chat && (
        <motion.div className="ml-4 mt-1 max-w-[180px] rounded-2xl rounded-tl-sm px-3 py-1.5 text-[11px] font-semibold text-white empty:hidden" style={{ backgroundColor: color }}>
          {chat}
        </motion.div>
      )}
    </motion.div>
  );
}

function Stage({ progress }: { progress: MotionValue<number> }) {
  const p = useSpring(progress, { stiffness: 140, damping: 28, mass: 0.4 });

  // Chapter 1: things appear, connectors draw.
  const [c0a, c0b] = ch(0);
  const pop = (start: number) => ({
    opacity: useP(p, (v) => seg(v, mix(c0a, c0b, start), mix(c0a, c0b, start + 0.22))),
    scale: useP(p, (v) => mix(0.6, 1, ease(seg(v, mix(c0a, c0b, start), mix(c0a, c0b, start + 0.22))))),
  });
  const noteA = pop(0.02);
  const rectB = pop(0.14);
  const diamondC = pop(0.26);
  const ellipseD = pop(0.38);
  const draw1 = useP(p, (v) => seg(v, mix(c0a, c0b, 0.45), mix(c0a, c0b, 0.7)));
  const draw2 = useP(p, (v) => seg(v, mix(c0a, c0b, 0.6), mix(c0a, c0b, 0.85)));
  const draw3 = useP(p, (v) => seg(v, mix(c0a, c0b, 0.72), mix(c0a, c0b, 0.95)));

  // Chapter 2: cursors, live typing, a reaction.
  const [c1a, c1b] = ch(1);
  const cursorsIn = useP(p, (v) => seg(v, c1a - 0.02, c1a + 0.03) * (1 - seg(v, ch(5)[0], ch(5)[0] + 0.05)));
  const mayaX = useP(p, (v) => `${mix(78, 20, ease(seg(v, c1a, mix(c1a, c1b, 0.45))))}%`);
  const mayaY = useP(p, (v) => `${mix(82, 24, ease(seg(v, c1a, mix(c1a, c1b, 0.45))))}%`);
  const leoX = useP(p, (v) => `${mix(92, 70, ease(seg(v, mix(c1a, c1b, 0.1), mix(c1a, c1b, 0.6)))) + tri(v, ch(3)[0], ch(3)[1]) * -4}%`);
  const leoY = useP(p, (v) => `${mix(12, 22, ease(seg(v, mix(c1a, c1b, 0.1), mix(c1a, c1b, 0.6))))}%`);
  const typed = "Launch — Friday 🚀";
  const noteText = useP(p, (v) => `Launch${typed.slice(6, 6 + Math.round(seg(v, mix(c1a, c1b, 0.45), mix(c1a, c1b, 0.8)) * (typed.length - 6)))}`);
  const chat = useP<string>(p, (v) => (v > mix(c1a, c1b, 0.55) && v < c1b + 0.03 ? "Looks great! 👏" : ""));
  const reaction = useP(p, (v) => tri(v, mix(c1a, c1b, 0.7), c1b + 0.02));
  const reactionY = useP(p, (v) => `${mix(56, 30, seg(v, mix(c1a, c1b, 0.7), c1b + 0.02))}%`);

  // Chapter 3: offline → queued → synced.
  const [c2a, c2b] = ch(2);
  const offline = useP(p, (v) => v > mix(c2a, c2b, 0.12) && v < mix(c2a, c2b, 0.78));
  const status = useP(p, (v) => {
    if (v < mix(c2a, c2b, 0.12) || v > mix(c2a, c2b, 0.9)) return "Synced";
    if (v > mix(c2a, c2b, 0.78)) return "Syncing 3…";
    const queued = Math.min(3, Math.floor(seg(v, mix(c2a, c2b, 0.2), mix(c2a, c2b, 0.7)) * 4));
    return queued > 0 ? `Offline · ${queued} queued` : "Offline";
  });
  const statusColor = useP(p, (v) => (v > mix(c2a, c2b, 0.12) && v < mix(c2a, c2b, 0.78) ? "#c98a12" : v > mix(c2a, c2b, 0.78) && v < mix(c2a, c2b, 0.9) ? "#2f63ff" : "#1e8f5a"));
  const queuedNote = (i: number) => ({
    opacity: useP(p, (v) => seg(v, mix(c2a, c2b, 0.22 + i * 0.16), mix(c2a, c2b, 0.3 + i * 0.16))),
    dashed: useP(p, (v) => (v < mix(c2a, c2b, 0.86) ? 1 : 0)),
    y: useP(p, (v) => mix(10, 0, ease(seg(v, mix(c2a, c2b, 0.22 + i * 0.16), mix(c2a, c2b, 0.3 + i * 0.16))))),
  });
  const q0 = queuedNote(0);
  const q1 = queuedNote(1);
  const q2 = queuedNote(2);
  const syncPulse = useP(p, (v) => tri(v, mix(c2a, c2b, 0.78), mix(c2a, c2b, 1)));

  // Chapter 4: concurrent move + recolor of the same card both survive.
  const [c3a, c3b] = ch(3);
  const moveT = useP(p, (v) => ease(seg(v, mix(c3a, c3b, 0.2), mix(c3a, c3b, 0.55))));
  const timeTravel = (v: number): number => tri(v, ch(4)[0] + 0.02, ch(4)[1] - 0.02);
  const bX = useP(p, (v) => `${mix(58, 62, ease(seg(v, mix(c3a, c3b, 0.2), mix(c3a, c3b, 0.55))) * (1 - ease(timeTravel(v))))}%`);
  const bY = useP(p, (v) => `${mix(10, 6, ease(seg(v, mix(c3a, c3b, 0.2), mix(c3a, c3b, 0.55))) * (1 - ease(timeTravel(v))))}%`);
  const bColor = useP(p, (v) => {
    const t = ease(seg(v, mix(c3a, c3b, 0.2), mix(c3a, c3b, 0.55))) * (1 - ease(timeTravel(v)));
    const from = [169, 205, 255];
    const to = [168, 230, 180];
    const c = from.map((f, i) => Math.round(mix(f, to[i] ?? f, t)));
    return `rgb(${c.join(",")})`;
  });
  const badges = useP(p, (v) => tri(v, mix(c3a, c3b, 0.1), mix(c3a, c3b, 1.02)));
  const merged = useP(p, (v) => seg(v, mix(c3a, c3b, 0.55), mix(c3a, c3b, 0.65)) * (1 - seg(v, c3b - 0.01, c3b + 0.02)));

  // Chapter 5: time travel slider rewinds the board.
  const [c4a, c4b] = ch(4);
  const sliderIn = useP(p, (v) => seg(v, c4a - 0.01, c4a + 0.03) * (1 - seg(v, c4b - 0.02, c4b + 0.01)));
  const thumb = useP(p, (v) => `${(1 - timeTravel(v)) * 100}%`);
  const versionLabel = useP(p, (v) => `v${Math.round(mix(128, 41, timeTravel(v)))}`);
  const rewindFade = useP(p, (v) => 1 - ease(timeTravel(v)) * 0.92);
  const rewindDim = useP(p, (v) => 1 - timeTravel(v) * 0.6);

  // Chapter 6: AI streams a board.
  const [c5a, c5b] = ch(5);
  const promptIn = useP(p, (v) => seg(v, c5a - 0.01, c5a + 0.03));
  const prompt = "Plan our product launch";
  const promptText = useP(p, (v) => prompt.slice(0, Math.round(seg(v, c5a + 0.01, mix(c5a, c5b, 0.3)) * prompt.length)));
  const boardOut = useP(p, (v) => 1 - seg(v, c5a, c5a + 0.04));
  const aiCards = [
    ["Audience", "Story", "Assets"],
    ["Press kit", "Demo video", "Beta list"],
    ["Launch day", "Follow-ups"],
  ];
  const colors = ["#a9cdff", "#ffd666", "#a8e6b4"];

  const statusDot = useP(p, (v) => (v > ch(2)[0] && v < ch(3)[0] ? 1 : 0.6));
  const sceneOpacity = boardOut;

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[28px] border border-edge bg-paper shadow-[0_40px_100px_rgba(25,29,37,0.18)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle,var(--color-line)_1.2px,transparent_1.2px)] [background-size:22px_22px]" />
      {/* window chrome */}
      <div className="absolute inset-x-0 top-0 z-30 flex h-11 items-center gap-2 border-b border-line/70 bg-paper/80 px-4 backdrop-blur">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 text-[12px] font-bold text-ink">Launch plan</span>
        <motion.span className="ml-auto flex items-center gap-1.5 rounded-full bg-canvas px-2.5 py-1 text-[11px] font-bold text-ink" style={{ opacity: statusDot }}>
          <motion.span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusColor }} />
          <motion.span>{status}</motion.span>
        </motion.span>
        <span className="flex -space-x-1.5">
          <span className="grid h-6 w-6 place-items-center rounded-full border-2 border-paper bg-[#dd4f78] text-[9px] font-bold text-white">MA</span>
          <span className="grid h-6 w-6 place-items-center rounded-full border-2 border-paper bg-[#137d77] text-[9px] font-bold text-white">LE</span>
        </span>
      </div>

      <motion.div className="absolute inset-0 top-11" style={{ opacity: sceneOpacity }}>
        {/* connectors */}
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 260" preserveAspectRatio="none" aria-hidden>
          <defs>
            <marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0L10 5L0 10z" className="fill-ink" />
            </marker>
          </defs>
          <motion.path d="M120 48 C 170 48, 190 44, 228 42" className="stroke-ink" strokeWidth="2" fill="none" markerEnd="url(#head)" style={{ pathLength: draw1, opacity: draw1 }} />
          <motion.path d="M290 78 C 290 120, 230 140, 205 150" className="stroke-ink" strokeWidth="2" fill="none" markerEnd="url(#head)" style={{ pathLength: draw2, opacity: draw2 }} />
          <motion.path d="M160 180 C 120 200, 100 210, 82 206" className="stroke-ink" strokeWidth="2" fill="none" markerEnd="url(#head)" style={{ pathLength: draw3, opacity: draw3 }} />
        </svg>

        <Card x="5%" y="8%" w="25%" h="24%" color="#ffd666" style={noteA}>
          <motion.span>{noteText}</motion.span>
        </Card>
        <Card x={bX} y={bY} w="27%" h="22%" color={bColor} style={{ ...rectB, opacity: useTransform([rectB.opacity, rewindDim], ([a, b]) => (a as number) * (b as number)) }}>
          Design review
        </Card>
        <Card x="36%" y="46%" w="24%" h="34%" color="#ffadc8" shape="diamond" style={{ ...diamondC, opacity: useTransform([diamondC.opacity, rewindFade], ([a, b]) => (a as number) * (b as number)) }}>
          Ship it?
        </Card>
        <Card x="3%" y="66%" w="20%" h="22%" color="#cdb8ff" shape="ellipse" style={{ ...ellipseD, opacity: useTransform([ellipseD.opacity, rewindFade], ([a, b]) => (a as number) * (b as number)) }}>
          Celebrate
        </Card>

        {/* queued offline notes */}
        {[q0, q1, q2].map((q, i) => (
          <motion.div
            key={i}
            className="absolute rounded-[10px] bg-[#ffc49b] p-2 text-[clamp(8px,1vw,12px)] font-bold text-[#111318] shadow-[0_8px_18px_rgba(40,32,20,0.14)]"
            style={{
              left: `${68 + (i % 2) * 2}%`,
              top: `${44 + i * 15}%`,
              width: "22%",
              height: "12%",
              opacity: useTransform([q.opacity, rewindFade], ([a, b]) => (a as number) * (b as number)),
              y: q.y,
              outline: useTransform(q.dashed, (d) => (d > 0.5 ? "2px dashed rgba(17,19,24,0.35)" : "0px solid transparent")),
              outlineOffset: 3,
            }}
          >
            {["Pack demo laptop", "Print stickers", "Book the room"][i]}
          </motion.div>
        ))}
        <motion.div className="pointer-events-none absolute inset-0 rounded-[28px] border-4 border-good" style={{ opacity: syncPulse }} />

        {/* offline banner */}
        <motion.div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-ink px-3 py-1.5 text-[clamp(9px,1vw,11px)] font-bold text-paper" style={{ opacity: useTransform(offline, (o) => (o ? 1 : 0)) }}>
          <Icon name="link" className="h-3.5 w-3.5" /> No connection — saving on this device
        </motion.div>

        {/* merge badges */}
        <motion.div className="absolute left-[50%] top-[36%] z-10 flex flex-col gap-1.5" style={{ opacity: badges }}>
          <span className="rounded-full bg-[#dd4f78] px-2.5 py-1 text-[10px] font-bold text-white shadow">Maya: moved it →</span>
          <span className="rounded-full bg-[#137d77] px-2.5 py-1 text-[10px] font-bold text-white shadow">Leo: made it green</span>
          <motion.span className="rounded-full bg-good px-2.5 py-1 text-[10px] font-bold text-white shadow" style={{ opacity: merged, scale: useTransform(merged, (m) => 0.8 + m * 0.2) }}>
            ✓ Both kept
          </motion.span>
        </motion.div>
        <motion.div className="pointer-events-none absolute left-[56%] top-[4%] h-[30%] w-[35%] rounded-[16px] border-2 border-dashed border-good" style={{ opacity: useTransform(moveT, (t) => (t > 0.98 ? 0 : t * 0.8)) }} />

        {/* reaction */}
        <motion.span className="absolute left-[26%] z-20 text-[34px]" style={{ top: reactionY, opacity: reaction, scale: useTransform(reaction, (r) => 0.6 + r * 0.6) }}>
          🎉
        </motion.span>

        <Cursor x={mayaX} y={mayaY} name="Maya" color="#dd4f78" opacity={cursorsIn} chat={chat} />
        <Cursor x={leoX} y={leoY} name="Leo" color="#137d77" opacity={cursorsIn} />

        {/* time-travel slider */}
        <motion.div className="absolute inset-x-[8%] bottom-[6%] z-20 rounded-2xl border border-edge bg-paper/95 p-3 shadow-lg" style={{ opacity: sliderIn, y: useTransform(sliderIn, (s) => (1 - s) * 20) }}>
          <div className="mb-2 flex items-center justify-between text-[11px] font-bold">
            <span className="flex items-center gap-1.5 text-ink">
              <Icon name="history" className="h-3.5 w-3.5" /> Time travel
            </span>
            <motion.span className="font-mono text-muted">{versionLabel}</motion.span>
          </div>
          <div className="relative h-1.5 rounded-full bg-line">
            <motion.div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: thumb }} />
            <motion.div className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-paper bg-accent shadow" style={{ left: thumb }} />
          </div>
        </motion.div>
      </motion.div>

      {/* AI chapter */}
      <motion.div className="absolute inset-0 top-11 p-[5%]" style={{ opacity: promptIn }}>
        <div className="mx-auto flex max-w-[80%] items-center gap-2 rounded-2xl border border-edge bg-paper px-3 py-2.5 shadow-lg">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#2f63ff] to-[#ff8a5b] text-white">
            <Icon name="sparkle" className="h-4 w-4" />
          </span>
          <motion.span className="truncate text-[clamp(11px,1.2vw,14px)] font-semibold text-ink">{promptText}</motion.span>
          <motion.span className="h-4 w-0.5 bg-accent" animate={{ opacity: [1, 0, 1] }} transition={{ duration: 1, repeat: Infinity }} />
        </div>
        <div className="mt-[5%] grid grid-cols-3 gap-[4%]">
          {aiCards.map((column, c) => (
            <div key={c} className="space-y-[8%]">
              <AiTitle progress={p} at={mix(c5a, c5b, 0.3 + c * 0.08)} label={["Prepare", "Build buzz", "Launch"][c] ?? ""} />
              {column.map((label, i) => (
                <AiCard key={label} progress={p} at={mix(c5a, c5b, 0.34 + c * 0.08 + i * 0.09)} color={colors[c] ?? "#ffd666"} label={label} />
              ))}
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function AiTitle({ progress, at, label }: { progress: MotionValue<number>; at: number; label: string }) {
  const o = useTransform(progress, (v) => seg(v, at, at + 0.02));
  return (
    <motion.div className="rounded-lg bg-ink px-2 py-1.5 text-[clamp(9px,1vw,12px)] font-bold text-paper" style={{ opacity: o, y: useTransform(o, (t) => (1 - t) * -10) }}>
      {label}
    </motion.div>
  );
}

function AiCard({ progress, at, color, label }: { progress: MotionValue<number>; at: number; color: string; label: string }) {
  const o = useTransform(progress, (v) => seg(v, at, at + 0.025));
  return (
    <motion.div
      className="rounded-lg p-2 text-[clamp(9px,1vw,12px)] font-bold text-[#111318] shadow-[0_8px_18px_rgba(40,32,20,0.14)]"
      style={{ backgroundColor: color, opacity: o, scale: useTransform(o, (t) => 0.85 + t * 0.15), y: useTransform(o, (t) => (1 - t) * 14) }}
    >
      {label}
    </motion.div>
  );
}

function Story() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [active, setActive] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => setActive(Math.min(N - 1, Math.max(0, Math.floor(v * N)))));
  return (
    <section ref={ref} id="story" className="relative" style={{ height: `${N * 100 + 40}vh` }}>
      <div className="sticky top-0 flex h-screen items-center">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
          <div className="relative order-2 h-[38vh] lg:order-1 lg:h-[64vh]">
            {CHAPTERS.map((chapter, i) => (
              <motion.div
                key={chapter.kicker}
                className="absolute inset-0 flex flex-col justify-center"
                initial={false}
                animate={{ opacity: active === i ? 1 : 0, y: active === i ? 0 : active > i ? -30 : 30, filter: active === i ? "blur(0px)" : "blur(6px)" }}
                transition={softSpring}
                aria-hidden={active !== i}
              >
                <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-accent">{chapter.kicker}</p>
                <h2 className="mt-3 font-display text-[clamp(32px,4.4vw,58px)] leading-[1.02] text-ink [&_em]:text-accent">{chapter.title}</h2>
                <p className="mt-4 max-w-md text-[clamp(14px,1.2vw,17px)] leading-relaxed text-muted">{chapter.body}</p>
                <ul className="mt-5 hidden space-y-2 sm:block">
                  {chapter.points.map((point) => (
                    <li key={point} className="flex items-center gap-2.5 text-[14px] font-semibold text-ink">
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-accent/15 text-accent">
                        <Icon name="check" className="h-3 w-3" />
                      </span>
                      {point}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
          <div className="order-1 lg:order-2">
            <Stage progress={scrollYProgress} />
            <div className="mt-5 flex justify-center gap-2">
              {CHAPTERS.map((chapter, i) => (
                <motion.span key={chapter.kicker} className="h-1.5 rounded-full bg-ink" animate={{ width: active === i ? 28 : 8, opacity: active === i ? 1 : 0.2 }} transition={spring} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// --- hero ---------------------------------------------------------------------------------

function FloatingNote({ className, color, children, delay, depth, scrollY }: { className: string; color: string; children: ReactNode; delay: number; depth: number; scrollY: MotionValue<number> }) {
  const y = useTransform(scrollY, (v) => v * depth);
  const reduced = useReducedMotion();
  return (
    <motion.div className={`absolute hidden md:block ${className}`} style={{ y }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.6, rotate: -8 }}
        animate={reduced ? { opacity: 1, scale: 1, rotate: 0 } : { opacity: 1, scale: 1, rotate: [0, 2, -1.5, 0], y: [0, -10, 4, 0] }}
        transition={{ opacity: { delay, duration: 0.6 }, scale: { delay, ...spring }, rotate: { duration: 9, repeat: Infinity, delay }, y: { duration: 7, repeat: Infinity, delay } }}
        className="rounded-2xl p-4 text-[14px] font-bold leading-snug text-[#111318] shadow-[0_24px_50px_rgba(40,32,20,0.2)]"
        style={{ backgroundColor: color }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

function Hero() {
  const { scrollY } = useScroll();
  const fade = useTransform(scrollY, [0, 500], [1, 0]);
  const lift = useTransform(scrollY, [0, 500], [0, -80]);
  const words = ["Think", "together.", "Even", "offline."];
  return (
    <section className="relative flex min-h-screen items-center overflow-hidden pt-16">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--color-line)_1.2px,transparent_1.2px)] [background-size:28px_28px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(47,99,255,0.18),transparent)] blur-2xl" />
      <div className="pointer-events-none absolute right-[8%] top-[58%] h-[360px] w-[460px] rounded-full bg-[radial-gradient(closest-side,rgba(255,138,91,0.2),transparent)] blur-2xl" />

      <FloatingNote className="left-[6%] top-[22%]" color="#ffd666" delay={0.5} depth={-0.35} scrollY={scrollY}>
        Ship the beta 🚀
      </FloatingNote>
      <FloatingNote className="right-[7%] top-[18%]" color="#a9cdff" delay={0.7} depth={-0.2} scrollY={scrollY}>
        Works on a plane ✈️
      </FloatingNote>
      <FloatingNote className="left-[10%] bottom-[14%]" color="#a8e6b4" delay={0.9} depth={-0.5} scrollY={scrollY}>
        Undo, but only mine
      </FloatingNote>
      <FloatingNote className="right-[11%] bottom-[18%]" color="#ffadc8" delay={1.1} depth={-0.28} scrollY={scrollY}>
        Rewind to Tuesday ⏪
      </FloatingNote>

      <motion.div className="relative mx-auto max-w-4xl px-4 text-center" style={{ opacity: fade, y: lift }}>
        <motion.a
          {...linkProps("/boards")}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...softSpring, delay: 0.05 }}
          className="inline-flex items-center gap-2 rounded-full border border-edge bg-paper/80 py-1.5 pl-1.5 pr-3.5 text-[12px] font-semibold text-ink backdrop-blur hover:bg-paper"
        >
          <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-bold text-paper">NEW</span>
          Connectors, comments, follow mode & a smarter local AI
          <Icon name="back2" className="h-3 w-3 rotate-180" />
        </motion.a>
        <h1 className="mt-7 font-display text-[clamp(52px,9vw,124px)] leading-[0.92] text-ink">
          {words.map((word, i) => (
            <motion.span
              key={word}
              className={`inline-block ${i === 3 ? "italic text-accent" : ""}`}
              initial={{ opacity: 0, y: 40, filter: "blur(10px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ ...softSpring, delay: 0.15 + i * 0.09 }}
            >
              {word}
              {i < words.length - 1 && " "}
            </motion.span>
          ))}
        </h1>
        <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...softSpring, delay: 0.55 }} className="mx-auto mt-6 max-w-2xl text-[clamp(16px,1.6vw,20px)] leading-relaxed text-muted">
          Tandem is a real-time whiteboard that works without a connection, never loses an edit when two people collide, remembers every version, and has an AI that runs on your own machine.
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...softSpring, delay: 0.68 }} className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <motion.a
            {...linkProps("/boards")}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            className="group flex h-14 items-center gap-2 rounded-2xl bg-ink px-7 text-[15px] font-bold text-paper shadow-[0_18px_40px_rgba(17,19,24,0.25)]"
          >
            Open your boards
            <Icon name="back2" className="h-4 w-4 rotate-180 transition-transform group-hover:translate-x-1" />
          </motion.a>
          <motion.button
            type="button"
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => startDemo()}
            className="flex h-14 items-center gap-2 rounded-2xl border border-edge bg-paper/80 px-6 text-[15px] font-bold text-ink backdrop-blur hover:bg-paper"
          >
            <Icon name="sparkle" className="h-4 w-4 text-accent" />
            Try a live demo
          </motion.button>
        </motion.div>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="mt-5 text-[12px] font-medium text-muted">
          Free · No sign-up · Your data stays on your device and your server
        </motion.p>
      </motion.div>

      <motion.a href="#story" style={{ opacity: fade }} className="absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
        Scroll to see how
        <motion.span animate={{ y: [0, 6, 0] }} transition={{ duration: 1.6, repeat: Infinity }} className="grid h-9 w-6 place-items-start justify-center rounded-full border-2 border-muted/50 pt-1.5">
          <span className="h-2 w-1 rounded-full bg-muted" />
        </motion.span>
      </motion.a>
    </section>
  );
}

// --- numbers ------------------------------------------------------------------------------

function CountUp({ to, suffix = "", decimals = 0 }: { to: number; suffix?: string; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  useEffect(() => {
    if (!inView || !ref.current) return;
    const node = ref.current;
    const controls = animate(0, to, {
      duration: 1.6,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        node.textContent = `${v.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}${suffix}`;
      },
    });
    return () => controls.stop();
  }, [inView, to, suffix, decimals]);
  return <span ref={ref}>0{suffix}</span>;
}

function Numbers() {
  const stats: ReadonlyArray<{ value: ReactNode; label: string; detail: string }> = [
    { value: <CountUp to={5000} suffix="+" />, label: "shapes at 60 fps", detail: "GPU-batched rendering with the document engine in a Web Worker" },
    { value: <CountUp to={0} />, label: "merge conflicts", detail: "CRDTs (move tree, LWW maps, Fugue text) written from scratch" },
    { value: <CountUp to={100} suffix="%" />, label: "usable offline", detail: "IndexedDB journal; edits sync the moment you reconnect" },
    { value: <CountUp to={190} suffix="+" />, label: "automated tests", detail: "Property-based convergence tests run thousands of random edits" },
  ];
  return (
    <section className="relative border-y border-line/70 bg-paper/60">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-line/70 lg:grid-cols-4">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ ...softSpring, delay: i * 0.08 }}
            className="bg-canvas px-6 py-10 sm:px-8"
          >
            <p className="font-display text-[clamp(44px,5vw,72px)] leading-none text-ink">{s.value}</p>
            <p className="mt-2 text-[14px] font-bold text-ink">{s.label}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">{s.detail}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// --- features bento -----------------------------------------------------------------------

const FEATURES: ReadonlyArray<{ icon: IconName; title: string; body: string; span?: string; tint: string }> = [
  { icon: "arrow", title: "Flowcharts that hold together", body: "Drag a connector between two shapes and it stays attached — move them anywhere and the arrows follow.", span: "lg:col-span-2", tint: "#2f63ff" },
  { icon: "comment", title: "Comments on the canvas", body: "Pin a thought exactly where it belongs.", tint: "#dd4f78" },
  { icon: "eye", title: "Follow mode", body: "Click a teammate to ride along with their view while they present.", tint: "#137d77" },
  { icon: "command", title: "Everything in ⌘K", body: "Every tool, template and action, a few keystrokes away.", tint: "#7b55e7" },
  { icon: "frame", title: "Frames & templates", body: "Kanban, retro, flowchart, mind map, brainstorm — one click to start.", span: "lg:col-span-2", tint: "#c98a12" },
  { icon: "download", title: "Export anywhere", body: "Crisp PNG, infinitely scalable SVG, or a print-ready PDF.", tint: "#1e8f5a" },
  { icon: "share", title: "Share with care", body: "Edit or view-only links, enforced by signed tokens on the server.", tint: "#ef6b3a" },
  { icon: "map", title: "Minimap & snapping", body: "Never get lost; alignment guides keep it neat.", tint: "#2f63ff" },
];

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 py-28 sm:px-6">
      <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={softSpring} className="max-w-2xl">
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-accent">Everything you reach for</p>
        <h2 className="mt-3 font-display text-[clamp(38px,5vw,64px)] leading-[1.02] text-ink">
          Pro tools, <em className="text-accent">zero</em> clutter.
        </h2>
      </motion.div>
      <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f, i) => (
          <motion.article
            key={f.title}
            initial={{ opacity: 0, y: 30, scale: 0.98 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ ...softSpring, delay: (i % 4) * 0.07 }}
            whileHover={{ y: -6 }}
            className={`group relative overflow-hidden rounded-3xl border border-edge bg-paper p-6 ${f.span ?? ""}`}
          >
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" style={{ backgroundColor: `${f.tint}33` }} />
            <span className="relative grid h-11 w-11 place-items-center rounded-2xl text-white shadow-lg transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110" style={{ backgroundColor: f.tint }}>
              <Icon name={f.icon} className="h-5 w-5" />
            </span>
            <h3 className="relative mt-5 text-[17px] font-extrabold tracking-tight text-ink">{f.title}</h3>
            <p className="relative mt-1.5 text-[14px] leading-relaxed text-muted">{f.body}</p>
          </motion.article>
        ))}
      </div>
    </section>
  );
}

// --- architecture (draws itself on scroll) ---------------------------------------------------

function Architecture() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 80%", "center 45%"] });
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });
  const line1 = useTransform(p, [0.1, 0.5], [0, 1]);
  const line2 = useTransform(p, [0.45, 0.9], [0, 1]);
  const node = (at: number) => ({ opacity: useTransform(p, [at, at + 0.12], [0, 1]), y: useTransform(p, [at, at + 0.12], [24, 0]) });
  const n1 = node(0);
  const n2 = node(0.4);
  const n3 = node(0.8);
  const nodes = [
    { style: n1, icon: "pen" as const, title: "Your device", lines: ["CRDT engine in a Web Worker", "IndexedDB journal (offline)", "WebGL canvas, 60 fps"] },
    { style: n2, icon: "link" as const, title: "Sync server", lines: ["WebSocket, binary protocol", "Ordered log + snapshots", "Postgres · Redis fan-out"] },
    { style: n3, icon: "smile" as const, title: "Your team", lines: ["Merges in any order", "Live cursors & presence", "Same result, every time"] },
  ];
  return (
    <section ref={ref} className="relative overflow-hidden bg-ink py-28 text-paper">
      <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:radial-gradient(circle,var(--color-paper)_1px,transparent_1px)] [background-size:24px_24px]" />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#8fb0ff]">Under the hood</p>
        <h2 className="mt-3 max-w-3xl font-display text-[clamp(38px,5vw,64px)] leading-[1.02]">
          Local-first, by design. <em className="text-[#ff9f7a]">The server is optional.</em>
        </h2>
        <div className="relative mt-16 grid gap-6 lg:grid-cols-3">
          <svg className="pointer-events-none absolute inset-x-0 top-1/2 hidden h-8 w-full -translate-y-1/2 lg:block" viewBox="0 0 1000 32" preserveAspectRatio="none" aria-hidden>
            <motion.path d="M300 16 H 370" stroke="#8fb0ff" strokeWidth="2.5" strokeDasharray="6 6" fill="none" style={{ pathLength: line1 }} />
            <motion.path d="M630 16 H 700" stroke="#ff9f7a" strokeWidth="2.5" strokeDasharray="6 6" fill="none" style={{ pathLength: line2 }} />
          </svg>
          {nodes.map((n) => (
            <motion.div key={n.title} style={n.style} className="relative rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10">
                <Icon name={n.icon} className="h-5 w-5" />
              </span>
              <h3 className="mt-5 text-[18px] font-extrabold">{n.title}</h3>
              <ul className="mt-3 space-y-1.5">
                {n.lines.map((line) => (
                  <li key={line} className="flex items-center gap-2 text-[14px] text-white/70">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#8fb0ff]" />
                    {line}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// --- page ------------------------------------------------------------------------------------

function Nav() {
  const { scrollY } = useScroll();
  const [solid, setSolid] = useState(false);
  useMotionValueEvent(scrollY, "change", (v) => setSolid(v > 24));
  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${solid ? "border-b border-line/60 bg-canvas/80 backdrop-blur-md" : "border-b border-transparent"}`}>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <a {...linkProps("/")} className="flex items-center gap-2">
          <Logo />
          <span className="text-[17px] font-extrabold tracking-tight text-ink">Tandem</span>
        </a>
        <nav className="ml-4 hidden items-center gap-6 text-[13px] font-semibold text-muted md:flex">
          <a href="#story" className="hover:text-ink">How it works</a>
          <a href="#features" className="hover:text-ink">Features</a>
          <button type="button" onClick={() => startDemo("kanban")} className="hover:text-ink">Demo</button>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <motion.a {...linkProps("/boards")} whileHover={{ y: -1 }} className="flex h-10 items-center rounded-xl bg-ink px-4 text-[13px] font-bold text-paper">
            Open app
          </motion.a>
        </div>
      </div>
    </header>
  );
}

function FinalCta() {
  return (
    <section className="relative overflow-hidden px-4 py-32 text-center sm:px-6">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(47,99,255,0.16),transparent)] blur-2xl" />
      <motion.h2 initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={softSpring} className="relative mx-auto max-w-4xl font-display text-[clamp(44px,7vw,96px)] leading-[0.95] text-ink">
        Your next big idea deserves a <em className="text-accent">better canvas.</em>
      </motion.h2>
      <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ ...softSpring, delay: 0.1 }} className="relative mt-10 flex flex-wrap justify-center gap-3">
        <motion.button type="button" whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} onClick={() => startDemo("brainstorm")} className="h-14 rounded-2xl bg-accent px-8 text-[15px] font-bold text-white shadow-[0_18px_40px_rgba(47,99,255,0.35)]">
          Start a board — it's free
        </motion.button>
        <motion.a {...linkProps("/boards")} whileHover={{ y: -2 }} className="flex h-14 items-center rounded-2xl border border-edge bg-paper px-7 text-[15px] font-bold text-ink">
          See your boards
        </motion.a>
      </motion.div>
    </section>
  );
}

export default function Home() {
  useEffect(() => {
    document.title = "Tandem — the canvas that never loses a thought";
  }, []);
  return (
    <div className="min-h-full bg-canvas">
      <Nav />
      <Hero />
      <Story />
      <Numbers />
      <Features />
      <Architecture />
      <FinalCta />
      <footer className="border-t border-line/70 px-4 py-10 text-center text-[12px] text-muted">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <span className="flex items-center gap-2">
            <Logo className="h-5 w-5" /> Tandem — local-first collaborative canvas
          </span>
          <span>CRDTs · Web Workers · WebGL · WebSockets · Postgres · Redis · Ollama</span>
        </div>
      </footer>
    </div>
  );
}
