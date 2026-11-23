import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import Lenis from "lenis";
import { motion, useInView } from "motion/react";
import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react";
import { newBoardId, upsertBoard } from "../boards";
import { linkProps, navigate } from "../router";
import { Icon, Logo, type IconName } from "../ui/kit";
import { Showcase, TemplateMarquee } from "./home/Showcase";
import { CHAPTERS } from "./home/story";
import type { StoryState } from "./home/Scene";

gsap.registerPlugin(ScrollTrigger, SplitText);

// Three.js is big: load the scene in its own chunk, after the text is on screen.
const StoryScene = lazy(() => import("./home/Scene").then((m) => ({ default: m.StoryScene })));

function startDemo(template = "flowchart"): void {
  const id = newBoardId();
  upsertBoard(id, { title: "Demo board" });
  navigate(`/b/${id}?template=${template}`);
}

const supportsWebGL = (): boolean => {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
};

const STORY: ReadonlyArray<{ kicker: string; title: string; accent: string; body: string; side: "left" | "right"; icon: IconName }> = [
  { kicker: "01 · Build", title: "Ideas snap into", accent: "place.", body: "Sticky notes, shapes, frames, a pen and connectors that stay attached. Snapping and alignment guides keep it tidy while you think out loud.", side: "left", icon: "note" },
  { kicker: "02 · Many hands", title: "Eight people.", accent: "One board. Zero waiting.", body: "Every cursor is a real person working at the same time — dragging, typing, connecting. No locks, no turns, no “someone else is editing”.", side: "right", icon: "hand" },
  { kicker: "03 · Offline", title: "Lose the signal.", accent: "Keep the flow.", body: "Each device keeps working on its own copy. When they reconnect, every change merges — mathematically guaranteed, nothing overwritten.", side: "left", icon: "link" },
  { kicker: "04 · Time travel", title: "Rewind to", accent: "any moment.", body: "Every edit is kept in order. Scrub back through the board's whole life, then restore any version in one click — and undo that too.", side: "right", icon: "history" },
  { kicker: "05 · Local AI", title: "Ask for a deck.", accent: "Get a designed one.", body: "Slide decks with real layouts, charts with KPIs and insights, live 3D scenes, detailed plans, flowcharts and mind maps — streamed onto the canvas by an AI running on your own machine.", side: "left", icon: "sparkle" },
  { kicker: "06 · Pro", title: "A real editor,", accent: "not a toy.", body: "Pages and layers on the left, an inspector with exact numbers on the right, finished templates, present mode, PNG · SVG · PDF export and signed share links. Free, private and fast.", side: "right", icon: "star" },
];

/** A button that leans toward the pointer. */
function Magnetic({ children, className, onClick, href }: { children: ReactNode; className: string; onClick?: () => void; href?: string }) {
  const ref = useRef<HTMLElement | null>(null);
  const move = (e: React.PointerEvent): void => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    gsap.to(el, { x: (e.clientX - r.left - r.width / 2) * 0.25, y: (e.clientY - r.top - r.height / 2) * 0.35, duration: 0.4, ease: "power3.out" });
  };
  const leave = (): void => {
    if (ref.current) gsap.to(ref.current, { x: 0, y: 0, duration: 0.7, ease: "elastic.out(1, 0.4)" });
  };
  if (href) {
    return (
      <a ref={(el) => void (ref.current = el)} {...linkProps(href)} onPointerMove={move} onPointerLeave={leave} className={className}>
        {children}
      </a>
    );
  }
  return (
    <button ref={(el) => void (ref.current = el)} type="button" onClick={onClick} onPointerMove={move} onPointerLeave={leave} className={className}>
      {children}
    </button>
  );
}

