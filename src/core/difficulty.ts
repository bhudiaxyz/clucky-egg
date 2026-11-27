/**
 * Difficulty — one curve for every farm: bands of eight levels (one pass), easy to Mayhem.
 *
 * Purpose
 *   Every generated-level knob comes from difficulty(n), so the endless farms start gentle
 *   and add complexity steadily, a pass at a time. (The hand-built eight keep their authored
 *   layouts; the pass rules in core/game.ts add the duck, the extra hens and the speed.)
 *
 * Operations
 *   - difficulty(n): knobs for overall level n (0-based). With band = ⌊n / 8⌋ and within =
 *     (n mod 8) / 7, progress is t = (band + 0.2·within) / 4.2, saturating at level 40
 *     (MAX_DIFFICULTY_AT): inside a band difficulty creeps up only 20% of a step, and each
 *     new band is a clear one.
 *   - Knobs for generated layouts: how many hens, lifts and pits, how wide the platform gaps
 *     run, how many ladders connect each pair of floors, and the starting clock.
 *   - bandName(n): the intro card's label ("Easy" … "Mayhem").
 *
 * Usage
 *   world/generate.ts (layout knobs), ui/menu.ts (band label).
 *
 * See also: scripts/check.ts (the curve never eases); DESIGN.md "7. Generation and difficulty".
 */
export const BAND = 8;
/** Level number (1-based) where the curve reaches full difficulty and holds. */
export const MAX_DIFFICULTY_AT = 40;
const WITHIN = 0.2;

export const BAND_NAMES = ["Easy", "Steady", "Tricky", "Hard", "Mayhem"];

export interface Difficulty {
    t: number;
    /** 1-based band (1 = levels 1-8). */
    band: number;
    hens: number;
    lifts: number;
    /** Chance a bottom-floor span is replaced by a pit. */
    pits: number;
    /** Ladders joining each pair of floors. */
    ladders: number;
    /** Largest gap, in cells, between platforms on one floor (jumps cross two). */
    gap: number;
    /** Platform length range, in cells. */
    span: [number, number];
    time: number;
}

export function difficulty(n: number): Difficulty {
    const bands = BAND_NAMES.length;
    const k = Math.min(Math.max(n, 0), MAX_DIFFICULTY_AT - 1);
    const band = Math.floor(k / BAND),
        within = (k % BAND) / (BAND - 1);
    const t = (band + WITHIN * within) / (bands - 1 + WITHIN);
    const L = (a: number, b: number) => a + (b - a) * t;
    const R = (a: number, b: number) => Math.round(L(a, b));
    return {
        t,
        band: band + 1,
        hens: R(3, 6),
        lifts: R(0, 2),
        pits: L(0.1, 0.45),
        ladders: R(3, 2),
        gap: 2,
        span: [R(7, 4), R(14, 9)],
        time: R(950, 1050),
    };
}

export const bandName = (n: number) => BAND_NAMES[Math.min(difficulty(n).band, BAND_NAMES.length) - 1];
