/**
 * Ready-made 3D scenes for templates and the Insert panel. Each is a scene spec (see
 * scenes.ts); `compose()` still runs on them, so they follow the same rules as AI scenes.
 */
type O = Record<string, unknown>;

const o = (shape: string, label: string, color: string, position: number[], size: number[], extra: O = {}): O => ({ shape, label, color, position, size, motion: "none", ...extra });

export interface ScenePreset {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly spec: { title: string; backdrop: string; objects: O[] };
}

const planets: Array<[string, string, number, number, boolean]> = [
  ["Mercury", "#a39b91", 0.35, 3, false],
  ["Venus", "#e3b673", 0.6, 4.3, false],
  ["Earth", "#3d7bff", 0.65, 5.8, false],
  ["Mars", "#d4582f", 0.45, 7.2, false],
  ["Jupiter", "#d9a066", 1.5, 9.4, false],
  ["Saturn", "#e8cf8f", 1.2, 12, true],
];

export const SCENE_PRESETS: readonly ScenePreset[] = [
  {
    id: "solar",
    name: "Solar system",
    blurb: "Glowing sun, six planets, Saturn's rings",
    spec: {
      title: "Our solar system",
      backdrop: "space",
      objects: [
        o("planet", "Sun", "#ffb23f", [0, 0, 0], [3, 3, 3], { motion: "spin", speed: 0.2, glow: true }),
        ...planets.map(([label, color, d, r, rings]) => o("planet", label, color, [r, 0, 0], [d, d, d], { motion: "orbit", orbitRadius: r, speed: 0.8, rings })),
      ],
    },
  },
  {
    id: "city",
    name: "City at night",
    blurb: "Lit towers, park, traffic and a drone",
    spec: {
      title: "Downtown at night",
      backdrop: "night",
      objects: [
        o("plane", "", "#1b1f2a", [0, 0, 0], [26, 0.1, 26]),
        o("building", "HQ tower", "#2b3a55", [0, 3.5, 0], [2, 7, 2]),
        o("building", "", "#3a2f4f", [-3.4, 2.2, -1], [1.8, 4.4, 1.8]),
        o("building", "", "#2f4a4a", [3.4, 1.8, -0.6], [2, 3.6, 2]),
        o("building", "", "#404040", [-1, 1.3, -4.2], [2.2, 2.6, 1.6]),
        o("building", "", "#2b3a55", [2.8, 2.8, -4], [1.6, 5.6, 1.6]),
        o("building", "", "#352c45", [-4.6, 1.5, 2.6], [1.6, 3, 1.6]),
        o("tree", "", "#2f8f4e", [-1.8, 0.6, 3.6], [1.2, 1.2, 1.2]),
        o("tree", "", "#2f8f4e", [-0.6, 0.6, 4.2], [1, 1, 1]),
        o("pine", "", "#2a7a46", [4.6, 0.7, 3.2], [1, 1.4, 1]),
        o("car", "Taxi", "#ffc53d", [0, 0.25, 6], [1, 0.6, 0.6], { motion: "orbit", orbitRadius: 6.5, speed: 0.6 }),
        o("car", "", "#ff5a5a", [0, 0.25, 6], [1, 0.6, 0.6], { motion: "orbit", orbitRadius: 7.5, speed: 0.45 }),
        o("crystal", "AI core", "#7a6bff", [0, 8.4, 0], [0.9, 1.3, 0.9], { motion: "spin", glow: true }),
        o("rocket", "Drone", "#ff5a5a", [-5, 4, -3], [0.6, 1.2, 0.6], { motion: "float", speed: 1 }),
        o("server", "Data center", "#3b4252", [5.4, 0.9, 2], [1, 1.8, 0.8]),
        o("cloud", "", "#c9d2e6", [-4, 9, -6], [2.6, 1.2, 1.6], { motion: "float", speed: 0.3 }),
      ],
    },
  },
  {
    id: "nature",
    name: "Valley at sunset",
    blurb: "Mountains, forest, a cabin and clouds",
    spec: {
      title: "Valley at sunset",
      backdrop: "sunset",
      objects: [
        o("plane", "", "#6b7a4a", [0, 0, 0], [30, 0.1, 30]),
        o("mountain", "Peak", "#7b6a62", [-4, 3, -7], [8, 6, 8]),
        o("mountain", "", "#8a786e", [4, 2.2, -8], [7, 4.4, 7]),
        o("mountain", "", "#6e5f58", [9, 1.8, -5], [5, 3.6, 5]),
        o("house", "Cabin", "#c98d5a", [1.5, 0.6, 2], [1.6, 1.2, 1.4]),
        ...[-5, -3.5, -2, 4.5, 6, 3.5, -6.5].map((x, i) => o(i % 2 ? "pine" : "tree", "", i % 2 ? "#2f6b3e" : "#4a8f3a", [x, 0.8, 1 + (i % 3) * 1.6], [1.1, 1.6, 1.1])),
        o("cloud", "", "#ffe3d0", [-3, 8, -4], [3, 1.2, 1.8], { motion: "float", speed: 0.25 }),
        o("cloud", "", "#ffd6c0", [5, 9, -2], [2.6, 1.1, 1.6], { motion: "float", speed: 0.2 }),
        o("person", "Hiker", "#3d7bff", [0, 0.45, 4], [0.5, 0.9, 0.5], { motion: "bob", speed: 0.5 }),
      ],
    },
  },
  {
    id: "product",
    name: "Product showcase",
    blurb: "Studio-lit hero product on a turntable",
    spec: {
      title: "Product showcase",
      backdrop: "studio",
      objects: [
        o("cylinder", "", "#2a2d35", [0, 0.15, 0], [6, 0.3, 6], { material: "metal" }),
        o("crystal", "Aurora One", "#7a6bff", [0, 2, 0], [1.6, 2.4, 1.6], { motion: "spin", speed: 0.5, glow: true, material: "glass" }),
        o("torus", "", "#ffcf5c", [0, 2, 0], [3.4, 0.4, 3.4], { motion: "spin", speed: -0.3, material: "metal" }),
        o("sphere", "Sensor", "#22e5ff", [2.6, 1, 1], [0.6, 0.6, 0.6], { material: "glass", glow: true, motion: "bob" }),
        o("box", "Charger", "#f2f2f2", [-2.4, 0.55, 1.2], [1, 0.5, 1], { material: "plastic" }),
      ],
    },
  },
  {
    id: "datacenter",
    name: "Data center",
    blurb: "Server racks with blinking lights",
    spec: {
      title: "Data center",
      backdrop: "night",
      objects: [
        o("plane", "", "#151a24", [0, 0, 0], [20, 0.1, 20]),
        ...[-4.5, -1.5, 1.5, 4.5].flatMap((x, i) => [o("server", i === 0 ? "Rack A" : "", "#2b3240", [x, 1.2, -2], [1.2, 2.4, 1]), o("server", i === 3 ? "Rack H" : "", "#2b3240", [x, 1.2, 2], [1.2, 2.4, 1])]),
        o("crystal", "Load balancer", "#36c6ff", [0, 3.6, 0], [0.8, 1.2, 0.8], { glow: true, motion: "spin" }),
        o("ring", "", "#36c6ff", [0, 0.06, 0], [7, 0.2, 7], { motion: "spin", speed: 0.2 }),
        o("person", "Engineer", "#ffb020", [0, 0.45, 4.6], [0.5, 0.9, 0.5]),
      ],
    },
  },
  {
    id: "launch",
    name: "Rocket launch",
    blurb: "A rocket lifting off past the clouds",
    spec: {
      title: "Launch day",
      backdrop: "sky",
      objects: [
        o("plane", "", "#7a8f6a", [0, 0, 0], [24, 0.1, 24]),
        o("rocket", "Starship", "#ff5a5a", [0, 4, 0], [1.4, 4, 1.4], { motion: "float", speed: 0.6 }),
        o("cylinder", "Launch pad", "#8a8f98", [0, 0.2, 0], [3.6, 0.4, 3.6], { material: "metal" }),
        o("box", "Tower", "#c9ced6", [-1.8, 3, 0], [0.5, 6, 0.5], { material: "metal" }),
        o("cloud", "", "#ffffff", [-3, 6, -2], [3, 1.3, 2], { motion: "float", speed: 0.2 }),
        o("cloud", "", "#f1f4f9", [3.5, 7.5, -3], [2.6, 1.2, 1.6], { motion: "float", speed: 0.25 }),
        o("building", "Mission control", "#d7dbe3", [5.5, 1, 3], [2.4, 2, 1.8]),
        o("tree", "", "#3f8f4a", [-5, 0.7, 4], [1.2, 1.4, 1.2]),
        o("tree", "", "#3f8f4a", [-6.2, 0.6, 2.6], [1, 1.2, 1]),
      ],
    },
  },
];

export const scenePreset = (id: string): ScenePreset | undefined => SCENE_PRESETS.find((p) => p.id === id);
