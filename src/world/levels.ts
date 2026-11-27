/**
 * Levels — the eight hand-built farmyards and the tile grid they parse into.
 *
 * Purpose
 *   Content as data. Each LevelSpec lists, tier by tier, where the platforms are, then ladders,
 *   eggs, grain, hens and lifts. parse() turns a spec into a Level: a 26 × 24 tile grid plus
 *   pixel positions for everything that moves or can be picked up.
 *
 * Operations
 *   - LEVELS: the eight specs (the 40-level game is these eight, five passes over).
 *   - parse(spec): builds the Level. Five platform tiers sit on rows 6, 10, 14, 18 and 22,
 *     four rows apart. A ladder joins tier t to tier t+1: its top cell ('T') replaces the
 *     platform cell, the rest ('H') hang above the lower platform.
 *
 * Tile legend
 *   '#' platform (solid)   'H' ladder   'T' a ladder cell on a platform row: climbable and
 *   standable, so a ladder can pass through a platform and be left there.   '.' air.
 *   Everything else is an object, not a tile.
 *
 * Usage
 *   world/farms.ts picks the level for a run (hand-built or generated); render/view.ts draws the tiles.
 *
 * Highlights
 *   - Cells are 8 game pixels; positions are floats in game pixels, y growing downwards.
 *   - Wherever a jump is the only way across, the gap is at most two cells (scripts/check.ts
 *     proves every egg and pile of grain reachable that way).
 *   - The cage sits in the top-left corner (rows 1-4, columns 1-4), which no level uses.
 *
 * See also: scripts/check.ts (reachability proof), core/physics.ts; DESIGN.md "4. Levels".
 */
export const W = 26;
export const H = 24;
export const CELL = 8;

/** Rows of the five platform tiers. */
export const TIER_ROWS = [6, 10, 14, 18, 22];

type Span = [number, number];
type At = [number, number]; // [column, tier]

export interface LevelSpec {
    name: string;
    /** Per tier, inclusive column spans of platform. */
    tiers: [Span[], Span[], Span[], Span[], Span[]];
    /** [column, upper tier]: a ladder from that tier down to the next one. */
    ladders: At[];
    eggs: At[];
    seeds: At[];
    hens: At[];
    start: At;
    /** Lifts: left column and a 0..1 phase along the shaft. */
    lifts?: { c: number; phase: number }[];
    /** Bonus the timer starts at (ten points a second). */
    time: number;
}

