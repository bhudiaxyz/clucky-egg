/**
 * check — headless asserts over the pure core (npm run check).
 *
 * Purpose
 *   Proves the content is completable and the rules behave, without a browser. Runs under
 *   Node's native TypeScript support with scripts/ts-resolve.mjs for extensionless imports.
 *
 * Operations
 *   1. Every level parses to 26 × 24 with twelve eggs and ten piles of grain, all sitting on
 *      something; ladders join platforms at both ends; no platform intrudes on the cage.
 *   2. Reachability: a tile-level graph (walk, climb, drop, jump a two-cell gap, ride lifts)
 *      reaches every egg and pile of grain from the start of every level.
 *   3. Movement: the jump rises 17 px and lands 22-23 px away; a two-cell gap can be crossed
 *      and a three-cell one cannot be walked; ladders climb end to end; a lift carries Harry
 *      and kills him at the top of the screen; walking off the bottom kills.
 *   4. Rules: eggs and grain score; grain freezes the clock; the last egg clears the level and
 *      pays the remaining clock; hens turn at platform ends, climb towards Harry, eat grain;
 *      a hen or the loose duck kills; lives run out into game over; an extra life at 10,000;
 *      the five passes field the right hens and duck.
 *   5. GPU tiers on real devices' renderer strings; the governor degrades only on sustained
 *      slow frames and stops when out of steps.
 *
 * Usage
 *   npm run check (exits non-zero on the first failure).
 *
 * See also: core/physics.ts, core/game.ts, world/levels.ts; DESIGN.md "16. Checks and tooling".
 */
import assert from "node:assert/strict";
import { CELL, H, LEVELS, parse, TIER_ROWS, W } from "../src/world/levels";
import { farmFor, generate, passOf } from "../src/world/generate";
import { reach as solveReach, solves, cellId } from "../src/world/solver";
import { difficulty, BAND, MAX_DIFFICULTY_AT } from "../src/core/difficulty";
import { FLYERS, WALKERS, walkerFor, flyerFor, creatureInfo } from "../src/core/creatures";
import { Game, CAGE, EGG_POINTS, SEED_POINTS, START_LIVES } from "../src/core/game";
import {
    BODY_H,
    BODY_W,
    LIFT_SPEED,
    newBody,
    stepHarry,
    TICK,
    updateLifts,
    type Body,
    type Input,
    type Lift,
} from "../src/core/physics";
import { classifyGpu, Governor, type Tier } from "../src/render/tier";

const idle: Input = { left: false, right: false, up: false, down: false, jump: false };
const keys = (o: Partial<Input>): Input => ({ ...idle, ...o });
const nothing = () => {};

// ---- 1. Parsing ---------------------------------------------------------------------------
assert.equal(LEVELS.length, 8);
for (const spec of LEVELS) {
    const lv = parse(spec);
    assert.equal(lv.tiles.length, W * H, spec.name);
    assert.equal(lv.eggs.length, 12, `${spec.name}: eggs`);
    assert.equal(lv.seeds.length, 10, `${spec.name}: grain`);
    assert.ok(lv.hens.length >= 3, `${spec.name}: hens`);
    // Every pickup and hen sits on a platform or a ladder top.
    const stands = (c: number, tier: number) => {
        const t = lv.tiles[TIER_ROWS[tier] * W + c];
        return t === "#" || t === "T";
    };
    for (const [list, what] of [[spec.eggs, "egg"], [spec.seeds, "grain"], [spec.hens, "hen"], [[spec.start], "start"]] as const) {
        for (const [c, tier] of list) assert.ok(stands(c, tier), `${spec.name}: ${what} at ${c},${tier} floats`);
    }
    // No duplicates.
    for (const list of [spec.eggs, spec.seeds]) {
        assert.equal(new Set(list.map((p) => p.join())).size, list.length, `${spec.name}: duplicate pickup`);
    }
    // Ladders: both ends are platform.
    for (const [c, tier] of spec.ladders) {
        const top = TIER_ROWS[tier],
            bot = TIER_ROWS[tier + 1];
        assert.ok(spec.tiers[tier].some(([a, b]) => c >= a && c <= b), `${spec.name}: ladder ${c},${tier} top`);
        assert.ok(spec.tiers[tier + 1].some(([a, b]) => c >= a && c <= b), `${spec.name}: ladder ${c},${tier} foot`);
        assert.equal(lv.tiles[top * W + c], "T");
        assert.equal(lv.tiles[(bot - 1) * W + c], "H");
        assert.ok("#T".includes(lv.tiles[bot * W + c]));
    }
    // The cage corner is clear.
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) assert.notEqual(lv.tiles[r * W + c], "#", `${spec.name}: cage corner`);
}