function Nav() {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const on = (): void => setSolid(window.scrollY > window.innerHeight * 0.6);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${solid ? "bg-[#05060a]/70 backdrop-blur-xl" : ""}`}>
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-5 sm:px-8">
        <a {...linkProps("/")} className="flex items-center gap-2.5">
          <Logo />
          <span className="text-[17px] font-extrabold tracking-tight text-white">Tandem</span>
        </a>
        <nav className="ml-6 hidden items-center gap-7 text-[13px] font-semibold text-white/60 md:flex">
          <a href="#story" className="transition-colors hover:text-white">Story</a>
          <a href="#ai" className="transition-colors hover:text-white">AI Studio</a>
          <a href="#features" className="transition-colors hover:text-white">Features</a>
          <a href="#engine" className="transition-colors hover:text-white">Engine</a>
          <button type="button" onClick={() => startDemo("kanban")} className="transition-colors hover:text-white">Live demo</button>
        </nav>
        <div className="ml-auto">
          <Magnetic href="/boards" className="relative flex h-10 items-center gap-2 overflow-hidden rounded-full bg-white px-5 text-[13px] font-bold text-[#05060a]">
            Open app <Icon name="back2" className="h-3.5 w-3.5 rotate-180" />
          </Magnetic>
        </div>
      </div>
    </header>
  );
}

/** Right-edge progress rail: where you are in the story; click to jump. */
function Rail({ active, onJump, visible }: { active: number; onJump: (i: number) => void; visible: boolean }) {
  const labels = ["Intro", ...STORY.map((s) => s.kicker.split("· ")[1] ?? "")];
  return (
    <div className={`fixed right-5 top-1/2 z-40 hidden -translate-y-1/2 flex-col gap-3 transition-opacity duration-500 lg:flex ${visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}>
      {labels.map((label, i) => (
        <button key={label} type="button" onClick={() => onJump(i)} className="group flex items-center justify-end gap-3" aria-label={`Go to ${label}`}>
          <span className={`text-[11px] font-bold uppercase tracking-[0.12em] transition-all duration-300 ${active === i ? "text-white opacity-100" : "translate-x-2 text-white/50 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"}`}>{label}</span>
          <span className={`block h-2 rounded-full transition-all duration-500 ${active === i ? "w-8 bg-gradient-to-r from-[#2f63ff] to-[#ff8a5b]" : "w-2 bg-white/30 group-hover:bg-white/70"}`} />
        </button>
      ))}
    </div>
  );
}