export const LEVELS: LevelSpec[] = [
    {
        name: "Hen House",
        tiers: [[[5, 20]], [[2, 11], [14, 23]], [[1, 22]], [[1, 9], [12, 20]], [[0, 25]]],
        ladders: [[7, 0], [17, 0], [4, 1], [20, 1], [8, 2], [18, 2], [3, 3], [14, 3]],
        eggs: [[6, 0], [12, 0], [19, 0], [3, 1], [10, 1], [16, 1], [22, 1], [5, 2], [13, 2], [21, 2], [4, 3], [16, 3]],
        seeds: [[9, 0], [15, 0], [8, 1], [21, 1], [2, 2], [11, 2], [17, 2], [6, 3], [19, 3], [12, 4]],
        hens: [[10, 0], [18, 1], [6, 2], [15, 3]],
        start: [13, 4],
        time: 900,
    },
    {
        name: "Barn Loft",
        tiers: [
            [[1, 4], [7, 12], [15, 20], [23, 25]],
            [[2, 8], [11, 17], [20, 25]],
            [[1, 4], [7, 16], [19, 22]],
            [[2, 9], [12, 19]],
            [[0, 8], [11, 15], [19, 25]],
        ],
        ladders: [[3, 0], [12, 0], [24, 0], [3, 1], [14, 1], [21, 1], [8, 2], [3, 2], [14, 2], [5, 3], [13, 3], [19, 3]],
        eggs: [[2, 0], [9, 0], [17, 0], [24, 0], [4, 1], [13, 1], [22, 1], [2, 2], [12, 2], [20, 2], [5, 3], [16, 3]],
        seeds: [[11, 0], [19, 0], [7, 1], [15, 1], [23, 1], [9, 2], [15, 2], [3, 3], [18, 3], [12, 4]],
        hens: [[9, 0], [14, 1], [11, 2], [6, 3]],
        start: [4, 4],
        time: 900,
    },
    {
        name: "Lift Off",
        tiers: [[[2, 8], [15, 21]], [[1, 8], [15, 23]], [[2, 8], [15, 22]], [[1, 8], [15, 23]], [[0, 9], [16, 25]]],
        ladders: [[4, 0], [6, 1], [3, 2], [5, 3], [18, 0], [20, 1], [17, 2], [21, 3]],
        eggs: [[3, 0], [8, 0], [16, 0], [21, 0], [2, 1], [7, 1], [17, 1], [22, 1], [5, 2], [19, 2], [3, 3], [22, 3]],
        seeds: [[6, 0], [19, 0], [5, 1], [21, 1], [7, 2], [21, 2], [2, 3], [16, 3], [3, 4], [24, 4]],
        hens: [[5, 0], [19, 1], [4, 2], [20, 3]],
        start: [3, 4],
        lifts: [
            {c: 11, phase: 0},
            {c: 11, phase: 0.5},
        ],
        time: 950,
    },
    {
        name: "Crossroads",
        tiers: [
            [[3, 10], [15, 22]],
            [[0, 6], [9, 16], [19, 25]],
            [[2, 9], [12, 23]],
            [[0, 5], [8, 17], [20, 25]],
            [[0, 25]],
        ],
        ladders: [[5, 0], [16, 0], [21, 0], [3, 1], [14, 1], [22, 1], [4, 2], [9, 2], [21, 2], [2, 3], [12, 3], [23, 3]],
        eggs: [[4, 0], [9, 0], [17, 0], [22, 0], [1, 1], [11, 1], [24, 1], [3, 2], [13, 2], [20, 2], [2, 3], [24, 3]],
        seeds: [[7, 0], [19, 0], [5, 1], [15, 1], [21, 1], [6, 2], [17, 2], [10, 3], [15, 3], [20, 4]],
        hens: [[8, 0], [18, 0], [12, 1], [16, 2], [4, 3]],
        start: [12, 4],
        time: 950,
    },
    {
        name: "Ladder Maze",
        tiers: [[[2, 23]], [[0, 8], [11, 14], [17, 25]], [[2, 6], [9, 16], [19, 23]], [[0, 9], [12, 13], [16, 25]], [[0, 25]]],
        ladders: [[4, 0], [12, 0], [21, 0], [3, 1], [13, 1], [22, 1], [5, 2], [16, 2], [20, 2], [7, 3], [13, 3], [24, 3]],
        eggs: [[3, 0], [8, 0], [16, 0], [22, 0], [1, 1], [12, 1], [18, 1], [3, 2], [10, 2], [21, 2], [1, 3], [13, 3]],
        seeds: [[6, 0], [19, 0], [7, 1], [24, 1], [11, 2], [14, 2], [22, 2], [3, 3], [20, 3], [10, 4]],
        hens: [[7, 0], [19, 0], [5, 1], [12, 2], [8, 3]],
        start: [12, 4],
        time: 1000,
    },
    {
        name: "Pit Stop",
        tiers: [
            [[0, 5], [8, 13], [16, 21], [24, 25]],
            [[2, 8], [11, 17], [20, 25]],
            [[0, 4], [7, 12], [15, 19], [22, 25]],
            [[3, 9], [12, 18], [21, 25]],
            [[0, 4], [7, 10], [13, 16], [19, 25]],
        ],
        ladders: [[4, 0], [12, 0], [20, 0], [3, 1], [8, 1], [16, 1], [23, 1], [4, 2], [12, 2], [18, 2], [24, 2], [4, 3], [9, 3], [15, 3], [22, 3]],
        eggs: [[2, 0], [10, 0], [18, 0], [25, 0], [5, 1], [14, 1], [22, 1], [1, 2], [9, 2], [17, 2], [6, 3], [24, 3]],
        seeds: [[1, 0], [9, 0], [17, 0], [6, 1], [15, 1], [24, 1], [11, 2], [19, 2], [14, 3], [23, 3]],
        hens: [[3, 0], [12, 0], [14, 1], [9, 2], [16, 3]],
        start: [21, 4],
        time: 1000,
    },
    {
        name: "Skyway",
        tiers: [[[6, 19]], [[5, 12], [15, 20]], [[6, 19]], [[5, 12], [15, 20]], [[4, 21]]],
        ladders: [[7, 0], [17, 0], [6, 1], [18, 1], [9, 2], [16, 2], [8, 3], [17, 3]],
        eggs: [[8, 0], [12, 0], [16, 0], [19, 0], [5, 1], [11, 1], [20, 1], [7, 2], [13, 2], [18, 2], [6, 3], [19, 3]],
        seeds: [[10, 0], [14, 0], [8, 1], [17, 1], [10, 2], [15, 2], [10, 3], [16, 3], [7, 4], [19, 4]],
        hens: [[10, 0], [15, 1], [8, 2], [17, 3], [12, 4]],
        start: [10, 4],
        lifts: [
            {c: 2, phase: 0},
            {c: 2, phase: 0.5},
            {c: 22, phase: 0.25},
            {c: 22, phase: 0.75},
        ],
        time: 1000,
    },
    {
        name: "Coop de Grace",
        tiers: [
            [[0, 4], [7, 12], [15, 20], [23, 25]],
            [[2, 5], [8, 11], [14, 17], [20, 23]],
            [[0, 4], [7, 12], [15, 20], [23, 25]],
            [[2, 5], [8, 11], [14, 17], [20, 23]],
            [[0, 6], [9, 16], [19, 25]],
        ],
        ladders: [[3, 0], [9, 0], [16, 0], [20, 0], [3, 1], [10, 1], [16, 1], [23, 1], [4, 2], [9, 2], [17, 2], [20, 2], [3, 3], [10, 3], [15, 3], [22, 3]],
        eggs: [[1, 0], [8, 0], [19, 0], [24, 0], [4, 1], [11, 1], [17, 1], [21, 1], [2, 2], [11, 2], [18, 2], [9, 3]],
        seeds: [[4, 0], [11, 0], [16, 0], [5, 1], [22, 1], [7, 2], [24, 2], [5, 3], [20, 3], [12, 4]],
        hens: [[10, 0], [17, 0], [9, 1], [18, 2], [10, 3], [22, 3]],
        start: [14, 4],
        time: 1050,
    },
];

