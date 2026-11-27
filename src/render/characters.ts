/**
 * Characters — Harry, the farm and barn creatures, the bugs and the mother duck, in voxel cubes.
 *
 * Purpose
 *   Every character is a small hierarchy of voxel parts (torso, head, legs, wings, shell, …),
 *   each hung from a joint so a pose only has to rotate or move joints. The same part builder
 *   as Mayhem Miner's, with a new cast.
 *
 * Operations
 *   - voxelFaces(boxes): fills a voxel grid from boxes (later boxes paint over earlier ones)
 *     and returns only the faces exposed to air, split into lit and glowing sets. Each voxel
 *     gets a small brightness jitter so the cubes read individually. Pure, no DOM.
 *   - harryModel(): Hen-House Harry: straw hat, red shirt, blue dungarees, boots. Poses idle,
 *     walk, climb (hand over hand), rise, fall, flail (death), cheer (level clear).
 *   - MODELS / modelFor(id, colour): the creatures of core/creatures.ts by id. Walkers: hen,
 *     chick, barn rat, rooster, dung beetle, ladybird, snail, ant, caterpillar, hedgehog,
 *     goose, mole, barn spider. Fliers: bumblebee, barn bat, moth, dragonfly. And the mother duck.
 *     fowl() is one builder behind hen, rooster and goose (neck, comb, tail and size differ).
 *   - Character.pose(state): moves the joints toward the state's target pose, eased by dt, so
 *     idle → walk → jump → fall blend instead of snapping. Freezes when dt is 0 (paused).
 *
 * Usage
 *   view.ts builds the models once per farm and calls pose() every frame; render/preview.ts
 *   shows them turning in How to play.
 *
 * Highlights
 *   - One voxel is 1/8 unit: Harry is 8 × 16 voxels, the game's 8 px grid.
 *   - Models stand on the origin and face +x; z runs across the body (left / right side).
 *   - Each part is at most two meshes (lit + glow), however many voxels it has.
 *   - Each model reports its height `h` in voxels; small creatures are drawn larger so a rat
 *     still looks like what will hurt Harry (every creature's reach is about a farmer's height).
 *
 * See also: core/creatures.ts (the roster), render/view.ts (placement, facing, death tumble);
 * DESIGN.md "9. Rendering" and "9.1 Characters".
 */
import * as THREE from "three";
import { COLORS } from "../core/palette";

export const VOX = 1 / 8;
/** [x, y, z, w, h, d, colour, glow?] in voxels. glow > 0 makes the voxels emit at that HDR strength. */
export type Box = [number, number, number, number, number, number, number, number?];

export type Mode = "idle" | "walk" | "climb" | "rise" | "fall" | "flail" | "cheer" | "eat";
export interface PoseState {
    /** Seconds since the last frame (0 while paused). */
    dt: number;
    /** Seconds, for idle motion. */
    t: number;
    /** Walk cycle in radians, driven by distance moved so feet match the ground. */
    phase: number;
    mode: Mode;
    /** Landing squash, 1 on touchdown easing to 0. */
    land: number;
    /** Model units from the origin up to an anchor above (a spider's silk: 0 for none). */
    reach?: number;
}
export interface Character {
    group: THREE.Group;
    pose(s: PoseState): void;
    /** Height in voxels, so view.ts can enlarge small creatures towards a farmer's height. */
    h: number;
}

export interface FaceSet {
    pos: number[];
    nrm: number[];
    col: number[];
}

/** Unit-cube faces as [normal, 4 corners], wound counter-clockwise seen from outside. */
const FACES = [0, 1, 2].flatMap((ax) =>
    [1, -1].map((s) => {
        const u = (ax + 1) % 3,
            v = (ax + 2) % 3;
        const corner = (a: number, b: number) => {
            const p = [0, 0, 0];
            p[ax] = s > 0 ? 1 : 0;
            p[u] = a;
            p[v] = b;
            return p;
        };
        const quad = [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)];
        const n = [0, 0, 0];
        n[ax] = s;
        return { n, quad: s > 0 ? quad : quad.reverse() };
    })
);

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

export function voxelFaces(boxes: Box[]): { solid: FaceSet; glow: FaceSet } {
    const grid = new Map<string, { x: number; y: number; z: number; c: number; g: number }>();
    for (const [x0, y0, z0, w, h, d, c, g = 0] of boxes)
        for (let x = x0; x < x0 + w; x++)
            for (let y = y0; y < y0 + h; y++)
                for (let z = z0; z < z0 + d; z++) grid.set(key(x, y, z), { x, y, z, c, g });
    const solid: FaceSet = { pos: [], nrm: [], col: [] };
    const glow: FaceSet = { pos: [], nrm: [], col: [] };
    const rgb = new THREE.Color();
    for (const { x, y, z, c, g } of grid.values()) {
        const j = 0.9 + 0.16 * hash(x, y, z);
        rgb.setHex(c).multiplyScalar(g > 0 ? g : j);
        const set = g > 0 ? glow : solid;
        for (const { n, quad } of FACES) {
            if (grid.has(key(x + n[0], y + n[1], z + n[2]))) continue;
            for (const i of [0, 1, 2, 0, 2, 3]) {
                const q = quad[i];
                set.pos.push(x + q[0], y + q[1], z + q[2]);
                set.nrm.push(n[0], n[1], n[2]);
                set.col.push(rgb.r, rgb.g, rgb.b);
            }
        }
    }
    return { solid, glow };
}

