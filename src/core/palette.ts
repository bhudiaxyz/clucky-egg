/**
 * Palette — every colour: a theme per farm, fixed sprite colours, and UI colours.
 *
 * Purpose
 *   Keeps colour out of the rendering and UI code, so a farm's whole look (platforms, plank
 *   tops, ladders, the copper-bar backdrop, the lamp) can be retuned in one place.
 *
 * Operations
 *   - THEMES / themeFor(n): each hand-built farmyard has its own theme (THEMES[n]); every other
 *     level (the later passes, generated farms) gets a seeded one (golden-ratio hue steps,
 *     random styles), so the same layout looks new on each pass. A theme sets the platform,
 *     plank, ladder and lift colours, the backdrop gradient (top to bottom), a glow accent
 *     (edge strips, lift lights), the platform texture, the back wall's rock and feature
 *     layer, ambient motes, and the hemisphere light's sky / ground tints.
 *   - COLORS: fixed colours for Harry, eggs, grain, the cage and the duck.
 *   - hdr(hex, k): a colour scaled above 1, for materials that should bloom.
 *   - applyUiColors(): writes COLORS.ui into CSS custom properties at start-up.
 *
 * Usage
 *   render/view.ts reads themeFor(game.n) on every build; styles.css reads the CSS vars.
 *
 * Highlights
 *   - Backdrops are horizontal "copper bars": the colour gradient an Amiga's copper co-processor
 *     drew by changing the palette every scan line. Here they are a canvas gradient on the back wall.
 *   - Egg colours cycle through EGG_CYCLE, which is what makes them glint.
 *
 * See also: render/view.ts, render/paint.ts, styles.css; DESIGN.md "11. Palette and themes".
 */
import * as THREE from "three";
import { rng } from "./random";

export type RockStyle = "mottled" | "strata" | "fractured" | "cobble" | "crystal";
export type BackStyle = "bars" | "strata" | "cave" | "stars" | "roots" | "veins";
export type MoteKind = "dust" | "spores" | "embers" | "drips" | "bubbles" | "glints";
/** Back-wall rock (natural, no masonry), painted procedurally (seeded per cavern) under the gradient. */
export type WallStyle = "rock" | "stone" | "rubble" | "marble" | "mud" | "fissured";

export interface Theme {
    name: string;
    rock: number;
    ledge: number;
    crumble: number;
    belt: number;
    /** Edge strips, portal and portal light. */
    glow: number;
    /** Backdrop gradient stops, top to bottom. */
    bars: string[];
    /** Rock block texture pattern. */
    rockStyle: RockStyle;
    /** What is painted on the back wall over the gradient. */
    back: BackStyle;
    /** The back wall's natural rock. */
    wall: WallStyle;
    /** Ambient particles drifting through the cavern, and their colour. */
    motes: MoteKind;
    mote: number;
    /** Hemisphere light: sky (from above) and ground (from below) tints. */
    sky: number;
    ground: number;
}

/** Compact theme rows: [name, rock, ledge, crumble, belt, glow, bars, rockStyle, back, motes, mote, sky, ground]. */
type Row = [
    string,
    number,
    number,
    number,
    number,
    number,
    string[],
    RockStyle,
    BackStyle,
    MoteKind,
    number,
    number,
    number,
];

/** Back-wall rock per hand-built farm, in level order. */
const WALLS: WallStyle[] = ["mud", "rubble", "stone", "rock", "fissured", "mud", "marble", "rubble"];

/** One theme per hand-built farm, in level order, each chosen to suit its name. */
const ROWS: Row[] = [
    [
        "Hen House",
        0x7a3a2a,
        0xd9a05b,
        0xe0b878,
        0x5d6b78,
        0xffb35c,
        ["#12051a", "#3a0f2e", "#7a2c2c", "#c2602f", "#1a0a12"],
        "mottled",
        "bars",
        "dust",
        0xffd0a0,
        0xffd8b0,
        0x40302a,
    ],
    [
        "Barn Loft",
        0x8a6a3e,
        0xe0c07a,
        0xe8d090,
        0x5a5a7a,
        0xffe07a,
        ["#140c04", "#3d2a0a", "#8a5a1a", "#e0a040", "#1a1206"],
        "strata",
        "roots",
        "dust",
        0xfff0c0,
        0xfff0d0,
        0x4a3a20,
    ],
    [
        "Lift Off",
        0x2e3a5a,
        0x7a9ad0,
        0xa0b8e0,
        0x6a5a48,
        0x7ad7ff,
        ["#030814", "#0b1d3d", "#1f4a7a", "#5a8fc0", "#06101e"],
        "fractured",
        "stars",
        "glints",
        0xffe2a0,
        0xc8d4ff,
        0x2a3040,
    ],
    [
        "Crossroads",
        0x3f5a35,
        0x8cbf5a,
        0xb8dc88,
        0x5a4d6b,
        0xb6ff6a,
        ["#030d06", "#0d2a14", "#24552a", "#6a9a3a", "#081208"],
        "cobble",
        "strata",
        "spores",
        0xe0ff90,
        0xd0ffc0,
        0x203020,
    ],
    [
        "Ladder Maze",
        0x3e2e52,
        0x9a7ac0,
        0xd0b0e8,
        0x4a6b5a,
        0xe07aff,
        ["#06020c", "#1a0a2e", "#3a1a5a", "#6a3a8a", "#0a0412"],
        "mottled",
        "roots",
        "spores",
        0xc0ff6a,
        0xe0c0ff,
        0x201830,
    ],
    [
        "Pit Stop",
        0x4a3a32,
        0x9a6a4a,
        0xc89a70,
        0x5a6a6a,
        0xff9a5a,
        ["#080404", "#1e100c", "#3a2018", "#6a3a22", "#0c0606"],
        "cobble",
        "cave",
        "drips",
        0xa0d0ff,
        0xf0c8b0,
        0x2a1a14,
    ],
    [
        "Skyway",
        0x4a5260,
        0xd0dcf0,
        0xe8f0ff,
        0x6a5a48,
        0xd0e8ff,
        ["#04060c", "#10162a", "#3a3060", "#a0608a", "#080a14"],
        "crystal",
        "stars",
        "glints",
        0xe8f0ff,
        0xe0e8ff,
        0x202838,
    ],
    [
        "Coop de Grace",
        0x4a1a22,
        0xe0b040,
        0xf0d070,
        0x3a3a52,
        0xffd040,
        ["#0a0204", "#2a0610", "#5a0a1e", "#c03a2a", "#10040a"],
        "crystal",
        "veins",
        "embers",
        0xffd060,
        0xffd0a0,
        0x400a14,
    ],
];

