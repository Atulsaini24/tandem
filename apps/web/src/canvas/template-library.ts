import { SCENE_PRESETS } from "./scene-presets";
import { arrow, blocks, chart, columns, deck, FILLS, frame, NOTE_COLORS, note, scene, shape, text, tree, type TemplateShape } from "./template-kit";

/**
 * The template library beyond the classics: decks, dashboards, strategy canvases,
 * diagrams, workshops, 3D and education. Every one is a finished example with real content.
 */
export interface LibraryTemplate {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly color: number;
  readonly tag?: string;
  readonly category: TemplateCategory;
  build(): TemplateShape[];
}

export type TemplateCategory = "Presentations" | "Dashboards" | "Planning" | "Strategy" | "Diagrams" | "Workshops" | "3D" | "Education";
export const TEMPLATE_CATEGORIES: readonly TemplateCategory[] = ["Presentations", "Dashboards", "Planning", "Strategy", "Diagrams", "Workshops", "3D", "Education"];

const B = NOTE_COLORS;

// --- presentations ----------------------------------------------------------------------

const decks: LibraryTemplate[] = [
  {
    id: "qbr",
    name: "Quarterly business review",
    blurb: "Results, wins, misses and next-quarter bets in 7 slides.",
    color: 0x2f63ff,
    tag: "Slides",
    category: "Presentations",
    build: () =>
      deck("Q2 2026 business review", "paper", [
        { layout: "title", kicker: "Q2 2026", title: "Q2 review: our best quarter yet", subtitle: "Revenue up 34%, churn down to 2.1%, and three bets for Q3." },
        { layout: "stats", kicker: "Results", title: "The numbers that mattered", stats: [{ value: "$2.41M", label: "Revenue this quarter", delta: "+34% YoY" }, { value: "2.1%", label: "Monthly churn", delta: "-0.8 pts" }, { value: "71", label: "Net promoter score", delta: "+9" }], subtitle: "Growth came from expansion, not new logos: upsell is now 41% of new revenue." },
        { layout: "chart", kicker: "Revenue", title: "Every month beat the plan", subtitle: "June closed at $862k, 3% above target.", chart: { type: "area", unit: "$", labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"], series: [{ name: "Revenue $k", values: [612, 648, 701, 742, 806, 862] }, { name: "Target", values: [600, 640, 690, 740, 790, 840] }] }, items: [{ title: "Enterprise", text: "Three deals over $100k closed in June." }, { title: "Self-serve", text: "Trial-to-paid rose to 14%." }] },
        { layout: "cards", kicker: "Wins", title: "What went right", items: [{ icon: "🚀", title: "Launched Team plans", text: "1,240 teams upgraded in eight weeks." }, { icon: "🤝", title: "Partner channel", text: "Two resellers now bring 12% of pipeline." }, { icon: "⚡", title: "Faster onboarding", text: "Time to first value fell from 9 to 3 days." }] },
        { layout: "compare", kicker: "Misses", title: "What we'll fix", columns: [{ title: "Missed", items: ["EU launch slipped 6 weeks", "Support backlog peaked at 410", "Paid social CAC up 18%"] }, { title: "Fix in Q3", items: ["Frankfurt region live by Aug 15", "Two new support hires + AI triage", "Shift 30% of budget to content"] }] },
        { layout: "matrix", kicker: "Q3 bets", title: "Where we'll put our effort", axes: ["Effort", "Impact"], items: [{ icon: "🎯", title: "Usage-based pricing", text: "High impact, modest effort: ship in July." }, { icon: "🏗️", title: "Enterprise SSO", text: "High impact, high effort: plan carefully." }, { icon: "✨", title: "Template gallery", text: "Quick win for activation." }, { icon: "🧪", title: "Mobile app", text: "Park until Q4." }] },
        { layout: "closing", kicker: "Next steps", title: "Three bets, one goal: $3M in Q3", subtitle: "Owners and dates are in the roadmap board.", items: [{ icon: "📈", title: "Usage pricing" }, { icon: "🔐", title: "SSO" }, { icon: "🌍", title: "EU region" }] },
      ]),
  },
  {
    id: "launch-deck",
    name: "Product launch",
    blurb: "A bold neon launch keynote: problem, product, pricing, launch plan.",
    color: 0xff2fd6,
    tag: "Slides",
    category: "Presentations",
    build: () =>
      deck("Pulse — launch keynote", "neon", [
        { layout: "title", kicker: "Launch 2026", title: "Pulse: your music, mixed live by AI", subtitle: "The first DJ app that reads the room and mixes in real time." },
        { layout: "statement", kicker: "The idea", title: "Every party deserves a *world-class DJ*", subtitle: "Pulse listens to the crowd and adapts the set, song by song." },
        { layout: "process", kicker: "How it works", title: "From playlist to party in three steps", items: [{ icon: "🎧", title: "Connect your library", value: "10 sec", text: "Spotify, Apple Music or local files." }, { icon: "📡", title: "Pulse reads the room", value: "Live", text: "Tempo, energy and crowd noise, every second." }, { icon: "🎛️", title: "It mixes for you", value: "Seamless", text: "Beat-matched transitions, no gaps." }] },
        { layout: "pricing", kicker: "Pricing", title: "Simple plans for every party", items: [{ title: "Free", value: "₹0", text: "3 hours a month; basic transitions; ads" }, { title: "Pro", value: "₹299/mo", text: "Unlimited mixing; crowd sensing; no ads; offline mode" }, { title: "Venue", value: "₹2,499/mo", text: "Multiple zones; scheduling; analytics; priority support" }] },
        { layout: "timeline", kicker: "Rollout", title: "Launch plan", items: [{ title: "Jun 2 · Waitlist", text: "Invite 20,000 waitlist users." }, { title: "Jun 16 · Public", text: "App Store and Play Store." }, { title: "Jul · Venues", text: "30 partner clubs in Mumbai and Bengaluru." }, { title: "Sep · Global", text: "UK, UAE and Singapore." }] },
        { layout: "closing", kicker: "Join us", title: "Turn it up on June 16", subtitle: "Pre-order Pro today and get three months free.", items: [{ icon: "🎟️", title: "Join the waitlist" }, { icon: "📣", title: "Press kit" }] },
      ]),
  },
  {
    id: "marketing-deck",
    name: "Marketing strategy",
    blurb: "Audience, channels, budget and a 90-day plan.",
    color: 0xff6a3d,
    tag: "Slides",
    category: "Presentations",
    build: () =>
      deck("Bloom — 2026 marketing strategy", "sunset", [
        { layout: "title", kicker: "Marketing 2026", title: "Bloom: from local favorite to national brand", subtitle: "A 90-day plan to triple online orders for our plant-based snacks." },
        { layout: "team", kicker: "Audience", title: "Who we're talking to", items: [{ icon: "🧘", title: "Wellness Riya", value: "26 · Pune", text: "Gym regular, reads labels, orders on Swiggy Instamart." }, { icon: "👨‍👩‍👧", title: "Parent Arjun", value: "38 · Delhi", text: "Wants healthy tiffin snacks his kids will actually eat." }, { icon: "💼", title: "Office Meera", value: "31 · Bengaluru", text: "Buys for team pantries; cares about variety and price." }] },
        { layout: "chart", kicker: "Budget", title: "Where the ₹40 lakh goes", subtitle: "Creators and quick-commerce get 60% of spend.", chart: { type: "donut", unit: "%", labels: ["Creators", "Quick-commerce ads", "Search", "Sampling", "PR"], series: [{ name: "Share", values: [34, 26, 18, 14, 8] }] }, items: [{ title: "Creators", text: "120 micro-creators, ₹8–25k each." }, { title: "Sampling", text: "40 gyms and 25 offices." }] },
        { layout: "cards", kicker: "Channels", title: "Four channels, one story", items: [{ icon: "📱", title: "Instagram Reels", text: "3 recipes a week; creators remix our snacks into meals." }, { icon: "🛒", title: "Instamart & Blinkit", text: "Top-of-search placement in 6 cities." }, { icon: "🏋️", title: "Gym sampling", text: "Free packs after workouts, QR to order." }, { icon: "📰", title: "Founder story PR", text: "From a home kitchen to 40,000 orders." }] },
        { layout: "stats", kicker: "Goals", title: "What success looks like in 90 days", stats: [{ value: "3×", label: "Online orders", delta: "12k → 36k/mo" }, { value: "₹180", label: "Customer acquisition cost", delta: "-25%" }, { value: "38%", label: "Repeat purchase rate", delta: "+11 pts" }] },
        { layout: "closing", kicker: "Next", title: "Launch the first creator wave on Monday", items: [{ icon: "✅", title: "Approve budget" }, { icon: "🎬", title: "Brief creators" }] },
      ]),
  },
  {
    id: "sales-deck",
    name: "Sales proposal",
    blurb: "A client proposal with ROI, plan and pricing.",
    color: 0x36c6ff,
    tag: "Slides",
    category: "Presentations",
    build: () =>
      deck("Proposal for Fernway Logistics", "ocean", [
        { layout: "title", kicker: "Proposal", title: "Cut Fernway's delivery delays by 40%", subtitle: "Route AI for 1,200 vehicles across 14 depots." },
        { layout: "cards", kicker: "Your challenge", title: "What we heard from your team", items: [{ icon: "🚚", title: "18% late deliveries", text: "Mostly in the last mile, after 4 pm." }, { icon: "⛽", title: "Fuel up 22%", text: "Routes are planned by hand each morning." }, { icon: "📞", title: "4,000 calls a week", text: "Customers asking where their parcel is." }] },
        { layout: "stats", kicker: "ROI", title: "What changes in the first year", stats: [{ value: "₹3.2Cr", label: "Fuel and overtime saved", delta: "per year" }, { value: "40%", label: "Fewer late deliveries", delta: "18% → 11%" }, { value: "4.6 mo", label: "Payback period" }] },
        { layout: "timeline", kicker: "Rollout", title: "Live in 10 weeks", items: [{ title: "Weeks 1–2", text: "Connect fleet GPS and order data." }, { title: "Weeks 3–5", text: "Pilot in 2 depots." }, { title: "Weeks 6–8", text: "Train dispatchers, tune routes." }, { title: "Weeks 9–10", text: "All 14 depots live." }] },
        { layout: "pricing", kicker: "Investment", title: "Choose your plan", items: [{ title: "Pilot", value: "₹6L", text: "2 depots; 10 weeks; success criteria agreed up front" }, { title: "Growth", value: "₹38L/yr", text: "All 14 depots; live tracking page; dedicated success manager; quarterly review" }, { title: "Enterprise", value: "Custom", text: "Multi-country; on-prem option; SLA 99.95%" }] },
        { layout: "closing", kicker: "Next step", title: "Start the 2-depot pilot on July 1", items: [{ icon: "✍️", title: "Sign pilot order" }, { icon: "📅", title: "Kickoff call" }] },
      ]),
  },
  {
    id: "lesson-deck",
    name: "Lesson: intro to AI",
    blurb: "A classroom-ready lesson with concepts, steps and a quiz.",
    color: 0xc87bff,
    tag: "Slides",
    category: "Education",
    build: () =>
      deck("Intro to machine learning — Lesson 1", "royal", [
        { layout: "title", kicker: "Lesson 1", title: "How machines learn from examples", subtitle: "By the end of this lesson you'll train your first model — on paper." },
        { layout: "agenda", kicker: "Today", title: "What we'll cover", items: [{ title: "What learning means", text: "Patterns from examples" }, { title: "Training vs testing", text: "Why we hide some data" }, { title: "A tiny example", text: "Predicting house prices" }, { title: "Quiz", text: "Three quick questions" }] },
        { layout: "statement", kicker: "Big idea", title: "A model is a *pattern* learned from *examples*", subtitle: "Show it enough labeled examples and it can guess new ones." },
        { layout: "process", kicker: "Steps", title: "The machine learning loop", items: [{ icon: "📦", title: "Collect data", value: "Step 1", text: "Examples with the right answers." }, { icon: "🏋️", title: "Train", value: "Step 2", text: "The model adjusts to reduce mistakes." }, { icon: "🧪", title: "Test", value: "Step 3", text: "Check it on examples it never saw." }, { icon: "🚀", title: "Use it", value: "Step 4", text: "Make predictions on new data." }] },
        { layout: "chart", kicker: "Example", title: "Bigger houses, higher prices", subtitle: "The model learns this line from the dots.", chart: { type: "line", unit: "₹L", labels: ["600", "800", "1000", "1200", "1400", "1600"], series: [{ name: "Price (₹L) by sq ft", values: [42, 55, 68, 79, 93, 104] }] }, items: [{ title: "Slope", text: "About ₹6.2 lakh per 100 sq ft." }] },
        { layout: "cards", kicker: "Quiz", title: "Check your understanding", items: [{ icon: "❓", title: "Question 1", text: "Why do we keep some data for testing?" }, { icon: "❓", title: "Question 2", text: "What is a label?" }, { icon: "❓", title: "Question 3", text: "Give one example of ML in your phone." }] },
      ]),
  },
  {
    id: "esg-deck",
    name: "Sustainability report",
    blurb: "Emissions, progress and commitments, beautifully laid out.",
    color: 0x9be15d,
    tag: "Slides",
    category: "Presentations",
    build: () =>
      deck("Greenline — 2026 impact report", "forest", [
        { layout: "title", kicker: "Impact 2026", title: "Halfway to net zero", subtitle: "We cut emissions 48% since 2021 while revenue doubled." },
        { layout: "chart", kicker: "Emissions", title: "Emissions falling every year", subtitle: "Scope 1 and 2 down 48%; scope 3 is the next frontier.", chart: { type: "stacked", unit: "kt", labels: ["2021", "2022", "2023", "2024", "2025", "2026"], series: [{ name: "Scope 1", values: [18, 16, 13, 11, 9, 7] }, { name: "Scope 2", values: [24, 21, 17, 14, 12, 10] }] }, items: [{ title: "Solar", text: "62% of power from our own rooftops." }] },
        { layout: "stats", kicker: "Progress", title: "This year in numbers", stats: [{ value: "48%", label: "Lower emissions vs 2021", delta: "-9 pts this year" }, { value: "1.2M", label: "Trees planted with partners", delta: "+400k" }, { value: "91%", label: "Waste diverted from landfill", delta: "+6 pts" }] },
        { layout: "timeline", kicker: "Commitments", title: "The road to net zero", items: [{ title: "2027", text: "100% renewable electricity." }, { title: "2028", text: "Electric delivery fleet." }, { title: "2030", text: "Net zero scopes 1 and 2." }, { title: "2035", text: "Net zero across the value chain." }] },
        { layout: "quote", kicker: "Voices", title: "From our partners", quote: { text: "Greenline proved that cutting carbon and growing fast are not a trade-off.", author: "Dr. Anika Rao, Climate Partners India" } },
      ]),
  },
  {
    id: "onboarding-deck",
    name: "Team onboarding",
    blurb: "Welcome deck: mission, team, first 30 days.",
    color: 0x5b5b5b,
    tag: "Slides",
    category: "Presentations",
    build: () =>
      deck("Welcome to Tandem", "mono", [
        { layout: "title", kicker: "Welcome", title: "Welcome to the team", subtitle: "Everything you need for your first 30 days." },
        { layout: "statement", kicker: "Our mission", title: "Help every team *think together*, even offline", subtitle: "We build tools people love to open every morning." },
        { layout: "team", kicker: "Your people", title: "Who to ask about what", items: [{ title: "Maya Chen", value: "Product", text: "Roadmap, priorities, customer calls." }, { title: "Leo Park", value: "Engineering", text: "Code reviews, on-call, architecture." }, { title: "Zoe Ali", value: "Design", text: "Design system, research, prototypes." }, { title: "Sam Ortiz", value: "Growth", text: "Experiments, analytics, launches." }] },
        { layout: "timeline", kicker: "Your first month", title: "Your first 30 days", items: [{ title: "Day 1", text: "Laptop, accounts, lunch with your buddy." }, { title: "Week 1", text: "Ship a small fix to production." }, { title: "Week 2", text: "Sit in on 3 customer calls." }, { title: "Day 30", text: "Present one idea to the team." }] },
        { layout: "cards", kicker: "How we work", title: "Five habits we share", items: [{ icon: "✍️", title: "Write it down", text: "Decisions live in docs, not in chats." }, { icon: "🔁", title: "Ship small", text: "Many small releases beat one big one." }, { icon: "🙋", title: "Ask early", text: "Nobody expects you to know everything." }, { icon: "🎉", title: "Demo Fridays", text: "Show what you made this week." }] },
      ]),
  },
  {
    id: "case-study",
    name: "Customer case study",
    blurb: "Challenge, solution, results and a quote.",
    color: 0x2ee6b0,
    tag: "Slides",
    category: "Presentations",
    build: () =>
      deck("Case study — Medisync Clinics", "aurora", [
        { layout: "title", kicker: "Case study", title: "How Medisync cut patient wait times in half", subtitle: "42 clinics, 1 scheduling assistant, 6 months." },
        { layout: "compare", kicker: "Before & after", title: "What changed", columns: [{ title: "Before", items: ["54-minute average wait", "Phone-only booking", "18% no-shows", "Paper queues"] }, { title: "After", items: ["26-minute average wait", "WhatsApp booking 24/7", "7% no-shows with reminders", "Live queue on every phone"] }] },
        { layout: "stats", kicker: "Results", title: "Six months later", stats: [{ value: "52%", label: "Shorter waits" }, { value: "61%", label: "Fewer no-shows" }, { value: "₹1.4Cr", label: "Added yearly revenue" }] },
        { layout: "quote", kicker: "In their words", title: "What the team says", quote: { text: "Our waiting rooms are calm for the first time in ten years.", author: "Dr. Kavya Iyer, COO, Medisync" } },
      ]),
  },
];

// --- dashboards --------------------------------------------------------------------------

const dash = (id: string, name: string, blurb: string, color: number, title: string, charts: Array<Record<string, unknown>>): LibraryTemplate => ({
  id,
  name,
  blurb,
  color,
  tag: "Charts",
  category: "Dashboards",
  build: () => [
    frame("f", 0, 0, 1900, 1420, title, color),
    ...charts.map((c, i) => chart(`c${i}`, 40 + (i % 2) * 920, 60 + Math.floor(i / 2) * 680, 900, 640, c)),
  ],
});

const dashboards: LibraryTemplate[] = [
  dash("saas-metrics", "SaaS metrics", "MRR, churn, plan mix and top accounts.", 0x5b8cff, "SaaS metrics — FY2026", [
    { type: "area", palette: "ocean", title: "Monthly recurring revenue", unit: "$", note: "$k, end of month", kpis: [{ label: "MRR", value: "$486k", delta: "+9.2% MoM" }, { label: "ARR", value: "$5.8M", delta: "+71% YoY" }, { label: "NRR", value: "128%", delta: "+6 pts" }], labels: ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"], series: [{ name: "MRR", values: [212, 231, 252, 270, 291, 318, 336, 362, 389, 415, 445, 486] }], insight: "MRR more than doubled in 12 months; expansion drove 44% of new MRR." },
    { type: "line", palette: "sunset", title: "Logo and revenue churn", unit: "%", note: "Monthly", kpis: [{ label: "Logo churn", value: "2.1%", delta: "-0.9 pts" }, { label: "Revenue churn", value: "0.8%", delta: "-0.6 pts" }, { label: "Saved accounts", value: "37", delta: "+12" }], labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"], series: [{ name: "Logo churn", values: [3.0, 2.8, 2.6, 2.4, 2.2, 2.1] }, { name: "Revenue churn", values: [1.4, 1.3, 1.1, 1.0, 0.9, 0.8] }], insight: "Churn fell every month after the onboarding redesign shipped in February." },
    { type: "donut", palette: "vivid", title: "Revenue by plan", unit: "%", note: "Share of MRR", labels: ["Enterprise", "Business", "Team", "Starter"], series: [{ name: "Share", values: [46, 29, 17, 8] }], insight: "Enterprise is now nearly half of revenue from 7% of customers." },
    { type: "hbar", palette: "forest", title: "Top accounts by ARR", unit: "$", note: "$k", labels: ["Fernway", "Medisync", "Lumen Bank", "Orbit Air", "Kite Retail", "Nimbus"], series: [{ name: "ARR", values: [412, 338, 296, 241, 188, 154] }], insight: "Top 6 accounts hold 28% of ARR — watch concentration risk." },
  ]),
  dash("marketing-dash", "Marketing performance", "Channels, funnel, CAC and campaign scores.", 0xff6a3d, "Marketing performance — June", [
    { type: "stacked", palette: "sunset", title: "Leads by channel", note: "Weekly", kpis: [{ label: "Leads", value: "8,412", delta: "+22%" }, { label: "MQLs", value: "2,106", delta: "+17%" }, { label: "Cost / lead", value: "$14", delta: "-$3" }], labels: ["W1", "W2", "W3", "W4"], series: [{ name: "Organic", values: [820, 910, 1010, 1120] }, { name: "Paid", values: [640, 600, 700, 720] }, { name: "Referral", values: [380, 420, 460, 532] }], insight: "Organic overtook paid in week 2 and kept growing." },
    { type: "funnel", palette: "vivid", title: "Lead to customer", labels: ["Leads", "MQL", "SQL", "Opportunity", "Won"], series: [{ name: "People", values: [8412, 2106, 742, 318, 121] }], insight: "SQL → opportunity (43%) is healthy; MQL → SQL (35%) is the bottleneck." },
    { type: "bar", palette: "ocean", title: "Customer acquisition cost by channel", unit: "$", labels: ["Organic", "Referral", "Events", "Paid search", "Paid social"], series: [{ name: "CAC", values: [62, 88, 214, 236, 318] }], insight: "Paid social costs 5× organic per customer." },
    { type: "radar", palette: "neon", title: "Campaign scorecard", labels: ["Reach", "CTR", "Conversion", "Cost", "Brand lift", "Retention"], series: [{ name: "Summer launch", values: [9, 7, 6, 5, 8, 6] }, { name: "Spring promo", values: [6, 8, 7, 7, 5, 7] }], insight: "Summer launch won on reach and brand; spring promo converted better." },
  ]),
  dash("web-analytics", "Website analytics", "Traffic, sources, pages and conversion.", 0x22c3a6, "Website analytics — last 30 days", [
    { type: "area", palette: "forest", title: "Daily visitors", note: "Last 30 days, thousands", kpis: [{ label: "Visitors", value: "412k", delta: "+9%" }, { label: "Avg. time", value: "3m 12s", delta: "+18s" }, { label: "Bounce", value: "38%", delta: "-4 pts" }], labels: ["W1", "W2", "W3", "W4", "W5"], series: [{ name: "Visitors k", values: [82, 88, 91, 97, 104] }], insight: "Traffic grew every week; the pricing page redesign cut bounce by 4 points." },
    { type: "pie", palette: "vivid", title: "Traffic sources", unit: "%", labels: ["Search", "Direct", "Social", "Referral", "Email"], series: [{ name: "Share", values: [44, 22, 16, 11, 7] }], insight: "Search brings 44% of visits; email is small but converts best." },
    { type: "hbar", palette: "ocean", title: "Top pages", labels: ["/pricing", "/", "/templates", "/blog/ai-decks", "/docs", "/careers"], series: [{ name: "Views k", values: [96, 88, 61, 47, 33, 12] }], insight: "Pricing is the most-viewed page — keep it fast and clear." },
    { type: "funnel", palette: "sunset", title: "Sign-up funnel", labels: ["Visited", "Pricing", "Sign-up form", "Verified", "Activated"], series: [{ name: "Users", values: [412000, 96000, 18400, 12900, 7800] }], insight: "Only 19% of pricing visitors start the form." },
  ]),
  dash("finance-dash", "Personal finance", "Spending, savings, budget vs actual.", 0xffb547, "My money — 2026", [
    { type: "donut", palette: "sunset", title: "Where the money went", unit: "₹", note: "This month", labels: ["Rent", "Food", "Transport", "Shopping", "Bills", "Fun"], series: [{ name: "Spend", values: [22000, 9400, 3800, 6100, 4200, 3500] }], insight: "Rent is 45% of spending; food is the easiest place to save." },
    { type: "line", palette: "forest", title: "Savings growth", unit: "₹", kpis: [{ label: "Saved", value: "₹1.86L", delta: "+₹21k" }, { label: "Savings rate", value: "24%", delta: "+3 pts" }, { label: "Emergency fund", value: "4.2 mo", delta: "+0.6" }], labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"], series: [{ name: "Savings", values: [98000, 112000, 131000, 146000, 165000, 186000] }], insight: "On track for ₹3.5 lakh by December." },
    { type: "bar", palette: "vivid", title: "Budget vs actual", unit: "₹", labels: ["Food", "Transport", "Shopping", "Fun"], series: [{ name: "Budget", values: [10000, 4000, 5000, 4000] }, { name: "Actual", values: [9400, 3800, 6100, 3500] }], insight: "Shopping went ₹1,100 over budget; everything else came in under." },
    { type: "radar", palette: "ocean", title: "Financial health", labels: ["Savings", "Debt", "Investing", "Insurance", "Budgeting"], series: [{ name: "Score", values: [8, 9, 6, 5, 7] }], insight: "Insurance is the weakest area — compare health plans this month." },
  ]),
  dash("fitness-dash", "Fitness tracker", "Steps, sleep, workouts and goals.", 0xff5c8a, "Fitness — this month", [
    { type: "bar", palette: "neon", title: "Daily steps", kpis: [{ label: "Avg. steps", value: "9,420", delta: "+1,180" }, { label: "Best day", value: "Sat", delta: "15,206" }, { label: "Goal hit", value: "22/30", delta: "days" }], labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], series: [{ name: "Steps", values: [8200, 9100, 7600, 10400, 8800, 15206, 6640] }], insight: "Weekends are your best and worst days — plan a Sunday walk." },
    { type: "area", palette: "ocean", title: "Sleep (hours)", labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], series: [{ name: "Sleep", values: [6.4, 7.1, 6.8, 7.4, 5.9, 8.2, 7.6] }], insight: "Friday nights are short: 5.9 hours." },
    { type: "radar", palette: "vivid", title: "Workout balance", labels: ["Cardio", "Strength", "Mobility", "Core", "Endurance"], series: [{ name: "This month", values: [8, 6, 3, 5, 7] }, { name: "Goal", values: [7, 7, 6, 6, 7] }], insight: "Mobility is far below goal — add two yoga sessions a week." },
    { type: "donut", palette: "forest", title: "Activity mix", unit: "%", labels: ["Running", "Gym", "Cycling", "Yoga"], series: [{ name: "Share", values: [41, 33, 18, 8] }], insight: "Running dominates; cross-training lowers injury risk." },
  ]),
];

// --- planning & strategy ----------------------------------------------------------------

const planning: LibraryTemplate[] = [
  {
    id: "okrs",
    name: "OKRs",
    blurb: "Three objectives with measurable key results and owners.",
    color: 0x7b55e7,
    tag: "Plan",
    category: "Planning",
    build: () => {
      const objectives: Array<[string, number, number, string[]]> = [
        ["🎯 Delight new users", 0x2f63ff, B.blue, ["KR1: Time to first board under 2 min (now 4.5) — Maya", "KR2: Week-1 retention 45% (now 36%) — Raj", "KR3: NPS 60+ from new users — Zoe"]],
        ["📈 Grow revenue", 0x1e8f5a, B.green, ["KR1: $3M ARR (now $2.4M) — Sam", "KR2: 300 paying teams (now 212) — Sam", "KR3: Expansion = 40% of new MRR — Ana"]],
        ["🛡️ Be enterprise-ready", 0xef6b3a, B.orange, ["KR1: SSO + SCIM live — Leo", "KR2: SOC 2 Type II audit started — Ivy", "KR3: 99.95% uptime — Omar"]],
      ];
      return objectives.flatMap(([title, fill, nf, krs], i) => [
        frame(`o${i}`, i * 420, 0, 380, 560, title, fill),
        ...krs.map((kr, k) => note(`o${i}k${k}`, i * 420 + 20, 30 + k * 170, `${kr}\n\nProgress: ${["▰▰▰▱▱ 60%", "▰▰▱▱▱ 40%", "▰▰▰▰▱ 80%"][(i + k) % 3]}`, nf, 340, 150)),
      ]);
    },
  },
  {
    id: "gantt",
    name: "Project timeline",
    blurb: "A Gantt-style plan: workstreams across 12 weeks.",
    color: 0x22c3a6,
    tag: "Plan",
    category: "Planning",
    build: () => {
      const W = 110;
      const out: TemplateShape[] = [frame("f", 0, 0, 260 + 12 * W + 40, 640, "Website relaunch — 12 weeks", 0x22c3a6)];
      for (let w = 0; w < 12; w += 1) out.push(text(`w${w}`, 260 + w * W, 20, W, 30, `W${w + 1}`));
      const rows: Array<[string, number, number, number]> = [
        ["Research & interviews", 0, 2, B.purple],
        ["Information architecture", 1, 3, B.blue],
        ["Visual design", 3, 4, B.pink],
        ["Content writing", 3, 5, B.yellow],
        ["Front-end build", 5, 5, B.green],
        ["CMS migration", 7, 3, B.orange],
        ["QA & accessibility", 9, 2, B.blue],
        ["Launch 🚀", 11, 1, B.green],
      ];
      rows.forEach(([name, start, len, fill], i) => {
        out.push(text(`r${i}`, 24, 76 + i * 66, 220, 40, name));
        out.push(note(`bar${i}`, 260 + start * W, 72 + i * 66, name.split(" ")[0] ?? "", fill, len * W - 8, 48));
      });
      return out;
    },
  },
  {
    id: "eisenhower",
    name: "Eisenhower matrix",
    blurb: "Sort tasks by urgent and important.",
    color: 0xff5c8a,
    category: "Planning",
    build: () =>
      blocks([
        { x: 0, y: 0, w: 560, h: 400, title: "🔥 Do now — urgent & important", fill: 0xdd4f78, noteFill: B.pink, notes: ["Fix checkout bug", "Board deck due Friday", "Renew SSL certificate"] },
        { x: 600, y: 0, w: 560, h: 400, title: "📅 Schedule — important, not urgent", fill: 0x2f63ff, noteFill: B.blue, notes: ["Plan Q3 roadmap", "1:1s with the team", "Learn the new analytics tool"] },
        { x: 0, y: 440, w: 560, h: 400, title: "🤝 Delegate — urgent, not important", fill: 0xef6b3a, noteFill: B.orange, notes: ["Book venue for offsite", "Answer vendor emails"] },
        { x: 600, y: 440, w: 560, h: 400, title: "🗑️ Drop — neither", fill: 0x6c6f76, noteFill: B.yellow, notes: ["Reorganize old folders", "Optional webinar"] },
      ]),
  },
  {
    id: "sprint",
    name: "Sprint planning",
    blurb: "Sprint goal, capacity and a ready backlog.",
    color: 0x2f63ff,
    tag: "Plan",
    category: "Planning",
    build: () => [
      note("goal", 0, 0, "🎯 Sprint 24 goal\n\nTeams can share a read-only link to any board, and viewers see live cursors.", B.purple, 560, 150),
      note("cap", 600, 0, "👥 Capacity\n\n5 engineers × 8 days = 40 dev-days\nPlanned: 34 points · Buffer: 15%", B.yellow, 400, 150),
      ...columns([
        { title: "Backlog (ready)", fill: 0x6c6f76, noteFill: B.blue, notes: ["Share dialog: view-only toggle · 3 pts", "Signed link tokens · 5 pts", "Viewer presence avatars · 3 pts", "Rate-limit public links · 2 pts"] },
        { title: "Sprint", fill: 0x2f63ff, noteFill: B.green, notes: ["Read-only mode in editor · 5 pts", "Live cursors for viewers · 8 pts", "Copy link + QR code · 2 pts"] },
        { title: "Stretch", fill: 0xc98a12, noteFill: B.orange, notes: ["Password-protected links · 5 pts", "Link expiry dates · 3 pts"] },
      ]).map((s) => ({ ...s, props: { ...s.props, y: s.props.y + 200 } })),
    ],
  },
  {
    id: "swot",
    name: "SWOT analysis",
    blurb: "Strengths, weaknesses, opportunities, threats.",
    color: 0x1e8f5a,
    category: "Strategy",
    build: () =>
      blocks([
        { x: 0, y: 0, w: 560, h: 420, title: "💪 Strengths", fill: 0x1e8f5a, noteFill: B.green, notes: ["Works fully offline", "Local AI: private by design", "Real-time sync with no conflicts"] },
        { x: 600, y: 0, w: 560, h: 420, title: "⚠️ Weaknesses", fill: 0xef6b3a, noteFill: B.orange, notes: ["Small brand awareness", "No mobile app yet", "AI speed depends on the laptop"] },
        { x: 0, y: 460, w: 560, h: 420, title: "🌱 Opportunities", fill: 0x2f63ff, noteFill: B.blue, notes: ["Schools need private tools", "Remote teams in low-bandwidth regions", "Template marketplace"] },
        { x: 600, y: 460, w: 560, h: 420, title: "🌩️ Threats", fill: 0xdd4f78, noteFill: B.pink, notes: ["Big suites bundle whiteboards free", "Fast-moving AI competitors", "Pricing pressure"] },
      ]),
  },
  {
    id: "bmc",
    name: "Business model canvas",
    blurb: "All nine blocks, filled in for a real business.",
    color: 0x2f63ff,
    category: "Strategy",
    build: () => {
      const c = (x: number, y: number, w: number, h: number, title: string, fill: number, notes: string[]) => ({ x, y, w, h, title, fill, noteFill: B.yellow, notes });
      return blocks([
        c(0, 0, 300, 600, "🤝 Key partners", 0x6c6f76, ["Cloud provider", "Ollama community", "Resellers"]),
        c(320, 0, 300, 290, "⚙️ Key activities", 0x6c6f76, ["Product engineering", "Template design"]),
        c(320, 310, 300, 290, "🧰 Key resources", 0x6c6f76, ["CRDT engine", "Design system"]),
        c(640, 0, 340, 600, "💎 Value proposition", 0x2f63ff, ["Think together, even offline", "AI that never phones home", "Beautiful decks in minutes"]),
        c(1000, 0, 300, 290, "💬 Customer relationships", 0x7b55e7, ["Self-serve", "Community templates"]),
        c(1000, 310, 300, 290, "📣 Channels", 0x7b55e7, ["Product Hunt", "YouTube demos"]),
        c(1320, 0, 300, 600, "👥 Customer segments", 0x1e8f5a, ["Startups", "Schools", "Agencies"]),
        c(0, 620, 800, 300, "💸 Cost structure", 0xef6b3a, ["Engineering salaries (68%)", "Hosting (9%)"]),
        c(820, 620, 800, 300, "💰 Revenue streams", 0x1e8f5a, ["Pro $12/mo", "Team $20/seat"]),
      ]);
    },
  },
  {
    id: "lean",
    name: "Lean canvas",
    blurb: "Problem, solution, metrics, unfair advantage.",
    color: 0xef6b3a,
    category: "Strategy",
    build: () => {
      const c = (x: number, y: number, w: number, h: number, title: string, fill: number, notes: string[]) => ({ x, y, w, h, title, fill, noteFill: B.orange, notes });
      return blocks([
        c(0, 0, 300, 520, "😣 Problem", 0xdd4f78, ["Kirana owners lose 14% of sales to stock-outs", "Paper registers hide trends"]),
        c(320, 0, 300, 250, "💡 Solution", 0x2f63ff, ["WhatsApp inventory assistant"]),
        c(320, 270, 300, 250, "📏 Key metrics", 0x2f63ff, ["Weekly active stores", "Reorders per store"]),
        c(640, 0, 320, 520, "💎 Unique value", 0x7b55e7, ["Inventory that runs itself, inside WhatsApp"]),
        c(980, 0, 300, 250, "🛡️ Unfair advantage", 0x1e8f5a, ["Distributor network data"]),
        c(980, 270, 300, 250, "📣 Channels", 0x1e8f5a, ["Distributor sales reps"]),
        c(1300, 0, 300, 520, "👥 Customers", 0x1e8f5a, ["63M kirana stores", "Early adopters: Tier-2 cities"]),
        c(0, 540, 790, 260, "💸 Costs", 0xef6b3a, ["WhatsApp API fees", "Field team"]),
        c(810, 540, 790, 260, "💰 Revenue", 0xef6b3a, ["₹299/month per store"]),
      ]);
    },
  },
  {
    id: "journey",
    name: "Customer journey map",
    blurb: "Stages × actions, thoughts, feelings and opportunities.",
    color: 0x36c6ff,
    category: "Strategy",
    build: () => {
      const stages = ["Discover", "Sign up", "First board", "Invite team", "Pay"];
      const rows: Array<[string, number, string[]]> = [
        ["Actions", B.blue, ["Sees a demo on YouTube", "Signs up with Google", "Picks a template", "Shares a link", "Upgrades to Team"]],
        ["Thinking", B.purple, ["Is this better than Miro?", "Hope it's quick", "Wow, the AI made slides", "Will they join?", "Is it worth $20?"]],
        ["Feeling", B.yellow, ["😐 Curious", "🙂 Easy", "🤩 Delighted", "😬 Unsure", "🙂 Confident"]],
        ["Opportunity", B.green, ["Show offline mode", "Skip email verify", "Suggest the AI deck", "Invite reminders", "Annual discount"]],
      ];
      const out: TemplateShape[] = [];
      stages.forEach((s, i) => out.push(shape(`st${i}`, "rect", 200 + i * 300, 0, 280, 60, s, 0x111318)));
      rows.forEach(([name, fill, cells], r) => {
        out.push(text(`rl${r}`, 0, 100 + r * 150 + 40, 180, 40, name));
        cells.forEach((cell, i) => out.push(note(`c${r}-${i}`, 200 + i * 300, 100 + r * 150, cell, fill, 280, 120)));
      });
      return out;
    },
  },
  {
    id: "persona",
    name: "User persona",
    blurb: "Goals, frustrations, quote and a day in the life.",
    color: 0xb36bff,
    category: "Strategy",
    build: () => [
      shape("avatar", "ellipse", 0, 0, 220, 220, "👩🏽‍💻\nPriya, 29", B.purple),
      note("bio", 260, 0, "Product designer at a 40-person startup in Bengaluru. Works remote 3 days a week; flaky home Wi-Fi.", B.blue, 520, 120),
      note("quote", 260, 140, "“I lose my best ideas when the call drops and the whiteboard freezes.”", B.yellow, 520, 100),
      ...blocks([
        { x: 0, y: 280, w: 380, h: 330, title: "🎯 Goals", fill: 0x1e8f5a, noteFill: B.green, notes: ["Run workshops that feel alive", "Turn messy notes into a deck fast", "Keep work private"] },
        { x: 400, y: 280, w: 380, h: 330, title: "😤 Frustrations", fill: 0xdd4f78, noteFill: B.pink, notes: ["Tools freeze offline", "Making slides takes hours", "Too many tools"] },
      ]),
    ],
  },
  {
    id: "raci",
    name: "RACI chart",
    blurb: "Who's responsible, accountable, consulted, informed.",
    color: 0xffb547,
    category: "Planning",
    build: () => {
      const people = ["Maya (PM)", "Leo (Eng)", "Zoe (Design)", "Sam (Growth)"];
      const tasks: Array<[string, string[]]> = [
        ["Define scope", ["A", "C", "C", "I"]],
        ["Design screens", ["C", "C", "R", "I"]],
        ["Build features", ["I", "R", "C", "I"]],
        ["Launch plan", ["A", "I", "C", "R"]],
        ["Measure results", ["A", "I", "I", "R"]],
      ];
      const color: Record<string, number> = { R: B.green, A: B.pink, C: B.blue, I: B.yellow };
      const out: TemplateShape[] = [];
      people.forEach((p, i) => out.push(shape(`p${i}`, "rect", 280 + i * 200, 0, 180, 60, p, 0x111318)));
      tasks.forEach(([t, cells], r) => {
        out.push(text(`t${r}`, 0, 90 + r * 90 + 20, 260, 40, t));
        cells.forEach((c, i) => out.push(note(`c${r}${i}`, 280 + i * 200, 90 + r * 90, c, color[c] ?? B.yellow, 180, 70)));
      });
      out.push(note("key", 1100, 0, "R = Responsible\nA = Accountable\nC = Consulted\nI = Informed", B.purple, 240, 160));
      return out;
    },
  },
];

// --- diagrams ---------------------------------------------------------------------------

const diagrams: LibraryTemplate[] = [
  {
    id: "orgchart",
    name: "Org chart",
    blurb: "Leadership and teams as a connected tree.",
    color: 0x5b8cff,
    category: "Diagrams",
    build: () =>
      tree({
        label: "Aisha Khan\nCEO",
        fill: B.purple,
        children: [
          { label: "Leo Park\nCTO", children: [{ label: "Platform\n6 engineers", fill: B.green }, { label: "Product eng\n9 engineers", fill: B.green }] },
          { label: "Maya Chen\nCPO", children: [{ label: "Design\n4 designers", fill: B.pink }, { label: "Research\n2 researchers", fill: B.pink }] },
          { label: "Sam Ortiz\nCMO", children: [{ label: "Growth\n5 people", fill: B.orange }, { label: "Brand\n3 people", fill: B.orange }] },
        ],
      }),
  },
  {
    id: "architecture",
    name: "System architecture",
    blurb: "Clients, edge, services, data — with the request flow.",
    color: 0x22c3a6,
    category: "Diagrams",
    build: () => [
      frame("fe", 0, 0, 300, 560, "Clients", 0x2f63ff),
      shape("web", "rect", 30, 60, 240, 90, "🌐 Web app\nReact + WebGL", B.blue),
      shape("mobile", "rect", 30, 200, 240, 90, "📱 Mobile\n(PWA)", B.blue),
      shape("worker", "rect", 30, 340, 240, 90, "⚙️ Engine worker\nCRDT + IndexedDB", B.blue),
      frame("edge", 380, 0, 300, 560, "Edge", 0x7b55e7),
      shape("cdn", "rect", 410, 60, 240, 90, "CDN\nstatic assets", B.purple),
      shape("lb", "rect", 410, 240, 240, 90, "Load balancer\nWebSockets", B.purple),
      frame("svc", 760, 0, 340, 560, "Services", 0x1e8f5a),
      shape("sync", "rect", 790, 60, 280, 90, "Sync server ×N\nordered log", B.green),
      shape("auth", "rect", 790, 200, 280, 90, "Auth + share links", B.green),
      shape("ai", "rect", 790, 340, 280, 90, "Ollama\nlocal AI", B.green),
      frame("data", 1180, 0, 300, 560, "Data", 0xef6b3a),
      shape("pg", "rect", 1210, 60, 240, 90, "🐘 Postgres\nsnapshots + log", B.orange),
      shape("redis", "rect", 1210, 240, 240, 90, "Redis\nfan-out", B.orange),
      arrow("a1", "web", "cdn"),
      arrow("a2", "worker", "lb", "ops"),
      arrow("a3", "lb", "sync"),
      arrow("a4", "sync", "pg"),
      arrow("a5", "sync", "redis"),
      arrow("a6", "web", "ai", "prompts"),
    ],
  },
  {
    id: "fishbone",
    name: "Fishbone (root cause)",
    blurb: "Find why something keeps going wrong.",
    color: 0xdd4f78,
    category: "Diagrams",
    build: () => {
      const out: TemplateShape[] = [shape("head", "rect", 1240, 250, 260, 120, "😟 Late deliveries\n(18% of orders)", B.pink), shape("spine", "rect", 80, 302, 1150, 14, "", 0x111318)];
      const causes: Array<[string, string[]]> = [
        ["People", ["New drivers untrained", "Dispatcher overloaded"]],
        ["Process", ["Routes planned by hand", "No priority rules"]],
        ["Tools", ["GPS lags 5 min", "No live tracking page"]],
        ["Environment", ["Monsoon traffic", "Road works on NH48"]],
      ];
      causes.forEach(([cat, items], i) => {
        const x = 120 + i * 280;
        const top = i % 2 === 0;
        out.push(shape(`cat${i}`, "rect", x, top ? 20 : 500, 220, 70, cat, B.purple));
        items.forEach((t, k) => out.push(note(`it${i}${k}`, x + 20, top ? 110 + k * 90 : 330 + k * 90 - 0, t, B.yellow, 200, 70)));
      });
      return out;
    },
  },
  {
    id: "decision-tree",
    name: "Decision tree",
    blurb: "Choices and outcomes, branching left to right.",
    color: 0xffb547,
    category: "Diagrams",
    build: () =>
      tree(
        {
          label: "Build or buy\nanalytics?",
          kind: "diamond",
          fill: B.yellow,
          children: [
            { label: "Team has data engineers?", kind: "diamond", fill: B.yellow, children: [{ label: "✅ Build in-house\n6 months, full control", fill: B.green }, { label: "Hire 2 first\n+3 months", fill: B.orange }] },
            { label: "Budget over $50k/yr?", kind: "diamond", fill: B.yellow, children: [{ label: "✅ Enterprise BI tool\nlive in 4 weeks", fill: B.green }, { label: "Open-source stack\nMetabase + dbt", fill: B.blue }] },
          ],
        },
        240,
        110,
      ),
  },
  {
    id: "user-flow",
    name: "User flow",
    blurb: "Screens and decisions in an onboarding flow.",
    color: 0x7b6cff,
    category: "Diagrams",
    build: () => [
      shape("s1", "ellipse", 0, 140, 200, 90, "Open app", B.green),
      shape("s2", "rect", 280, 145, 220, 80, "Welcome screen", B.blue),
      shape("d1", "diamond", 580, 110, 200, 150, "Has account?", B.yellow),
      shape("s3", "rect", 860, 30, 220, 80, "Sign in", B.blue),
      shape("s4", "rect", 860, 260, 220, 80, "Create account", B.blue),
      shape("s5", "rect", 1160, 145, 220, 80, "Pick a template", B.purple),
      shape("s6", "ellipse", 1460, 140, 200, 90, "First board 🎉", B.green),
      arrow("a1", "s1", "s2"),
      arrow("a2", "s2", "d1"),
      arrow("a3", "d1", "s3", "Yes"),
      arrow("a4", "d1", "s4", "No"),
      arrow("a5", "s3", "s5"),
      arrow("a6", "s4", "s5"),
      arrow("a7", "s5", "s6"),
    ],
  },
];

// --- workshops --------------------------------------------------------------------------

const workshops: LibraryTemplate[] = [
  {
    id: "start-stop",
    name: "Start · Stop · Continue",
    blurb: "A fast retro format with real examples.",
    color: 0x1e8f5a,
    category: "Workshops",
    build: () =>
      columns([
        { title: "🟢 Start", fill: 0x1e8f5a, noteFill: B.green, notes: ["Writing decisions in one doc", "Demo every Friday", "Pairing on hard bugs"] },
        { title: "🔴 Stop", fill: 0xdd4f78, noteFill: B.pink, notes: ["Meetings without an agenda", "Merging on Friday evening"] },
        { title: "🔵 Continue", fill: 0x2f63ff, noteFill: B.blue, notes: ["Customer calls on Thursday", "Small, frequent releases", "Celebrating wins"] },
      ]),
  },
  {
    id: "crazy8",
    name: "Crazy 8s",
    blurb: "Eight ideas in eight minutes, one per box.",
    color: 0xff7a59,
    category: "Workshops",
    build: () => {
      const ideas = ["Swipe to vote", "Voice notes", "AI summary card", "Emoji reactions", "Timer + music", "Anonymous mode", "Idea of the day", "Photo to sticky"];
      return [frame("f", 0, 0, 1240, 640, "Crazy 8s — how might we make retros fun?", 0xff7a59), ...ideas.map((t, i) => note(`i${i}`, 30 + (i % 4) * 300, 40 + Math.floor(i / 4) * 300, `${i + 1}. ${t}`, FILLS[i % FILLS.length] ?? B.yellow, 270, 260))];
    },
  },
  {
    id: "meeting",
    name: "Meeting agenda",
    blurb: "Goal, timed agenda, decisions and action items.",
    color: 0x2f63ff,
    category: "Workshops",
    build: () => [
      note("goal", 0, 0, "🎯 Goal: agree on the Q3 launch date and owners", B.purple, 760, 90),
      ...columns([
        { title: "⏱️ Agenda (45 min)", fill: 0x2f63ff, noteFill: B.blue, notes: ["5' — Where we are", "15' — Launch risks", "15' — Date options", "10' — Owners & next steps"] },
        { title: "✅ Decisions", fill: 0x1e8f5a, noteFill: B.green, notes: ["Launch on Sep 9", "Beta to 500 users first"] },
        { title: "📌 Action items", fill: 0xef6b3a, noteFill: B.orange, notes: ["Maya: launch plan — Mon", "Leo: load test — Wed", "Sam: press list — Fri"] },
      ]).map((s) => ({ ...s, props: { ...s.props, y: s.props.y + 140 } })),
    ],
  },
  {
    id: "affinity",
    name: "Affinity map",
    blurb: "Raw research notes grouped into themes.",
    color: 0xb36bff,
    category: "Workshops",
    build: () =>
      blocks([
        { x: 0, y: 0, w: 380, h: 420, title: "Speed", fill: 0x2f63ff, noteFill: B.blue, notes: ["“Slides take me hours”", "“I want a first draft fast”", "“Exporting is slow”"] },
        { x: 400, y: 0, w: 380, h: 420, title: "Trust", fill: 0x1e8f5a, noteFill: B.green, notes: ["“Where does my data go?”", "“Our legal team says no cloud AI”", "“Offline is a must”"] },
        { x: 800, y: 0, w: 380, h: 420, title: "Collaboration", fill: 0xef6b3a, noteFill: B.orange, notes: ["“Hard to follow who's talking”", "“Need to vote quickly”", "“Comments get lost”"] },
      ]),
  },
];

// --- 3D -----------------------------------------------------------------------------------

const threeD: LibraryTemplate[] = SCENE_PRESETS.filter((p) => p.id !== "solar").map((p) => ({
  id: `3d-${p.id}`,
  name: p.name,
  blurb: `${p.blurb}. Double-click to explore.`,
  color: 0x8b6cff,
  tag: "3D",
  category: "3D" as const,
  build: () => [scene("scene", 0, 0, 1100, 680, p.spec), note("n", 1150, 0, `✨ ${p.name}\n\nDouble-click the scene to orbit with your mouse. Ask the AI's 3D mode to make your own.`, B.purple, 300, 200)],
}));

// --- education ----------------------------------------------------------------------------

const education: LibraryTemplate[] = [
  {
    id: "study-planner",
    name: "Weekly study planner",
    blurb: "Subjects, sessions and exam countdown for the week.",
    color: 0x22c3a6,
    tag: "Plan",
    category: "Education",
    build: () => {
      const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const sessions: string[][] = [
        ["📐 Maths: calculus ch. 4", "🧪 Chemistry lab notes"],
        ["📖 English essay draft", "📐 Maths practice set"],
        ["🧬 Biology: cells revision", "💻 Coding project"],
        ["🧪 Chemistry: organic", "📖 Read 30 pages"],
        ["📐 Mock test (2 h)", "🧘 Rest evening"],
        ["🔁 Review weak topics", "🎉 Plan next week"],
      ];
      return [
        note("exam", 0, -150, "⏳ Board exams in 42 days\nTarget: 2 hours focused study a day", B.pink, 520, 110),
        ...days.flatMap((d, i) => [frame(`d${i}`, i * 300, 0, 280, 360, d, 0x22c3a6), ...(sessions[i] ?? []).map((s, k) => note(`s${i}${k}`, i * 300 + 16, 24 + k * 150, s, FILLS[(i + k) % FILLS.length] ?? B.yellow, 248, 130))]),
      ];
    },
  },
  {
    id: "concept-map",
    name: "Concept map",
    blurb: "How the ideas in a topic connect: photosynthesis.",
    color: 0x9be15d,
    category: "Education",
    build: () => [
      shape("core", "ellipse", 520, 260, 280, 130, "🌿 Photosynthesis", B.green),
      shape("sun", "rect", 80, 40, 240, 90, "☀️ Sunlight\n(energy)", B.yellow),
      shape("water", "rect", 80, 470, 240, 90, "💧 Water\n(from roots)", B.blue),
      shape("co2", "rect", 1000, 40, 240, 90, "CO₂\n(from air)", B.purple),
      shape("glucose", "rect", 1000, 470, 240, 90, "🍬 Glucose\n(food)", B.orange),
      shape("o2", "rect", 540, 600, 240, 90, "O₂\n(released)", B.blue),
      shape("chloro", "rect", 540, 20, 240, 90, "Chlorophyll\n(in leaves)", B.green),
      arrow("a1", "sun", "core", "powers"),
      arrow("a2", "water", "core", "input"),
      arrow("a3", "co2", "core", "input"),
      arrow("a4", "core", "glucose", "makes"),
      arrow("a5", "core", "o2", "releases"),
      arrow("a6", "chloro", "core", "captures light"),
    ],
  },
];

export const LIBRARY: readonly LibraryTemplate[] = [...decks, ...dashboards, ...planning, ...diagrams, ...workshops, ...threeD, ...education];
