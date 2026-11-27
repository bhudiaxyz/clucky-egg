/**
 * Physics — Harry's movement: walk, committed jump, fall, ladders and lifts. Pure functions.
 *
 * Purpose
 *   The one movement model. Game steps Harry through stepHarry(); scripts/check.ts drives the
 *   same function headless. Positions are game pixels (8 per cell), y growing downwards; a
 *   Body's (x, y) is the top-left of its 6 × 14 box.
 *
 * Operations
 *   - stepHarry(b, input, tiles, lifts, dt, emit): one fixed tick. Modes:
 *       ground  walk at 44 px/s; Jump leaves the ground; Up / Down near a ladder grabs it
 *       air     fixed horizontal speed chosen at take-off (the arc is committed), gravity,
 *               head bumps on platforms, landing on platforms, ladder tops and lifts;
 *               Up / Down over a ladder grabs it mid-air
 *       climb   Up / Down at 34 px/s along one ladder; hands over to ground at either end;
 *               Jump (+ a direction) hops off
 *     Returns "ok", "fall" (dropped out of the bottom of the screen) or "crush" (carried
 *     into a platform or the top of the screen by a lift).
 *   - updateLifts(lifts, dt): lifts rise 20 px/s and wrap from the top back to the bottom.
 *   - overlapsSolid(), support(), landing(): box tests against the tile grid and lifts.
 *
 * Highlights
 *   - Jump: 135 px/s up under 520 px/s² gives a 17.5 px (just over two cells) hop that lasts
 *     0.52 s and covers 22.9 px sideways: a two-cell gap is cleared with room to spare.
 *   - Platforms are solid from every side, so ladders are the way up. A ladder cell on a
 *     platform row ('T') is standable but never blocks: land on it from above, climb through it.
 *   - Falling any distance is safe, as in the original. Only the bottom of the screen kills.
 *
 * See also: world/levels.ts (tiles), core/game.ts, scripts/check.ts; DESIGN.md "5. Movement".
 */
import {CELL, H, tileAt} from "../world/levels";

export const TICK = 1 / 120;
export const BODY_W = 6;
export const BODY_H = 14;
export const WALK = 44;
export const CLIMB = 34;
export const GRAVITY = 520;
export const JUMP_V = 135;
export const MAX_FALL = 240;
export const LIFT_W = 16;
export const LIFT_SPEED = 20;
const EPS = 0.001;

export interface Input {
    left: boolean;
    right: boolean;
    up: boolean;
    down: boolean;
    jump: boolean;
}

export type Mode = "ground" | "air" | "climb";

export interface Body {
    x: number;
    y: number;
    vx: number;
    vy: number;
    mode: Mode;
    face: 1 | -1;
    /** Index of the lift being ridden, or -1. */
    lift: number;
    /** Feet-y limits of the ladder being climbed. */
    top: number;
    bot: number;
    /** Distance walked or climbed, for animation. */
    dist: number;
}

export interface Lift {
    x: number;
    /** Surface (top) y, and last tick's. */
    y: number;
    py: number;
}

export type Emit = (e: "jump" | "land") => void;
export type Step = "ok" | "fall" | "crush";

export function newBody(x: number, feet: number): Body {
    return {
        x: x - BODY_W / 2,
        y: feet - BODY_H,
        vx: 0,
        vy: 0,
        mode: "ground",
        face: 1,
        lift: -1,
        top: 0,
        bot: 0,
        dist: 0
    };
}

const solid = (t: string, c: number, r: number) => tileAt(t, c, r) === "#";
const isLadder = (t: string, c: number, r: number) => {
    const k = tileAt(t, c, r);
    return k === "H" || k === "T";
};
/** Something to stand on: a platform, or a ladder cell on a platform row. */
const floor = (t: string, c: number, r: number) => {
    const k = tileAt(t, c, r);
    return k === "#" || k === "T";
};

export function overlapsSolid(t: string, x: number, y: number, w = BODY_W, h = BODY_H): boolean {
    const c0 = Math.floor(x / CELL),
        c1 = Math.floor((x + w - EPS) / CELL);
    const r0 = Math.floor(y / CELL),
        r1 = Math.floor((y + h - EPS) / CELL);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (solid(t, c, r)) return true;
    return false;
}

const footCols = (x: number): [number, number] => [
    Math.floor((x + 1) / CELL),
    Math.floor((x + BODY_W - 1 - EPS) / CELL),
];

/** What the feet stand on right now, if anything. */
export function support(t: string, lifts: Lift[], b: Body): { y: number; lift: number } | null {
    const feet = b.y + BODY_H;
    const k = Math.round(feet / CELL);
    if (Math.abs(feet - k * CELL) < 0.02) {
        const [c0, c1] = footCols(b.x);
        for (let c = c0; c <= c1; c++) if (floor(t, c, k)) return {y: k * CELL, lift: -1};
    }
    for (let i = 0; i < lifts.length; i++) {
        const l = lifts[i];
        if (b.x + BODY_W - 1 > l.x && b.x + 1 < l.x + LIFT_W && Math.abs(feet - l.y) < 0.6) return {y: l.y, lift: i};
    }
    return null;
}