function hash(x: number, y: number, z: number) {
    const h = Math.imul(x + 101, 73856093) ^ Math.imul(y + 211, 19349663) ^ Math.imul(z + 307, 83492791);
    return ((h >>> 0) % 997) / 997;
}

function mesh(f: FaceSet, mat: THREE.Material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(f.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(f.nrm, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(f.col, 3));
    g.scale(VOX, VOX, VOX);
    return new THREE.Mesh(g, mat);
}

/**
 * A voxel part hung from a joint: the joint sits at `at` (voxels, parent space) and the boxes
 * are shifted by `offset` (voxels) so the joint lands where the part should pivot.
 */
function part(boxes: Box[], offset: number[], at: number[], extra: THREE.MeshStandardMaterialParameters = {}) {
    const joint = new THREE.Group();
    joint.position.set(at[0] * VOX, at[1] * VOX, at[2] * VOX);
    const { solid, glow } = voxelFaces(boxes);
    for (const [f, mat] of [
        [solid, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, ...extra })],
        [glow, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })],
    ] as const) {
        if (!f.pos.length) continue;
        const m = mesh(f, mat);
        m.position.set(offset[0] * VOX, offset[1] * VOX, offset[2] * VOX);
        joint.add(m);
    }
    return joint;
}

/** Ease rotation / position channels toward a target; k is the frame's blend (0 = frozen, 1 = snap). */
const to = (v: THREE.Vector3 | THREE.Euler, axis: "x" | "y" | "z", target: number, k: number) =>
    (v[axis] += (target - v[axis]) * k);
/** Frame blend toward a target at `rate` per second; a negative dt (rAF timestamps can predate a
 * performance.now() read) must not overshoot, so it counts as no time. */
const blend = (dt: number, rate: number) => 1 - Math.exp(-Math.max(0, dt) * rate);
const shade = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();

const EYE = COLORS.eye;
const BLACK = 0x14141c;

// ---- Harry ----------------------------------------------------------------------------------------

export function harryModel(): Character {
    const { overalls, shirt, skin, straw, boots } = COLORS;
    const dark = shade(overalls, 0.7),
        hair = 0x6a3e22,
        belt = 0x5a3a22;
    const root = new THREE.Group();
    const legBoxes: Box[] = [
        [0, 0, 0, 3, 2, 2, boots],
        [0, 0, 0, 3, 1, 2, shade(boots, 0.6)],
        [0, 2, 0, 2, 4, 2, overalls],
        [0, 2, 0, 2, 1, 2, dark],
    ];
    const legs = [-1, 1].map((z) => part(legBoxes, [-1, -6, -1], [0, 6, z]));
    const torso = part(
        [
            [0, 0, 0, 4, 5, 4, overalls],
            [0, 3, 0, 4, 2, 4, shirt],
            [3, 2, 1, 1, 2, 2, overalls],
            [3, 4, 0, 1, 1, 1, overalls],
            [3, 4, 3, 1, 1, 1, overalls],
            [0, 3, 0, 1, 2, 1, overalls],
            [0, 3, 3, 1, 2, 1, overalls],
            [0, 1, 0, 4, 1, 4, belt],
            [3, 1, 1, 1, 1, 2, straw],
        ],
        [-2, 0, -2],
        [0, 6, 0]
    );
    const armBoxes: Box[] = [
        [0, 1, 0, 2, 3, 1, shirt],
        [0, 0, 0, 2, 1, 1, skin],
    ];
    const arms = [-2.5, 2.5].map((z) => part(armBoxes, [-1, -4, -0.5], [0, 5, z]));
    const head = part(
        [
            [0, 0, 0, 4, 3, 5, skin],
            [0, 0, 0, 1, 3, 5, hair],
            [1, 1, -1, 1, 1, 1, skin],
            [1, 1, 5, 1, 1, 1, skin],
            [3, 2, 1, 1, 1, 1, BLACK],
            [3, 2, 3, 1, 1, 1, BLACK],
            [4, 1, 2, 1, 1, 1, shade(skin, 0.85)],
            [3, 0, 2, 1, 1, 1, shade(skin, 0.7)],
            // The straw hat: a wide brim, a crown, a red band.
            [-1, 3, -1, 6, 1, 7, straw],
            [0, 4, 0, 4, 1, 5, shirt],
            [0, 5, 0, 4, 1, 5, straw],
            [-1, 3, -1, 6, 1, 1, shade(straw, 0.8)],
            [-1, 3, 5, 6, 1, 1, shade(straw, 0.8)],
        ],
        [-2, 0, -2.5],
        [0, 5, 0]
    );
    torso.add(head, ...arms);
    root.add(torso, ...legs);
    const group = new THREE.Group();
    group.add(root);

    const pose = (s: PoseState) => {
        if (s.mode === "flail") {
            const a = s.t * 28;
            arms[0].rotation.z = a;
            arms[1].rotation.z = a + Math.PI;
            legs[0].rotation.z = Math.sin(a) * 0.8;
            legs[1].rotation.z = -Math.sin(a) * 0.8;
            return;
        }
        const k = blend(s.dt, 18);
        let l0 = 0,
            l1 = 0,
            a0 = 0.05,
            a1 = 0.05,
            lean = 0,
            bob = 0,
            look = 0,
            stretch = 1;
        if (s.mode === "walk") {
            const w = Math.sin(s.phase);
            l0 = w * 0.8;
            l1 = -w * 0.8;
            a0 = -w * 0.9;
            a1 = w * 0.9;
            lean = -0.12;
            bob = Math.abs(Math.cos(s.phase)) * 0.6;
        } else if (s.mode === "climb") {
            // Hand over hand, knees up, facing the camera.
            const w = Math.sin(s.phase);
            l0 = 0.5 + w * 0.7;
            l1 = 0.5 - w * 0.7;
            a0 = 2.7 + w * 0.5;
            a1 = 2.7 - w * 0.5;
            bob = Math.abs(w) * 0.4;
        } else if (s.mode === "idle") {
            const b = Math.sin(s.t * 2.4);
            bob = b * 0.15;
            a0 += b * 0.05;
            a1 -= b * 0.05;
            look = Math.sin(s.t * 0.6) * 0.35;
        } else if (s.mode === "cheer") {
            const b = Math.abs(Math.sin(s.t * 9));
            a0 = a1 = 2.9 + Math.sin(s.t * 18) * 0.3;
            l0 = 0.3;
            l1 = -0.3;
            bob = b * 1.6;
            stretch = 1 + b * 0.05;
        } else if (s.mode === "rise") {
            l0 = 0.9;
            l1 = -0.5;
            a0 = 2.6;
            a1 = 2.2;
            lean = -0.1;
            stretch = 1.06;
        } else {
            const f = Math.sin(s.t * 9) * 0.25;
            l0 = 0.3;
            l1 = -0.2;
            a0 = 1.9 + f;
            a1 = 1.9 - f;
            lean = 0.08;
        }
        // Wrap arms back from a flail so they don't unwind several turns.
        for (const a of arms) a.rotation.z = Math.atan2(Math.sin(a.rotation.z), Math.cos(a.rotation.z));
        to(legs[0].rotation, "z", l0, k);
        to(legs[1].rotation, "z", l1, k);
        to(arms[0].rotation, "z", a0, k);
        to(arms[1].rotation, "z", a1, k);
        to(torso.rotation, "z", lean, k);
        to(torso.position, "y", (6 + bob) * VOX, k);
        to(head.rotation, "y", look, blend(s.dt, 4));
        const land = Math.min(1, Math.max(0, s.land));
        root.scale.set(1 + 0.12 * land, (1 - 0.22 * land) * stretch, 1 + 0.12 * land);
    };
    return { group, pose, h: 16 };
}

