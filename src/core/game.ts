/**
 * Game — the rules: eggs, grain, hens, the duck, lifts, the bonus clock, lives and score. Pure.
 *
 * Purpose
 *   Owns all mutable gameplay state and advances it only through update(dt, input). No DOM, no
 *   three.js, so check.ts runs it headless and the title screen can run a live "attract" Game.
 *
 * Operations
 *   - new Game(n, opts): level n (0-based; n % 8 picks the hand-built farmyard and n / 8 the
 *     pass; from level 40, or always in Random farm mode, the farm is generated). opts: demo
 *     (the title screen's attract game), mode ("classic" | "random") and seed.
 *   - update(dt, input): fixed 120 Hz ticks. Phases: play → dead (tumble, then respawn or
 *     over) / clear (bonus, then the next level).
 *   - Rules (from the original): twelve eggs a level, 100 points each; ten piles of grain,
 *     50 each, and taking one freezes the bonus clock for a moment; hens that reach grain
 *     stop to eat it. Touching a hen or the duck, falling out of the bottom, being carried
 *     into the ceiling by a lift or running the clock to zero costs a life. Five lives to
 *     start, an extra one every 10,000 points.
 *   - Passes: 1 hens and a caged duck. 2 the duck is loose and there are no hens. 3 both.
 *     4 more hens, and bugs on the wing (a flier sweeps a lane of air between two floors). 5 and
 *     on: everything faster, three fliers.
 *   - Walkers: the hen and the barn and field creatures of core/creatures.ts patrol their
 *     platform and turn at its ends; at a ladder they usually climb towards Harry's level;
 *     they pause while eating grain. Each kind has its own speed.
 *   - onEvent(e): one callback for the things that can't be polled (see GameEvent).
 *
 * Highlights
 *   - Dying keeps collected eggs and eaten grain, as in the original; Harry, the hens and the
 *     duck go back to their starts. The clock keeps running (a timeout refills it).
 *   - Hens use a seeded generator, so a run of the same level plays the same way.
 *
 * See also: core/physics.ts, world/levels.ts, render/view.ts; DESIGN.md "8. Game rules".
 */
import {CELL, H, type Level, TIER_ROWS, tileAt, W} from "../world/levels";
import {farmFor, type Mode, passOf} from "../world/generate";
import {creatureInfo, flyerFor, walkerFor} from "./creatures";
import {type Body, BODY_H, BODY_W, type Input, type Lift, newBody, stepHarry, TICK, updateLifts} from "./physics";
import {rng} from "./random";

export type GameEvent = "jump" | "land" | "egg" | "seed" | "eat" | "die" | "clear" | "extra" | "over" | "duck";
export type {Mode};
export type Phase = "play" | "dead" | "clear" | "over";

export const HEN_W = 8;
export const HEN_H = 13;
export const EGG_POINTS = 100;
export const SEED_POINTS = 50;
export const EXTRA_EVERY = 10000;
export const START_LIVES = 5;
export const DEAD_TIME = 1.5;
export const CLEAR_TIME = 2.4;
/** Seconds the bonus clock stands still after Harry takes grain. */
export const FREEZE = 2.5;
/** The duck's cage, top-left: centre in game px. */
export const CAGE = {x: 26, y: 26};
const DUCK_DELAY = 2.5;
const CLOCK_RATE = 10;

export interface Hen {
    /** Creature id (core/creatures.ts): "hen", "rat", "snail", … */
    kind: string;
    x: number;
    feet: number;
    dir: 1 | -1;
    mode: "walk" | "climb" | "eat";
    t: number;
    /** Climb target (feet y) and the column last considered for a ladder. */
    to: number;
    lastCol: number;
    think: number;
    dist: number;
}

/** A bug or bird that sweeps a lane of air. x is the centre, y the lane's centre. */
export interface Flyer {
    kind: string;
    x: number;
    y: number;
    dir: 1 | -1;
    phase: number;
}

export interface Duck {
    x: number;
    y: number;
    vx: number;
    vy: number;
    /** "caged" (pass 1: never released), "wait" (about to burst out) or "free". */
    state: "caged" | "wait" | "free";
}