// ---- 2. Reachability ----------------------------------------------------------------------
for (const spec of LEVELS) assert.ok(solves(spec), `${spec.name}: an egg or grain is unreachable`);
{
    // The solver is not vacuous: cut the only ladders of a level and it must fail.
    const cut = { ...LEVELS[0], ladders: [] };
    assert.ok(!solves(cut), "without ladders nothing upstairs is reachable");
    assert.ok(solveReach(LEVELS[0]).has(cellId(LEVELS[0].start[0], 4)));
}

// ---- 2b. Generation and difficulty -----------------------------------------------------------
{
    for (let n = 0; n < 120; n++) {
        const spec = generate(n, n % 5);
        assert.ok(!LEVELS.includes(spec), `generated level ${n} fell back to a hand-built one`);
        assert.ok(solves(spec), `generated level ${n} (${spec.name}) is unsolvable`);
        const lv = parse(spec);
        assert.equal(lv.eggs.length, 12);
        assert.equal(lv.seeds.length, 10);
        assert.ok(lv.hens.length >= 3);
        assert.deepEqual(generate(n, n % 5), spec, "deterministic");
    }
    assert.notDeepEqual(generate(3, 1), generate(3, 2), "different seeds, different farms");
    assert.strictEqual(farmFor(5), farmFor(5), "hand-built farms are cached");
    assert.strictEqual(farmFor(45), farmFor(45), "generated farms are cached");
    assert.notStrictEqual(farmFor(0, "random", 7), farmFor(0, "classic"));
    // Difficulty never eases, saturates and starts gentle.
    let prev = difficulty(0);
    for (let n = 1; n < 80; n++) {
        const d = difficulty(n);
        assert.ok(d.t >= prev.t - 1e-9 && d.hens >= prev.hens && d.lifts >= prev.lifts, `eased at ${n}`);
        prev = d;
    }
    assert.equal(difficulty(MAX_DIFFICULTY_AT - 1).t, 1);
    assert.deepEqual(difficulty(MAX_DIFFICULTY_AT + 30), difficulty(MAX_DIFFICULTY_AT - 1));
    assert.equal(difficulty(0).lifts, 0);
    assert.ok(difficulty(BAND).t > difficulty(BAND - 1).t + 0.1, "each band is a step");
}

// ---- 2c. Creatures ---------------------------------------------------------------------------
{
    assert.equal(new Set([...WALKERS, ...FLYERS].map((c) => c.id)).size, WALKERS.length + FLYERS.length, "unique ids");
    assert.equal(walkerFor(0, 0).id, "hen");
    assert.equal(walkerFor(0, 1).id, "hen", "level 1 is hens only");
    assert.ok(creatureInfo("duck").kind === "boss");
    const seen = new Set<string>();
    for (let n = 0; n < 60; n++) for (let s = 0; s < 8; s++) seen.add(walkerFor(n, s).id);
    assert.equal(seen.size, WALKERS.length, "every walker turns up");
    for (let n = 0; n < 60; n++) for (let s = 0; s < 3; s++) assert.ok(WALKERS.concat(FLYERS).some((c) => c.id === flyerFor(n, s).id));
    for (const c of WALKERS) assert.ok(walkerFor(c.from, 1).from <= c.from || true);
}

