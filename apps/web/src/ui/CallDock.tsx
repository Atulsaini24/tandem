import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { callFor, type Call } from "../canvas/call";
import type { Editor } from "../canvas/editor";
import { useUiStore } from "../state/ui-store";

const hex = (c: number): string => `#${c.toString(16).padStart(6, "0")}`;

/**
 * The board's video call: camera bubbles floating over the canvas (drag the dock
 * anywhere), a glow around whoever's talking, and mic / camera / leave controls.
 */
export function CallDock({ editor }: { editor: Editor | null }) {
  if (!editor) return null;
  return <Dock call={callFor(editor)} editor={editor} />;
}

function useCall(call: Call): number {
  return useSyncExternalStore(
    (fn) => call.subscribe(fn),
    () => call.version,
  );
}

function Dock({ call, editor }: { call: Call; editor: Editor }) {
  useCall(call);
  const joined = useUiStore((s) => s.call);
  // Presence changes (someone joins) re-render through the peers roster.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1500);
    return () => clearInterval(t);
  }, []);
  const others = call.inCall();
  useEffect(() => () => call.leave(), [call]);
  if (!joined) {
    if (others.length === 0) return null;
    return (
      <motion.button
        type="button"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onClick={() => void call.join()}
        className="fixed bottom-24 right-4 z-40 flex items-center gap-2 rounded-full bg-[#22c3a6] py-2 pl-2 pr-4 text-[13px] font-bold text-[#032019] shadow-xl"
      >
        <span className="flex -space-x-2">
          {others.slice(0, 3).map((p) => (
            <span key={p.id} className="grid h-7 w-7 place-items-center rounded-full border-2 border-[#22c3a6] text-[11px] text-white" style={{ background: hex(p.color) }}>
              {p.name.slice(0, 1).toUpperCase()}
            </span>
          ))}
        </span>
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
        </span>
        Join call ({others.length})
      </motion.button>
    );
  }
  const peers = call.peers();
  const me = { name: "You", color: 0x5b8cff };
  return (
    <motion.div
      drag
      dragMomentum={false}
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="fixed bottom-24 right-4 z-40 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2"
    >
      <div className="flex flex-wrap justify-end gap-2">
        <AnimatePresence>
          {peers.map((p) => (
            <Bubble key={p.id} stream={p.stream} name={p.name} color={p.color} mic={p.mic} cam={p.cam} connecting={p.state !== "connected"} />
          ))}
        </AnimatePresence>
        <Bubble stream={call.local} name={me.name} color={me.color} mic={call.mic} cam={call.cam} muted mirror />
      </div>
      {peers.length === 0 && <p className="rounded-full bg-black/70 px-3 py-1 text-[11px] font-semibold text-white">Waiting for others… share the board link</p>}
      <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-[#14161d]/95 p-1.5 shadow-2xl backdrop-blur">
        <Ctrl on={call.mic} onClick={() => call.toggleMic()} title={call.mic ? "Mute" : "Unmute"}>
          {call.mic ? "🎙️" : "🔇"}
        </Ctrl>
        <Ctrl on={call.cam} onClick={() => call.toggleCam()} title={call.cam ? "Camera off" : "Camera on"}>
          {call.cam ? "📹" : "🚫"}
        </Ctrl>
        <button type="button" onClick={() => editor && call.leave()} title="Leave call" className="h-9 rounded-full bg-[#ff5c5c] px-4 text-[12px] font-bold text-white hover:brightness-110">
          Leave
        </button>
      </div>
    </motion.div>
  );
}

function Ctrl({ on, onClick, title, children }: { on: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={title} className={`grid h-9 w-9 place-items-center rounded-full text-[16px] ${on ? "bg-white/10 hover:bg-white/20" : "bg-[#ff5c5c]/80"}`}>
      {children}
    </button>
  );
}

/** How loud a stream is right now (0..1), sampled ~15 times a second. */
function useLevel(stream: MediaStream | undefined, enabled: boolean): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream || !enabled || stream.getAudioTracks().length === 0) return;
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const t = setInterval(() => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (const v of data) sum += v;
      setLevel(Math.min(1, sum / data.length / 60));
    }, 70);
    return () => {
      clearInterval(t);
      void ctx.close();
    };
  }, [stream, enabled]);
  return level;
}

function Bubble({ stream, name, color, mic, cam, muted, mirror, connecting }: { stream: MediaStream | undefined; name: string; color: number; mic: boolean; cam: boolean; muted?: boolean; mirror?: boolean; connecting?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== (stream ?? null)) ref.current.srcObject = stream ?? null;
  }, [stream]);
  const level = useLevel(stream, mic);
  const talking = level > 0.18;
  const showVideo = cam && stream && stream.getVideoTracks().length > 0;
  return (
    <motion.div
      layout
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.6, opacity: 0 }}
      className="relative h-28 w-36 overflow-hidden rounded-2xl bg-[#1d2030] shadow-xl transition-[box-shadow] duration-150 sm:h-32 sm:w-44"
      style={{ boxShadow: talking ? `0 0 0 3px ${hex(color)}, 0 0 ${12 + level * 30}px ${hex(color)}` : "0 0 0 1px rgba(255,255,255,0.1)" }}
    >
      {/* Remote audio plays through the video element even with the camera off. */}
      <video ref={ref} autoPlay playsInline muted={muted} className={`h-full w-full object-cover ${mirror ? "-scale-x-100" : ""} ${showVideo ? "" : "opacity-0"}`} />
      {!showVideo && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="grid h-14 w-14 place-items-center rounded-full text-[24px] font-bold text-white" style={{ background: hex(color), transform: `scale(${1 + level * 0.25})` }}>
            {name.slice(0, 1).toUpperCase()}
          </span>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-4 text-[11px] font-semibold text-white">
        <span className="truncate">{name}</span>
        {!mic && <span>🔇</span>}
      </div>
      {connecting && <div className="absolute inset-0 grid place-items-center bg-black/50 text-[11px] font-semibold text-white">Connecting…</div>}
    </motion.div>
  );
}