export interface Level {
    name: string;
    /** W × H tiles, row-major: tiles[r * W + c]. */
    tiles: string;
    eggs: { x: number; y: number }[];
    seeds: { x: number; y: number }[];
    /** Hen start positions: x centre, feet y. */
    hens: { x: number; feet: number }[];
    start: { x: number; feet: number };
    lifts: { x: number; phase: number }[];
    time: number;
    /** Extra hens for the later passes, at spots on the platforms. */
    spares: { x: number; feet: number }[];
}

export const tileAt = (tiles: string, c: number, r: number): string => {
    if (c < 0 || c >= W || r < 0) return "#";
    if (r >= H) return ".";
    return tiles[r * W + c];
};

export function parse(spec: LevelSpec): Level {
    const t: string[] = Array(W * H).fill(".");
    spec.tiers.forEach((spans, i) => {
        for (const [a, b] of spans) for (let c = a; c <= b; c++) t[TIER_ROWS[i] * W + c] = "#";
    });
    for (const [c, tier] of spec.ladders) {
        t[TIER_ROWS[tier] * W + c] = "T";
        for (let r = TIER_ROWS[tier] + 1; r < TIER_ROWS[tier + 1]; r++) t[r * W + c] = "H";
    }
    const feet = (tier: number) => TIER_ROWS[tier] * CELL;
    const spares: Level["spares"] = [];
    spec.tiers.forEach((spans, i) => {
        // Spares start at the middle of the widest span of tiers 1 and 3.
        if (i % 2 === 0) return;
        const [a, b] = spans.reduce((m, s) => (s[1] - s[0] > m[1] - m[0] ? s : m));
        spares.push({x: ((a + b + 1) / 2) * CELL, feet: feet(i)});
    });
    return {
        name: spec.name,
        tiles: t.join(""),
        eggs: spec.eggs.map(([c, tier]) => ({x: c * CELL + 4, y: feet(tier) - 4})),
        seeds: spec.seeds.map(([c, tier]) => ({x: c * CELL + 4, y: feet(tier) - 3})),
        hens: spec.hens.map(([c, tier]) => ({x: c * CELL + 4, feet: feet(tier)})),
        start: {x: spec.start[0] * CELL + 4, feet: feet(spec.start[1])},
        lifts: (spec.lifts ?? []).map((l) => ({x: l.c * CELL, phase: l.phase})),
        time: spec.time,
        spares,
    };
}
