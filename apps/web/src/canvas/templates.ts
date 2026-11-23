import { card, chart, columns, frame, INK, NOTE_COLORS, note, arrow, slide, text, type TemplateShape } from "./template-kit";
import { LIBRARY, TEMPLATE_CATEGORIES, type TemplateCategory } from "./template-library";

export { INK, NOTE_COLORS, TEMPLATE_CATEGORIES, type TemplateCategory, type TemplateShape };

/**
 * Starter boards. Shapes reference each other by `key` (arrows' from/to); the editor gives
 * every shape a fresh id when it inserts a template, so one board can hold several copies.
 * Each one is a finished example worth keeping, not an empty skeleton.
 */
export interface Template {
  readonly id: TemplateId;
  readonly name: string;
  readonly blurb: string;
  /** Accent for the dashboard card. */
  readonly color: number;
  /** Shown as a badge on the card ("Slides", "Charts", "3D"). */
  readonly tag?: string;
  readonly category: TemplateCategory;
  build(): TemplateShape[];
}

export type TemplateId = string;

// --- content ----------------------------------------------------------------------------

const DECK = "Nova — the AI analyst for every team";
const PITCH: ReadonlyArray<Record<string, unknown>> = [
  { layout: "title", kicker: "Series A", title: "Every team deserves its own data analyst", subtitle: "Nova answers business questions in plain English, straight from your warehouse, in seconds instead of weeks." },
  { layout: "cards", kicker: "Problem", title: "Data teams are drowning in one-off questions", items: [
    { icon: "⏳", title: "11-day wait for answers", text: "The average analytics request sits in a queue for 11 days; most are simple lookups." },
    { icon: "🧩", title: "Dashboards nobody trusts", text: "Companies run 400+ dashboards; 62% of them disagree on core metrics." },
    { icon: "💸", title: "Expensive bottleneck", text: "A 5-person data team costs $900k a year and spends 70% of its time on tickets." },
  ] },
  { layout: "stats", kicker: "Market", title: "A $28B market moving to self-serve AI", stats: [
    { value: "$28B", label: "BI and analytics software spend, 2025", delta: "+11% YoY" },
    { value: "4.2M", label: "Companies with a cloud data warehouse", delta: "+23% YoY" },
    { value: "68%", label: "Leaders planning AI analytics in 2026", delta: "+31 pts" },
  ], subtitle: "Warehouses made data central; AI makes it accessible to everyone else." },
  { layout: "chart", kicker: "Traction", title: "Revenue tripled in the last three quarters", subtitle: "$2.9M ARR with 132% net revenue retention.", chart: { type: "bar", unit: "$", labels: ["Q1 '25", "Q2 '25", "Q3 '25", "Q4 '25", "Q1 '26", "Q2 '26"], series: [{ name: "ARR ($k)", values: [410, 620, 960, 1480, 2140, 2910] }] }, items: [
    { title: "212 paying teams", text: "Up from 38 a year ago, mostly bottom-up." },
    { title: "4.1-month payback", text: "CAC recovered in a single quarter." },
  ] },
  { layout: "compare", kicker: "Why Nova", title: "Built for the questions dashboards can't answer", columns: [
    { title: "Classic BI tools", items: ["Analysts build every chart by hand", "Weeks from question to answer", "SQL skills required", "Metrics drift across dashboards"] },
    { title: "Nova", items: ["Ask in plain English, get a chart", "Answers in 8 seconds on average", "Works for every role, no SQL", "One governed metric layer"] },
  ] },
  { layout: "timeline", kicker: "Roadmap", title: "From answers to autonomous analysis", items: [
    { title: "Q3 · Alerts", text: "Nova watches key metrics and explains every unusual change." },
    { title: "Q4 · Forecasts", text: "One-click forecasts with confidence ranges for any metric." },
    { title: "Q1 · Agents", text: "Scheduled deep-dives that write the weekly business review." },
    { title: "Q2 · Marketplace", text: "Certified metric packs for SaaS, retail and fintech." },
  ] },
  { layout: "quote", kicker: "Customers", title: "What our customers say", quote: { text: "Nova cut our ad-hoc data requests by 74%. My analysts finally work on the hard problems.", author: "Priya Raman, Head of Data, Fernway" } },
  { layout: "closing", kicker: "The ask", title: "Raising $12M to make every team data-fluent", subtitle: "24 months of runway to reach $15M ARR and launch Nova Agents.", items: [{ icon: "📅", title: "Book a live demo" }, { icon: "✉️", title: "founders@nova.ai" }] },
];

