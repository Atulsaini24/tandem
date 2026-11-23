import type { ChartType } from "./charts";
import type { SlideLayout } from "./slides";

/** Starter content for inserting a slide or chart by hand (then edit it in Studio). */
export const SAMPLE_SLIDES: Record<SlideLayout, Record<string, unknown>> = {
  title: { kicker: "2026", title: "Your big idea, in one bold line", subtitle: "One sentence that makes people lean in." },
  agenda: { kicker: "Agenda", title: "What we'll cover", items: [{ title: "Where we are", text: "The numbers so far" }, { title: "What we learned", text: "Three surprises" }, { title: "What's next", text: "The plan for Q3" }, { title: "Questions", text: "Open floor" }] },
  cards: { kicker: "Why it matters", title: "Three reasons this works", items: [{ icon: "⚡", title: "It's fast", text: "Ten times quicker than the old way." }, { icon: "🔒", title: "It's private", text: "Your data never leaves your device." }, { icon: "💛", title: "People love it", text: "NPS of 71 in the first month." }] },
  stats: { kicker: "Results", title: "The numbers that matter", stats: [{ value: "3×", label: "Faster onboarding", delta: "+200%" }, { value: "71", label: "Net promoter score", delta: "+9" }, { value: "$2.4M", label: "Annual revenue", delta: "+34% YoY" }], subtitle: "Growth came from teams inviting teams." },
  chart: { kicker: "Traction", title: "Growing every month", subtitle: "Up 3.4× in six months.", chart: { type: "area", unit: "", labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"], series: [{ name: "Active teams", values: [120, 168, 214, 276, 331, 412] }] }, items: [{ title: "Word of mouth", text: "61% of sign-ups were invited." }] },
  quote: { kicker: "Customers", title: "In their words", quote: { text: "It's the first tool our whole team opens every morning.", author: "Priya Raman, Head of Design" } },
  timeline: { kicker: "Roadmap", title: "Where we're going", items: [{ title: "Q1 · Beta", text: "500 teams, weekly releases." }, { title: "Q2 · Launch", text: "Public launch and pricing." }, { title: "Q3 · Teams", text: "Admin, SSO, billing." }, { title: "Q4 · Scale", text: "EU region and partners." }] },
  compare: { kicker: "Why us", title: "Before and after", columns: [{ title: "The old way", items: ["Hours of manual work", "Scattered files", "No single source of truth"] }, { title: "With us", items: ["Minutes, automated", "One shared board", "Always up to date"] }] },
  closing: { kicker: "Next steps", title: "Let's build it together", subtitle: "Pick a time and we'll show you a live demo.", items: [{ icon: "📅", title: "Book a demo" }, { icon: "✉️", title: "hello@example.com" }] },
  statement: { kicker: "Our belief", title: "Great ideas deserve *great tools*", subtitle: "Everything else follows from this." },
  team: { kicker: "Team", title: "The people behind it", items: [{ title: "Aisha Khan", value: "CEO", text: "Ex-founder, scaled to 2M users." }, { title: "Leo Park", value: "CTO", text: "Built real-time sync at scale." }, { title: "Maya Chen", value: "Design", text: "Led design at two unicorns." }] },
  pricing: { kicker: "Pricing", title: "Simple, fair pricing", items: [{ title: "Free", value: "$0", text: "3 boards; Local AI; Export PNG" }, { title: "Pro", value: "$12/mo", text: "Unlimited boards; AI decks & charts; 3D scenes; Priority sync" }, { title: "Team", value: "$20/seat", text: "Everything in Pro; Admin & SSO; Shared templates" }] },
  process: { kicker: "How it works", title: "From idea to done in four steps", items: [{ icon: "💡", title: "Capture", value: "Step 1", text: "Drop ideas on the board." }, { icon: "🧩", title: "Organize", value: "Step 2", text: "AI groups and links them." }, { icon: "🎞️", title: "Present", value: "Step 3", text: "Turn it into a deck." }, { icon: "🚀", title: "Ship", value: "Step 4", text: "Assign owners and dates." }] },
  matrix: { kicker: "Priorities", title: "Where to focus next", axes: ["Effort", "Impact"], items: [{ icon: "🎯", title: "Quick wins", text: "High impact, low effort: do now." }, { icon: "🏗️", title: "Big bets", text: "High impact, high effort: plan them." }, { icon: "🧹", title: "Fill-ins", text: "Low impact, low effort." }, { icon: "🛑", title: "Avoid", text: "Low impact, high effort." }] },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];

export function sampleChart(type: ChartType): Record<string, unknown> {
  const base = { type, title: "", unit: "", note: "Sample data — edit it in Studio", kpis: [] as unknown[], insight: "" };
  switch (type) {
    case "pie":
    case "donut":
      return { ...base, title: "Revenue by channel", unit: "%", labels: ["Organic", "Paid", "Partners", "Email"], series: [{ name: "Share", values: [42, 27, 19, 12] }], insight: "Organic brings in the largest share." };
    case "funnel":
      return { ...base, title: "Sign-up funnel", labels: ["Visited", "Signed up", "Activated", "Paid"], series: [{ name: "Users", values: [24000, 4100, 2300, 610] }], insight: "Activation is the biggest drop." };
    case "radar":
      return { ...base, title: "Product comparison", labels: ["Speed", "Price", "Design", "Support", "Features"], series: [{ name: "Us", values: [9, 7, 9, 8, 7] }, { name: "Competitor", values: [6, 8, 6, 7, 8] }], insight: "We lead on speed and design." };
    case "hbar":
      return { ...base, title: "Top products", unit: "$", labels: ["Pro plan", "Team plan", "Add-ons", "Services", "Training"], series: [{ name: "Revenue", values: [412, 338, 196, 124, 61] }], insight: "Pro brings in the most revenue." };
    case "stacked":
      return { ...base, title: "Revenue by region", unit: "$", labels: ["Q1", "Q2", "Q3", "Q4"], series: [{ name: "India", values: [120, 150, 190, 240] }, { name: "Europe", values: [80, 95, 110, 130] }, { name: "US", values: [60, 70, 85, 104] }], insight: "India grows fastest." };
    default:
      return {
        ...base,
        title: "Monthly revenue",
        unit: "$",
        kpis: [{ label: "Total", value: "$1.9M", delta: "+38%" }, { label: "Best month", value: "Jun", delta: "$412k" }, { label: "Growth", value: "+86%", delta: "Jan → Jun" }],
        labels: MONTHS,
        series: [{ name: "Revenue $k", values: [222, 268, 291, 338, 371, 412] }, ...(type === "line" || type === "area" ? [{ name: "Costs $k", values: [240, 251, 262, 270, 284, 296] }] : [])],
        insight: "Revenue passed costs in March and kept climbing.",
      };
  }
}