// ---- Fowl: hen, rooster, goose ---------------------------------------------------------------------

interface Fowl {
    body: number;
    wing: number;
    beak: number;
    comb: number;
    leg: number;
    tail: number[];
    /** Body length, height, width and leg height, in voxels. */
    len: number;
    bh: number;
    w: number;
    legH: number;
    neck: number;
    combH: number;
    /** A second tail colour for sweeping tail feathers (rooster). */
    sweep?: number;
}

function fowl(o: Fowl): Character {
    const { len, bh, w, legH, neck } = o;
    const legs = [-1.5, 1.5].map((z) =>
        part(
            [
                [0, 1, 0, 1, legH - 1, 1, o.leg],
                [-1, 0, -1, 4, 1, 3, o.leg],
            ],
            [-0.5, -legH, -0.5],
            [0, legH, z * (w / 5)]
        )
    );
    const bx = len / 2;
    const boxes: Box[] = [
        [0, 0, 0, len, bh, w, o.body],
        [1, 0, 0, len - 2, 1, w, shade(o.body, 0.82)],
        // Tail: stiff feathers sweeping up and back.
        [-2, bh - 3, Math.floor(w / 2) - 1, 2, 4, 3, o.tail[0]],
        [-3, bh - 1, Math.floor(w / 2) - 1, 1, 4, 3, o.tail[1] ?? o.tail[0]],
    ];
    if (o.sweep) boxes.push([-4, bh + 2, Math.floor(w / 2) - 1, 1, 4, 3, o.sweep], [-5, bh + 5, Math.floor(w / 2) - 1, 1, 3, 3, o.sweep]);
    const body = part(boxes, [-bx, 0, -w / 2], [0, legH, 0]);
    const wings = [-1, 1].map((side) =>
        part(
            [
                [0, 0, 0, len - 3, bh - 2, 1, o.wing],
                [0, 0, 0, len - 3, 1, 1, shade(o.wing, 0.8)],
            ],
            [-(len - 3) / 2, -(bh - 2) / 2, 0],
            [-0.5, legH + bh / 2, side * (w / 2 + 0.5)]
        )
    );
    const eyeZ = 1;
    const head = part(
        [
            [0, 0, -1, 2, neck, 2, o.body],
            [0, neck, -1.5, 3, 3, 3, o.body],
            [3, neck + 1, -0.5, 2, 1, 1, o.beak],
            [3, neck, -0.5, 1, 1, 1, shade(o.beak, 0.85)],
            [0, neck + 3, -0.5, 3, o.combH, 1, o.comb],
            [2, neck - 1, -0.5, 1, 2, 1, o.comb],
            [2, neck + 2, -1.5 - 0.5, 1, 1, 1, BLACK],
            [2, neck + 2, eyeZ + 0.5, 1, 1, 1, BLACK],
        ],
        [-0.5, 0, 0],
        [bx - 1, bh - 3, 0]
    );
    body.add(head, ...wings);
    const group = new THREE.Group();
    group.add(body, ...legs);
    return {
        group,
        h: legH + bh + neck + 3 + o.combH,
        pose: (s) => {
            const w2 = Math.sin(s.phase);
            if (s.mode === "eat") {
                head.rotation.z = -1.0 + Math.sin(s.t * 16) * 0.35;
                head.position.x = (bx - 1) * VOX;
                legs[0].rotation.z = legs[1].rotation.z = 0;
                body.position.y = legH * VOX;
                return;
            }
            const moving = s.mode === "walk";
            legs[0].rotation.z = moving ? w2 * 0.8 : 0;
            legs[1].rotation.z = moving ? -w2 * 0.8 : 0;
            body.position.y = (legH + (moving ? Math.abs(Math.cos(s.phase)) * 0.6 : 0)) * VOX;
            // The head pecks forward and back with each stride.
            head.position.x = (bx - 1 + (moving ? Math.sin(s.phase * 2) * 0.9 : 0)) * VOX;
            head.rotation.z = moving ? Math.sin(s.phase * 2 + 1) * 0.1 : Math.sin(s.t * 1.7) * 0.06;
            // Wings tucked, with a flutter on a hurried climb.
            const f = s.mode === "climb" ? Math.sin(s.t * 26) * 0.5 : 0;
            wings[0].rotation.x = f;
            wings[1].rotation.x = -f;
        },
    };
}