/** The surface a body falling from y to ny lands on, if any (the highest one crossed). */
export function landing(t: string, lifts: Lift[], b: Body, ny: number): { y: number; lift: number } | null {
    const oldFeet = b.y + BODY_H,
        newFeet = ny + BODY_H;
    let best: { y: number; lift: number } | null = null;
    const [c0, c1] = footCols(b.x);
    for (let k = Math.ceil((oldFeet - EPS) / CELL); k <= Math.floor(newFeet / CELL); k++) {
        for (let c = c0; c <= c1; c++) {
            if (floor(t, c, k)) {
                if (!best || k * CELL < best.y) best = {y: k * CELL, lift: -1};
            }
        }
    }
    for (let i = 0; i < lifts.length; i++) {
        const l = lifts[i];
        if (b.x + BODY_W - 1 > l.x && b.x + 1 < l.x + LIFT_W && oldFeet <= l.py + 1 && newFeet >= l.y) {
            if (!best || l.y < best.y) best = {y: l.y, lift: i};
        }
    }
    return best;
}

export function updateLifts(lifts: Lift[], dt: number) {
    for (const l of lifts) {
        l.py = l.y;
        l.y -= LIFT_SPEED * dt;
        if (l.y < -4) l.y = l.py = H * CELL;
    }
}

/** A ladder cell within reach of a body at (x, y): its column, and the feet limits, or null. */
function grab(t: string, b: Body, up: boolean, down: boolean): { c: number; top: number; bot: number } | null {
    const c = Math.floor((b.x + BODY_W / 2) / CELL);
    const feet = b.y + BODY_H;
    const above = Math.floor((feet - 0.5) / CELL),
        at = Math.floor((feet + 0.5) / CELL);
    let r: number;
    if (up && isLadder(t, c, above)) r = above;
    else if (down && isLadder(t, c, at)) r = at;
    else return null;
    let top = r,
        bot = r;
    while (isLadder(t, c, top - 1)) top--;
    while (isLadder(t, c, bot + 1)) bot++;
    return {c, top: top * CELL, bot: (bot + 1) * CELL};
}

function moveX(t: string, b: Body, dx: number): boolean {
    const nx = b.x + dx;
    if (!overlapsSolid(t, nx, b.y)) {
        b.x = nx;
        return false;
    }
    b.x = dx > 0 ? Math.floor((nx + BODY_W) / CELL) * CELL - BODY_W - EPS : (Math.floor(nx / CELL) + 1) * CELL;
    return true;
}

export function stepHarry(b: Body, inp: Input, t: string, lifts: Lift[], dt: number, emit: Emit): Step {
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (b.mode === "ground") {
        if (b.lift >= 0) {
            b.y = lifts[b.lift].y - BODY_H;
            if (overlapsSolid(t, b.x, b.y)) return "crush";
        }
        if (dir) b.face = dir as 1 | -1;
        const g = (inp.up || inp.down) && !inp.jump ? grab(t, b, inp.up, inp.down) : null;
        if (inp.jump) {
            b.mode = "air";
            b.vy = -JUMP_V;
            b.vx = dir * WALK;
            b.lift = -1;
            emit("jump");
        } else if (g) {
            startClimb(b, g);
        } else {
            const x0 = b.x;
            moveX(t, b, dir * WALK * dt);
            b.dist += Math.abs(b.x - x0);
            const s = support(t, lifts, b);
            if (!s) {
                b.mode = "air";
                b.vx = 0;
                b.vy = 0;
                b.lift = -1;
            } else b.lift = s.lift;
        }
        return "ok";
    }
    if (b.mode === "climb") {
        const feet0 = b.y + BODY_H;
        if (inp.jump) {
            b.mode = "air";
            b.vy = -JUMP_V * 0.6;
            b.vx = dir * WALK;
            if (dir) b.face = dir as 1 | -1;
            emit("jump");
            return "ok";
        }
        const feet = Math.min(b.bot, Math.max(b.top, feet0 + ((inp.down ? 1 : 0) - (inp.up ? 1 : 0)) * CLIMB * dt));
        b.dist += Math.abs(feet - feet0);
        b.y = feet - BODY_H;
        // Level with a platform row (a ladder passing through a floor): step off sideways.
        const k = Math.round(feet / CELL);
        if (dir && Math.abs(feet - k * CELL) < 1.5 && tileAt(t, Math.floor((b.x + BODY_W / 2) / CELL), k) === "T") {
            b.y = k * CELL - BODY_H;
            b.mode = "ground";
            b.face = dir as 1 | -1;
            return "ok";
        }
        if ((feet <= b.top && inp.up) || (feet >= b.bot && inp.down)) {
            b.mode = "ground";
            b.lift = -1;
        }
        return "ok";
    }
    // air
    b.vy = Math.min(MAX_FALL, b.vy + GRAVITY * dt);
    if (moveX(t, b, b.vx * dt)) b.vx = 0;
    const g = inp.up || inp.down ? grab(t, b, inp.up, inp.down) : null;
    if (g) {
        startClimb(b, g);
        return "ok";
    }
    const ny = b.y + b.vy * dt;
    if (b.vy < 0) {
        if (overlapsSolid(t, b.x, ny)) {
            b.y = (Math.floor(ny / CELL) + 1) * CELL;
            b.vy = 0;
        } else b.y = ny;
    } else {
        const l = landing(t, lifts, b, ny);
        if (l) {
            if (b.vy > 60) emit("land");
            b.y = l.y - BODY_H;
            b.vx = b.vy = 0;
            b.mode = "ground";
            b.lift = l.lift;
        } else b.y = ny;
    }
    return b.y > H * CELL ? "fall" : "ok";
}

function startClimb(b: Body, g: { c: number; top: number; bot: number }) {
    b.mode = "climb";
    b.x = g.c * CELL + (CELL - BODY_W) / 2;
    b.vx = b.vy = 0;
    b.lift = -1;
    b.top = g.top;
    b.bot = g.bot;
}