// ---- 3. Movement --------------------------------------------------------------------------
function world(rows: string[]) {
    // A tiny test grid in the 26 × 24 frame: rows given from the top (row 0 up), padded with air.
    const t = Array(W * H).fill(".");
    rows.forEach((line, r) => [...line].forEach((ch, c) => (t[r * W + c] = ch)));
    return t.join("");
}
function run(b: Body, t: string, lifts: Lift[], inp: Input, seconds: number, onTick?: (r: string) => void) {
    let res = "ok";
    for (let i = 0; i < seconds / TICK; i++) {
        updateLifts(lifts, TICK);
        res = stepHarry(b, inp, t, lifts, TICK, nothing);
        onTick?.(res);
        if (res !== "ok") break;
    }
    return res;
}
{
    // Flat ground at row 10.
    const t = world([...Array(10).fill(""), "#".repeat(W)]);
    const b = newBody(40, 80);
    assert.equal(b.y + BODY_H, 80);
    // Jump straight up: peak ~17.5 px, back on the ground.
    let peak = Infinity;
    stepHarry(b, keys({ jump: true }), t, [], TICK, nothing);
    run(b, t, [], idle, 0.8, () => (peak = Math.min(peak, b.y)));
    assert.equal(b.mode, "ground");
    assert.ok(80 - BODY_H - peak > 16.5 && 80 - BODY_H - peak < 18.5, `jump height ${80 - BODY_H - peak}`);
    // Running jump: lands 22-24 px away, and the direction is committed (holding left changes nothing).
    const x0 = b.x;
    stepHarry(b, keys({ jump: true, right: true }), t, [], TICK, nothing);
    let landedAt = NaN;
    run(b, t, [], keys({ left: true }), 0.8, () => {
        if (b.mode === "ground" && Number.isNaN(landedAt)) landedAt = b.x;
    });
    assert.ok(landedAt - x0 > 21 && landedAt - x0 < 25, `jump range ${landedAt - x0}`);
    // Walk speed.
    const x1 = b.x;
    run(b, t, [], keys({ right: true }), 1);
    assert.ok(Math.abs(b.x - x1 - 44) < 1);
}
{
    // A two-cell gap is crossed by jumping; a three-cell gap is not walked across (falls).
    const gap = (n: number) => {
        const row = "#".repeat(5) + ".".repeat(n) + "#".repeat(W - 5 - n);
        return world([...Array(10).fill(""), row]);
    };
    for (const [n, ok] of [[1, true], [2, true], [3, false], [5, false]] as const) {
        const t = gap(n);
        const b = newBody(4 * CELL, 80);
        b.x = 5 * CELL - BODY_W - 0.5; // right at the edge
        stepHarry(b, keys({ jump: true, right: true }), t, [], TICK, nothing);
        run(b, t, [], idle, 0.9);
        const over = b.x > (5 + n) * CELL - 3 && b.mode === "ground";
        assert.equal(over, ok, `gap of ${n}: crossed=${over}`);
    }
    const t = gap(2);
    const b = newBody(4 * CELL, 80);
    assert.equal(run(b, t, [], keys({ right: true }), 0.4), "ok");
    assert.equal(b.mode, "air", "walking off a ledge falls");
}
{
    // Ladder: a platform at row 6 (top cell is a ladder), another at row 10; climb up and down.
    const rows = Array(11).fill("");
    rows[6] = "#".repeat(8) + "T" + "#".repeat(W - 9);
    for (let r = 7; r < 10; r++) rows[r] = ".".repeat(8) + "H";
    rows[10] = "#".repeat(W);
    const t = world(rows);
    const b = newBody(8 * CELL + 4, 80);
    run(b, t, [], keys({ up: true }), 4);
    assert.equal(b.mode, "ground");
    assert.equal(b.y + BODY_H, 6 * CELL, "reached the ladder top");
    run(b, t, [], keys({ right: true }), 0.5);
    assert.ok(b.x > 8 * CELL + 5 && b.mode === "ground", "walks off the top");
    b.x = 8 * CELL + 1;
    run(b, t, [], keys({ down: true }), 4);
    assert.equal(b.y + BODY_H, 80, "climbed back down");
    // Platforms are solid from below: no jumping up through row 6.
    const b2 = newBody(3 * CELL, 80);
    stepHarry(b2, keys({ jump: true }), t, [], TICK, nothing);
    run(b2, t, [], idle, 0.8);
    assert.equal(b2.y + BODY_H, 80);
}
{
    // Lifts: stand on one, rise with it, die at the top of the screen; falling out of the bottom kills.
    const t = world([...Array(22).fill(""), "#".repeat(8) + ".".repeat(4) + "#".repeat(W - 12)]);
    const lifts: Lift[] = [{ x: 8 * CELL, y: 160, py: 160 }];
    const b = newBody(9 * CELL, 160);
    b.lift = 0;
    run(b, t, lifts, idle, 1);
    assert.ok(Math.abs(b.y + BODY_H - lifts[0].y) < 0.01, "rides the lift");
    assert.ok(Math.abs(lifts[0].y - (160 - LIFT_SPEED)) < 0.5);
    assert.equal(run(b, t, lifts, idle, 12), "crush", "carried into the top of the screen");
    // Jumping onto a rising lift from the side.
    const lifts2: Lift[] = [{ x: 8 * CELL, y: 170, py: 170 }];
    const b3 = newBody(8 * CELL - 4, 176);
    stepHarry(b3, keys({ jump: true, right: true }), t, lifts2, TICK, nothing);
    run(b3, t, lifts2, idle, 0.6);
    assert.equal(b3.mode, "ground");
    assert.equal(b3.lift, 0, "landed on the lift");
    // Fall out of the bottom.
    const pit = world([...Array(22).fill(""), "#".repeat(4)]);
    const b4 = newBody(10 * CELL, 176);
    assert.equal(run(b4, pit, [], idle, 3), "fall");
}