const hen = (c: number) =>
    fowl({ body: c, wing: shade(c, 0.88), beak: 0xffa83a, comb: 0xe8473f, leg: 0xe89a3a, tail: [shade(c, 0.9), shade(c, 0.75)], len: 6, bh: 5, w: 5, legH: 5, neck: 2, combH: 2 });
const rooster = (c: number) =>
    fowl({ body: c, wing: 0x8a3a1a, beak: 0xffa83a, comb: 0xd02a2a, leg: 0xe89a3a, tail: [0x3a8a5a, 0x2a5aa0], sweep: 0x3ac090, len: 7, bh: 6, w: 5, legH: 5, neck: 3, combH: 3 });
const goose = (c: number) =>
    fowl({ body: c, wing: shade(c, 0.85), beak: 0xff8a2a, comb: c, leg: 0xff8a2a, tail: [shade(c, 0.9), shade(c, 0.8)], len: 8, bh: 6, w: 6, legH: 3, neck: 6, combH: 0 });

function chick(c: number): Character {
    const body = part(
        [
            [0, 0, 0, 5, 4, 4, c],
            [1, 0, 0, 3, 1, 4, shade(c, 0.85)],
            [0, 3, 1, 1, 2, 2, shade(c, 0.85)],
            [4, 2, 0, 3, 3, 4, shade(c, 1.1)],
            [7, 3, 1, 1, 1, 2, 0xff8a2a],
            [6, 4, 0, 1, 1, 1, BLACK],
            [6, 4, 3, 1, 1, 1, BLACK],
        ],
        [-3, 0, -2],
        [0, 2, 0]
    );
    const legs = [-1, 1].map((z) => part([[0, 0, 0, 2, 1, 1, 0xff8a2a], [0, 1, 0, 1, 1, 1, 0xff8a2a]], [-0.5, -2, -0.5], [0.5, 2, z]));
    const group = new THREE.Group();
    group.add(body, ...legs);
    return {
        group,
        h: 9,
        pose: (s) => {
            const hop = Math.abs(Math.sin(s.phase));
            body.position.y = (2 + hop * 1.8) * VOX;
            body.rotation.z = Math.sin(s.phase) * 0.12;
            legs[0].rotation.z = Math.sin(s.phase) * 0.9;
            legs[1].rotation.z = -Math.sin(s.phase) * 0.9;
        },
    };
}

// ---- Barn and field creatures -----------------------------------------------------------------------

function rat(c: number): Character {
    const dk = shade(c, 0.6),
        pink = 0xe8a0a0;
    const body = part(
        [
            [0, 0, 0, 8, 4, 4, c],
            [1, 0, 0, 6, 1, 4, shade(c, 0.75)],
            [8, 0, 1, 3, 3, 2, shade(c, 1.1)],
            [11, 1, 1, 1, 1, 2, pink],
            [8, 3, 0, 1, 2, 1, pink],
            [8, 3, 3, 1, 2, 1, pink],
            [9, 2, 0, 1, 1, 1, EYE],
            [9, 2, 3, 1, 1, 1, EYE],
            [4, 4, 1, 3, 1, 2, dk],
        ],
        [-5, 0, -2],
        [0, 2, 0]
    );
    // A long thin tail that swishes.
    const tail = part([[0, 0, 0, 3, 1, 1, pink], [3, 0, 0, 3, 1, 1, shade(pink, 0.85)]], [-6, 0, -0.5], [-5, 3, 0]);
    const legs = [-1.5, 1.5].flatMap((z) => [-2.5, 2.5].map((x) => part([[0, 0, 0, 1, 2, 1, dk], [0, 0, 0, 2, 1, 1, dk]], [-0.5, -2, -0.5], [x, 2, z])));
    const group = new THREE.Group();
    group.add(body, tail, ...legs);
    return {
        group,
        h: 7,
        pose: (s) => {
            legs.forEach((l, i) => (l.rotation.z = Math.sin(s.phase * 1.8 + i * 1.6) * 0.7));
            body.position.y = (2 + Math.abs(Math.sin(s.phase * 1.8)) * 0.5) * VOX;
            tail.rotation.y = Math.sin(s.t * 6) * 0.5;
            tail.rotation.z = Math.sin(s.t * 3) * 0.15;
        },
    };
}