const isLadder = (t: string, c: number, r: number) => {
    const k = tileAt(t, c, r);
    return k === "H" || k === "T";
};
const walkable = (t: string, c: number, r: number) => {
    const k = tileAt(t, c, r);
    return k === "#" || k === "T";
};

export class Game {
    n: number;
    pass: number;
    level: Level;
    harry!: Body;
    lifts: Lift[] = [];
    hens: Hen[] = [];
    duck: Duck | null = null;
    flyers: Flyer[] = [];
    eggs: boolean[] = [];
    seeds: boolean[] = [];
    left = 0;
    time = 0;
    freeze = 0;
    score = 0;
    lives = START_LIVES;
    phase: Phase = "play";
    phaseT = 0;
    /** Seconds since the level began (animation clock). */
    clock = 0;
    readonly demo: boolean;
    readonly mode: Mode;
    readonly seed: number;
    private nextExtra = EXTRA_EVERY;
    private acc = 0;
    private rand: () => number;

    constructor(n: number, opts: { demo?: boolean; mode?: Mode; seed?: number } = {}) {
        this.demo = !!opts.demo;
        this.mode = opts.mode ?? "classic";
        this.seed = opts.seed ?? 0;
        this.n = n;
        this.pass = passOf(n);
        this.level = farmFor(n, this.mode, this.seed);
        this.rand = rng(n * 7919 + 17);
        this.load();
    }

    get henSpeed(): number {
        return (20 + 2 * (this.n % 8)) * [1, 1, 1.05, 1.1, 1.35][this.pass];
    }

    /** Flier speed (px/s). */
    get flyerSpeed(): number {
        return 26 * [1, 1, 1, 1.15, 1.4][this.pass];
    }

    get duckSpeed(): number {
        return [0, 22, 26, 30, 38][this.pass];
    }

    onEvent: (e: GameEvent) => void = () => {
    };

    update(dt: number, input: Input) {
        this.acc += dt;
        while (this.acc >= TICK) {
            this.acc -= TICK;
            this.tick(input);
        }
    }

    die() {
        if (this.phase !== "play") return;
        this.lives--;
        this.phase = "dead";
        this.phaseT = 0;
        this.onEvent("die");
    }

    /** Set up the level fresh: all eggs and grain, full clock. */
    private load() {
        const lv = this.level;
        this.pass = passOf(this.n);
        this.eggs = lv.eggs.map(() => true);
        this.seeds = lv.seeds.map(() => true);
        this.left = lv.eggs.length;
        this.time = lv.time;
        this.freeze = 0;
        this.clock = 0;
        this.phase = "play";
        this.phaseT = 0;
        this.lifts = lv.lifts.map((l) => ({x: l.x, y: l.phase * H * CELL, py: l.phase * H * CELL}));
        this.rand = rng(this.n * 7919 + 17);
        this.reset();
    }

    /** Harry, hens and duck back to their starts (level progress is kept). */
    private reset() {
        const lv = this.level;
        this.harry = newBody(lv.start.x, lv.start.feet);
        const starts = [...lv.hens, ...(this.pass >= 3 ? lv.spares : [])];
        this.hens = this.pass === 1 ? [] : starts.map((h, i) => this.newHen(h.x, h.feet, i));
        // Bugs on the wing from pass 3: one, two, then three lanes of air.
        const lanes = this.pass >= 2 ? this.pass - 1 : 0;
        this.flyers = Array.from({length: lanes}, (_, i) => ({
            kind: flyerFor(this.n, i).id,
            x: 40 + ((i * 83 + this.n * 37) % 120),
            y: TIER_ROWS[[1, 2, 0, 3][i % 4]] * CELL + 10,
            dir: (i % 2 ? 1 : -1) as 1 | -1,
            phase: i * 2,
        }));
        this.duck =
            this.pass === 0
                ? {x: CAGE.x, y: CAGE.y, vx: 0, vy: 0, state: "caged"}
                : {x: CAGE.x, y: CAGE.y, vx: 0, vy: 0, state: "wait"};
    }

    private newHen(x: number, feet: number, i: number): Hen {
        return {
            kind: walkerFor(this.n, i).id,
            x,
            feet,
            dir: i % 2 ? 1 : -1,
            mode: "walk",
            t: 0,
            to: 0,
            lastCol: -1,
            think: 1 + this.rand() * 2,
            dist: 0,
        };
    }

