/**
 * Props — shared prop geometry, and small animated dioramas of each farm feature for How to play.
 *
 * Purpose
 *   One source for the shapes the farms use, so Help's previews look exactly like the game.
 *
 * Operations
 *   - eggGeometry(): the egg (a squashed-up sphere), shared with render/view.ts.
 *   - seedPileGeometry(): a pile of grain, a pyramid of little uneven cubes (merged into one mesh).
 *   - propModel(id): a diorama for How to play, posed like a Character (render/preview.ts):
 *       egg     spins and glints through the egg colours
 *       grain   a pile that pulses, with sparkles
 *       ladder  Harry climbing hand over hand up and down a ladder
 *       lift    a rising platform with Harry riding it, wrapping from the top back to the bottom
 *       cage    the mother duck in her cage; the bars lift and she bursts out, then it resets
 *   - PROPS: the ids above, in Help order; HAZARDS: Help's text for each (name, tag line, description).
 *
 * Usage
 *   render/view.ts uses the geometry; render/preview.ts calls propModel for Help.
 *
 * See also: render/view.ts (build), render/paint.ts (tileTextures); DESIGN.md "10.1 Screens".
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { COLORS, hdr } from "../core/palette";
import { rng } from "../core/random";
import { duckModel, harryModel, type Character } from "./characters";
import { tileTextures } from "./paint";

export function eggGeometry() {
    const g = new THREE.SphereGeometry(0.3, 14, 10);
    g.scale(0.78, 1.05, 0.78);
    return g;
}

export function seedPileGeometry() {
    const r = rng(9301);
    const parts: THREE.BufferGeometry[] = [];
    // Layers from the ground up: 4 cubes, 2, 1, each uneven and slightly turned.
    const layers: [number, number][] = [
        [4, 0],
        [2, 1],
        [1, 2],
    ];
    for (const [n, level] of layers) {
        for (let i = 0; i < n; i++) {
            const s = 0.13 + r() * 0.04;
            const g = new THREE.BoxGeometry(s, s, s);
            g.rotateY(r() * 1.2);
            g.translate((i - (n - 1) / 2) * 0.17 + (r() - 0.5) * 0.04, s / 2 + level * 0.12, (r() - 0.5) * 0.14);
            parts.push(g);
        }
    }
    const merged = mergeGeometries(parts)!;
    for (const p of parts) p.dispose();
    return merged;
}

export const PROPS = ["egg", "grain", "ladder", "lift", "cage"] as const;
export type PropId = (typeof PROPS)[number];

export const HAZARDS: { id: PropId; name: string; meta: string; blurb: string }[] = [
    {
        id: "egg",
        name: "Eggs",
        meta: "twelve a level · 100 each",
        blurb: "Collect all twelve to clear the level. They glint, so they are easy to spot, and they stay collected even if you lose a life.",
    },
    {
        id: "grain",
        name: "Grain",
        meta: "ten piles · 50 each",
        blurb: "Take a pile and the bonus clock freezes for a moment. Leave it, and the first creature to reach it stops to eat it.",
    },
    {
        id: "ladder",
        name: "Ladders",
        meta: "the only way up",
        blurb: "Platforms are solid: jumping can't get you through them. Press up or down beside a ladder to grab it, and left or right at a floor to step off. Creatures use them too.",
    },
    {
        id: "lift",
        name: "Lifts",
        meta: "rise and wrap",
        blurb: "Jump on and ride up. When a lift reaches the top of the screen it wraps back to the bottom, and so does anything on it: get off before the top, or lose a life.",
    },
    {
        id: "cage",
        name: "The cage",
        meta: "top left",
        blurb: "The Mother Duck watches from her cage. Finish all eight farms and she breaks loose on the next round, homing in on you through walls and floors.",
    },
];

const bar = (w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
    m.position.set(x, y, z);
    return m;
};

function ladderMesh(height: number): THREE.Group {
    const g = new THREE.Group();
    for (const x of [-0.3, 0.3]) g.add(bar(0.07, height, 0.1, COLORS.ladder, x, height / 2));
    for (let y = 0.15; y < height; y += 0.3) g.add(bar(0.6, 0.06, 0.08, COLORS.ladderDark, 0, y));
    return g;
}

export function propModel(id: PropId): Character {
    const group = new THREE.Group();
    const tex = tileTextures();
    if (id === "egg") {
        const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
        const egg = new THREE.Mesh(eggGeometry(), mat);
        egg.scale.setScalar(2.4);
        egg.position.y = 1;
        group.add(egg);
        return {
            group,
            h: 14,
            pose: (s) => {
                egg.rotation.y = s.t * 2;
                egg.position.y = 1 + Math.sin(s.t * 3) * 0.08;
                mat.color.copy(hdr(COLORS.eggCycle[Math.floor(s.t * 6) % COLORS.eggCycle.length], 1.5));
            },
        };
    }
    if (id === "grain") {
        const pile = new THREE.Mesh(seedPileGeometry(), new THREE.MeshStandardMaterial({ color: COLORS.seed, roughness: 0.5, emissive: COLORS.seed, emissiveIntensity: 0.3 }));
        pile.scale.setScalar(3);
        pile.position.y = 0.2;
        group.add(pile);
        return {
            group,
            h: 8,
            pose: (s) => {
                pile.scale.setScalar(3 + Math.sin(s.t * 4) * 0.12);
                pile.rotation.y = Math.sin(s.t * 0.8) * 0.4;
            },
        };
    }
    if (id === "ladder") {
        const ladder = ladderMesh(2.3);
        const harry = harryModel();
        harry.group.scale.setScalar(0.55);
        group.add(ladder, harry.group);
        return {
            group,
            h: 16,
            pose: (s) => {
                const k = (Math.sin(s.t * 0.9) + 1) / 2;
                harry.group.position.set(0, 0.15 + k * 1.1, 0.12);
                harry.group.rotation.y = 0;
                harry.pose({ dt: s.dt, t: s.t, phase: s.t * 7, mode: "climb", land: 0 });
            },
        };
    }
    if (id === "lift") {
        const slab = new THREE.Mesh(
            new THREE.BoxGeometry(1.6, 0.18, 0.7),
            new THREE.MeshStandardMaterial({ map: tex.belt, color: 0xffb060, roughness: 0.4, metalness: 0.3 })
        );
        const glow = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: hdr(COLORS.liftGlow, 1.8), toneMapped: false }));
        glow.position.set(0, 0.1, 0.38);
        const riding = new THREE.Group();
        riding.add(slab, glow);
        const harry = harryModel();
        harry.group.scale.setScalar(0.55);
        harry.group.position.y = 0.09;
        harry.group.rotation.y = 0.5;
        riding.add(harry.group);
        group.add(riding);
        for (const x of [-0.9, 0.9]) group.add(bar(0.03, 2.4, 0.03, 0x403048, x, 1.2));
        return {
            group,
            h: 16,
            pose: (s) => {
                const k = (s.t * 0.35) % 1;
                riding.position.y = -0.2 + k * 2.4;
                harry.pose({ dt: s.dt, t: s.t, phase: 0, mode: "idle", land: 0 });
            },
        };
    }
    // cage
    const duck = duckModel();
    duck.group.scale.setScalar(0.5);
    const cage = new THREE.Group();
    cage.add(bar(1.7, 0.08, 1, COLORS.cage, 0, 0), bar(1.7, 0.08, 1, COLORS.cage, 0, 1.6));
    const bars = new THREE.Group();
    for (let x = -0.75; x <= 0.76; x += 0.3) bars.add(bar(0.05, 1.6, 0.05, COLORS.cage, x, 0.8, 0.45));
    cage.add(bars);
    group.add(cage, duck.group);
    return {
        group,
        h: 14,
        pose: (s) => {
            const k = (s.t % 7) / 7;
            const open = k > 0.45 && k < 0.9;
            bars.scale.y = THREE.MathUtils.lerp(bars.scale.y, open ? 0.02 : 1, 0.2);
            bars.position.y = (1 - bars.scale.y) * 1.6;
            if (open) {
                const a = (k - 0.45) * 9;
                duck.group.position.set(Math.sin(a) * 0.9, 1 + Math.sin(a * 1.3) * 0.3, 0.2);
                duck.group.rotation.y = Math.cos(a) > 0 ? 0.6 : Math.PI - 0.6;
            } else {
                duck.group.position.set(0, 0.2, 0);
                duck.group.rotation.y = 0.5;
            }
            duck.pose({ dt: s.dt, t: s.t, phase: 0, mode: open ? "walk" : "idle", land: 0 });
        },
    };
}
