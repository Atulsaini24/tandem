import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CHART_THEMES, chartSvg, parseChart } from "../../canvas/charts";
import { toSvg } from "../../canvas/export";
import { parseScene } from "../../canvas/scenes";
import { parseSlide, slideSvg } from "../../canvas/slides";
import { TEMPLATES } from "../../canvas/templates";
import { CANVAS_THEMES } from "../../canvas/theme";
import { Icon } from "../../ui/kit";

gsap.registerPlugin(ScrollTrigger);

// The live 3D view is three.js: its own chunk, loaded when the gallery gets close.
const SceneView = lazy(() => import("../../ui/Scenes3D").then((m) => ({ default: m.SceneView })));

const DECK = "ShopSathi — AI inventory on WhatsApp";

const slide = (data: Record<string, unknown>): string => {
  const spec = parseSlide(JSON.stringify({ deck: DECK, total: 9, ...data }));
  return spec ? slideSvg(spec, 960, 540) : "";
};
const chart = (data: Record<string, unknown>): string => {
  const spec = parseChart(JSON.stringify(data));
  return spec ? chartSvg(spec, 860, 600, CHART_THEMES.dark) : "";
};

const SOLAR = parseScene(
  JSON.stringify({
    title: "The inner solar system",
    backdrop: "space",
    objects: [
      { shape: "planet", label: "Sun", color: "#ffb23f", position: [0, 0, 0], size: [3, 3, 3], motion: "spin", speed: 0.2, glow: true },
      { shape: "planet", label: "Mercury", color: "#a39b91", position: [3, 0, 0], size: [0.35, 0.35, 0.35], motion: "orbit", orbitRadius: 3, speed: 1.6 },
      { shape: "planet", label: "Venus", color: "#e3b673", position: [4.3, 0, 0], size: [0.6, 0.6, 0.6], motion: "orbit", orbitRadius: 4.3, speed: 1.2 },
      { shape: "planet", label: "Earth", color: "#3d7bff", position: [5.8, 0, 0], size: [0.65, 0.65, 0.65], motion: "orbit", orbitRadius: 5.8, speed: 1 },
      { shape: "planet", label: "Mars", color: "#d4582f", position: [7.2, 0, 0], size: [0.45, 0.45, 0.45], motion: "orbit", orbitRadius: 7.2, speed: 0.8 },
      { shape: "planet", label: "Saturn", color: "#e8cf8f", position: [9.5, 0, 0], size: [1.3, 1.3, 1.3], motion: "orbit", orbitRadius: 9.5, speed: 0.5, rings: true },
    ],
  }),
);

interface Panel {
  readonly mode: string;
  readonly prompt: string;
  readonly caption: string;
  readonly ratio: string;
  readonly svg?: () => string;
  readonly three?: boolean;
}

const PANELS: readonly Panel[] = [
  {
    mode: "Slides",
    prompt: "Investor pitch deck for an AI that runs kirana inventory over WhatsApp",
    caption: "9 designed slides, themed, numbered — and it starts presenting on its own.",
    ratio: "960 / 540",
    svg: () => slide({ layout: "title", theme: "midnight", kicker: "Seed round", index: 0, title: "Inventory that runs itself, right inside WhatsApp", subtitle: "ShopSathi helps 63 million Indian kirana stores stop losing ₹1.2 lakh a year to stock-outs and waste." }),
  },
  {
    mode: "Slides",
    prompt: "…a market slide with the three numbers that matter",
    caption: "Fourteen layouts in ten themes — and every slide opens in Studio for editing.",
    ratio: "960 / 540",
    svg: () =>
      slide({
        layout: "stats",
        theme: "sunset",
        kicker: "Market",
        index: 3,
        title: "A huge market that software has ignored",
        stats: [
          { value: "63M", label: "Small retail stores in India", delta: "+4% YoY" },
          { value: "₹74L Cr", label: "Annual kirana retail spend", delta: "+11% YoY" },
          { value: "530M", label: "WhatsApp users in India", delta: "+9% YoY" },
        ],
        subtitle: "Every one of these stores already has WhatsApp — none of them want another app.",
      }),
  },
  {
    mode: "Slides",
    prompt: "…and a pricing slide with three plans, the middle one most popular",
    caption: "Statement, team, pricing, process and 2×2 layouts — restyle a whole deck in one click.",
    ratio: "960 / 540",
    svg: () =>
      slide({
        layout: "pricing",
        theme: "royal",
        kicker: "Pricing",
        index: 6,
        title: "Simple plans for every shop",
        items: [
          { title: "Starter", value: "₹0", text: "1 store; Daily stock alerts; WhatsApp only" },
          { title: "Pro", value: "₹299/mo", text: "Unlimited items; Auto reorders; Expiry alerts; Hindi + 8 languages" },
          { title: "Chain", value: "₹1,999/mo", text: "Up to 10 stores; Distributor sync; Analytics dashboard" },
        ],
      }),
  },
  {
    mode: "Chart",
    prompt: "Revenue vs operating costs for a Series A SaaS, FY2025",
    caption: "KPIs computed from the data, a smooth plot and the insight — then it builds itself in.",
    ratio: "860 / 600",
    svg: () =>
      chart({
        type: "line",
        title: "Revenue vs operating costs, FY2025",
        unit: "$",
        note: "Illustrative estimates for a Series A SaaS company, $k",
        kpis: [
          { label: "Total revenue", value: "$4.2M", delta: "+38% YoY" },
          { label: "Gross margin", value: "74%", delta: "+6 pts" },
          { label: "Burn multiple", value: "1.3x", delta: "-0.4x" },
        ],
        labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        series: [
          { name: "Revenue", values: [212, 228, 251, 262, 289, 301, 334, 352, 371, 398, 421, 463] },
          { name: "Operating costs", values: [318, 322, 330, 327, 338, 345, 349, 356, 360, 368, 371, 380] },
        ],
        insight: "Revenue crossed costs in September and finished the year 22% above them.",
      }),
  },
  {
    mode: "Chart",
    prompt: "Our checkout funnel for last month — where do we lose people?",
    caption: "Nine chart types: bar, ranking, stacked, line, area, pie, donut, funnel, radar.",
    ratio: "860 / 600",
    svg: () =>
      chart({
        type: "funnel",
        title: "Checkout funnel, last 30 days",
        note: "Web store, all traffic",
        kpis: [
          { label: "Visitors", value: "184k", delta: "+12%" },
          { label: "Orders", value: "5.1k", delta: "+9%" },
          { label: "Conversion", value: "2.8%", delta: "-0.2 pts" },
        ],
        labels: ["Product view", "Add to cart", "Checkout", "Payment", "Order placed"],
        series: [{ name: "Users", values: [184200, 41300, 17800, 8900, 5120] }],
        insight: "Biggest leak: only 22% of viewers add to cart — fix product pages before checkout.",
      }),
  },
  {
    mode: "3D",
    prompt: "The solar system with Saturn's rings, orbiting at real-ish speeds",
    caption: "Live, lit 3D on the board: planets, cities, rockets, servers. Double-click to fly around.",
    ratio: "16 / 10",
    three: true,
  },
];