function beetle(c: number, spots = false): Character {
    const dk = shade(c, 0.65),
        leg = shade(c, 0.35);
    const boxes: Box[] = [
        [0, 0, 0, 8, 2, 6, c],
        [1, 2, 1, 6, 1, 4, c],
        [2, 3, 2, 4, 1, 2, shade(c, 1.35)],
        [0, 0, 0, 8, 1, 6, dk],
        [8, 0, 1, 2, 2, 4, spots ? BLACK : dk],
        [9, 1, 1, 1, 1, 1, spots ? 0xffffff : EYE, 3],
        [9, 1, 4, 1, 1, 1, spots ? 0xffffff : EYE, 3],
        [10, 0, 1, 1, 1, 1, dk],
        [10, 0, 4, 1, 1, 1, dk],
    ];
    if (spots) {
        // A split shell with black spots.
        boxes.push([0, 1, 2, 8, 2, 1, BLACK], [1, 3, 1, 2, 1, 1, BLACK], [5, 3, 4, 2, 1, 1, BLACK], [2, 2, 4, 1, 1, 1, BLACK], [6, 2, 1, 1, 1, 1, BLACK]);
    }
    const body = part(boxes, [-5, 0, -3], [0, 3, 0], { roughness: 0.45 });
    const legs = [-3, 0, 3].flatMap((x, i) =>
        [-1, 1].map((side) => {
            const l = part(
                side > 0
                    ? [[0, 2, 0, 1, 1, 2, leg], [0, 0, 2, 1, 2, 1, leg]]
                    : [[0, 2, -2, 1, 1, 2, leg], [0, 0, -3, 1, 2, 1, leg]],
                [-0.5, -3, 0],
                [x, 3, side * 3]
            );
            l.userData.gait = (i + (side > 0 ? 1 : 0)) % 2;
            return l;
        })
    );
    const group = new THREE.Group();
    group.add(body, ...legs);
    return {
        group,
        h: 5,
        pose: (s) => {
            for (const l of legs) l.rotation.z = Math.sin(s.phase * 1.5 + l.userData.gait * Math.PI) * 0.5;
            body.position.y = (3 + Math.abs(Math.sin(s.phase * 1.5)) * 0.4) * VOX;
        },
    };
}

const ladybird = (c: number) => beetle(c, true);

function snail(c: number): Character {
    const flesh = 0xd8c8a0;
    const foot = part(
        [
            [0, 0, 0, 9, 2, 4, flesh],
            [8, 2, 0, 2, 2, 4, flesh],
            [9, 4, 0, 1, 3, 1, flesh],
            [9, 4, 3, 1, 3, 1, flesh],
            [9, 7, 0, 1, 1, 1, BLACK],
            [9, 7, 3, 1, 1, 1, BLACK],
        ],
        [-5, 0, -2],
        [0, 0, 0]
    );
    // The shell: stacked rings that taper up.
    const shell = part(
        [
            [0, 0, 0, 6, 6, 4, c],
            [1, 6, 0, 4, 1, 4, c],
            [1, 1, -0, 4, 4, 4, shade(c, 0.75)],
            [2, 2, 0, 2, 2, 4, shade(c, 1.35)],
        ],
        [-4, 0, -2],
        [-1, 2, 0]
    );
    const group = new THREE.Group();
    group.add(foot, shell);
    return {
        group,
        h: 9,
        pose: (s) => {
            const w = Math.sin(s.phase * 0.8);
            foot.scale.x = 1 + w * 0.08;
            shell.rotation.z = w * 0.06;
            shell.position.y = (2 + Math.abs(w) * 0.3) * VOX;
        },
    };
}

function ant(c: number): Character {
    const dk = shade(c, 0.55);
    const body = part(
        [
            [0, 0, 0, 4, 4, 3, c],
            [4, 1, 0, 2, 2, 3, dk],
            [6, 0, 0, 4, 3, 3, c],
            [10, 1, 0, 1, 1, 1, EYE, 3],
            [10, 1, 2, 1, 1, 1, EYE, 3],
            [10, 3, 0, 2, 1, 1, dk],
            [10, 3, 2, 2, 1, 1, dk],
        ],
        [-6, 0, -1.5],
        [0, 3, 0],
        { roughness: 0.4 }
    );
    const legs = [-1.5, 3, 7].flatMap((x, i) =>
        [-1, 1].map((side) => {
            const l = part(
                side > 0 ? [[0, 2, 0, 1, 1, 3, dk], [0, 0, 2, 1, 2, 1, dk]] : [[0, 2, -3, 1, 1, 3, dk], [0, 0, -3, 1, 2, 1, dk]],
                [-0.5, -3, 0],
                [x - 5, 3, side * 1.5]
            );
            l.userData.gait = (i + (side > 0 ? 1 : 0)) % 2;
            return l;
        })
    );
    const group = new THREE.Group();
    group.add(body, ...legs);
    return {
        group,
        h: 6,
        pose: (s) => {
            for (const l of legs) l.rotation.z = Math.sin(s.phase * 2.2 + l.userData.gait * Math.PI) * 0.6;
            body.position.y = (3 + Math.abs(Math.sin(s.phase * 2.2)) * 0.4) * VOX;
        },
    };
}

