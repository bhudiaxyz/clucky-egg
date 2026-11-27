/**
 * Generate — endless seeded farms: a procedural level generator proven by the solver.
 *
 * Purpose
 *   After the eight hand-built farmyards (and in Random farm mode from the start) every level
 *   is generated. The same level number and seed always give the same farm, on every machine.
 *
 * Operations
 *   - generate(n, seed): builds a LevelSpec by generate-and-test: lay out five tiers of platform
 *     spans from difficulty(n) (length range, gap width, pits in the bottom floor), cut a lift
 *     shaft when the difficulty calls for lifts, join each pair of floors with ladders where
 *     both have platform, scatter twelve eggs, ten piles of grain and the hens, and keep the
 *     candidate only if world/solver.ts proves everything reachable. A name is made from
 *     the seed. After 60 failed candidates (it hasn't happened) a hand-built farm stands in.
 *   - farmFor(n, mode, seed): the Level for a run: hand-built for classic 0-39, generated
 *     for classic 40+ and for every level of Random farm.
 *   - passOf(n): which pass over the eight (0..4, capped, as the original's level 41 = 33).
 *
 * Usage
 *   core/game.ts: farmFor(n, mode, seed); ui/menu.ts: farmName.
 *
 * Highlights
 *   - Seeds: n * 7919 + seed * 104729 + attempt, run through the shared mulberry32.
 *   - Every platform keeps a clear cage corner (rows 0-4, columns 0-4) because tier 0 is row 6.
 *
 * See also: core/difficulty.ts, world/solver.ts, world/levels.ts; DESIGN.md "7. Generation and difficulty".
 */
import { difficulty } from "../core/difficulty";
import { rng } from "../core/random";
import { LEVELS, parse, W, type Level, type LevelSpec } from "./levels";
import { solves } from "./solver";

export type Mode = "classic" | "random";

const ADJ = ["Muddy", "Golden", "Windy", "Dusty", "Mossy", "Sunny", "Foggy", "Crooked", "Quiet", "Rusty", "Hungry", "Clover", "Stormy", "Lazy"];
const NOUN = ["Meadow", "Paddock", "Coop", "Orchard", "Granary", "Barnyard", "Hayloft", "Dairy", "Hollow", "Stable", "Pasture", "Mill", "Lane", "Henhouse"];

type Span = [number, number];

export function generate(n: number, seed = 0): LevelSpec {
    for (let attempt = 0; attempt < 60; attempt++) {
        const spec = candidate(n, seed, attempt);
        if (spec && solves(spec)) return spec;
    }
    return LEVELS[n % LEVELS.length];
}

function candidate(n: number, seed: number, attempt: number): LevelSpec | null {
    const r = rng(n * 7919 + seed * 104729 + attempt * 31 + 1337);
    const d = difficulty(n);
    const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
    const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];

    // Tiers: runs of platform with gaps of one or two cells.
    const tiers: Span[][] = [];
    for (let t = 0; t < 5; t++) {
        const spans: Span[] = [];
        let c = t === 4 ? 0 : int(0, 4);
        while (c < W) {
            const end = Math.min(W - 1, c + int(d.span[0], d.span[1]) - 1);
            if (end - c >= 2) spans.push([c, end]);
            const gap = t === 4 && r() < d.pits ? 2 : int(1, d.gap);
            c = end + 1 + gap;
        }
        if (t < 4 && spans.length && r() < 0.5) spans[spans.length - 1][1] = Math.min(spans[spans.length - 1][1], int(20, 24));
        tiers.push(spans);
    }

    // A lift shaft: cut six columns through every tier, then fit the lifts.
    const lifts: { c: number; phase: number }[] = [];
    let shaft: Span | null = null;
    if (d.lifts > 0) {
        const sc = int(5, 15);
        shaft = [sc, sc + 5];
        for (let t = 0; t < 5; t++) {
            tiers[t] = tiers[t].flatMap(([a, b]) => {
                const out: Span[] = [];
                if (a < sc) out.push([a, Math.min(b, sc - 1)]);
                if (b > sc + 5) out.push([Math.max(a, sc + 6), b]);
                return out.filter(([x, y]) => y - x >= 1);
            });
        }
        for (let i = 0; i < d.lifts; i++) lifts.push({ c: sc + 2, phase: d.lifts === 1 ? 0.3 : i / d.lifts });
        if (d.lifts === 1) lifts.push({ c: sc + 2, phase: 0.8 });
    }
    if (tiers.some((s) => !s.length)) return null;

    const has = (t: number, c: number) => tiers[t].some(([a, b]) => c >= a && c <= b);
    const cells = (t: number) => {
        const out: number[] = [];
        for (let c = 0; c < W; c++) if (has(t, c)) out.push(c);
        return out;
    };

    // Ladders between each pair of floors, spread out.
    const ladders: [number, number][] = [];
    for (let t = 0; t < 4; t++) {
        const cand = cells(t).filter((c) => has(t + 1, c) && c > 0 && c < W - 1);
        const chosen: number[] = [];
        for (let k = 0; k < d.ladders && cand.length; k++) {
            const c = pick(cand);
            if (chosen.every((o) => Math.abs(o - c) >= 4)) chosen.push(c);
        }
        if (!chosen.length) return null;
        chosen.forEach((c) => ladders.push([c, t]));
    }

    // Scatter: eggs and grain on distinct cells, hens away from the start.
    const used = new Set<string>();
    const place = (count: number, weights: number[]) => {
        const out: [number, number][] = [];
        for (let i = 0; i < count; i++) {
            const t = weights[i % weights.length];
            const cand = cells(t).filter((c) => !used.has(`${c},${t}`) && c > 0 && c < W - 1);
            if (!cand.length) return null;
            const c = pick(cand);
            used.add(`${c},${t}`);
            out.push([c, t]);
        }
        return out;
    };
    const eggs = place(12, [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 1, 2]);
    const seeds = place(10, [0, 1, 2, 3, 4, 1, 2, 3, 0, 4]);
    if (!eggs || !seeds) return null;
    const floor = cells(4).filter((c) => c > 1 && c < W - 2);
    if (!floor.length) return null;
    const start: [number, number] = [pick(floor), 4];
    const hens: [number, number][] = [];
    for (let i = 0; i < d.hens; i++) {
        const t = i % 5;
        const cand = cells(t).filter((c) => t !== 4 || Math.abs(c - start[0]) > 6);
        if (!cand.length) continue;
        hens.push([pick(cand), t]);
    }
    if (hens.length < 3) return null;
    void shaft;
    return {
        name: `${pick(ADJ)} ${pick(NOUN)}`,
        tiers: tiers as LevelSpec["tiers"],
        ladders,
        eggs,
        seeds,
        hens,
        start,
        lifts: lifts.length ? lifts : undefined,
        time: d.time,
    };
}

const cache = new Map<string, Level>();

/** The Level for overall index n: hand-built (classic, n < 40) or generated. */
export function farmFor(n: number, mode: Mode = "classic", seed = 0): Level {
    const handBuilt = mode === "classic" && n < LEVELS.length * 5;
    const key = handBuilt ? `h${n % LEVELS.length}` : `g${mode}:${seed}:${n}`;
    let lv = cache.get(key);
    if (!lv) {
        lv = parse(handBuilt ? LEVELS[n % LEVELS.length] : generate(n, mode === "random" ? seed : 0));
        if (cache.size > 64) cache.clear();
        cache.set(key, lv);
    }
    return lv;
}

export const passOf = (n: number) => Math.min(4, Math.floor(n / LEVELS.length));
