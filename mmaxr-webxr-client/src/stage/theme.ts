import type { CosmosPalette, PlanetOptions, SoundMood, StarOptions } from "../ambience/index.js";

/** Nebula colours behind the sign-in pages: deep indigo with magenta filaments. */
export const LOGIN_PALETTE: CosmosPalette = {
  deep: "#04030e",
  mid: "#1a0d44",
  glow: "#6b2fd6",
  accent: "#ff4f9a",
};

/** Nebula colours behind the experiments page: deep blue with violet filaments. */
export const DASHBOARD_PALETTE: CosmosPalette = {
  deep: "#02050f",
  mid: "#0c1f4a",
  glow: "#2f6fe0",
  accent: "#b452ff",
};

/** A brief warm flash for a refused sign-in. */
export const DENY_PALETTE: CosmosPalette = {
  deep: "#0d0306",
  mid: "#3a0c1c",
  glow: "#c0304f",
  accent: "#ff7a59",
};

/** Dark, open chord for the sign-in pages (D minor 7, spread wide). */
export const LOGIN_MOOD: SoundMood = { rootMidi: 38, intervals: [0, 7, 12, 15, 22], brightness: 0.22 };

/** Bright, open chord for the experiments page (D 6/9). */
export const DASHBOARD_MOOD: SoundMood = { rootMidi: 38, intervals: [0, 7, 14, 16, 21], brightness: 0.45 };

/** How one subject appears on the experiments page: a star with its own chord. */
export interface SystemLook {
  readonly star: StarOptions;
  /** Star size in CSS pixels. */
  readonly size: number;
  readonly orbitColor: string;
  /** Chord the pad glides to while one of this subject's planets is in focus. */
  readonly mood: SoundMood;
  /** Accent colour for this subject's labels. */
  readonly accent: string;
}

const SYSTEMS: Readonly<Record<string, SystemLook>> = {
  physics: {
    star: { core: "#ffe7b8", edge: "#ff7f24", intensity: 1, spikes: 0.55, seed: 2.1 },
    size: 104,
    orbitColor: "#ffb36b",
    mood: { rootMidi: 33, intervals: [12, 19, 23, 26, 31], brightness: 0.62 },
    accent: "#ffc074",
  },
  chemistry: {
    star: { core: "#e6e1ff", edge: "#6d5cff", intensity: 1, spikes: 0.55, seed: 5.3 },
    size: 112,
    orbitColor: "#a99bff",
    mood: { rootMidi: 43, intervals: [0, 7, 14, 18, 21], brightness: 0.55 },
    accent: "#b9adff",
  },
  biology: {
    star: { core: "#e4ffef", edge: "#2fb57a", intensity: 1, spikes: 0.5, seed: 8.8 },
    size: 100,
    orbitColor: "#5fd9a0",
    mood: { rootMidi: 40, intervals: [0, 7, 11, 14, 16], brightness: 0.4 },
    accent: "#8fe7bd",
  },
  science: {
    star: { core: "#fff6e0", edge: "#ffb84d", intensity: 0.95, spikes: 0.45, seed: 6.4 },
    size: 96,
    orbitColor: "#ffd38a",
    mood: { rootMidi: 41, intervals: [0, 7, 9, 14, 19], brightness: 0.5 },
    accent: "#ffd99a",
  },
};

const FALLBACK_SYSTEM: SystemLook = {
  star: { core: "#f5f7ff", edge: "#9fb4ff", intensity: 0.8, spikes: 0.4 },
  size: 96,
  orbitColor: "#9fb4ff",
  mood: DASHBOARD_MOOD,
  accent: "#c4d0ff",
};

/** The star system for a subject id. Unknown subjects get a neutral blue-white star. */
export function systemLook(subjectId: string): SystemLook {
  return SYSTEMS[subjectId] ?? FALLBACK_SYSTEM;
}

/** Subjects in the order the experiments page shows them. */
export const SUBJECT_ORDER: readonly { readonly id: string; readonly label: string }[] = [
  { id: "physics", label: "Physics" },
  { id: "chemistry", label: "Chemistry" },
  { id: "biology", label: "Biology" },
  { id: "science", label: "General science" },
];

/** How one lab appears on the experiments page: a planet with its own colours and note. */
export interface PlanetLook {
  readonly planet: Omit<PlanetOptions, "lightFrom">;
  /** Planet size in CSS pixels. */
  readonly size: number;
  /** Nebula colours while this planet is in focus or being entered. */
  readonly palette: CosmosPalette;
  /** Bell note (MIDI) heard when the planet is pointed at. */
  readonly note: number;
}