function caterpillar(c: number): Character {
    const dk = shade(c, 0.6);
    const SEGS = 5;
    const segs = Array.from({ length: SEGS }, (_, i) =>
        part([[0, 0, 0, 2, 3, 3, i % 2 ? dk : c], [0, 0, 0, 2, 1, 3, shade(c, 0.8)]], [-1, 0, -1.5], [2 - i * 2, 0, 0], { roughness: 0.4 })
    );
    const head = part(
        [
            [0, 0, 0, 3, 4, 4, shade(c, 1.25)],
            [2, 2, 0, 1, 1, 1, EYE, 3],
            [2, 2, 3, 1, 1, 1, EYE, 3],
            [2, 0, 1, 1, 1, 2, 0x200810],
            [0, 4, 1, 1, 2, 1, dk],
            [0, 4, 2, 1, 2, 1, dk],
        ],
        [-1.5, 0, -2],
        [4.5, 0, 0],
        { roughness: 0.4 }
    );
    const group = new THREE.Group();
    group.add(...segs, head);
    const rise = (i: number) => Math.max(0, 2 - i) * 2.2;
    return {
        group,
        h: 8,
        pose: (s) => {
            segs.forEach((g, i) => (g.position.y = (rise(i) + Math.abs(Math.sin(s.phase * 1.2 - i * 0.9)) * 1.5) * VOX));
            head.position.y = (rise(-1) + Math.abs(Math.sin(s.phase * 1.2 + 0.9)) * 1.2) * VOX;
            head.rotation.z = Math.sin(s.t * 3) * 0.15;
        },
    };
}

function hedgehog(c: number): Character {
    const dk = shade(c, 0.55),
        face = 0xe0c8a0;
    const boxes: Box[] = [
        [0, 1, 0, 8, 4, 6, c],
        [1, 5, 1, 6, 1, 4, dk],
        [8, 1, 1, 3, 3, 4, face],
        [11, 2, 2, 1, 1, 2, BLACK],
        [9, 4, 1, 1, 1, 1, BLACK],
        [9, 4, 4, 1, 1, 1, BLACK],
    ];
    // Spines: little spikes poking up and back over the whole back.
    for (let x = 0; x < 8; x += 2) for (let z = 0; z < 6; z += 2) boxes.push([x, 5 + ((x + z) % 4 === 0 ? 1 : 0), z, 1, 1, 1, shade(c, 1.4)]);
    boxes.push([-1, 2, 1, 1, 2, 4, dk]);
    const body = part(boxes, [-5, 0, -3], [0, 1, 0], { roughness: 0.9 });
    const feet = [-1, 1].flatMap((z) => [-2, 3].map((x) => part([[0, 0, 0, 2, 1, 1, dk]], [-0.5, -1, -0.5], [x, 1, z * 2])));
    const group = new THREE.Group();
    group.add(body, ...feet);
    return {
        group,
        h: 8,
        pose: (s) => {
            feet.forEach((f, i) => (f.rotation.z = Math.sin(s.phase * 1.8 + i * 1.7) * 0.6));
            body.rotation.z = Math.sin(s.phase * 0.9) * 0.05;
            body.position.y = (1 + Math.abs(Math.sin(s.phase * 1.8)) * 0.4) * VOX;
        },
    };
}

function mole(c: number): Character {
    const dk = shade(c, 0.55),
        claw = 0xf0d8c8,
        snout = 0xe8a8a8;
    const body = part(
        [
            [0, 1, 0, 8, 4, 6, c],
            [1, 5, 1, 6, 1, 4, shade(c, 1.25)],
            [1, 0, 1, 6, 1, 4, dk],
            [8, 1, 2, 2, 2, 2, snout],
            [10, 2, 2, 1, 1, 2, 0xff7a9a, 1.3],
            [7, 4, 1, 1, 1, 1, EYE, 2.5],
            [7, 4, 4, 1, 1, 1, EYE, 2.5],
        ],
        [-5, 0, -3],
        [0, 1, 0],
        { roughness: 0.95 }
    );
    const claws = [-1, 1].map((side) => part([[0, -3, 0, 1, 3, 1, dk], [0, -3, 0, 2, 1, 1, claw]], [-0.5, 0, -0.5], [2.5, 3.5, side * 3.5]));
    const feet = [-1, 1].map((side) => part([[0, -1, 0, 2, 1, 1, dk]], [-1, 0, -0.5], [-3, 1, side * 2.5]));
    const group = new THREE.Group();
    group.add(body, ...claws, ...feet);
    return {
        group,
        h: 7,
        pose: (s) => {
            const w = Math.sin(s.phase * 1.4);
            claws[0].rotation.z = w * 0.7;
            claws[1].rotation.z = -w * 0.7;
            feet[0].rotation.z = -w * 0.5;
            feet[1].rotation.z = w * 0.5;
            body.rotation.x = w * 0.08;
            body.position.y = (1 + Math.abs(w) * 0.4) * VOX;
        },
    };
}