export const THEMES: Theme[] = ROWS.map(
    ([name, rock, ledge, crumble, belt, glow, bars, rockStyle, back, motes, mote, sky, ground], i) => ({
        wall: WALLS[i],
        name,
        rock,
        ledge,
        crumble,
        belt,
        glow,
        bars,
        rockStyle,
        back,
        motes,
        mote,
        sky,
        ground,
    })
);

const ROCK_STYLES: RockStyle[] = ["mottled", "strata", "fractured", "cobble", "crystal"];
const BACK_STYLES: BackStyle[] = ["bars", "strata", "cave", "stars", "roots", "veins"];
const MOTES: MoteKind[] = ["dust", "spores", "embers", "drips", "bubbles", "glints"];
export const WALL_STYLES: WallStyle[] = ["rock", "stone", "rubble", "marble", "mud", "fissured"];

/** A seeded theme for every farm without a hand-built one: its own hue, styles and motes. */
function generatedTheme(n: number): Theme {
    const r = rng(n * 7919 + 13);
    const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
    const col = (h: number, s: number, l: number) =>
        new THREE.Color().setHSL(((h % 1) + 1) % 1, s, l, THREE.SRGBColorSpace);
    const hex = (h: number, s: number, l: number) => col(h, s, l).getHex();
    const css = (h: number, s: number, l: number) => `#${col(h, s, l).getHexString()}`;
    // Golden-ratio hue steps keep neighbouring farms far apart on the colour wheel.
    const h = (n * 0.618034) % 1;
    const sat = 0.3 + r() * 0.4;
    const bh = h + (r() - 0.5) * 0.15;
    return {
        name: `Farm ${n + 1}`,
        rock: hex(h, sat * 0.6, 0.16 + r() * 0.1),
        ledge: hex(h + 0.04, sat, 0.55 + r() * 0.15),
        crumble: hex(h, sat * 0.6, 0.4),
        belt: hex(h + 0.5, 0.15, 0.4),
        glow: hex(h + (r() - 0.5) * 0.2, 1, 0.65),
        bars: [
            css(bh, 0.6, 0.03),
            css(bh, 0.6, 0.08),
            css(bh + 0.03, 0.55, 0.16),
            css(bh + 0.06, 0.6, 0.3),
            css(bh, 0.6, 0.04),
        ],
        rockStyle: pick(ROCK_STYLES),
        back: pick(BACK_STYLES),
        wall: pick(WALL_STYLES),
        motes: pick(MOTES),
        mote: hex(h + 0.1, 0.8, 0.75),
        sky: hex(h, 0.3, 0.78),
        ground: hex(h + 0.5, 0.3, 0.15),
    };
}


export const COLORS = {
    shirt: 0xe8473f,
    overalls: 0x2f6fd6,
    skin: 0xf0b890,
    straw: 0xe8c860,
    boots: 0x4a2e1c,
    lamp: 0xfff2c0,
    lampLight: 0xffe0a0,
    /** Lamp blink while the clock is nearly out. */
    lampDanger: 0xff3020,
    /** Landing / jump dust (dim so the additive sparks stay under the bloom threshold). */
    dust: 0x5a5046,
    egg: 0xfff1c9,
    eggCycle: [0xfff1c9, 0xffe9a8, 0xffffff, 0xffd25a, 0x9af0ff],
    seed: 0xf2b134,
    seedDark: 0xb97a1c,
    ladder: 0xd8a860,
    ladderDark: 0x8a5a2a,
    lift: 0xff9a3a,
    liftGlow: 0xffc27a,
    cage: 0x9aa4b8,
    cageGlow: 0xffd25a,
    eye: 0xff3a5a,
    feather: 0xfff8e8,
    ui: {
        bg: "#0b0716",
        ink: "#f6f0ff",
        dim: "#b3a6cf",
        accent: "#ffd25a",
        air: "#5ae0ff",
        danger: "#ff5a6a",
    },
};

export function themeFor(n: number): Theme {
    return n < THEMES.length ? THEMES[n] : generatedTheme(n);
}

/** Linear-space colour scaled by k (k > 1 crosses the bloom threshold). */
export function hdr(hex: number, k: number) {
    return new THREE.Color(hex).multiplyScalar(k);
}

export function applyUiColors() {
    const s = document.documentElement.style;
    for (const [k, v] of Object.entries(COLORS.ui)) s.setProperty(`--${k}`, v);
}