/** One planet per lab type (`LessonSummary.type`). */
const PLANETS: Readonly<Record<string, PlanetLook>> = {
  // Indicators: a crystal world in acid pink and base teal.
  chemistry_indicators: {
    planet: { style: "crystal", colors: ["#3a0b52", "#ff5fa2", "#9dffea"], atmosphere: "#ff8fd0", spin: 0.07, tilt: 0.25, seed: 4.2 },
    size: 108,
    palette: { deep: "#10031a", mid: "#3a0b4a", glow: "#c2309a", accent: "#4fffd6" },
    note: 86,
  },
  // Metals: a copper gas giant with bright metallic rings.
  chemistry_metals: {
    planet: { style: "banded", colors: ["#2a1a10", "#c07a42", "#f4e6d2"], atmosphere: "#ffb06b", rings: { count: 2, color: "#ffc48a" }, spin: 0.1, tilt: 0.4, seed: 1.7 },
    size: 116,
    palette: { deep: "#0c0603", mid: "#3a1f0e", glow: "#c26a2a", accent: "#ffd9a0" },
    note: 79,
  },
  // Respiratory system: a rosy living world with pale blue air.
  biology_respiratory_system: {
    planet: { style: "ocean", colors: ["#3b0f22", "#e0607a", "#ffe4ea"], atmosphere: "#9fe2ff", spin: 0.06, tilt: 0.3, seed: 2.6 },
    size: 108,
    palette: { deep: "#12030a", mid: "#43112a", glow: "#d04670", accent: "#9fe2ff" },
    note: 84,
  },
  // Digestive system: a green world with a warm orange moon.
  biology_digestive_system: {
    planet: {
      style: "ocean",
      colors: ["#0f3a1f", "#5fae4c", "#fff1c9"],
      atmosphere: "#c8f08a",
      moon: { colors: ["#6a2a0e", "#f29b4b", "#fff0d8"], atmosphere: "#ffb877", size: 0.28 },
      spin: 0.05,
      tilt: 0.3,
      seed: 3.3,
    },
    size: 104,
    palette: { deep: "#03110a", mid: "#0d3b22", glow: "#2fb57a", accent: "#ffc65c" },
    note: 81,
  },
  // Optics: a clear ice-blue crystal that catches the light.
  physics_optics: {
    planet: { style: "crystal", colors: ["#0a1a4a", "#7fd6ff", "#ffffff"], atmosphere: "#bfe9ff", spin: 0.08, tilt: 0.2, seed: 7.1 },
    size: 100,
    palette: { deep: "#020818", mid: "#0b2a5c", glow: "#3aa0ff", accent: "#fff3a0" },
    note: 88,
  },
  // Waves and sound: a teal giant circled by ripple-like rings.
  physics_waves_sound: {
    planet: { style: "banded", colors: ["#06243a", "#1fa6a0", "#d8fff5"], atmosphere: "#6effe0", rings: { count: 4, color: "#7dffd8" }, spin: 0.12, tilt: 0.5, seed: 5.5 },
    size: 112,
    palette: { deep: "#01100f", mid: "#063b3a", glow: "#14b7a8", accent: "#a6fff0" },
    note: 76,
  },
  // Motion and forces: a fast orange storm world.
  physics_mechanics_sandbox: {
    planet: { style: "storm", colors: ["#240c05", "#b4461a", "#ffd76a"], atmosphere: "#ff9a3d", spin: 0.16, tilt: 0.3, seed: 7.9 },
    size: 120,
    palette: { deep: "#0b0402", mid: "#3d1406", glow: "#f06a1a", accent: "#ffd34d" },
    note: 74,
  },
  // Electromagnetism: a violet giant with red field-line rings.
  physics_electromagnetism: {
    planet: { style: "banded", colors: ["#1a0a3a", "#5a4cff", "#ff7a7a"], atmosphere: "#9c8cff", rings: { count: 3, color: "#ff6b6b" }, spin: 0.1, tilt: 0.6, seed: 9.3 },
    size: 108,
    palette: { deep: "#06031a", mid: "#231060", glow: "#6a3cff", accent: "#ff5a6e" },
    note: 83,
  },
  // Circuits: a golden storm world with current-like lightning.
  physics_circuits: {
    planet: { style: "storm", colors: ["#1a1400", "#c9a21a", "#fff6b0"], atmosphere: "#ffe45c", spin: 0.12, tilt: 0.25, seed: 3.8 },
    size: 104,
    palette: { deep: "#0a0800", mid: "#3a2e04", glow: "#e0b416", accent: "#fff27a" },
    note: 79,
  },
  // Simple machines: a steel-blue world with a small grey moon.
  physics_simple_machines: {
    planet: {
      style: "banded",
      colors: ["#1a2230", "#6c7f99", "#e6edf7"],
      atmosphere: "#b4c8e6",
      moon: { colors: ["#2a2a2a", "#a3a3a3", "#ffffff"], atmosphere: "#cfd8e6", size: 0.24 },
      spin: 0.07,
      tilt: 0.2,
      seed: 6.6,
    },
    size: 100,
    palette: { deep: "#03060c", mid: "#16243a", glow: "#4f78b0", accent: "#ffc07a" },
    note: 77,
  },
  // Fundamentals: a calm blue ocean world.
  physics_fundamentals_sandbox: {
    planet: { style: "ocean", colors: ["#071a46", "#2f6fe0", "#e4ecff"], atmosphere: "#8fb0ff", spin: 0.06, tilt: 0.35, seed: 8.2 },
    size: 96,
    palette: { deep: "#02050f", mid: "#0c2a5a", glow: "#2f6fe0", accent: "#9fe8ff" },
    note: 72,
  },
  // Bohr model: a violet giant circled by electron-shell rings.
  physics_bohr: {
    planet: { style: "banded", colors: ["#2a1670", "#7a5cff", "#bff4ff"], atmosphere: "#8f7bff", rings: { count: 3, color: "#6ff3ff" }, spin: 0.1, tilt: 0.4, seed: 1.1 },
    size: 110,
    palette: { deep: "#05031a", mid: "#1d0f56", glow: "#6a3cff", accent: "#3ee6ff" },
    note: 79,
  },
  // Atom Builder (MMAXR's look): a violet gas giant circled by electron-shell rings.
  chemistry_atom_builder: {
    planet: { style: "banded", colors: ["#2a1670", "#7a5cff", "#bff4ff"], atmosphere: "#8f7bff", rings: { count: 3, color: "#6ff3ff" }, spin: 0.1, tilt: 0.4, seed: 1.7 },
    size: 116,
    palette: { deep: "#05031a", mid: "#1d0f56", glow: "#6a3cff", accent: "#3ee6ff" },
    note: 79,
  },
  // Ionic Bonding (MMAXR's look): a crystal world in two alternating colours, with a bonded companion moon.
  chemistry_ionic_bonding: {
    planet: {
      style: "crystal",
      colors: ["#0b5566", "#a7fff0", "#ff6fd8"],
      atmosphere: "#5ff0e0",
      moon: { colors: ["#5a1a6e", "#ffb3ec", "#ffffff"], atmosphere: "#ff8fe0", size: 0.27 },
      spin: 0.07,
      tilt: 0.25,
      seed: 4.2,
    },
    size: 100,
    palette: { deep: "#021113", mid: "#073c48", glow: "#12b5a6", accent: "#ff5cc8" },
    note: 86,
  },
  // Plant vs Animal Cell (MMAXR's look): a living green world, with a soft pink moon for the animal cell.
  biology_cell_explorer: {
    planet: {
      style: "ocean",
      colors: ["#0f4a2a", "#4fae5c", "#f2fff0"],
      atmosphere: "#9df0b4",
      moon: { colors: ["#7a3b46", "#f0b9a8", "#fff4ef"], atmosphere: "#ffc9bd", size: 0.3 },
      spin: 0.06,
      tilt: 0.3,
      seed: 3.3,
    },
    size: 108,
    palette: { deep: "#03110a", mid: "#0d3b22", glow: "#2fb57a", accent: "#b8ff8a" },
    note: 84,
  },
  // Properties of matter: a lilac crystal with golden highlights.
  science_matter_properties: {
    planet: { style: "crystal", colors: ["#20103a", "#9a7bff", "#fff0c4"], atmosphere: "#d6c4ff", spin: 0.07, tilt: 0.3, seed: 2.9 },
    size: 104,
    palette: { deep: "#08041a", mid: "#24104e", glow: "#8a5cff", accent: "#ffd36b" },
    note: 81,
  },
};