function spider(c: number): Character {
    const dk = shade(c, 0.35);
    const body = part(
        [
            [0, 0, 0, 5, 4, 5, c],
            [1, 4, 2, 3, 1, 1, shade(c, 1.3)],
            [5, 1, 1, 3, 3, 3, shade(c, 0.7)],
            [8, 2, 1, 1, 1, 1, EYE, 3],
            [8, 2, 3, 1, 1, 1, EYE, 3],
        ],
        [-4, 0, -2.5],
        [0, 5, 0],
        { roughness: 0.6 }
    );
    const legs = [-2.5, -1, 0.5, 2].flatMap((x, i) =>
        [-1, 1].map((side) => {
            const l = part(
                side > 0 ? [[0, 0, 0, 1, 1, 3, dk], [0, -4, 2, 1, 4, 1, dk]] : [[0, 0, -3, 1, 1, 3, dk], [0, -4, -3, 1, 4, 1, dk]],
                [-0.5, 0, 0],
                [x, 2, side * 2.5]
            );
            l.userData.k = i + (side > 0 ? 0.5 : 0);
            l.userData.side = side;
            return l;
        })
    );
    body.add(...legs);
    const group = new THREE.Group();
    group.add(body);
    return {
        group,
        h: 9,
        pose: (s) => {
            for (const l of legs) l.rotation.x = l.userData.side * -0.55 + Math.sin(s.phase * 2 + l.userData.k * 2) * 0.3;
            body.rotation.y = Math.sin(s.t * 0.9) * 0.3;
            body.position.y = (5 + Math.abs(Math.sin(s.phase)) * 0.4) * VOX;
        },
    };
}

// ---- Fliers -----------------------------------------------------------------------------------------

/** Wings pair for fliers: `build(side)` returns the boxes for the wing on that side. */
function wingPair(build: (side: number) => Box[], at: (side: number) => number[]) {
    return [-1, 1].map((side) => part(build(side), [0, 0, 0], at(side)));
}

function bee(c: number): Character {
    const dk = BLACK;
    const body = part(
        [
            [0, 0, 0, 7, 4, 4, c],
            [1, 0, 0, 1, 4, 4, dk],
            [3, 0, 0, 1, 4, 4, dk],
            [5, 0, 0, 1, 4, 4, dk],
            [7, 0, 0, 2, 4, 4, dk],
            [9, 1, 0, 1, 1, 1, EYE, 3],
            [9, 1, 3, 1, 1, 1, EYE, 3],
            [-1, 1, 1, 1, 1, 2, 0xdddddd],
            [8, 4, 1, 1, 2, 1, dk],
            [8, 4, 2, 1, 2, 1, dk],
        ],
        [-4, 0, -2],
        [0, 6, 0],
        { roughness: 0.6 }
    );
    const wings = wingPair(
        (side) => [[0, 0, side > 0 ? 0 : -4, 4, 1, 4, 0xe8f4ff]],
        (side) => [-1, 10, side * 1.5]
    );
    for (const w of wings) (w.children[0] as THREE.Mesh).material = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.6, roughness: 0.2 });
    const group = new THREE.Group();
    group.add(body, ...wings);
    return {
        group,
        h: 8,
        pose: (s) => {
            const f = Math.sin(s.t * 46) * 0.7;
            wings[0].rotation.x = 0.6 + f;
            wings[1].rotation.x = -0.6 - f;
            const y = 6 + Math.sin(s.t * 5) * 0.8;
            body.position.y = y * VOX;
            for (const w of wings) w.position.y = (y + 4) * VOX;
            body.rotation.z = Math.sin(s.t * 3) * 0.08;
        },
    };
}

function bat(c: number): Character {
    const dk = shade(c, 0.4);
    const body = part(
        [
            [0, 0, 0, 4, 4, 4, c],
            [1, 4, 0, 1, 2, 1, shade(c, 0.75)],
            [1, 4, 3, 1, 2, 1, shade(c, 0.75)],
            [3, 1, 1, 1, 1, 2, shade(c, 1.35)],
            [3, 2, 0, 1, 1, 1, EYE, 3],
            [3, 2, 3, 1, 1, 1, EYE, 3],
            [3, 0, 1, 1, 1, 1, 0xffffff],
        ],
        [-2, 0, -2],
        [0, 6, 0],
        { roughness: 0.9 }
    );
    const wings = [-1, 1].map((side) => {
        const z = (w: number) => (side > 0 ? 0 : -w);
        return part(
            [
                [-1, 0, z(2), 4, 1, 2, dk],
                [-1, 0, side > 0 ? 2 : -4, 3, 1, 2, dk],
                [-1, 0, side > 0 ? 4 : -5, 2, 1, 1, dk],
            ],
            [0, 0, 0],
            [0, 9, side * 2]
        );
    });
    const group = new THREE.Group();
    group.add(body, ...wings);
    return {
        group,
        h: 8,
        pose: (s) => {
            const f = Math.sin(s.t * 16) * 0.8;
            wings[0].rotation.x = f;
            wings[1].rotation.x = -f;
            const y = 6 + Math.sin(s.t * 4) * 0.8;
            body.position.y = y * VOX;
            for (const w of wings) w.position.y = (y + 3) * VOX;
        },
    };
}

