/**
 * Solver — a tile-level reachability proof for a level, shared by the generator and check.ts.
 *
 * Purpose
 *   Proves every egg and pile of grain can be reached from the start, so no layout can be
 *   impossible. It works on the level's platform graph rather than on pixels, and is
 *   deliberately conservative: it only uses moves the physics always allows.
 *
 * Operations
 *   - reach(spec): the set of standing cells (column, platform row) Harry can get to from the
 *     start. Moves: walk, step off and fall (to the first platform below), jump a gap of up to
 *     two cells on one level, take a ladder either way, and ride a lift (from any platform
 *     within a jump of the shaft to any other).
 *   - solves(spec): every egg and every pile of grain is on a reached cell.
 *
 * Usage
 *   world/generate.ts keeps a candidate only if solves(); scripts/check.ts asserts it for
 *   all hand-built levels.
 *
 * Highlights
 *   - Same movement limits as core/physics.ts (check.ts proves the two-cell jump).
 *   - Falling is one-way, so the solver never assumes Harry can climb back up by dropping.
 *
 * See also: world/levels.ts, world/generate.ts; DESIGN.md "6. The solver".
 */
import { H, parse, tileAt, TIER_ROWS, W, type LevelSpec } from "./levels";

export function reach(spec: LevelSpec): Set<number> {
    const t = parse(spec).tiles;
    const standable = (c: number, r: number) => {
        if (c < 0 || c >= W || r < 0 || r >= H) return false;
        const k = tileAt(t, c, r);
        return (k === "#" || k === "T") && tileAt(t, c, r - 1) !== "#";
    };
    const id = (c: number, r: number) => r * W + c;
    const seen = new Set<number>();
    const queue: [number, number][] = [];
    const push = (c: number, r: number) => {
        if (standable(c, r) && !seen.has(id(c, r))) (seen.add(id(c, r)), queue.push([c, r]));
    };
    push(spec.start[0], TIER_ROWS[spec.start[1]]);
    const shafts = (spec.lifts ?? []).map((l) => [l.c, l.c + 1] as const);
    while (queue.length) {
        const [c, r] = queue.shift()!;
        for (const d of [-1, 1]) {
            if (standable(c + d, r)) push(c + d, r);
            else for (let rr = r + 1; rr < H; rr++) if (standable(c + d, rr)) (push(c + d, rr), (rr = H));
            // Jump a gap of one or two cells on the same level.
            for (const g of [2, 3]) if (standable(c + d * g, r) && !standable(c + d, r)) push(c + d * g, r);
        }
        for (const [lc, lt] of spec.ladders) {
            if (lc !== c) continue;
            if (r === TIER_ROWS[lt]) push(c, TIER_ROWS[lt + 1]);
            if (r === TIER_ROWS[lt + 1]) push(c, TIER_ROWS[lt]);
        }
        for (const [a, b] of shafts) {
            if (c >= a - 3 && c <= b + 3) for (let rr = 0; rr < H; rr++) for (let cc = a - 3; cc <= b + 3; cc++) push(cc, rr);
        }
    }
    return seen;
}

export function solves(spec: LevelSpec): boolean {
    const seen = reach(spec);
    return [...spec.eggs, ...spec.seeds].every(([c, tier]) => seen.has(TIER_ROWS[tier] * W + c));
}

/** The reached state keyed like reach(): row * W + column. */
export const cellId = (c: number, tier: number) => TIER_ROWS[tier] * W + c;