    private tick(inp: Input) {
        this.clock += TICK;
        updateLifts(this.lifts, TICK);
        if (this.demo) {
            this.hens.forEach((h) => this.moveHen(h, TICK));
            this.flyers.forEach((f) => this.moveFlyer(f, TICK));
            return;
        }
        if (this.phase === "dead") {
            this.phaseT += TICK;
            if (this.phaseT >= DEAD_TIME) {
                if (this.lives < 0) {
                    this.phase = "over";
                    this.onEvent("over");
                } else {
                    this.reset();
                    this.phase = "play";
                }
            }
            return;
        }
        if (this.phase === "clear") {
            this.phaseT += TICK;
            if (this.phaseT >= CLEAR_TIME) {
                this.n++;
                this.level = farmFor(this.n, this.mode, this.seed);
                this.load();
            }
            return;
        }
        if (this.phase !== "play") return;

        const res = stepHarry(this.harry, inp, this.level.tiles, this.lifts, TICK, (e) => this.onEvent(e));
        if (res !== "ok") return this.die();
        this.pickups();
        for (const h of this.hens) {
            this.moveHen(h, TICK);
            if (this.touchesHarry(h.x, h.feet - HEN_H / 2, HEN_W / 2 - 1, HEN_H / 2 - 1)) return this.die();
        }
        for (const f of this.flyers) {
            this.moveFlyer(f, TICK);
            if (this.touchesHarry(f.x, f.y, 5, 4)) return this.die();
        }
        if (this.duck && this.duck.state !== "caged") {
            this.moveDuck(this.duck, TICK);
            if (this.duck.state === "free" && this.touchesHarry(this.duck.x, this.duck.y, 6, 6)) return this.die();
        }
        if (this.freeze > 0) this.freeze -= TICK;
        else this.time -= CLOCK_RATE * TICK;
        if (this.time <= 0) {
            this.time = 500;
            return this.die();
        }
        if (this.left === 0) {
            this.score += Math.floor(this.time);
            this.award();
            this.phase = "clear";
            this.phaseT = 0;
            this.onEvent("clear");
        }
    }

    private touchesHarry(cx: number, cy: number, hw: number, hh: number): boolean {
        const b = this.harry;
        return Math.abs(cx - (b.x + BODY_W / 2)) < hw + BODY_W / 2 - 1 && Math.abs(cy - (b.y + BODY_H / 2)) < hh + BODY_H / 2 - 1;
    }

    private award() {
        while (this.score >= this.nextExtra) {
            this.nextExtra += EXTRA_EVERY;
            this.lives++;
            this.onEvent("extra");
        }
    }

    private pickups() {
        const b = this.harry;
        const hx = b.x + BODY_W / 2,
            hy = b.y + BODY_H / 2;
        const lv = this.level;
        lv.eggs.forEach((e, i) => {
            if (this.eggs[i] && Math.abs(e.x - hx) < 6 && Math.abs(e.y - hy) < 9) {
                this.eggs[i] = false;
                this.left--;
                this.score += EGG_POINTS;
                this.onEvent("egg");
                this.award();
            }
        });
        lv.seeds.forEach((s, i) => {
            if (this.seeds[i] && Math.abs(s.x - hx) < 6 && Math.abs(s.y - hy) < 9) {
                this.seeds[i] = false;
                this.score += SEED_POINTS;
                this.freeze = FREEZE;
                this.onEvent("seed");
                this.award();
            }
        });
    }