function moth(c: number): Character {
    const dk = shade(c, 0.5),
        wing = shade(c, 0.75),
        spot = shade(c, 1.5);
    const body = part(
        [
            [0, 0, 0, 5, 3, 3, c],
            [4, 0, 0, 1, 3, 3, shade(c, 1.35)],
            [5, 0, 0, 2, 3, 3, dk],
            [6, 1, 0, 1, 1, 1, EYE, 3],
            [6, 1, 2, 1, 1, 1, EYE, 3],
            [5, 3, 0, 1, 2, 1, dk],
            [5, 3, 2, 1, 2, 1, dk],
        ],
        [-3, 0, -1.5],
        [0, 7, 0],
        { roughness: 0.95 }
    );
    const wings = [-1, 1].map((side) => {
        const z = (w: number, at: number) => (side > 0 ? at : -at - w);
        return part(
            [
                [-2, 0, z(3, 0), 6, 1, 3, wing],
                [-1, 0, z(2, 3), 5, 1, 2, wing],
                [0, 0, z(1, 5), 3, 1, 1, dk],
                [0, 0, z(2, 2), 2, 1, 2, spot],
            ],
            [0, 0, 0],
            [0, 9, side * 1.5]
        );
    });
    const group = new THREE.Group();
    group.add(body, ...wings);
    return {
        group,
        h: 9,
        pose: (s) => {
            const f = 0.5 + Math.sin(s.t * 20) * 0.7;
            wings[0].rotation.x = f;
            wings[1].rotation.x = -f;
            const y = 7 + Math.sin(s.t * 5) * 1;
            body.position.y = y * VOX;
            for (const w of wings) w.position.y = (y + 2) * VOX;
        },
    };
}

function dragonfly(c: number): Character {
    const dk = shade(c, 0.5);
    const body = part(
        [
            [0, 0, 0, 12, 2, 2, c],
            [0, 0, 0, 12, 1, 2, dk],
            [12, 0, 0, 3, 3, 3, shade(c, 1.2)],
            [14, 1, 0, 1, 1, 1, EYE, 3],
            [14, 1, 2, 1, 1, 1, EYE, 3],
            [3, 2, 0, 2, 1, 2, dk],
        ],
        [-8, 0, -1.5],
        [0, 6, 0],
        { roughness: 0.3, metalness: 0.2 }
    );
    const glass = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.55, roughness: 0.2 });
    const wings = [-1, 1].flatMap((side) =>
        [3, -1].map((x) => {
            const w = part([[0, 0, side > 0 ? 0 : -5, 3, 1, 5, 0xdff4ff]], [0, 0, 0], [x - 2, 8, side * 1]);
            (w.children[0] as THREE.Mesh).material = glass;
            return w;
        })
    );
    const group = new THREE.Group();
    group.add(body, ...wings);
    return {
        group,
        h: 8,
        pose: (s) => {
            const f = Math.sin(s.t * 40) * 0.5;
            wings.forEach((w, i) => (w.rotation.x = (i < 2 ? 1 : -1) * (0.3 + f * (i % 2 ? -1 : 1))));
            const y = 6 + Math.sin(s.t * 3) * 0.6;
            body.position.y = y * VOX;
            for (const w of wings) w.position.y = (y + 2) * VOX;
        },
    };
}

// ---- The Mother Duck --------------------------------------------------------------------------------

export function duckModel(c: number = COLORS.straw): Character {
    const dk = shade(c, 0.75),
        orange = 0xff8a2a;
    const body = part(
        [
            [0, 0, 0, 10, 7, 8, c],
            [1, 0, 0, 8, 1, 8, dk],
            [-2, 3, 2, 2, 3, 4, dk],
            [-3, 5, 3, 1, 2, 2, dk],
        ],
        [-5, 0, -4],
        [0, 3, 0]
    );
    const head = part(
        [
            [0, 0, 0, 5, 5, 5, c],
            [4, 1, 0, 4, 1, 5, orange],
            [4, 0, 1, 3, 1, 3, shade(orange, 0.85)],
            [3, 3, 0, 1, 1, 1, EYE, 3],
            [3, 3, 4, 1, 1, 1, EYE, 3],
            [2, 5, 1, 2, 1, 3, dk],
        ],
        [-2, 0, -2.5],
        [4.5, 5, 0]
    );
    const wings = [-1, 1].map((side) =>
        part([[0, 0, 0, 8, 1, 6, dk], [0, 0, 0, 3, 1, 6, shade(dk, 0.8)]], [-4, 0, side > 0 ? 0 : -6], [0, 6, side * 3.5])
    );
    const feet = [-2, 2].map((z) => part([[0, 0, 0, 4, 1, 2, orange], [1, 1, 0, 1, 2, 1, orange]], [-1, -3, -1], [1, 3, z]));
    body.add(head);
    const group = new THREE.Group();
    group.add(body, ...wings, ...feet);
    return {
        group,
        h: 14,
        pose: (s) => {
            // Flapping hard when loose; mode "idle" is the caged, restless bob.
            const flying = s.mode !== "idle";
            const f = Math.sin(s.t * (flying ? 14 : 5)) * (flying ? 0.9 : 0.25);
            wings[0].rotation.x = f;
            wings[1].rotation.x = -f;
            body.position.y = (3 + (flying ? Math.sin(s.t * 7) * 0.7 : Math.abs(Math.sin(s.t * 2)) * 0.3)) * VOX;
            head.rotation.z = Math.sin(s.t * 3) * 0.1;
            for (const w of wings) w.position.y = body.position.y + 3 * VOX;
        },
    };
}

// ---- Roster ---------------------------------------------------------------------------------------

/** Model makers by creature id; `c` is the base colour (core/creatures.ts preview colour, jittered per instance). */
export const MODELS: Record<string, (c: number) => Character> = {
    hen,
    chick,
    rat,
    rooster,
    beetle,
    ladybird,
    snail,
    ant,
    caterpillar,
    hedgehog,
    goose,
    mole,
    spider,
    bee,
    bat,
    moth,
    dragonfly,
    duck: duckModel,
    harry: harryModel,
};

export function modelFor(id: string, color: number): Character {
    return (MODELS[id] ?? hen)(color);
}