function Story({ lenis }: { lenis: React.MutableRefObject<Lenis | null> }) {
  const section = useRef<HTMLElement>(null);
  const story = useRef<StoryState>({ target: 0, t: 0, time: 0, poses: [] });
  const [active, setActive] = useState(0);
  const [inside, setInside] = useState(true);
  const [webgl] = useState(supportsWebGL);
  const [showScene, setShowScene] = useState(false);

  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const t = setTimeout(() => setShowScene(true), 60);
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: el,
        start: "top top",
        end: "bottom bottom",
        onToggle: (self) => setInside(self.isActive || self.progress === 0),
        // A reload can land anywhere on the page: start in the right state.
        onRefresh: (self) => setInside(self.isActive || self.progress === 0),
        onUpdate: (self) => {
          story.current.target = self.progress * (CHAPTERS - 1);
          setActive(Math.min(CHAPTERS - 1, Math.round(self.progress * (CHAPTERS - 1))));
        },
      });
      const title = el.querySelector("[data-hero-split]");
      gsap.from("[data-hero-line]", { yPercent: 40, opacity: 0, filter: "blur(14px)", duration: 1.4, ease: "expo.out", delay: 0.55 });
      if (title) {
        const split = SplitText.create(title, { type: "chars,words,lines", mask: "lines" });
        gsap.from(split.chars, { yPercent: 115, rotate: 6, opacity: 0, stagger: 0.022, duration: 1.1, ease: "expo.out", delay: 0.15 });
      }
      gsap.from("[data-hero-fade]", { y: 28, opacity: 0, filter: "blur(8px)", stagger: 0.1, duration: 1.1, ease: "expo.out", delay: 0.7 });
      gsap.to("[data-hero]", { yPercent: -30, opacity: 0, filter: "blur(10px)", ease: "none", scrollTrigger: { trigger: el, start: "top top", end: () => `+=${window.innerHeight * 0.8}`, scrub: true } });
      el.querySelectorAll<HTMLElement>("[data-chapter]").forEach((card) => {
        const heading = card.querySelector("h2 [data-split]");
        const words = heading ? SplitText.create(heading, { type: "words,lines", mask: "lines" }).words : [];
        const tl = gsap.timeline({ scrollTrigger: { trigger: card, start: "top 70%", end: "bottom 30%", toggleActions: "play reverse play reverse" } });
        tl.from(card.querySelector("[data-card]"), { opacity: 0, y: 60, scale: 0.96, filter: "blur(12px)", duration: 0.9, ease: "expo.out" })
          .from(words, { yPercent: 110, stagger: 0.04, duration: 0.8, ease: "expo.out" }, "<0.1")
          .from(card.querySelector("[data-accent]"), { y: 24, opacity: 0, filter: "blur(8px)", duration: 0.8, ease: "expo.out" }, "<0.15")
          .from(card.querySelectorAll("[data-line]"), { opacity: 0, x: card.dataset.side === "left" ? -20 : 20, stagger: 0.06, duration: 0.6, ease: "power3.out" }, "<0.2");
      });
    }, el);
    return () => {
      clearTimeout(t);
      ctx.revert();
    };
  }, []);

  const jump = (i: number): void => {
    const el = section.current;
    if (!el) return;
    const top = el.offsetTop + ((el.offsetHeight - window.innerHeight) * i) / (CHAPTERS - 1);
    if (lenis.current) lenis.current.scrollTo(top, { duration: 1.6 });
    else window.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <section ref={section} id="story" className="relative" style={{ height: `${CHAPTERS * 110}vh` }}>
      <div className="sticky top-0 h-screen w-full overflow-hidden bg-[#05060a]">
        {webgl && showScene ? (
          <Suspense fallback={null}>
            <StoryScene story={story} />
          </Suspense>
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,#1b2c6b,transparent_60%),radial-gradient(ellipse_at_70%_80%,#5a2a2a,transparent_50%)]" />
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#05060a] to-transparent" />
      </div>
      <Rail active={active} onJump={jump} visible={inside} />

      <div className="pointer-events-none absolute inset-0">
        <div className="flex h-screen items-center justify-center px-5">
          <div data-hero className="pointer-events-auto max-w-5xl text-center">
            <a data-hero-fade {...linkProps("/boards")} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 py-1.5 pl-1.5 pr-4 text-[12px] font-semibold text-white/80 backdrop-blur-md transition-colors hover:bg-white/10">
              <span className="rounded-full bg-gradient-to-r from-[#2f63ff] to-[#ff8a5b] px-2 py-0.5 text-[10px] font-extrabold text-white">NEW</span>
              AI Studio: designed decks, live charts & 3D scenes
            </a>
            <h1 data-hero-title className="mt-7 font-display text-[clamp(56px,10vw,148px)] leading-[0.88] tracking-[-0.02em] text-white">
              <span data-hero-split className="block">Think together.</span>
              <span data-hero-line className="block bg-gradient-to-r from-[#7aa2ff] via-[#c59bff] to-[#ff9f7a] bg-clip-text italic text-transparent">Even offline.</span>
            </h1>
            <p data-hero-fade className="mx-auto mt-7 max-w-2xl text-[clamp(16px,1.5vw,19px)] leading-relaxed text-white/65">
              The real-time whiteboard that keeps working without a connection, merges everyone's edits without conflicts, remembers every version, and has an AI that runs on your own machine.
            </p>
            <div data-hero-fade className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Magnetic href="/boards" className="group flex h-14 items-center gap-2 rounded-full bg-white px-8 text-[15px] font-bold text-[#05060a] shadow-[0_0_60px_rgba(122,162,255,0.45)]">
                Start a board <Icon name="back2" className="h-4 w-4 rotate-180 transition-transform group-hover:translate-x-1" />
              </Magnetic>
              <Magnetic onClick={() => startDemo()} className="flex h-14 items-center gap-2 rounded-full border border-white/20 bg-white/5 px-7 text-[15px] font-bold text-white backdrop-blur-md hover:bg-white/10">
                <Icon name="sparkle" className="h-4 w-4 text-[#ff9f7a]" /> Try the live demo
              </Magnetic>
            </div>
            <p data-hero-fade className="mt-6 text-[12px] font-medium text-white/40">Free · No sign-up · Your data stays on your device</p>
          </div>
        </div>

        {STORY.map((chapter) => (
          <div key={chapter.kicker} data-chapter data-side={chapter.side} className={`flex h-[110vh] items-center px-5 sm:px-10 ${chapter.side === "left" ? "justify-start" : "justify-end"}`}>
            <div data-card className="pointer-events-auto relative w-full max-w-[460px] overflow-hidden rounded-[28px] border border-white/10 bg-[#0b0d14]/55 p-7 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
              <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-gradient-to-br from-[#2f63ff]/40 to-[#ff8a5b]/30 blur-3xl" />
              <div className="relative flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-[#2f63ff] to-[#ff8a5b] text-white shadow-[0_0_30px_rgba(47,99,255,0.5)]">
                  <Icon name={chapter.icon} className="h-5 w-5" />
                </span>
                <span className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#9fb8ff]">{chapter.kicker}</span>
              </div>
              <h2 className="relative mt-5 font-display text-[clamp(34px,3.6vw,52px)] leading-[1] text-white">
                <span data-split>{chapter.title}</span> <em data-accent className="inline-block bg-gradient-to-r from-[#9fb8ff] to-[#ffb08f] bg-clip-text text-transparent">{chapter.accent}</em>
              </h2>
              <p data-line className="relative mt-4 text-[15px] leading-relaxed text-white/65">{chapter.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  useEffect(() => {
    if (!inView || !ref.current) return;
    const node = ref.current;
    const state = { v: 0 };
    const tween = gsap.to(state, { v: to, duration: 2, ease: "expo.out", onUpdate: () => void (node.textContent = `${Math.round(state.v).toLocaleString()}${suffix}`) });
    return () => void tween.kill();
  }, [inView, to, suffix]);
  return <span ref={ref}>0{suffix}</span>;
}

function Numbers() {
  const stats = [
    { value: <CountUp to={5000} suffix="+" />, label: "shapes at 60 fps", detail: "WebGL batching, engine in a Web Worker" },
    { value: <CountUp to={0} />, label: "merge conflicts", detail: "CRDTs written from scratch: move tree, LWW maps, Fugue" },
    { value: <CountUp to={100} suffix="%" />, label: "works offline", detail: "IndexedDB journal, merges on reconnect" },
    { value: <CountUp to={200} suffix="+" />, label: "automated tests", detail: "Property-based: thousands of random edit orders" },
  ];
  return (
    <section className="relative border-y border-white/10 bg-[#07080d]">
      <div className="mx-auto grid max-w-7xl grid-cols-2 lg:grid-cols-4">
        {stats.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: i * 0.08 }} className="border-white/10 px-6 py-14 sm:px-10 [&:not(:last-child)]:border-r">
            <p className="bg-gradient-to-br from-white to-white/50 bg-clip-text font-display text-[clamp(48px,5.5vw,84px)] leading-none text-transparent">{s.value}</p>
            <p className="mt-3 text-[15px] font-bold text-white">{s.label}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/45">{s.detail}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

const FEATURES: ReadonlyArray<{ icon: IconName; title: string; body: string; span?: string; tint: string }> = [
  { icon: "eye", title: "Present mode", body: "Frames become slides. The camera flies between them, designed slides build themselves in, and everyone follows along — with a glowing laser pointer.", span: "sm:col-span-2 lg:row-span-2", tint: "#7b6cff" },
  { icon: "panel", title: "Studio editor", body: "Double-click any slide or chart: live preview, every field, a data grid, spreadsheet paste and AI rewrites.", tint: "#2f63ff" },
  { icon: "chart", title: "Charts that build in", body: "Nine chart types with KPIs and insights. Bars grow, lines draw.", tint: "#22c3a6" },
  { icon: "cube", title: "3D on the canvas", body: "Planets, cities, rockets — lit, glowing, and yours to orbit.", tint: "#b36bff" },
  { icon: "slides", title: "Designed decks", body: "Ten themes and fourteen layouts — statement, team, pricing, process, 2×2 matrix, timeline, charts and more. Decks stream in slide by slide, and the slide on stage keeps moving.", span: "sm:col-span-2", tint: "#ff7a59" },
  { icon: "arrow", title: "Quick-connect", body: "Hover a shape, click a + and the next step appears already connected.", tint: "#38b6ff" },
  { icon: "star", title: "Dot voting & timer", body: "Run a retro in minutes: vote on notes, share a countdown.", tint: "#ffb020" },
  { icon: "command", title: "48 templates, one click", body: "Pitch decks, dashboards, OKRs, canvases, journey maps, org charts and 3D scenes — plus an Insert panel for any slide, chart or scene.", span: "sm:col-span-2", tint: "#ff4f8b" },
  { icon: "download", title: "PNG · SVG · PDF", body: "Vector-perfect export of the board or just the selection.", tint: "#52d36b" },
  { icon: "share", title: "Signed share links", body: "Edit or view-only, enforced by the server. Works offline, merges on reconnect.", span: "sm:col-span-2", tint: "#e85cff" },
];

/** Cards with a light that follows the pointer and a slight 3D tilt. */
function Features() {
  return (
    <section id="features" className="relative mx-auto max-w-7xl px-5 py-32 sm:px-8">
      <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} className="max-w-3xl">
        <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#9fb8ff]">Everything you reach for</p>
        <h2 className="mt-4 font-display text-[clamp(44px,6vw,84px)] leading-[0.95] text-white">
          Pro tools. <em className="bg-gradient-to-r from-[#9fb8ff] to-[#ffb08f] bg-clip-text text-transparent">Zero clutter.</em>
        </h2>
      </motion.div>
      <div className="mt-14 grid auto-rows-[minmax(220px,auto)] grid-flow-dense grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f, i) => (
          <motion.article
            key={f.title}
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: (i % 4) * 0.07 }}
            onPointerMove={(e) => {
              const el = e.currentTarget;
              const r = el.getBoundingClientRect();
              const x = e.clientX - r.left;
              const y = e.clientY - r.top;
              el.style.setProperty("--mx", `${x}px`);
              el.style.setProperty("--my", `${y}px`);
              gsap.to(el, { rotateY: (x / r.width - 0.5) * 6, rotateX: -(y / r.height - 0.5) * 6, duration: 0.5, ease: "power3.out", transformPerspective: 900 });
            }}
            onPointerLeave={(e) => void gsap.to(e.currentTarget, { rotateX: 0, rotateY: 0, duration: 0.8, ease: "elastic.out(1, 0.5)" })}
            className={`group relative overflow-hidden rounded-[28px] border border-white/10 p-7 ${f.span ?? ""}`}
            style={{ background: `radial-gradient(420px circle at var(--mx, -999px) var(--my, -999px), ${f.tint}26, transparent 45%), rgba(255,255,255,0.03)` }}
          >
            <span className="relative grid h-12 w-12 place-items-center rounded-2xl text-white transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110" style={{ backgroundColor: f.tint, boxShadow: `0 0 40px ${f.tint}80` }}>
              <Icon name={f.icon} className="h-5 w-5" />
            </span>
            <h3 className="relative mt-6 text-[19px] font-extrabold tracking-tight text-white">{f.title}</h3>
            <p className="relative mt-2 max-w-md text-[14px] leading-relaxed text-white/55">{f.body}</p>
            {f.span?.includes("row-span-2") && <PresentDemo />}
          </motion.article>
        ))}
      </div>
    </section>
  );
}

/** A tiny looping "slides" animation inside the present-mode card. */
function PresentDemo() {
  const slides = ["#2f63ff", "#ff8a5b", "#19c3a5"];
  return (
    <div className="absolute inset-x-7 bottom-7 top-[52%] hidden overflow-hidden rounded-2xl border border-white/10 bg-black/30 lg:block">
      <motion.div className="flex h-full" animate={{ x: ["0%", "0%", "-100%", "-100%", "-200%", "-200%", "0%"] }} transition={{ duration: 9, repeat: Infinity, ease: [0.7, 0, 0.2, 1], times: [0, 0.25, 0.33, 0.58, 0.66, 0.92, 1] }}>
        {slides.map((c, i) => (
          <div key={c} className="grid h-full w-full shrink-0 place-items-center">
            <div className="h-[70%] w-[78%] rounded-xl p-4" style={{ background: `linear-gradient(135deg, ${c}55, ${c}15)`, border: `1px solid ${c}66` }}>
              <div className="h-2.5 w-24 rounded-full bg-white/70" />
              <div className="mt-3 flex gap-2">
                {[0, 1, 2].map((k) => (
                  <div key={k} className="h-10 flex-1 rounded-md bg-white/20" />
                ))}
              </div>
              <p className="mt-3 text-[11px] font-bold text-white/70">Slide {i + 1}</p>
            </div>
          </div>
        ))}
      </motion.div>
      <motion.span className="absolute h-3 w-3 rounded-full bg-[#ff3b3b] shadow-[0_0_20px_6px_rgba(255,59,59,0.7)]" animate={{ left: ["30%", "62%", "45%", "70%", "30%"], top: ["40%", "55%", "30%", "62%", "40%"] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }} />
    </div>
  );
}

function Engine() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      gsap.from("[data-node]", { opacity: 0, y: 50, stagger: 0.18, duration: 1, ease: "expo.out", scrollTrigger: { trigger: el, start: "top 70%" } });
      gsap.fromTo("[data-wire]", { strokeDashoffset: 200 }, { strokeDashoffset: 0, duration: 1.4, ease: "power2.inOut", stagger: 0.3, scrollTrigger: { trigger: el, start: "top 60%" } });
    }, el);
    return () => ctx.revert();
  }, []);
  const nodes = [
    { icon: "pen" as const, title: "Your device", lines: ["CRDT engine in a Web Worker", "IndexedDB journal (offline)", "WebGL canvas at 60 fps"] },
    { icon: "link" as const, title: "Sync server", lines: ["Binary WebSocket protocol", "Ordered log + snapshots", "Postgres · Redis fan-out"] },
    { icon: "smile" as const, title: "Your team", lines: ["Merges in any order", "Live cursors & presence", "Same result, every time"] },
  ];
  return (
    <section ref={ref} id="engine" className="relative overflow-hidden border-t border-white/10 py-32">
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(circle,#fff_1px,transparent_1px)] [background-size:26px_26px]" />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#9fb8ff]">Under the hood</p>
        <h2 className="mt-4 max-w-4xl font-display text-[clamp(40px,5.5vw,76px)] leading-[0.98] text-white">
          Local-first by design. <em className="text-[#ffb08f]">The server is optional.</em>
        </h2>
        <div className="relative mt-16 grid gap-6 lg:grid-cols-3">
          <svg className="pointer-events-none absolute inset-x-0 top-1/2 hidden h-6 w-full -translate-y-1/2 lg:block" viewBox="0 0 1000 24" preserveAspectRatio="none" aria-hidden>
            <path data-wire d="M300 12 H 370" stroke="#8fb0ff" strokeWidth="2.5" strokeDasharray="200" fill="none" />
            <path data-wire d="M630 12 H 700" stroke="#ff9f7a" strokeWidth="2.5" strokeDasharray="200" fill="none" />
          </svg>
          {nodes.map((n) => (
            <div key={n.title} data-node className="relative rounded-[28px] border border-white/10 bg-white/[0.04] p-7 backdrop-blur">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10 text-white">
                <Icon name={n.icon} className="h-5 w-5" />
              </span>
              <h3 className="mt-6 text-[19px] font-extrabold text-white">{n.title}</h3>
              <ul className="mt-3 space-y-2">
                {n.lines.map((line) => (
                  <li key={line} className="flex items-center gap-2.5 text-[14px] text-white/60">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#8fb0ff] shadow-[0_0_8px_#8fb0ff]" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="relative overflow-hidden px-5 py-40 text-center">
      <motion.div className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[980px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[conic-gradient(from_0deg,#2f63ff,#7b6cff,#ff8a5b,#2f63ff)] opacity-25 blur-[120px]" animate={{ rotate: 360 }} transition={{ duration: 30, repeat: Infinity, ease: "linear" }} />
      <motion.h2 initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} className="relative mx-auto max-w-5xl font-display text-[clamp(48px,8vw,120px)] leading-[0.9] text-white">
        Your next big idea deserves a <em className="bg-gradient-to-r from-[#9fb8ff] to-[#ffb08f] bg-clip-text text-transparent">better canvas.</em>
      </motion.h2>
      <div className="relative mt-12 flex flex-wrap justify-center gap-3">
        <Magnetic onClick={() => startDemo("brainstorm")} className="h-16 rounded-full bg-white px-10 text-[16px] font-bold text-[#05060a] shadow-[0_0_80px_rgba(159,184,255,0.5)]">
          Start a board — it's free
        </Magnetic>
        <Magnetic href="/boards" className="flex h-16 items-center rounded-full border border-white/20 px-8 text-[16px] font-bold text-white hover:bg-white/5">
          See your boards
        </Magnetic>
      </div>
    </section>
  );
}

export default function Home() {
  const lenis = useRef<Lenis | null>(null);
  useEffect(() => {
    document.title = "Tandem — the canvas that never loses a thought";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Smooth, inertial scrolling that drives GSAP's scroll triggers from the same clock.
    const instance = new Lenis({ lerp: 0.085, smoothWheel: true });
    lenis.current = instance;
    instance.on("scroll", ScrollTrigger.update);
    const tick = (time: number): void => instance.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(tick);
      instance.destroy();
      lenis.current = null;
    };
  }, []);
  return (
    <div className="theme-dark min-h-full bg-[#05060a] text-white">
      <Nav />
      <Story lenis={lenis} />
      <Numbers />
      <Showcase />
      <Features />
      <TemplateMarquee onOpen={(id) => startDemo(id)} />
      <Engine />
      <FinalCta />
      <footer className="border-t border-white/10 px-5 py-10 text-[12px] text-white/40">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <span className="flex items-center gap-2">
            <Logo className="h-5 w-5" /> Tandem — local-first collaborative canvas
          </span>
          <span>CRDTs · Web Workers · WebGL · Three.js · WebSockets · Postgres · Redis · Ollama</span>
        </div>
      </footer>
    </div>
  );
}