/** Types the prompt out when its panel becomes active. */
function Typed({ text, active }: { text: string; active: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    setN(0);
    let i = 0;
    const t = setInterval(() => {
      i += 2;
      setN(i);
      if (i >= text.length) clearInterval(t);
    }, 22);
    return () => clearInterval(t);
  }, [active, text]);
  return (
    <span>
      {text.slice(0, active ? n : text.length)}
      {active && n < text.length && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-white" />}
    </span>
  );
}

function Artifact({ panel, active, near }: { panel: Panel; active: boolean; near: boolean }): ReactNode {
  const svg = useMemo(() => panel.svg?.() ?? "", [panel]);
  const [play, setPlay] = useState(0);
  // Replay the build-in animation each time the panel comes into focus.
  useEffect(() => {
    if (active) setPlay((p) => p + 1);
  }, [active]);
  if (panel.three) {
    return (
      <div className="relative h-full w-full overflow-hidden rounded-[22px] bg-[#02030a]">
        {near && SOLAR && (
          <Suspense fallback={null}>
            <SceneView spec={SOLAR} orbiting={false} />
          </Suspense>
        )}
        <span className="absolute left-4 top-3 text-[13px] font-bold text-white drop-shadow">{SOLAR?.title}</span>
      </div>
    );
  }
  return <div key={play} className={`showcase-art h-full w-full overflow-hidden rounded-[22px] ${active ? "reveal" : ""}`} style={{ ["--base" as string]: "250ms" }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * "AI Studio": a pinned, horizontally scrolling gallery of real output, drawn by the same
 * code the board uses. Each piece types its prompt and builds itself in as it arrives.
 */
export function Showcase() {
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = section.current;
    const tr = track.current;
    if (!el || !tr) return;
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: el,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (self) => {
          // Slide so the panel in focus sits in the middle of the screen, on any width.
          const items = [...tr.children] as HTMLElement[];
          const pos = self.progress * (items.length - 1);
          const a = items[Math.floor(pos)];
          const b = items[Math.min(items.length - 1, Math.floor(pos) + 1)];
          if (!a || !b) return;
          const f = pos - Math.floor(pos);
          const left = a.offsetLeft + (b.offsetLeft - a.offsetLeft) * f;
          const x = -(left - (window.innerWidth - a.offsetWidth) / 2);
          gsap.to(tr, { x, duration: 0.6, ease: "power3.out", overwrite: true });
          setProgress(self.progress);
          setActive(Math.min(PANELS.length - 1, Math.round(self.progress * (PANELS.length - 1))));
        },
      });
      gsap.from("[data-sc-head]", { opacity: 0, y: 40, filter: "blur(10px)", stagger: 0.1, duration: 1, ease: "expo.out", scrollTrigger: { trigger: el, start: "top 75%" } });
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={section} id="ai" className="relative" style={{ height: `${PANELS.length * 90 + 40}vh` }}>
      <div className="sticky top-0 flex h-screen flex-col overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_10%,rgba(91,140,255,0.18),transparent_55%),radial-gradient(ellipse_at_85%_90%,rgba(255,122,89,0.14),transparent_50%)]" />
        <div className="relative mx-auto flex w-full max-w-7xl flex-wrap items-end justify-between gap-6 px-5 pt-24 sm:px-8">
          <div>
            <p data-sc-head className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#9fb8ff]">AI Studio · runs on your machine</p>
            <h2 data-sc-head className="mt-3 font-display text-[clamp(40px,5.4vw,80px)] leading-[0.95] text-white">
              Ask once. <em className="bg-gradient-to-r from-[#9fb8ff] to-[#ffb08f] bg-clip-text text-transparent">Watch it build.</em>
            </h2>
          </div>
          <div data-sc-head className="flex items-center gap-2">
            {PANELS.map((p, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all duration-500 ${i === active ? "w-10 bg-gradient-to-r from-[#5b8cff] to-[#ff8a5b]" : "w-3 bg-white/20"}`} />
            ))}
            <span className="ml-3 font-mono text-[12px] text-white/40">{String(Math.round(progress * 100)).padStart(2, "0")}%</span>
          </div>
        </div>

        <div className="relative flex flex-1 items-center">
          <div ref={track} className="flex items-center gap-[5vw] pl-[max(20px,calc((100vw-80rem)/2+32px))] pr-[12vw] will-change-transform">
            {PANELS.map((p, i) => {
              const on = i === active;
              return (
                <article key={i} className={`w-[min(980px,82vw)] shrink-0 transition-all duration-700 ${on ? "opacity-100" : "scale-[0.94] opacity-40 blur-[1px]"}`}>
                  <div className="mb-4 flex items-center gap-3">
                    <span className="rounded-full bg-gradient-to-r from-[#5b8cff] to-[#b36bff] px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-white shadow-[0_0_24px_rgba(91,140,255,0.5)]">{p.mode}</span>
                    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-4 py-2 text-[14px] text-white/85 backdrop-blur-md">
                      <Icon name="sparkle" className="h-4 w-4 shrink-0 text-[#ffb08f]" />
                      <span className="truncate">
                        <Typed text={p.prompt} active={on} />
                      </span>
                    </div>
                  </div>
                  <div className="relative rounded-[26px] border border-white/10 bg-white/[0.03] p-2 shadow-[0_40px_120px_rgba(0,0,0,0.55)]" style={{ aspectRatio: p.ratio, maxHeight: "62vh" }}>
                    <Artifact panel={p} active={on} near={Math.abs(i - active) <= 1} />
                  </div>
                  <p className={`mt-4 max-w-2xl text-[14px] leading-relaxed text-white/55 transition-opacity duration-700 ${on ? "opacity-100" : "opacity-0"}`}>{p.caption}</p>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Two rows of real template previews drifting past; click one to open it. */
export function TemplateMarquee({ onOpen }: { onOpen: (id: string) => void }) {
  const previews = useMemo(
    () =>
      TEMPLATES.map((t) => {
        const shapes = t.build().map((s) => ({ id: s.key, ...s.props }));
        const byId = new Map(shapes.map((s) => [s.id, s]));
        const svg = toSvg(shapes, (id) => byId.get(id), { theme: CANVAS_THEMES.dark, padding: 60, background: false }).svg;
        return { t, url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
      }),
    [],
  );
  const rows = [previews, [...previews].reverse()];
  return (
    <section className="relative overflow-hidden border-t border-white/10 py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#9fb8ff]">Templates</p>
        <h2 className="mt-4 max-w-4xl font-display text-[clamp(40px,5.5vw,76px)] leading-[0.98] text-white">
          Start from a <em className="bg-gradient-to-r from-[#9fb8ff] to-[#ffb08f] bg-clip-text text-transparent">finished example.</em>
        </h2>
        <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-white/55">48 templates in 8 categories — decks, dashboards, strategy canvases, diagrams, workshops, 3D and lessons — full of real content, ready to edit.</p>
      </div>
      <div className="mt-14 space-y-5 [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]">
        {rows.map((row, r) => (
          <div key={r} className={`flex w-max gap-5 ${r === 0 ? "marquee-left" : "marquee-right"} hover:[animation-play-state:paused]`}>
            {[...row, ...row].map(({ t, url }, i) => (
              <button
                key={`${t.id}-${i}`}
                type="button"
                onClick={() => onOpen(t.id)}
                className="group relative w-[340px] shrink-0 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] text-left transition-colors hover:border-white/30"
              >
                <div className="relative aspect-[16/10] overflow-hidden bg-[#0b0d14]">
                  <img src={url} alt="" className="absolute inset-0 h-full w-full object-contain p-4 transition-transform duration-700 group-hover:scale-110" />
                  {t.tag && <span className="absolute left-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: `#${t.color.toString(16).padStart(6, "0")}` }}>{t.tag}</span>}
                </div>
                <div className="px-4 py-3">
                  <p className="text-[14px] font-bold text-white">{t.name}</p>
                  <p className="line-clamp-1 text-[12px] text-white/50">{t.blurb}</p>
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