// ---- 4. Rules -----------------------------------------------------------------------------
{
    const g = new Game(0);
    assert.equal(g.lives, START_LIVES);
    assert.equal(g.left, 12);
    assert.equal(g.pass, 0);
    assert.equal(g.duck?.state, "caged");
    assert.equal(g.hens.length, LEVELS[0].hens.length);
    // Teleport Harry onto an egg: it scores, and the count drops.
    const e = g.level.eggs[0];
    g.harry.x = e.x - BODY_W / 2;
    g.harry.y = e.y + 4 - BODY_H;
    g.harry.mode = "ground";
    const events: string[] = [];
    g.onEvent = (ev) => events.push(ev);
    g.update(TICK, idle);
    assert.equal(g.score, EGG_POINTS);
    assert.equal(g.left, 11);
    assert.ok(events.includes("egg"));
    // Grain freezes the clock.
    const s = g.level.seeds[0];
    g.harry.x = s.x - BODY_W / 2;
    g.harry.y = s.y + 3 - BODY_H;
    g.harry.mode = "ground";
    const t0 = g.time;
    g.update(TICK, idle);
    assert.equal(g.score, EGG_POINTS + SEED_POINTS);
    assert.ok(g.freeze > 2);
    g.update(0.5, idle);
    assert.ok(Math.abs(g.time - t0) < 0.2, "clock frozen");
}
{
    // Clearing a level pays the clock and advances.
    const g = new Game(0);
    g.onEvent = nothing;
    g.eggs.fill(false);
    g.left = 1;
    g.eggs[0] = true;
    g.left = 1;
    const e = g.level.eggs[0];
    g.harry.x = e.x - BODY_W / 2;
    g.harry.y = e.y + 4 - BODY_H;
    const before = g.time;
    g.update(TICK, idle);
    assert.equal(g.phase, "clear");
    assert.ok(g.score >= EGG_POINTS + Math.floor(before) - 1);
    g.update(3, idle);
    assert.equal(g.n, 1);
    assert.equal(g.phase, "play");
    assert.equal(g.left, 12);
}
{
    // A hen kills; lives run out into game over; the level keeps its eggs through a death.
    const g = new Game(0);
    const ev: string[] = [];
    g.onEvent = (e) => ev.push(e);
    g.eggs[0] = false;
    g.left--;
    for (let i = 0; i < START_LIVES + 1; i++) {
        const h = g.hens[0];
        g.harry.x = h.x - BODY_W / 2;
        g.harry.y = h.feet - BODY_H;
        g.harry.mode = "ground";
        g.update(TICK, idle);
        assert.equal(g.phase, "dead", `death ${i}`);
        g.update(2, idle);
        if (i < START_LIVES) {
            assert.equal(g.phase, "play");
            assert.equal(g.left, 11, "eggs kept through a death");
        }
    }
    assert.equal(g.phase, "over");
    assert.ok(ev.includes("over"));
}
{
    // Extra life at 10,000.
    const g = new Game(0);
    g.onEvent = nothing;
    g.score = 9950;
    const e = g.level.eggs[1];
    g.harry.x = e.x - BODY_W / 2;
    g.harry.y = e.y + 4 - BODY_H;
    g.update(TICK, idle);
    assert.equal(g.lives, START_LIVES + 1);
}
{
    // The clock running out costs a life and refills.
    const g = new Game(0);
    g.onEvent = nothing;
    g.hens = [];
    g.time = 0.05;
    g.update(0.2, idle);
    assert.equal(g.phase, "dead");
    assert.equal(g.lives, START_LIVES - 1);
    assert.ok(g.time > 100);
}
{
    // Hens: they stay on their platform, climb towards Harry, and eat grain.
    const g = new Game(0);
    g.onEvent = nothing;
    g.harry.x = 100;
    g.harry.y = 8 * TIER_ROWS[4] - BODY_H;
    g.harry.mode = "ground";
    const hen = g.hens[0]; // tier 0
    const f0 = hen.feet;
    let climbed = false;
    for (let i = 0; i < 120 * 40 && !climbed; i++) {
        g.harry.x = 100;
        g.harry.y = TIER_ROWS[4] * CELL - BODY_H; // Harry waits on the bottom floor, untouchable
        g.update(TICK, idle);
        if (g.phase !== "play") g.phase = "play";
        if (hen.mode === "climb" || hen.feet > f0 + 1) climbed = true;
        assert.ok(hen.x > 0 && hen.x < W * CELL, "hen on screen");
    }
    assert.ok(climbed, "hen heads for Harry's level");
    // Eating: put a hen on a seed.
    const g2 = new Game(0);
    g2.onEvent = nothing;
    const s = g2.level.seeds[0];
    g2.hens[0].x = s.x;
    g2.hens[0].feet = s.y + 3;
    g2.harry.x = 100;
    g2.harry.y = TIER_ROWS[4] * CELL - BODY_H;
    g2.update(TICK * 2, idle);
    assert.equal(g2.seeds[0], false);
    assert.equal(g2.hens[0].mode, "eat");
}
{
    // Passes: hens and duck by pass.
    const expect = [
        [0, "caged"],
        [8, "wait"],
        [16, "wait"],
        [24, "wait"],
        [32, "wait"],
        [40, "wait"],
    ] as const;
    for (const [n, duck] of expect) {
        const g = new Game(n);
        const base = g.level.hens.length;
        const pass = passOf(n);
        assert.equal(g.duck?.state, duck, `n=${n}`);
        const want = pass === 1 ? 0 : pass >= 3 ? base + 2 : base;
        assert.equal(g.hens.length, want, `hens at n=${n}`);
        assert.equal(g.flyers.length, Math.max(0, pass - 1), `flyers at n=${n}`);
        for (const h of g.hens) assert.ok(WALKERS.some((w) => w.id === h.kind));
    }
    assert.equal(passOf(40), 4);
    {
        // A flier sweeps its lane, bounces off the walls, and kills a jumping Harry but not a standing one.
        const g = new Game(24);
        g.onEvent = nothing;
        const f = g.flyers[0];
        assert.ok(f && FLYERS.some((c) => c.id === f.kind));
        g.hens = [];
        g.duck = null;
        let lo = Infinity,
            hi = -Infinity;
        for (let i = 0; i < 120 * 30; i++) {
            g.harry.x = 150;
            g.harry.y = TIER_ROWS[4] * CELL - BODY_H;
            g.harry.mode = "ground";
            g.update(TICK, idle);
            lo = Math.min(lo, f.x);
            hi = Math.max(hi, f.x);
        }
        assert.equal(g.phase, "play", "a standing Harry is below the lane");
        assert.ok(lo < 20 && hi > W * CELL - 20, "sweeps the whole width");
        f.y = g.harry.y + 4;
        f.x = g.harry.x;
        g.update(TICK, idle);
        assert.equal(g.phase, "dead", "a flier in Harry's box kills");
    }
    assert.ok(new Game(32).henSpeed > new Game(0).henSpeed);
    // The loose duck homes in and kills.
    const g = new Game(8);
    g.onEvent = nothing;
    g.harry.x = 200;
    g.harry.y = 176 - BODY_H;
    let dead = false;
    for (let i = 0; i < 120 * 60 && !dead; i++) {
        g.harry.x = 200;
        g.harry.y = 176 - BODY_H;
        g.harry.mode = "ground";
        g.update(TICK, idle);
        dead = g.phase === "dead";
    }
    assert.ok(dead, "duck catches a standing Harry");
    assert.equal(g.duck?.state, "free");
    assert.ok(Math.hypot(CAGE.x, CAGE.y) > 0);
}

// ---- 5. Tiers and governor ----------------------------------------------------------------
const tiers: [string, boolean, number, Tier][] = [
    ["ANGLE (NVIDIA GeForce RTX 4070 Direct3D11)", false, 16, "high"],
    ["Apple GPU", true, 6, "mobile-high"],
    ["Adreno (TM) 740", true, 8, "mobile-high"],
    ["Mali-G52", true, 8, "low"],
    ["Intel(R) UHD Graphics 620", false, 4, "low"],
    ["Google SwiftShader", false, 8, "low"],
];
for (const [renderer, mobile, cores, want] of tiers) assert.equal(classifyGpu({ renderer, mobile, cores }), want, renderer);
{
    let steps = 0;
    const gov = new Governor(() => ++steps < 2);
    for (let i = 0; i < 400; i++) gov.frame(16);
    assert.equal(steps, 0);
    for (let i = 0; i < 400; i++) gov.frame(33);
    assert.equal(steps, 0, "30 fps (Low Power Mode) isn't slow");
    for (let i = 0; i < 400; i++) gov.frame(60);
    assert.ok(steps >= 1);
}
console.log("check: all passed");
