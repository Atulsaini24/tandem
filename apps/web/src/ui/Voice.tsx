import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { Editor } from "../canvas/editor";
import { useUiStore } from "../state/ui-store";
import { spring } from "./kit";

// The Web Speech API isn't in TypeScript's DOM types yet: just what we use.
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;
const Recognizer = (): RecognitionCtor | undefined => (window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;

export const voiceSupported = (): boolean => Recognizer() !== undefined;

/**
 * Voice. Command mode: say what you want ("add three notes about launch risks", "make a
 * chart of our monthly sales") and the local AI turns it into an action. Meeting mode:
 * listens as the team talks and fills a Meeting notes frame with notes, decisions and
 * action items every ~40 seconds. Speech-to-text is the browser's own (in Chrome and Edge
 * that's the browser maker's speech service); understanding it is the local model.
 */
export function Voice({ editor }: { editor: Editor | null }) {
  const voice = useUiStore((s) => s.voice);
  const rec = useRef<Recognition | null>(null);
  const buffer = useRef("");
  const flushAt = useRef(0);

  useEffect(() => {
    if (!editor || voice.mode === "off") return;
    const Ctor = Recognizer();
    if (!Ctor) {
      useUiStore.getState().setNotice("Voice needs Chrome or Edge (speech recognition isn't available in this browser).");
      useUiStore.getState().setVoice({ mode: "off" });
      return;
    }
    const meeting = voice.mode === "meeting";
    const r = new Ctor();
    rec.current = r;
    r.continuous = meeting;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    let stopped = false;
    let finalText = "";
    flushAt.current = Date.now() + 40_000;
    const flush = (): void => {
      const chunk = buffer.current.trim();
      buffer.current = "";
      flushAt.current = Date.now() + 40_000;
      if (chunk.length > 20) void editor.ai.meetingChunk(chunk).then((n) => n > 0 && useUiStore.getState().setNotice(`Meeting notes: +${n}`));
    };
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const res = e.results[i];
        if (!res) continue;
        if (res.isFinal) {
          finalText += `${res[0].transcript} `;
          if (meeting) buffer.current += `${res[0].transcript}. `;
        } else interim += res[0].transcript;
      }
      useUiStore.getState().setVoice({ heard: (meeting ? `${buffer.current} ${interim}` : `${finalText}${interim}`).trim().slice(-280) });
      if (meeting && (Date.now() > flushAt.current || buffer.current.length > 700)) flush();
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        useUiStore.getState().setNotice("Microphone blocked: allow it in the address bar to use voice.");
        stopped = true;
        useUiStore.getState().setVoice({ mode: "off" });
      }
    };
    r.onend = () => {
      if (stopped) return;
      if (meeting) {
        // Browsers stop after a silence: keep listening for the whole meeting.
        try {
          r.start();
        } catch {
          // already restarting
        }
        return;
      }
      const said = finalText.trim();
      useUiStore.getState().setVoice({ mode: "off" });
      if (said) {
        useUiStore.getState().setNotice(`🎙️ “${said}”`);
        void editor.ai.voiceCommand(said).then((what) => useUiStore.getState().setNotice(`🎙️ ${what}`));
      }
    };
    try {
      r.start();
    } catch {
      // started twice: ignore
    }
    return () => {
      stopped = true;
      if (meeting) flush();
      r.onend = null;
      try {
        r.stop();
      } catch {
        // already stopped
      }
      rec.current = null;
    };
  }, [voice.mode, editor]);

  return (
    <AnimatePresence>
      {voice.mode !== "off" && (
        <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} transition={spring} className="pointer-events-none absolute inset-x-0 bottom-[96px] z-20 flex justify-center px-3">
          <div className="pointer-events-auto flex max-w-[620px] items-center gap-3 rounded-full border border-white/15 bg-[#0b0d14]/90 py-2 pl-2 pr-3 text-white shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#ff5c8a] to-[#b36bff]">
              <motion.span className="absolute inset-0 rounded-full bg-[#ff5c8a]" animate={{ scale: [1, 1.5], opacity: [0.5, 0] }} transition={{ duration: 1.2, repeat: Infinity }} />
              <span className="relative text-[18px]">🎙️</span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#ff9fbd]">{voice.mode === "meeting" ? "Meeting mode · taking notes" : "Listening · say a command"}</p>
              <p className="truncate text-[13px] text-white/85">{voice.heard || (voice.mode === "meeting" ? "Talk normally — notes, decisions and actions appear on the board." : "e.g. “add three notes about launch risks”")}</p>
            </div>
            <button type="button" onClick={() => useUiStore.getState().setVoice({ mode: "off", heard: "" })} className="shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-bold hover:bg-white/25">
              {voice.mode === "meeting" ? "End meeting" : "Stop"}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