const FALLBACK_PLANET: PlanetLook = {
  planet: { style: "banded", colors: ["#1b2a5a", "#5c7cff", "#e4ecff"], atmosphere: "#8fb0ff" },
  size: 104,
  palette: DASHBOARD_PALETTE,
  note: 74,
};

/** The planet for a lab type. New labs get a banded blue planet until they are given a look. */
export function planetLook(labType: string): PlanetLook {
  return PLANETS[labType] ?? FALLBACK_PLANET;
}

// Lab pages are addressed by lesson id, but their look belongs to the lab type. The experiments
// page records the pairing so a lab can open and close in its planet's colours.
const lessonTypes = new Map<string, string>();

/** Remember which lab type a lesson id belongs to. */
export function rememberLessonType(lessonId: string, labType: string): void {
  lessonTypes.set(lessonId, labType);
}

/** Nebula colours for a lesson id, or the experiments page colours when it is unknown. */
export function lessonPalette(lessonId: string): CosmosPalette {
  const type = lessonTypes.get(lessonId);
  return type ? planetLook(type).palette : DASHBOARD_PALETTE;
}

/** The giant planet rising at the bottom of the sign-in pages, backlit by a distant sun. */
export const LOGIN_HORIZON: Omit<PlanetOptions, "lightFrom"> = {
  style: "ocean",
  colors: ["#071a46", "#1d5c74", "#dff3ff"],
  atmosphere: "#5fd8ff",
  haloScale: 1.04,
  haloStrength: 1.5,
  lightDepth: -0.3,
  spin: 0.012,
  tilt: 0.12,
  seed: 3.3,
  segments: 64,
};

/** The distant sun above the sign-in horizon. */
export const LOGIN_SUN: StarOptions = {
  core: "#ffffff",
  edge: "#ff9ad6",
  intensity: 1.1,
  glowScale: 5,
  spikes: 0.9,
  seed: 9.1,
};
