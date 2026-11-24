/**
 * A hand-drawn library of flat illustrations. Each subject is drawn in a 100×100 box from
 * a main colour and an accent; shades are derived, so any colour combination looks
 * deliberate. The AI composes scenes from these (it picks subjects, colours, layout and
 * text); it never draws coordinates itself, which small models do badly.
 */
import { mix } from "./svg-kit";

export const ART_ICONS = [
  "robot", "rocket", "house", "tree", "pine", "sun", "moon", "cloud", "mountain", "planet", "star", "heart",
  "lightbulb", "coffee", "laptop", "phone", "chart", "trophy", "gift", "car", "book", "cap", "globe", "shield",
  "coin", "shop", "person", "cat", "flower", "target",
] as const;
export type ArtIcon = (typeof ART_ICONS)[number];

export const ART_BACKGROUNDS = ["plain", "gradient", "sunset", "night", "sky", "hills", "space", "blob"] as const;
export type ArtBackground = (typeof ART_BACKGROUNDS)[number];

const dark = (c: string, k = 0.25): string => mix(c, "#000000", k);
const light = (c: string, k = 0.35): string => mix(c, "#ffffff", k);

type Draw = (c: string, a: string) => string;

const ICONS: Record<ArtIcon, Draw> = {
  robot: (c, a) =>
    `<rect x="47" y="6" width="6" height="12" rx="3" fill="${dark(c)}"/><circle cx="50" cy="6" r="5" fill="${a}"/><rect x="20" y="16" width="60" height="44" rx="14" fill="${c}"/><rect x="26" y="24" width="48" height="28" rx="10" fill="${dark(c, 0.55)}"/><circle cx="39" cy="38" r="6" fill="${a}"/><circle cx="61" cy="38" r="6" fill="${a}"/><circle cx="41" cy="36" r="2" fill="#fff"/><circle cx="63" cy="36" r="2" fill="#fff"/><path d="M42 47 Q50 52 58 47" stroke="${a}" stroke-width="3" fill="none" stroke-linecap="round"/><rect x="12" y="30" width="8" height="16" rx="4" fill="${dark(c)}"/><rect x="80" y="30" width="8" height="16" rx="4" fill="${dark(c)}"/><rect x="28" y="62" width="44" height="30" rx="10" fill="${light(c, 0.15)}"/><circle cx="50" cy="76" r="7" fill="${a}"/><path d="M28 70 Q12 66 8 50" stroke="${c}" stroke-width="8" fill="none" stroke-linecap="round"/><circle cx="8" cy="48" r="6" fill="${dark(c)}"/><path d="M72 70 Q84 78 88 90" stroke="${c}" stroke-width="8" fill="none" stroke-linecap="round"/>`,
  rocket: (c, a) =>
    `<path d="M50 4 C66 18 70 42 66 66 L34 66 C30 42 34 18 50 4 Z" fill="${c}"/><path d="M50 4 C58 12 62 22 64 32 L36 32 C38 22 42 12 50 4 Z" fill="${a}"/><circle cx="50" cy="44" r="9" fill="${light(c, 0.7)}" stroke="${dark(c)}" stroke-width="3"/><path d="M34 54 L18 72 L34 70 Z" fill="${a}"/><path d="M66 54 L82 72 L66 70 Z" fill="${a}"/><rect x="40" y="66" width="20" height="8" rx="3" fill="${dark(c)}"/><path d="M42 74 Q50 100 58 74 Z" fill="#ffb547"/><path d="M46 74 Q50 90 54 74 Z" fill="#fff3c4"/>`,
  house: (c, a) =>
    `<rect x="18" y="44" width="64" height="48" rx="3" fill="${c}"/><path d="M10 48 L50 14 L90 48 Z" fill="${a}"/><path d="M10 48 L50 14 L54 18 L18 50 Z" fill="${light(a, 0.2)}"/><rect x="64" y="20" width="10" height="18" fill="${dark(a)}"/><rect x="42" y="64" width="16" height="28" rx="2" fill="${dark(c, 0.4)}"/><circle cx="54" cy="79" r="1.6" fill="#ffd166"/><rect x="24" y="56" width="13" height="13" rx="2" fill="#bfe3ff"/><rect x="63" y="56" width="13" height="13" rx="2" fill="#bfe3ff"/><path d="M30.5 56 V69 M24 62.5 H37 M69.5 56 V69 M63 62.5 H76" stroke="${dark(c)}" stroke-width="1.5"/>`,
  tree: (c, a) =>
    `<rect x="45" y="58" width="10" height="34" rx="3" fill="${a}"/><circle cx="50" cy="40" r="26" fill="${c}"/><circle cx="34" cy="52" r="16" fill="${dark(c, 0.12)}"/><circle cx="66" cy="50" r="17" fill="${dark(c, 0.08)}"/><circle cx="42" cy="30" r="10" fill="${light(c, 0.2)}"/>`,
  pine: (c, a) =>
    `<rect x="45" y="76" width="10" height="18" rx="2" fill="${a}"/><path d="M50 6 L74 40 L26 40 Z" fill="${light(c, 0.12)}"/><path d="M50 22 L80 60 L20 60 Z" fill="${c}"/><path d="M50 40 L86 80 L14 80 Z" fill="${dark(c, 0.12)}"/>`,
  sun: (c) =>
    `${Array.from({ length: 12 }, (_, i) => `<rect x="47" y="2" width="6" height="16" rx="3" fill="${light(c, 0.2)}" transform="rotate(${i * 30} 50 50)"/>`).join("")}<circle cx="50" cy="50" r="28" fill="${c}"/><circle cx="42" cy="42" r="10" fill="${light(c, 0.35)}" opacity="0.7"/>`,
  moon: (c) => `<path d="M58 8 A42 42 0 1 0 92 62 A34 34 0 1 1 58 8 Z" fill="${c}"/><circle cx="34" cy="58" r="5" fill="${dark(c, 0.12)}"/><circle cx="48" cy="76" r="3.5" fill="${dark(c, 0.12)}"/><circle cx="28" cy="38" r="3" fill="${dark(c, 0.12)}"/>`,
  cloud: (c) => `<ellipse cx="50" cy="66" rx="40" ry="16" fill="${c}"/><circle cx="36" cy="54" r="18" fill="${c}"/><circle cx="58" cy="46" r="22" fill="${c}"/><circle cx="74" cy="60" r="14" fill="${c}"/><ellipse cx="50" cy="76" rx="36" ry="6" fill="${dark(c, 0.08)}"/>`,
  mountain: (c, a) => `<path d="M4 92 L38 30 L60 66 L72 48 L96 92 Z" fill="${c}"/><path d="M38 30 L48 48 L42 46 L36 52 L30 44 Z" fill="${a}"/><path d="M72 48 L80 62 L74 60 L70 64 L66 58 Z" fill="${a}"/><path d="M38 30 L60 66 L54 92 L4 92 Z" fill="${dark(c, 0.12)}"/>`,
  planet: (c, a) =>
    `<ellipse cx="50" cy="52" rx="46" ry="14" fill="none" stroke="${a}" stroke-width="6" transform="rotate(-18 50 52)"/><circle cx="50" cy="50" r="28" fill="${c}"/><path d="M24 44 Q50 36 76 46" stroke="${dark(c, 0.15)}" stroke-width="5" fill="none"/><path d="M26 58 Q50 52 74 60" stroke="${light(c, 0.2)}" stroke-width="4" fill="none"/><path d="M8 70 Q50 64 92 34" stroke="${a}" stroke-width="6" fill="none" stroke-linecap="round"/>`,
  star: (c) => `<path d="M50 6 L62 36 L94 38 L69 58 L77 90 L50 72 L23 90 L31 58 L6 38 L38 36 Z" fill="${c}" stroke="${dark(c, 0.15)}" stroke-width="3" stroke-linejoin="round"/><path d="M50 16 L58 38 L50 34 Z" fill="${light(c, 0.4)}"/>`,
  heart: (c) => `<path d="M50 88 C10 62 6 34 22 22 C34 12 46 18 50 30 C54 18 66 12 78 22 C94 34 90 62 50 88 Z" fill="${c}"/><path d="M28 30 C32 24 38 24 42 28" stroke="${light(c, 0.5)}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  lightbulb: (c, a) =>
    `${[0, 40, 80, 280, 320].map((r) => `<rect x="48" y="0" width="4" height="10" rx="2" fill="${c}" transform="rotate(${r} 50 42)"/>`).join("")}<path d="M50 12 C32 12 22 26 22 40 C22 52 30 58 34 66 L66 66 C70 58 78 52 78 40 C78 26 68 12 50 12 Z" fill="${c}"/><path d="M40 36 C40 28 46 24 50 24" stroke="${light(c, 0.6)}" stroke-width="5" fill="none" stroke-linecap="round"/><rect x="36" y="68" width="28" height="8" rx="3" fill="${a}"/><rect x="38" y="78" width="24" height="7" rx="3" fill="${dark(a)}"/><rect x="44" y="86" width="12" height="6" rx="3" fill="${dark(a, 0.4)}"/>`,
  coffee: (c, a) =>
    `<path d="M40 8 Q34 16 40 24 M52 8 Q46 16 52 24" stroke="${light(a, 0.3)}" stroke-width="4" fill="none" stroke-linecap="round"/><ellipse cx="46" cy="88" rx="36" ry="6" fill="${dark(c, 0.3)}" opacity="0.4"/><path d="M14 32 L78 32 L72 82 C71 88 66 90 62 90 L30 90 C26 90 21 88 20 82 Z" fill="${c}"/><path d="M78 42 C94 42 94 66 76 66" stroke="${c}" stroke-width="7" fill="none"/><rect x="12" y="28" width="68" height="8" rx="4" fill="${dark(c, 0.15)}"/><path d="M30 52 C36 46 46 56 54 50 C58 47 62 48 64 52" stroke="${a}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  laptop: (c, a) =>
    `<rect x="16" y="18" width="68" height="46" rx="5" fill="${dark(c, 0.3)}"/><rect x="21" y="23" width="58" height="36" rx="2" fill="${a}"/><rect x="27" y="29" width="24" height="5" rx="2" fill="#fff" opacity="0.9"/><rect x="27" y="38" width="38" height="4" rx="2" fill="#fff" opacity="0.6"/><rect x="27" y="46" width="30" height="4" rx="2" fill="#fff" opacity="0.6"/><path d="M6 68 L94 68 L88 80 L12 80 Z" fill="${c}"/><rect x="42" y="69" width="16" height="3" rx="1.5" fill="${dark(c)}"/>`,
  phone: (c, a) =>
    `<rect x="28" y="6" width="44" height="88" rx="10" fill="${dark(c, 0.35)}"/><rect x="32" y="14" width="36" height="68" rx="4" fill="${a}"/><rect x="44" y="9" width="12" height="2.5" rx="1.25" fill="${c}"/><circle cx="50" cy="88" r="3" fill="${c}"/><rect x="37" y="22" width="26" height="16" rx="3" fill="#fff" opacity="0.85"/><rect x="37" y="44" width="12" height="12" rx="3" fill="#fff" opacity="0.6"/><rect x="51" y="44" width="12" height="12" rx="3" fill="#fff" opacity="0.6"/><rect x="37" y="60" width="26" height="5" rx="2.5" fill="#fff" opacity="0.6"/>`,
  chart: (c, a) =>
    `<rect x="8" y="10" width="84" height="80" rx="10" fill="#ffffff"/><rect x="20" y="58" width="12" height="22" rx="3" fill="${light(c, 0.3)}"/><rect x="38" y="44" width="12" height="36" rx="3" fill="${c}"/><rect x="56" y="50" width="12" height="30" rx="3" fill="${light(c, 0.3)}"/><rect x="74" y="28" width="12" height="52" rx="3" fill="${c}"/><path d="M18 46 L40 30 L58 38 L84 16" stroke="${a}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="84" cy="16" r="4" fill="${a}"/>`,
  trophy: (c, a) =>
    `<path d="M28 10 L72 10 L70 40 C68 56 58 62 50 62 C42 62 32 56 30 40 Z" fill="${c}"/><path d="M28 16 C10 16 12 40 30 42 M72 16 C90 16 88 40 70 42" stroke="${c}" stroke-width="6" fill="none"/><path d="M36 16 L40 40" stroke="${light(c, 0.5)}" stroke-width="5" stroke-linecap="round"/><rect x="45" y="60" width="10" height="16" fill="${dark(c, 0.15)}"/><rect x="30" y="76" width="40" height="14" rx="3" fill="${a}"/><path d="M50 22 L54 30 L62 31 L56 37 L58 45 L50 41 L42 45 L44 37 L38 31 L46 30 Z" fill="${light(c, 0.55)}"/>`,
  gift: (c, a) =>
    `<rect x="14" y="40" width="72" height="52" rx="5" fill="${c}"/><rect x="10" y="28" width="80" height="16" rx="4" fill="${light(c, 0.15)}"/><rect x="44" y="28" width="12" height="64" fill="${a}"/><path d="M50 28 C40 10 22 14 30 26 C34 30 44 30 50 28 C56 30 66 30 70 26 C78 14 60 10 50 28 Z" fill="${a}"/>`,
  car: (c, a) =>
    `<path d="M10 62 L14 48 C16 42 20 40 26 40 L34 40 L44 26 C46 24 48 22 52 22 L70 22 C74 22 77 24 79 28 L86 42 C92 44 94 48 94 54 L94 62 Z" fill="${c}"/><path d="M38 40 L47 28 L60 28 L60 40 Z M64 28 L72 28 C75 28 76 30 78 34 L80 40 L64 40 Z" fill="${light(a, 0.5)}"/><rect x="8" y="60" width="88" height="10" rx="5" fill="${dark(c, 0.2)}"/><circle cx="28" cy="70" r="11" fill="#1d2029"/><circle cx="28" cy="70" r="4" fill="#c9ced6"/><circle cx="74" cy="70" r="11" fill="#1d2029"/><circle cx="74" cy="70" r="4" fill="#c9ced6"/><rect x="86" y="48" width="8" height="5" rx="2" fill="#ffe08a"/>`,
  book: (c, a) =>
    `<path d="M50 22 C38 14 22 14 10 18 L10 84 C22 80 38 80 50 88 Z" fill="${c}"/><path d="M50 22 C62 14 78 14 90 18 L90 84 C78 80 62 80 50 88 Z" fill="${dark(c, 0.12)}"/><path d="M18 30 C26 28 34 28 42 32 M18 42 C26 40 34 40 42 44 M58 32 C66 28 74 28 82 30 M58 44 C66 40 74 40 82 42" stroke="${light(c, 0.55)}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M68 16 L68 36 L74 31 L80 36 L80 15" fill="${a}"/>`,
  cap: (c, a) =>
    `<path d="M50 16 L96 36 L50 56 L4 36 Z" fill="${c}"/><path d="M24 46 L24 66 C24 76 76 76 76 66 L76 46 L50 58 Z" fill="${dark(c, 0.2)}"/><path d="M84 40 L84 66" stroke="${a}" stroke-width="3"/><circle cx="84" cy="70" r="5" fill="${a}"/><path d="M50 16 L96 36 L90 38 L50 22 L10 38 L4 36 Z" fill="${light(c, 0.15)}"/>`,
  globe: (c, a) =>
    `<circle cx="50" cy="50" r="38" fill="${c}"/><path d="M28 26 C36 30 34 40 42 42 C50 44 44 56 36 58 C30 60 26 68 22 62 C16 52 18 34 28 26 Z M62 18 C70 22 66 30 74 34 C82 38 86 50 80 56 C74 62 66 52 60 56 C54 60 58 72 50 76 C66 84 84 70 88 52 C90 36 78 20 62 18 Z" fill="${a}"/><ellipse cx="50" cy="50" rx="38" ry="38" fill="none" stroke="${dark(c, 0.2)}" stroke-width="3"/><circle cx="36" cy="30" r="8" fill="#fff" opacity="0.2"/>`,
  shield: (c, a) =>
    `<path d="M50 6 L86 20 L86 46 C86 70 68 86 50 94 C32 86 14 70 14 46 L14 20 Z" fill="${c}"/><path d="M50 6 L86 20 L86 46 C86 70 68 86 50 94 Z" fill="${dark(c, 0.12)}"/><path d="M34 50 L46 62 L68 38" stroke="${a}" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  coin: (c, a) =>
    `<ellipse cx="50" cy="56" rx="38" ry="38" fill="${dark(c, 0.2)}"/><circle cx="50" cy="50" r="38" fill="${c}"/><circle cx="50" cy="50" r="29" fill="none" stroke="${light(c, 0.35)}" stroke-width="4"/><text x="50" y="64" text-anchor="middle" font-family="Arial, sans-serif" font-size="40" font-weight="900" fill="${a}">₹</text>`,
  shop: (c, a) =>
    `<rect x="14" y="40" width="72" height="52" fill="#ffffff"/><path d="M8 24 L92 24 L92 40 Q86 48 79 40 Q72 48 65 40 Q58 48 50 40 Q42 48 35 40 Q28 48 21 40 Q14 48 8 40 Z" fill="${c}"/><path d="M8 24 L22 24 L21 40 Q14 48 8 40 Z M36 24 L50 24 L50 40 Q42 48 35 40 Z M64 24 L78 24 L79 40 Q72 48 65 40 Z" fill="${light(c, 0.55)}"/><rect x="22" y="56" width="26" height="36" rx="2" fill="${a}"/><rect x="56" y="56" width="22" height="18" rx="2" fill="#bfe3ff"/><rect x="10" y="12" width="80" height="12" rx="3" fill="${dark(c)}"/>`,
  person: (c, a) =>
    `<circle cx="50" cy="28" r="16" fill="#f1c7a3"/><path d="M34 26 C34 12 66 12 66 26 C60 20 42 20 34 26 Z" fill="#3b2a20"/><path d="M22 92 C22 64 34 52 50 52 C66 52 78 64 78 92 Z" fill="${c}"/><path d="M44 52 L50 64 L56 52 Z" fill="${a}"/><circle cx="44" cy="28" r="1.8" fill="#1d2029"/><circle cx="56" cy="28" r="1.8" fill="#1d2029"/><path d="M45 35 Q50 39 55 35" stroke="#1d2029" stroke-width="2" fill="none" stroke-linecap="round"/>`,
  cat: (c, a) =>
    `<path d="M24 34 L28 10 L42 26 Z M76 34 L72 10 L58 26 Z" fill="${c}"/><ellipse cx="50" cy="44" rx="28" ry="24" fill="${c}"/><ellipse cx="50" cy="78" rx="26" ry="18" fill="${c}"/><circle cx="40" cy="42" r="4" fill="${a}"/><circle cx="60" cy="42" r="4" fill="${a}"/><path d="M47 52 L53 52 L50 55 Z" fill="#ff8fab"/><path d="M30 52 L16 50 M30 56 L16 58 M70 52 L84 50 M70 56 L84 58" stroke="${dark(c, 0.35)}" stroke-width="2" stroke-linecap="round"/><path d="M74 84 C92 82 94 64 86 60" stroke="${c}" stroke-width="7" fill="none" stroke-linecap="round"/>`,
  flower: (c, a) =>
    `<path d="M50 56 L50 94" stroke="#3f8f4a" stroke-width="5"/><path d="M50 78 C62 68 72 72 74 76 C66 80 58 82 50 80 Z" fill="#3f8f4a"/>${[0, 72, 144, 216, 288].map((r) => `<ellipse cx="50" cy="22" rx="12" ry="18" fill="${c}" transform="rotate(${r} 50 40)"/>`).join("")}<circle cx="50" cy="40" r="11" fill="${a}"/>`,
  target: (c, a) =>
    `<circle cx="46" cy="54" r="38" fill="#ffffff"/><circle cx="46" cy="54" r="38" fill="none" stroke="${c}" stroke-width="10"/><circle cx="46" cy="54" r="19" fill="${c}"/><circle cx="46" cy="54" r="8" fill="#ffffff"/><path d="M46 54 L88 12" stroke="${dark(a)}" stroke-width="4"/><path d="M80 8 L92 8 L92 20 Z" fill="${a}"/>`,
};

export function drawIcon(icon: ArtIcon, color: string, accent: string): string {
  return ICONS[icon](color, accent);
}

/** Background art for a 400×400 illustration. */
export function drawBackground(style: ArtBackground, c1: string, c2: string): string {
  switch (style) {
    case "gradient":
      return `<defs><linearGradient id="bgg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="400" height="400" fill="url(#bgg)"/>`;
    case "sunset":
      return `<defs><linearGradient id="bgs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b2c6e"/><stop offset="0.55" stop-color="#ff7a59"/><stop offset="1" stop-color="#ffc58a"/></linearGradient></defs><rect width="400" height="400" fill="url(#bgs)"/><circle cx="300" cy="230" r="60" fill="#ffd29a" opacity="0.9"/><path d="M0 300 Q100 250 200 290 Q300 330 400 280 L400 400 L0 400 Z" fill="#5b3a6e"/><path d="M0 340 Q120 300 240 340 Q330 370 400 330 L400 400 L0 400 Z" fill="#2c1e45"/>`;
    case "night":
      return `<rect width="400" height="400" fill="#0f1530"/>${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 97) % 400}" cy="${(i * 61) % 260}" r="${(i % 3) * 0.6 + 0.8}" fill="#ffffff" opacity="${0.4 + (i % 4) * 0.15}"/>`).join("")}<path d="M0 330 Q200 290 400 330 L400 400 L0 400 Z" fill="#1c2550"/>`;
    case "sky":
      return `<defs><linearGradient id="bgk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd0ff"/><stop offset="1" stop-color="#e6f6ff"/></linearGradient></defs><rect width="400" height="400" fill="url(#bgk)"/><path d="M0 320 Q200 290 400 320 L400 400 L0 400 Z" fill="#8fd48a"/>`;
    case "hills":
      return `<defs><linearGradient id="bgh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light(c1, 0.5)}"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs><rect width="400" height="400" fill="url(#bgh)"/><path d="M0 300 Q90 230 190 290 Q290 340 400 270 L400 400 L0 400 Z" fill="${c2}"/><path d="M0 350 Q140 300 260 350 Q340 380 400 350 L400 400 L0 400 Z" fill="${dark(c2, 0.18)}"/>`;
    case "space":
      return `<defs><radialGradient id="bgp" cx="0.5" cy="0.4" r="0.8"><stop offset="0" stop-color="#2a2f6e"/><stop offset="1" stop-color="#070918"/></radialGradient></defs><rect width="400" height="400" fill="url(#bgp)"/>${Array.from({ length: 60 }, (_, i) => `<circle cx="${(i * 131) % 400}" cy="${(i * 89) % 400}" r="${(i % 3) * 0.6 + 0.7}" fill="#fff" opacity="${0.3 + (i % 5) * 0.14}"/>`).join("")}`;
    case "blob":
      return `<rect width="400" height="400" fill="${light(c1, 0.85)}"/><path d="M80 120 C120 40 280 40 330 110 C380 180 360 300 280 330 C200 360 90 340 60 270 C40 220 50 170 80 120 Z" fill="${light(c1, 0.55)}"/><circle cx="330" cy="70" r="18" fill="${light(c2, 0.4)}"/><circle cx="60" cy="330" r="12" fill="${light(c2, 0.4)}"/>`;
    default:
      return `<rect width="400" height="400" fill="${c1}"/>`;
  }
}