    private moveHen(h: Hen, dt: number) {
        const t = this.level.tiles;
        const speed = this.henSpeed * creatureInfo(h.kind).speed;
        if (h.mode === "eat") {
            h.t -= dt;
            if (h.t <= 0) h.mode = "walk";
            return;
        }
        if (h.mode === "climb") {
            const step = speed * 0.8 * dt;
            h.dist += step;
            h.feet += Math.sign(h.to - h.feet) * step;
            if (Math.abs(h.to - h.feet) <= step) {
                h.feet = h.to;
                h.mode = "walk";
                h.dir = this.rand() < 0.5 ? 1 : -1;
            }
            return;
        }
        const c = Math.floor(h.x / CELL);
        const k = Math.round(h.feet / CELL);
        if (Math.abs(h.x - (c * CELL + CELL / 2)) > 3) h.lastCol = -1;
        // Grain underfoot: stop and eat it.
        const lv = this.level;
        for (let i = 0; i < lv.seeds.length; i++) {
            const s = lv.seeds[i];
            if (this.seeds[i] && Math.abs(s.x - h.x) < 4 && Math.abs(s.y - (h.feet - 3)) < 5) {
                this.seeds[i] = false;
                h.mode = "eat";
                h.t = 1.6;
                this.onEvent("eat");
                return;
            }
        }
        // A ladder here: usually take it towards Harry's level.
        if (c !== h.lastCol && Math.abs(h.x - (c * CELL + CELL / 2)) <= 1.5) {
            h.lastCol = c;
            const canUp = isLadder(t, c, Math.floor((h.feet - 0.5) / CELL));
            const canDown = isLadder(t, c, Math.floor((h.feet + 0.5) / CELL));
            const hf = this.harry.y + BODY_H;
            let go = 0;
            if (canUp && hf < h.feet - 6 && this.rand() < 0.75) go = -1;
            else if (canDown && hf > h.feet + 6 && this.rand() < 0.75) go = 1;
            else if ((canUp || canDown) && this.rand() < 0.12) go = canUp && (!canDown || this.rand() < 0.5) ? -1 : 1;
            if (go) {
                // One floor at a time: up to the next platform row, down to the next one below.
                let r = Math.floor((h.feet + (go < 0 ? -0.5 : 0.5)) / CELL);
                if (go < 0) while (tileAt(t, c, r) !== "T" && isLadder(t, c, r - 1)) r--;
                else while (!walkable(t, c, r + 1)) r++;
                h.mode = "climb";
                h.x = c * CELL + CELL / 2;
                h.to = go < 0 ? r * CELL : (r + 1) * CELL;
                return;
            }
        }
        // Now and then, turn to face Harry when he is on this floor.
        h.think -= dt;
        if (h.think <= 0) {
            h.think = 1 + this.rand() * 1.5;
            const hf = this.harry.y + BODY_H;
            if (Math.abs(hf - h.feet) < 8 && this.rand() < 0.8) h.dir = this.harry.x + BODY_W / 2 > h.x ? 1 : -1;
            else if (this.rand() < 0.1) h.dir = h.dir === 1 ? -1 : 1;
        }
        const nx = h.x + h.dir * speed * dt;
        const lead = Math.floor((nx + h.dir * (HEN_W / 2 - 1)) / CELL);
        if (!walkable(t, lead, k) || tileAt(t, lead, k - 1) === "#") {
            h.dir = h.dir === 1 ? -1 : 1;
            return;
        }
        h.dist += Math.abs(nx - h.x);
        h.x = nx;
    }

    private moveFlyer(f: Flyer, dt: number) {
        const speed = this.flyerSpeed * creatureInfo(f.kind).speed;
        f.x += f.dir * speed * dt;
        if (f.x < 10) ((f.x = 10), (f.dir = 1));
        if (f.x > W * CELL - 10) ((f.x = W * CELL - 10), (f.dir = -1));
        f.phase += dt;
    }

    private moveDuck(d: Duck, dt: number) {
        if (d.state === "wait") {
            if (this.clock > DUCK_DELAY) {
                d.state = "free";
                this.onEvent("duck");
            }
            return;
        }
        const b = this.harry;
        const dx = b.x + BODY_W / 2 - d.x,
            dy = b.y + BODY_H / 2 - d.y;
        const len = Math.hypot(dx, dy) || 1;
        const s = this.duckSpeed;
        const k = Math.min(1, 2.2 * dt);
        d.vx += ((dx / len) * s - d.vx) * k;
        d.vy += ((dy / len) * s - d.vy) * k;
        d.x = Math.min(W * CELL - 8, Math.max(8, d.x + d.vx * dt));
        d.y = Math.min(H * CELL - 8, Math.max(8, d.y + d.vy * dt));
    }
}