const CORE: readonly Template[] = [
  {
    id: "pitch",
    category: "Presentations",
    name: "Pitch deck",
    blurb: "An 8-slide investor deck with charts and stats. Press Present to play it.",
    color: 0x5b8cff,
    tag: "Slides",
    build: () => PITCH.flatMap((s, i) => slide(`s${i}`, (i % 4) * 1080, Math.floor(i / 4) * 680, { ...s, theme: "midnight", deck: DECK, index: i, total: PITCH.length }, `${i + 1}. ${String(s.title)}`)),
  },
  {
    id: "dashboard",
    category: "Dashboards",
    name: "Metrics dashboard",
    blurb: "Revenue, channels, funnel and top products, with KPIs and insights.",
    color: 0x22c3a6,
    tag: "Charts",
    build: () => [
      frame("f", 0, 0, 1900, 1420, "Q2 2026 business review", 0x22c3a6),
      text("t", 40, 36, 1100, 60, "Q2 2026 business review — Nova Commerce"),
      chart("rev", 40, 130, 900, 600, {
        type: "area", title: "Monthly revenue vs target", unit: "$", note: "Net revenue in $k, FY2026",
        kpis: [{ label: "Q2 revenue", value: "$2.41M", delta: "+34% YoY" }, { label: "vs target", value: "104%", delta: "+4 pts" }, { label: "Avg order", value: "$86", delta: "+$7" }],
        labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"], series: [{ name: "Revenue", values: [612, 648, 701, 742, 806, 862] }, { name: "Target", values: [600, 640, 690, 740, 790, 840] }],
        insight: "Revenue beat target five months in a row; June was the best month ever at $862k.",
      }),
      chart("mix", 960, 130, 900, 600, {
        type: "donut", title: "Revenue by channel", unit: "%", note: "Share of Q2 net revenue",
        kpis: [{ label: "Organic", value: "38%", delta: "+5 pts" }, { label: "Paid social", value: "24%", delta: "-3 pts" }, { label: "Retail partners", value: "17%", delta: "+2 pts" }],
        labels: ["Organic search", "Paid social", "Retail partners", "Email", "Referral"], series: [{ name: "Share", values: [38, 24, 17, 13, 8] }],
        insight: "Organic search is now the biggest channel; paid social's share fell as CPMs rose 18%.",
      }),
      chart("funnel", 40, 760, 900, 600, {
        type: "funnel", title: "Checkout funnel, June", unit: "", note: "Web and app, all traffic",
        kpis: [{ label: "Visitors", value: "412k", delta: "+9%" }, { label: "Orders", value: "10.1k", delta: "+14%" }, { label: "Conversion", value: "2.45%", delta: "+0.1 pts" }],
        labels: ["Visited", "Viewed product", "Added to cart", "Checkout", "Ordered"], series: [{ name: "Users", values: [412000, 168400, 39800, 17200, 10100] }],
        insight: "Only 24% of product viewers add to cart: the product page is the biggest lever.",
      }),
      chart("top", 960, 760, 900, 600, {
        type: "hbar", title: "Top products by revenue", unit: "$", note: "Q2, $k",
        labels: ["Trail Runner 2", "Merino Hoodie", "Daypack 22L", "Rain Shell", "Wool Socks 3-pack", "Cap"], series: [{ name: "Revenue", values: [418, 302, 264, 221, 148, 96] }],
        insight: "The Trail Runner 2 alone brought 17% of revenue; restock before the July sale.",
      }),
    ],
  },
  {
    id: "roadmap",
    category: "Planning",
    name: "Product roadmap",
    blurb: "A designed timeline plus quarter columns with owners, dates and priorities.",
    color: 0xff7a59,
    tag: "Plan",
    build: () => {
      const out: TemplateShape[] = slide("tl", 0, 0, { layout: "timeline", theme: "sunset", kicker: "Roadmap", title: "2026: from MVP to market leader", deck: "Product roadmap", index: 0, total: 1, items: [
        { title: "Q1 · Foundations", text: "Rebuild onboarding, launch the public API." },
        { title: "Q2 · Growth", text: "Team plans, templates gallery, referrals." },
        { title: "Q3 · Enterprise", text: "SSO, audit logs, admin console, SOC 2." },
        { title: "Q4 · Scale", text: "EU region, marketplace, 3 new integrations." },
      ] }, "Roadmap overview");
      const quarters: ReadonlyArray<{ title: string; fill: number; noteFill: number; cards: ReadonlyArray<[string, string, string, string, "high" | "medium" | "low"]> }> = [
        { title: "Q1 · Foundations", fill: 0x2f63ff, noteFill: NOTE_COLORS.blue, cards: [["New onboarding", "3-step setup that gets teams to their first board in 2 minutes.", "Maya (PM)", "Week 4", "high"], ["Public API v1", "REST + webhooks for boards, shapes and comments.", "Leo (Eng)", "Week 9", "high"], ["Usage analytics", "Activation and retention events in the warehouse.", "Ana (Data)", "Week 11", "medium"]] },
        { title: "Q2 · Growth", fill: 0x1e8f5a, noteFill: NOTE_COLORS.green, cards: [["Team plans", "Seats, shared spaces and per-team billing.", "Raj (Eng)", "Week 16", "high"], ["Templates gallery", "40 expert templates with previews and search.", "Zoe (Design)", "Week 19", "medium"], ["Referral loop", "Give a month, get a month; in-product invites.", "Sam (Growth)", "Week 22", "low"]] },
        { title: "Q3 · Enterprise", fill: 0x7b55e7, noteFill: NOTE_COLORS.purple, cards: [["SSO + SCIM", "Okta, Azure AD and Google Workspace sign-in.", "Leo (Eng)", "Week 29", "high"], ["Audit log", "Every change, exportable to the customer's SIEM.", "Ivy (Security)", "Week 32", "high"], ["SOC 2 Type II", "Controls in place, audit window opens.", "Ivy (Security)", "Week 38", "medium"]] },
        { title: "Q4 · Scale", fill: 0xef6b3a, noteFill: NOTE_COLORS.orange, cards: [["EU data region", "Frankfurt hosting for EU customers.", "Omar (Infra)", "Week 44", "high"], ["Marketplace", "Third-party templates and plugins, revenue share.", "Maya (PM)", "Week 48", "medium"], ["Integrations", "Jira, Linear and Notion two-way sync.", "Raj (Eng)", "Week 51", "low"]] },
      ];
      quarters.forEach((q, c) => {
        const x = c * 380 - 50;
        out.push(frame(`q${c}`, x, 620, 340, 640, q.title, q.fill));
        q.cards.forEach(([t, d, o, due, p], i) => out.push(card(`c${c}-${i}`, x + 20, 650 + i * 196, 300, t, d, o, due, p, q.noteFill)));
      });
      return out;
    },
  },
  {
    id: "explainer3d",
    category: "3D",
    name: "3D explainer",
    blurb: "An interactive 3D solar system with fact cards. Double-click to explore.",
    color: 0x8b6cff,
    tag: "3D",
    build: () => {
      const planets: ReadonlyArray<[string, string, number, number, boolean]> = [
        ["Mercury", "#a39b91", 0.35, 3, false],
        ["Venus", "#e3b673", 0.6, 4.3, false],
        ["Earth", "#3d7bff", 0.65, 5.8, false],
        ["Mars", "#d4582f", 0.45, 7.2, false],
        ["Jupiter", "#d9a066", 1.5, 9.4, false],
        ["Saturn", "#e8cf8f", 1.2, 12, true],
      ];
      const spec = {
        title: "Our solar system",
        backdrop: "space",
        objects: [
          { shape: "planet", label: "Sun", color: "#ffb23f", position: [0, 0, 0], size: [3, 3, 3], motion: "spin", speed: 0.2, glow: true },
          ...planets.map(([label, color, d, r, rings]) => ({ shape: "planet", label, color, position: [r, 0, 0], size: [d, d, d], motion: "orbit", orbitRadius: r, speed: 0.8, rings })),
        ],
      };
      const facts: ReadonlyArray<[string, number]> = [
        ["☀️ The Sun holds 99.86% of the solar system's mass.", NOTE_COLORS.yellow],
        ["🌍 Light from the Sun takes 8 min 20 s to reach Earth.", NOTE_COLORS.blue],
        ["🪐 Saturn's rings are 280,000 km wide but only ~10 m thick.", NOTE_COLORS.orange],
        ["🔴 Mars has the tallest volcano known: Olympus Mons, 21.9 km.", NOTE_COLORS.pink],
      ];
      return [
        { key: "scene", props: { kind: "scene3d", x: 0, y: 0, w: 1100, h: 680, fill: INK, label: spec.title, data: JSON.stringify(spec) } },
        ...facts.map(([t, fill], i) => note(`fact${i}`, 1150, i * 172, t, fill, 320, 150)),
      ];
    },
  },
  {
    id: "kanban",
    category: "Planning",
    name: "Kanban board",
    blurb: "Sprint board with owners, due dates and priorities on every card.",
    color: 0x2f63ff,
    tag: "Plan",
    build: () => {
      const cols: ReadonlyArray<{ title: string; fill: number; noteFill: number; cards: ReadonlyArray<[string, string, string, string, "high" | "medium" | "low"]> }> = [
        { title: "To do", fill: 0x2f63ff, noteFill: NOTE_COLORS.blue, cards: [["Launch announcement", "Blog post, changelog and a 60-second demo video.", "Zoe", "Fri", "high"], ["Pricing page A/B test", "Annual-first vs monthly-first layout.", "Sam", "Mon", "medium"], ["Invite beta testers", "Email the 120 people on the waitlist.", "Maya", "Tue", "low"]] },
        { title: "In progress", fill: 0xef6b3a, noteFill: NOTE_COLORS.orange, cards: [["Polish onboarding", "Cut setup from 5 steps to 3; add a sample board.", "Raj", "Thu", "high"], ["Offline sync fixes", "Reconnect without losing edits on flaky Wi-Fi.", "Leo", "Wed", "high"]] },
        { title: "In review", fill: 0x7b55e7, noteFill: NOTE_COLORS.purple, cards: [["Export to PDF", "Frames become pages; vector text.", "Ana", "Today", "medium"]] },
        { title: "Done", fill: 0x1e8f5a, noteFill: NOTE_COLORS.green, cards: [["Dark theme", "Every screen, every chart.", "Zoe", "Shipped", "low"], ["Time travel", "Scrub the board's full history.", "Leo", "Shipped", "medium"]] },
      ];
      const out: TemplateShape[] = [];
      cols.forEach((col, c) => {
        const x = c * 380;
        out.push(frame(`col${c}`, x, 0, 340, Math.max(640, 60 + col.cards.length * 196), col.title, col.fill));
        col.cards.forEach(([t, d, o, due, p], i) => out.push(card(`k${c}-${i}`, x + 20, 30 + i * 196, 300, t, d, o, due, p, col.noteFill)));
      });
      return out;
    },
  },
  {
    id: "retro",
    category: "Workshops",
    name: "Team retro",
    blurb: "What went well, what to improve, ideas, and who does what next.",
    color: 0x1e8f5a,
    build: () =>
      columns(
        [
          { title: "Went well 🎉", fill: 0x1e8f5a, noteFill: NOTE_COLORS.green, notes: ["Shipped the API two days early", "Pairing on the sync bug saved a week", "Zero incidents during launch", "Customer calls every Thursday"] },
          { title: "To improve 🔧", fill: 0xef6b3a, noteFill: NOTE_COLORS.orange, notes: ["Too many meetings (14 h/person)", "Flaky end-to-end tests block merges", "Specs arrive after design starts"] },
          { title: "Ideas 💡", fill: 0x7b55e7, noteFill: NOTE_COLORS.purple, notes: ["Demo day every Friday", "No-meeting Wednesdays", "Rotate the on-call buddy"] },
          { title: "Action items ✅", fill: 0x2f63ff, noteFill: NOTE_COLORS.blue, notes: ["Alex: cap meetings at 25 min — by Mon", "Sam: quarantine flaky tests — by Wed", "Maya: spec template in Notion — by Fri"] },
        ],
        300,
      ),
  },
  {
    id: "flowchart",
    category: "Diagrams",
    name: "Flowchart",
    blurb: "A sign-up flow with decisions and retries. Arrows follow when you move things.",
    color: 0x7b55e7,
    build: () => [
      { key: "start", props: { kind: "ellipse", x: 0, y: 160, w: 200, h: 90, fill: NOTE_COLORS.green, label: "Visitor clicks Sign up" } },
      { key: "form", props: { kind: "rect", x: 290, y: 165, w: 220, h: 80, fill: NOTE_COLORS.blue, label: "Enter email + password" } },
      { key: "valid", props: { kind: "diamond", x: 600, y: 130, w: 200, h: 150, fill: NOTE_COLORS.yellow, label: "Valid?" } },
      { key: "mail", props: { kind: "rect", x: 890, y: 165, w: 220, h: 80, fill: NOTE_COLORS.blue, label: "Send verification email" } },
      { key: "click", props: { kind: "diamond", x: 1200, y: 130, w: 200, h: 150, fill: NOTE_COLORS.yellow, label: "Clicked within 24 h?" } },
      { key: "onboard", props: { kind: "rect", x: 1490, y: 165, w: 220, h: 80, fill: NOTE_COLORS.purple, label: "3-step onboarding" } },
      { key: "end", props: { kind: "ellipse", x: 1800, y: 160, w: 200, h: 90, fill: NOTE_COLORS.green, label: "First board created" } },
      { key: "err", props: { kind: "rect", x: 590, y: 420, w: 220, h: 80, fill: NOTE_COLORS.pink, label: "Show inline error" } },
      { key: "remind", props: { kind: "rect", x: 1190, y: 420, w: 220, h: 80, fill: NOTE_COLORS.orange, label: "Send reminder email" } },
      arrow("a1", "start", "form"),
      arrow("a2", "form", "valid"),
      arrow("a3", "valid", "mail", "Yes"),
      arrow("a4", "mail", "click"),
      arrow("a5", "click", "onboard", "Yes"),
      arrow("a6", "onboard", "end"),
      arrow("a7", "valid", "err", "No"),
      arrow("a8", "err", "form"),
      arrow("a9", "click", "remind", "No"),
      arrow("a10", "remind", "mail"),
    ],
  },
  {
    id: "mindmap",
    category: "Diagrams",
    name: "Mind map",
    blurb: "A product launch, mapped two levels deep.",
    color: 0xdd4f78,
    build: () => {
      const branches: ReadonlyArray<[string, readonly string[]]> = [
        ["Audience", ["Startup founders", "Product managers", "Agencies"]],
        ["Pricing", ["Free for 3 boards", "Pro $12/mo", "Team $20/seat"]],
        ["Channels", ["Product Hunt", "YouTube demos", "Partner newsletters"]],
        ["Timeline", ["Beta: May 6", "Launch: Jun 3", "Retro: Jun 17"]],
        ["Risks", ["Sync at scale", "Onboarding drop-off", "Competitor launch"]],
        ["Metrics", ["1,000 sign-ups", "40% week-1 retention", "50 paying teams"]],
      ];
      const fills = Object.values(NOTE_COLORS);
      const out: TemplateShape[] = [{ key: "core", props: { kind: "ellipse", x: -150, y: -75, w: 300, h: 150, fill: 0x111318, label: "Product launch" } }];
      branches.forEach(([label, leaves], i) => {
        const angle = (i / branches.length) * Math.PI * 2 - Math.PI / 2;
        const bx = Math.cos(angle) * 460;
        const by = Math.sin(angle) * 320;
        const fill = fills[i % fills.length] ?? NOTE_COLORS.yellow;
        out.push(note(`b${i}`, bx - 110, by - 40, label, fill, 220, 80));
        out.push(arrow(`e${i}`, "core", `b${i}`));
        leaves.forEach((leaf, j) => {
          const a = angle + (j - 1) * 0.3;
          const lx = Math.cos(a) * 820;
          const ly = Math.sin(a) * 560;
          out.push(note(`l${i}-${j}`, lx - 100, ly - 32, leaf, fill, 200, 64));
          out.push(arrow(`le${i}-${j}`, `b${i}`, `l${i}-${j}`));
        });
      });
      return out;
    },
  },
  {
    id: "brainstorm",
    category: "Workshops",
    name: "Brainstorm",
    blurb: "A frame full of ideas to get the team going.",
    color: 0xc98a12,
    build: () => {
      const ideas = ["Works fully offline", "AI that tidies the board", "Follow a teammate's view", "Comments pinned to shapes", "Templates for rituals", "Export to slides", "Emoji reactions", "Voice notes on cards", "Live 3D models", "Charts from a CSV", "Timer + dot voting", "Share a read-only link"];
      const fills = Object.values(NOTE_COLORS);
      const out: TemplateShape[] = [frame("frame", 0, 0, 1240, 760, "Brainstorm — how might we make planning fun?", 0xc98a12)];
      ideas.forEach((idea, i) => {
        const col = i % 5;
        const row = Math.floor(i / 5);
        out.push(note(`i${i}`, 30 + col * 240 + (row % 2) * 20, 40 + row * 230 + (col % 2) * 30, idea, fills[(i * 5) % fills.length], 200, 150));
      });
      return out;
    },
  },
];

export const TEMPLATES: readonly Template[] = [...CORE, ...LIBRARY];

export const templateById = (id: string | null | undefined): Template | undefined => TEMPLATES.find((t) => t.id === id);
