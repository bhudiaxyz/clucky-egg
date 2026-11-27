/**
 * View — the three.js scene: a voxel-style 2.5D farm diorama, lit and post-processed.
 *
 * Purpose
 *   Draws a Game. It is stateless apart from GPU objects: sync(game, dt) reads the game's
 *   positions and flags and poses the scene, then renders it through the composer.
 *
 * Operations
 *   - new View(host, tierSettings): renderer (no MSAA on the canvas; the composer's target
 *     carries the tier's samples), lights, Harry, effects, and the EffectComposer
 *     (render → [GTAO ambient occlusion] → [bloom] → output).
 *   - sync(game, dt): rebuilds the level when it changes (build); poses lifts, eggs, grain,
 *     the cage and duck, creatures (rebuilt when the game respawns them), Harry (walk, climb,
 *     jump, fall, death tumble, level-clear cheer) and the lamp; eases the camera toward Harry;
 *     renders.
 *   - build(game): one farm's meshes, textured procedurally (render/paint.ts) from a seed
 *     taken from its name: instanced rock-and-plank platforms with neon edge strips, ladders
 *     (rails and rungs), the back wall, lift shafts, eggs, grain piles, the duck's cage.
 *   - burst() / halo() / warmup() / degrade() / resize(): sparks and halos at game pixels;
 *     shader pre-compile; one step down in quality for the Governor; framing for the screen.
 *
 * Usage
 *   main.ts: const view = new View(app, TIER_SETTINGS[tier]); view.sync(game, dt) each frame.
 *
 * Highlights
 *   - Game px → world: x / 8 and 24 − y / 8 (y flips: the game counts rows downward).
 *   - Neon materials use toneMapped: false with HDR colours, so they alone cross the bloom
 *     threshold: eggs, edge strips, lift lights, the duck's eyes, sparks.
 *   - Textures are painted at runtime into tiny canvases with nearest filtering: no image files.
 *   - Creatures keep their own natural colours (a hen is white), jittered a little per animal.
 *   - A respawn after a death keeps the same Level, so nothing is rebuilt but the creatures;
 *     per-frame state (eggs, grain, lifts) is all read from the Game.
 *
 * See also: core/game.ts, core/palette.ts, fx/effects.ts, render/tier.ts; DESIGN.md "9. Rendering".
 */
import * as THREE from "three";
import {EffectComposer} from "three/examples/jsm/postprocessing/EffectComposer.js";
import {RenderPass} from "three/examples/jsm/postprocessing/RenderPass.js";
import {UnrealBloomPass} from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import {OutputPass} from "three/examples/jsm/postprocessing/OutputPass.js";
import {GTAOPass} from "three/examples/jsm/postprocessing/GTAOPass.js";
import {RoundedBoxGeometry} from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {CAGE, DEAD_TIME, type Game} from "../core/game";
import {BODY_H, BODY_W, LIFT_W} from "../core/physics";
import {creatureInfo} from "../core/creatures";
import {COLORS, hdr, type Theme, themeFor} from "../core/palette";
import {rng} from "../core/random";
import {H, type Level, W} from "../world/levels";
import {Effects} from "../fx/effects";
import type {TierSettings} from "./tier";
import {backdropTextures, rockTexture, seedOf, tileTextures} from "./paint";
import {eggGeometry, seedPileGeometry} from "./props";
import {type Character, duckModel, harryModel, type Mode, modelFor} from "./characters";

const DEPTH = 1.2; // block depth (z)
/** Harry is drawn at 85% of his 1 × 2 cell box, from the feet. */
const SPRITE = 0.85;
const FOV = 30;
/** Seconds Harry tumbles (hops, spins, shrinks) after a death before vanishing. */
const TUMBLE = 0.9;
/** How far (world units) the camera drifts toward Harry, for parallax. */
const DRIFT_X = 0.4,
    DRIFT_Y = 0.25;
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Facing angles: a turn eases from one to the other through facing the camera. */
const FACE_R = -0.45,
    FACE_L = -Math.PI + 0.45;
/** Back wall brightness (it sits behind the play, so it stays dimmer than platforms and sprites). */
const BACKDROP_BRIGHTNESS = 0.5;
/** Strength of the back wall's glowing features (stars, veins). */
const BACKDROP_GLOW = 0.35;
/** Bloom strength (all glows). Kept modest so the level reads clearly, not hazily. */
const BLOOM_STRENGTH = 0.45;
/** HDR strength of the thin glowing strip along every platform top (1 = just under bloom). */
const EDGE_GLOW = 1.05;
/** HDR strength of the eggs (bloom picks up anything above 1). */
const EGG_GLOW = 1.5;
/** Seconds a landing squash takes to spring back. */
const LAND_SQUASH = 0.18;
/** Harry's glow: the warm halo point light around him. */
const LAMP_GLOW = 0.75;
/** Walk cycle radians per game px moved. */
const STRIDE = 0.35;
/** Creature height in cells at most; small ones are drawn up to this much bigger than life. */
const CREATURE_CELLS = 1.5;

type Alive = Character & { id: string; baseScale: number; blob: THREE.Mesh; face: number };

export class View {
    readonly renderer: THREE.WebGLRenderer;
    private scene = new THREE.Scene();
    private camera = new THREE.PerspectiveCamera(FOV, 1, 1, 400);
    private composer: EffectComposer;
    private effects: Effects;
    private lamp = new THREE.PointLight(COLORS.lampLight, 9, 9, 1.6);
    private key = new THREE.DirectionalLight(0xffffff, 1.6);
    private camBase = new THREE.Vector3();
    private camLook = new THREE.Vector3();
    private camDrift = new THREE.Vector3();
    private level = new THREE.Group();
    /** Walkers, fliers and the duck: rebuilt whenever the game respawns them. */
    private cast = new THREE.Group();
    private built: Level | null = null;
    private builtN = -1;
    private tex = tileTextures();
    /** Ambient fill, tinted per farm theme (sky from above, ground from below). */
    private hemi = new THREE.HemisphereLight(0xc8d4ff, 0x40302a, 1.5);
    /** Textures painted for the current farm (platform, back wall), disposed on the next build. */
    private farmTex: THREE.Texture[] = [];
    // Per-farm handles, set by build().
    private eggs: THREE.Mesh[] = [];
    private piles: THREE.Mesh[] = [];
    private liftViews: THREE.Group[] = [];
    private cage!: { group: THREE.Group; bars: THREE.Group; glow: THREE.MeshBasicMaterial };
    private duckV: Character | null = null;
    private duckBlob!: THREE.Mesh;
    private walkers: Alive[] = [];
    private flyers: Alive[] = [];
    private henSrc: unknown = null;
    private flySrc: unknown = null;
    private castN = -1;
    private harry: Character;
    private harryFace = FACE_R;
    private wasGround = true;
    private landAt = -Infinity;
    private theme!: Theme;
    private m4 = new THREE.Matrix4();
    private ao?: GTAOPass;
    private bloom?: UnrealBloomPass;
    /** Governor's resolution scale (1 = the tier's full DPR). */
    private dprScale = 1;
    /** GPU context lost (mobile background / memory pressure): skip rendering until restored. */
    private lost = false;
    /** Ground-level blob shadows: Harry's, one per walker, and static ones (eggs, grain). */
    private blobTex = blobTexture();
    private harryBlob!: THREE.Mesh;
    private lastX: number | undefined;

    constructor(
        host: HTMLElement,
        private ts: TierSettings
    ) {
        this.renderer = new THREE.WebGLRenderer({antialias: false, powerPreference: "high-performance"});
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        this.renderer.shadowMap.enabled = ts.shadowMap > 0;
        // PCF everywhere (PCFSoftShadowMap is deprecated in this three.js); soft tiers blur it via radius.
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        host.append(this.renderer.domElement);
        // Mobile browsers drop the GPU context under memory pressure or in the background. Calling
        // preventDefault lets it be restored (three.js re-uploads everything lazily); until then
        // nothing renders, and main.ts pauses the run.
        const el = this.renderer.domElement;
        el.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            this.lost = true;
            this.onContextLost();
        });
        el.addEventListener("webglcontextrestored", () => (this.lost = false));

        this.scene.background = new THREE.Color(COLORS.ui.bg);
        this.scene.add(this.hemi);
        this.key.position.set(8, 30, 22);
        this.key.target.position.set(W / 2, H / 2, 0);
        if (ts.shadowMap) {
            this.key.castShadow = true;
            this.key.shadow.mapSize.set(ts.shadowMap, ts.shadowMap);
            const c = this.key.shadow.camera;
            c.left = c.bottom = -20;
            c.right = c.top = 20;
            c.near = 5;
            c.far = 80;
            this.key.shadow.bias = -0.0005;
            this.key.shadow.normalBias = 0.03;
            if (ts.softShadows) this.key.shadow.radius = 3;
        }
        this.scene.add(this.key, this.key.target, this.lamp, this.level, this.cast);
        this.harry = harryModel();
        this.harryBlob = this.makeBlob(0.85);
        this.scene.add(this.harry.group, this.harryBlob);
        this.effects = new Effects(this.scene, ts.particles);

        // HDR (half-float) target where the GPU can render to it; some older Android GPUs can't, and
        // would show nothing, so they get 8-bit (glows clip a little, everything else is the same).
        const ext = this.renderer.extensions;
        const hdrOk = ext.has("EXT_color_buffer_float") || ext.has("EXT_color_buffer_half_float");
        const target = new THREE.WebGLRenderTarget(1, 1, {
            type: hdrOk ? THREE.HalfFloatType : THREE.UnsignedByteType,
            samples: ts.msaa,
        });
        this.composer = new EffectComposer(this.renderer, target);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        if (ts.ao) {
            const ao = new GTAOPass(this.scene, this.camera, 1, 1);
            ao.updateGtaoMaterial({radius: 0.6, thickness: 1});
            ao.blendIntensity = 0.8;
            this.composer.addPass(ao);
            this.ao = ao;
        }
        if (ts.bloom) {
            this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM_STRENGTH, 0.4, 0.85);
            this.composer.addPass(this.bloom);
        }
        this.composer.addPass(new OutputPass());
        this.resize();
        // The host's size is set by CSS (on portrait phones it leaves room for the controls).
        new ResizeObserver(() => this.resize()).observe(host);
    }

    /** Called when the GPU context is lost (main.ts pauses the run). */
    onContextLost = () => {
    };

    resize() {
        const host = this.renderer.domElement.parentElement!;
        const w = Math.max(1, host.clientWidth),
            h = Math.max(1, host.clientHeight);
        // DPR: the tier cap, lowered further to keep big screens (iPad Pro, 4K) under the pixel
        // budget, times the governor's scale.
        const budget = Math.sqrt(this.ts.maxPixels / (w * h));
        this.renderer.setPixelRatio(Math.max(0.6, Math.min(devicePixelRatio, this.ts.dprCap, budget) * this.dprScale));
        this.renderer.setSize(w, h);
        this.composer.setPixelRatio(this.renderer.getPixelRatio());
        this.composer.setSize(w, h);
        const aspect = w / h;
        this.camera.aspect = aspect;
        // Frame the farm plus room for the HUD bars above and below.
        const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
        const needH = H + 3.6,
            needW = W + 1;
        const dist = Math.max(needH / 2 / tan, needW / 2 / (tan * aspect));
        this.camBase.set(W / 2, H / 2 + dist * 0.06, dist);
        this.camLook.set(W / 2, H / 2 - 0.1, 0);
        this.camera.position.copy(this.camBase).add(this.camDrift);
        this.camera.lookAt(this.camLook);
        this.camera.updateProjectionMatrix();
    }

    /**
     * One step down in quality, for the Governor (render/tier.ts), cheapest-to-lose first:
     * ambient occlusion, then resolution (×0.8 a step down to DPR 1), then bloom, then shadows.
     * Returns false when there is nothing left to shed.
     */
    degrade(): boolean {
        const step = (what: string) => (console.info(`[clucky-egg] smoother frames: ${what}`), true);
        if (this.ao?.enabled) return ((this.ao.enabled = false), step("ambient occlusion off"));
        if (this.renderer.getPixelRatio() > 1.01) {
            this.dprScale *= 0.8;
            this.resize();
            return step(`resolution ×${this.renderer.getPixelRatio().toFixed(2)}`);
        }
        if (this.bloom?.enabled) return ((this.bloom.enabled = false), step("bloom off"));
        if (this.renderer.shadowMap.enabled) {
            this.renderer.shadowMap.enabled = this.key.castShadow = false;
            this.scene.traverse((o) => {
                const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
                if (m) for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
            });
            return step("shadows off");
        }
        return false;
    }

    /**
     * Compile every shader in the scene, and render once through the composer, before play, so
     * the first frames (and the first spark burst) don't stall on a compile. The spark layer is
     * empty at boot, so it gets one invisible spark for the compile.
     */
    async warmup() {
        this.effects.burst(W / 2, H / 2, new THREE.Color(0, 0, 0), 1, 0);
        await this.renderer.compileAsync(this.scene, this.camera);
        this.composer.render();
        this.effects.clear();
    }

    burst(px: number, py: number, color: number, n: number, speed = 4, gravity?: number) {
        this.effects.burst(px / 8, H - py / 8, hdr(color, 2.2), n, speed, gravity);
    }

    /** A blocky voxel halo and light flash at a game-pixel position (egg pickups). */
    halo(px: number, py: number, color: number) {
        this.effects.halo(px / 8, H - py / 8, hdr(color, 2.4));
    }

    sync(g: Game, dt: number) {
        if (g.level !== this.built || g.n !== this.builtN) this.build(g);
        this.syncCast(g);
        const t = g.clock;
        const playing = g.phase === "play";

        // Lifts: slab and shaft light ride the game's lift positions.
        g.lifts.forEach((l, i) => {
            const v = this.liftViews[i];
            if (v) v.position.set(l.x / 8 + LIFT_W / 16, H - l.y / 8, 0);
        });

        this.eggs.forEach((m, i) => {
            m.visible = g.eggs[i];
            if (!m.visible) return;
            m.rotation.y = t * 2 + i;
            m.position.y = (m.userData.y as number) + Math.sin(t * 3 + i) * 0.05;
            const cyc = COLORS.eggCycle;
            (m.material as THREE.MeshBasicMaterial).color.copy(hdr(cyc[(Math.floor(t * 5) + i) % cyc.length], EGG_GLOW));
        });
        this.piles.forEach((m, i) => {
            m.visible = g.seeds[i];
        });

        // The cage: bars lift once the duck is loose.
        const free = g.duck?.state === "free";
        this.cage.bars.scale.y += ((free ? 0.02 : 1) - this.cage.bars.scale.y) * Math.min(1, dt * 6);
        this.cage.bars.position.y = (1 - this.cage.bars.scale.y) * 3.1;
        this.cage.glow.color.copy(hdr(COLORS.cageGlow, free ? 0.4 : 1.2 + 0.4 * Math.sin(t * 4)));
        if (this.duckV && g.duck) {
            const d = g.duck;
            const caged = d.state !== "free";
            this.duckV.group.visible = true;
            if (caged) this.duckV.group.position.set(CAGE.x / 8, H - 5 + 0.12, 0);
            else this.duckV.group.position.set(d.x / 8, H - d.y / 8 - 0.75, 0);
            const want = caged ? FACE_R + 0.4 : d.vx >= 0 ? FACE_R : FACE_L;
            this.duckV.group.rotation.y += (want - this.duckV.group.rotation.y) * Math.min(1, dt * 8);
            this.duckV.pose({dt, t, phase: 0, mode: caged ? "idle" : "walk", land: 0});
            this.placeBlob(this.duckBlob, g.level.tiles, d.x / 8, H - d.y / 8 - 0.75);
            this.duckBlob.visible = this.duckBlob.visible && !caged;
        } else if (this.duckV) this.duckV.group.visible = false;

        // Turns ease through facing the camera instead of snapping (frozen while paused: dt = 0).
        const turn = 1 - Math.exp(-dt * 14);
        g.hens.forEach((h, i) => {
            const v = this.walkers[i];
            if (!v) return;
            v.group.position.set(h.x / 8, H - h.feet / 8, 0);
            const want = h.mode === "climb" ? 0 : h.dir > 0 ? FACE_R : FACE_L;
            v.face += (want - v.face) * turn;
            v.group.rotation.y = v.face;
            v.group.rotation.z = h.mode === "eat" ? Math.sin(t * 14 + i) * 0.1 : 0;
            const mode: Mode = h.mode === "eat" ? "eat" : h.mode === "climb" ? "climb" : "walk";
            v.pose({dt, t: t + i, phase: h.dist * STRIDE, mode, land: 0, reach: 0});
            this.placeBlob(v.blob, g.level.tiles, h.x / 8, H - h.feet / 8);
        });
        g.flyers.forEach((f, i) => {
            const v = this.flyers[i];
            if (!v) return;
            v.group.position.set(f.x / 8, H - f.y / 8 - 0.4 + Math.sin(f.phase * 3) * 0.1, 0);
            const want = f.dir > 0 ? FACE_R : FACE_L;
            v.face += (want - v.face) * turn;
            v.group.rotation.y = v.face;
            v.pose({dt, t: t + i * 3, phase: 0, mode: "walk", land: 0, reach: 0});
        });

        const b = g.harry;
        const hg = this.harry.group;
        // Seconds since a death (Harry tumbles for TUMBLE of the DEAD_TIME).
        const since = g.phase === "dead" ? g.phaseT : Infinity;
        const show = !g.demo && (g.phase === "play" || g.phase === "clear" || since < TUMBLE);
        hg.visible = show;
        this.harryBlob.visible = show;
        const doomed = playing && g.time / g.level.time < 0.12;
        let x = W / 2,
            y = H / 2;
        if (show) {
            x = (b.x + BODY_W / 2) / 8;
            y = H - (b.y + BODY_H) / 8;
            let s = 1;
            const climbing = b.mode === "climb";
            const want = climbing && g.phase === "play" ? 0 : b.face > 0 ? FACE_R : FACE_L;
            this.harryFace += (want - this.harryFace) * turn;
            hg.rotation.y = this.harryFace;
            hg.rotation.z = 0;
            // 1 normally; fades through a death tumble.
            let power = 1;
            if (since < TUMBLE) {
                const k = since / TUMBLE;
                y += since * 3 - since * since * 8;
                s = 1 - k;
                hg.rotation.z = -b.face * since * 9;
                power *= 1 - k;
            }
            hg.position.set(x, y, 0);
            hg.scale.setScalar(s * SPRITE);
            this.placeBlob(this.harryBlob, g.level.tiles, x, y, s);
            const ground = b.mode === "ground";
            // g.clock restarts at 0 on every level load: a landing remembered from before must not count.
            if (t < this.landAt) this.landAt = -Infinity;
            if (ground && !this.wasGround) this.landAt = t;
            this.wasGround = ground;
            const moving = (this.lastX ?? b.x) !== b.x;
            const mode: Mode =
                since < TUMBLE
                    ? "flail"
                    : g.phase === "clear"
                        ? "cheer"
                        : climbing
                            ? "climb"
                            : ground
                                ? moving
                                    ? "walk"
                                    : "idle"
                                : b.vy < 0
                                    ? "rise"
                                    : "fall";
            this.lastX = b.x;
            const land = Math.min(1, Math.max(0, 1 - (t - this.landAt) / LAND_SQUASH));
            this.harry.pose({dt, t, phase: b.dist * STRIDE, mode: mode, land});
            // The lamp dims and (motion allowing) gutters as the clock runs down.
            const f = Math.max(0, g.time / g.level.time);
            if (playing && f < 0.2) power *= (0.45 + 2.75 * f) * (REDUCED_MOTION ? 1 : 0.75 + 0.25 * Math.sin(t * 31) * Math.sin(t * 7.7));
            this.lamp.position.set(x + (b.face > 0 ? 0.3 : -0.3), y + 1.9 * SPRITE, 1.4);
            this.lamp.intensity = 9 * LAMP_GLOW * power;
        } else {
            this.lamp.intensity = g.demo ? 0 : this.lamp.intensity * 0.9;
        }
        this.lamp.color.setHex(doomed && Math.floor(t * 12) % 2 ? COLORS.lampDanger : COLORS.lampLight);

        // Camera drifts a little toward Harry so the diorama shows its depth.
        if (!REDUCED_MOTION) {
            const k = 1 - Math.exp(-dt * 2);
            const d = this.camDrift;
            d.x += (((x - W / 2) / (W / 2)) * DRIFT_X - d.x) * k;
            d.y += (((y - H / 2) / (H / 2)) * DRIFT_Y - d.y) * k;
            this.camera.position.copy(this.camBase).add(d);
            this.camera.lookAt(this.camLook);
        }

        this.effects.update(dt);
        if (!this.lost) this.composer.render();
    }

    /** A soft dark patch, lying flat on whatever is below; opacity is lower where shadow maps exist. */
    private makeBlob(size: number) {
        const m = new THREE.Mesh(
            BLOB_GEO,
            new THREE.MeshBasicMaterial({
                map: this.blobTex,
                transparent: true,
                depthWrite: false,
                opacity: this.ts.shadowMap ? 0.4 : 0.7,
                color: 0x000000,
            })
        );
        m.userData.size = size;
        m.userData.alpha = m.material.opacity;
        m.renderOrder = 1;
        return m;
    }

    /**
     * Put a blob on the first surface at or below world (x, feetY): a platform or ladder-top
     * plank, read from the tiles. It shrinks and fades with height, and is hidden with nothing below.
     */
    private placeBlob(b: THREE.Mesh, tiles: string, x: number, feetY: number, scale = 1) {
        const c = Math.min(W - 1, Math.max(0, Math.floor(x)));
        let top = -1;
        for (let r = Math.max(0, Math.ceil(H - feetY - 0.05)); r < H; r++)
            if ("#T".includes(tiles[r * W + c])) {
                top = H - r;
                break;
            }
        const h = feetY - top;
        b.visible = top >= 0 && h > -0.1 && scale > 0.05;
        if (!b.visible) return;
        const k = Math.max(0.25, 1 - h / 7);
        b.position.set(x, top + 0.015, 0);
        b.scale.setScalar(b.userData.size * k * scale);
        (b.material as THREE.MeshBasicMaterial).opacity = b.userData.alpha * k;
    }

    /** Build the walkers and fliers again when the game has respawned them (new arrays). */
    private syncCast(g: Game) {
        if (g.hens === this.henSrc && g.flyers === this.flySrc && g.n === this.castN) return;
        this.henSrc = g.hens;
        this.flySrc = g.flyers;
        this.castN = g.n;
        for (const o of [...this.walkers, ...this.flyers]) {
            this.cast.remove(o.group, o.blob);
            disposeTree(o.group);
            (o.blob.material as THREE.Material).dispose();
        }
        const pal = rng(seedOf(g.level.name) ^ g.n);
        const make = (kind: string, fly: boolean): Alive => {
            const info = creatureInfo(kind);
            const m = modelFor(kind, jitter(info.preview, pal));
            const scale = fly ? 1.6 : m.h * 0.125 > CREATURE_CELLS ? CREATURE_CELLS / (m.h * 0.125) : CREATURE_CELLS;
            m.group.scale.setScalar(scale);
            m.group.traverse((o) => (o.castShadow = this.ts.shadowMap > 0));
            const blob = this.makeBlob(fly ? 0 : 0.9);
            this.cast.add(m.group, blob);
            return {...m, id: kind, baseScale: scale, blob, face: FACE_R};
        };
        this.walkers = g.hens.map((h) => make(h.kind, false));
        this.flyers = g.flyers.map((f) => make(f.kind, true));
        this.flyers.forEach((f) => (f.blob.visible = false));
    }

    private build(g: Game) {
        const lv = g.level;
        this.built = lv;
        this.builtN = g.n;
        this.effects.clear();
        this.level.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (mesh.geometry) mesh.geometry.dispose();
            const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
            if (mat) for (const mm of Array.isArray(mat) ? mat : [mat]) mm.dispose();
        });
        this.level.clear();
        for (const t of this.farmTex) t.dispose();
        const th = (this.theme = themeFor(g.n));
        // Seeded by name (and level number, since later passes reuse a layout), so a farm's
        // surfaces are the same every visit.
        const seed = seedOf(lv.name) ^ Math.imul(g.n, 2654435761);
        const rockTex = rockTexture(th.rockStyle, seed);
        const backTex = backdropTextures(th, seed);
        this.farmTex = [rockTex, backTex.map, backTex.glow];
        this.hemi.color.setHex(th.sky);
        this.hemi.groundColor.setHex(th.ground);
        this.effects.motes(th.motes, th.mote, Math.round(this.ts.particles / 8));
        const tiles = lv.tiles;
        const at = (c: number, r: number) => (c < 0 || c >= W || r < 0 || r >= H ? "#" : tiles[r * W + c]);
        const cells = (chars: string) => {
            const out: number[] = [];
            for (let i = 0; i < tiles.length; i++) if (chars.includes(tiles[i])) out.push(i);
            return out;
        };
        const shadows = (o: THREE.Object3D) => ((o.castShadow = o.receiveShadow = this.ts.shadowMap > 0), o);
        const jitterR = rng(g.n * 31 + 7);

        // Backdrop: copper bars, painted rock and a feature layer.
        const back = new THREE.Mesh(
            new THREE.PlaneGeometry(W, H),
            new THREE.MeshStandardMaterial({
                map: backTex.map,
                color: new THREE.Color().setScalar(BACKDROP_BRIGHTNESS),
                emissive: 0xffffff,
                emissiveMap: backTex.glow,
                emissiveIntensity: BACKDROP_GLOW,
                roughness: 1,
            })
        );
        back.position.set(W / 2, H / 2, -DEPTH / 2 - 0.02);
        back.receiveShadow = this.ts.shadowMap > 0;
        this.level.add(back);

        const blocks = (list: number[], geo: THREE.BufferGeometry, mat: THREE.Material, y: number, color: number) => {
            const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
            mesh.count = list.length;
            const col = new THREE.Color();
            list.forEach((i, k) => {
                this.m4.makeTranslation((i % W) + 0.5, H - Math.floor(i / W) - y, 0);
                mesh.setMatrixAt(k, this.m4);
                mesh.setColorAt(k, col.setHex(color).multiplyScalar(0.9 + jitterR() * 0.2));
            });
            this.level.add(shadows(mesh));
            return mesh;
        };
        // Slightly rounded blocks catch a highlight on every edge; each texture doubles as its bump map.
        // A platform is a rock body (0.84 tall) under a plank top (0.16), together exactly one cell.
        blocks(
            cells("#"),
            new RoundedBoxGeometry(1, 0.84, DEPTH, 2, 0.05),
            new THREE.MeshStandardMaterial({map: rockTex, bumpMap: rockTex, bumpScale: 2, roughness: 0.9}),
            0.58,
            th.rock
        );
        blocks(
            cells("#T"),
            new RoundedBoxGeometry(1, 0.16, DEPTH, 2, 0.04),
            new THREE.MeshStandardMaterial({map: this.tex.ledge, bumpMap: this.tex.ledge, roughness: 0.8}),
            0.08,
            th.ledge
        );

        // Ladders: two rails and three rungs per cell, over the back of the platform.
        const lad = cells("HT");
        const rails = new THREE.InstancedMesh(
            new THREE.BoxGeometry(0.08, 1, 0.12),
            new THREE.MeshStandardMaterial({color: th.crumble, roughness: 0.7}),
            Math.max(1, lad.length * 2)
        );
        const rungs = new THREE.InstancedMesh(
            new THREE.BoxGeometry(0.6, 0.07, 0.1),
            new THREE.MeshStandardMaterial({color: COLORS.ladderDark, roughness: 0.7}),
            Math.max(1, lad.length * 3)
        );
        rails.count = lad.length * 2;
        rungs.count = lad.length * 3;
        lad.forEach((i, k) => {
            const c = i % W,
                r = Math.floor(i / W);
            for (let j = 0; j < 2; j++) {
                this.m4.makeTranslation(c + 0.2 + j * 0.6, H - r - 0.5, 0.05);
                rails.setMatrixAt(k * 2 + j, this.m4);
            }
            for (let j = 0; j < 3; j++) {
                this.m4.makeTranslation(c + 0.5, H - r - 0.2 - j * 0.3, 0.05);
                rungs.setMatrixAt(k * 3 + j, this.m4);
            }
        });
        this.level.add(shadows(rails), shadows(rungs));

        // Neon edge strips on every surface you can stand on.
        const tops: number[] = [];
        for (let i = W; i < tiles.length; i++) if ("#T".includes(tiles[i]) && at(i % W, Math.floor(i / W) - 1) !== "#") tops.push(i);
        const strips = new THREE.InstancedMesh(
            new THREE.BoxGeometry(1.02, 0.05, 0.05),
            new THREE.MeshBasicMaterial({color: hdr(th.glow, EDGE_GLOW), toneMapped: false}),
            Math.max(1, tops.length)
        );
        strips.count = tops.length;
        tops.forEach((i, k) => {
            this.m4.makeTranslation((i % W) + 0.5, H - Math.floor(i / W) + 0.01, DEPTH / 2 + 0.02);
            strips.setMatrixAt(k, this.m4);
        });
        this.level.add(strips);

        // Lifts: a chevron slab with a glowing underside, and a faint column showing its path.
        this.liftViews = lv.lifts.map((l) => {
            const grp = new THREE.Group();
            const slab = new THREE.Mesh(
                new THREE.BoxGeometry(LIFT_W / 8, 0.24, 0.9),
                new THREE.MeshStandardMaterial({
                    map: this.tex.belt,
                    bumpMap: this.tex.belt,
                    color: COLORS.lift,
                    roughness: 0.4,
                    metalness: 0.3
                })
            );
            slab.position.y = -0.12;
            const glow = new THREE.Mesh(
                new THREE.BoxGeometry(LIFT_W / 8 + 0.04, 0.06, 0.06),
                new THREE.MeshBasicMaterial({color: hdr(COLORS.liftGlow, 1.8), toneMapped: false})
            );
            glow.position.set(0, -0.02, 0.48);
            grp.add(shadows(slab), glow);
            this.level.add(grp);
            const lane = new THREE.Mesh(
                new THREE.PlaneGeometry(LIFT_W / 8, H),
                new THREE.MeshBasicMaterial({color: COLORS.lift, transparent: true, opacity: 0.07, depthWrite: false})
            );
            lane.position.set(l.x / 8 + LIFT_W / 16, H / 2, -DEPTH / 2 - 0.01);
            this.level.add(lane);
            return grp;
        });

        // Eggs and grain.
        const eggGeo = eggGeometry();
        this.eggs = lv.eggs.map((e, i) => {
            const m = new THREE.Mesh(eggGeo, new THREE.MeshBasicMaterial({
                color: hdr(COLORS.egg, EGG_GLOW),
                toneMapped: false
            }));
            m.userData.y = H - e.y / 8;
            m.position.set(e.x / 8, m.userData.y, 0);
            m.scale.setScalar(1.15);
            m.rotation.y = i;
            this.level.add(m);
            return m;
        });
        const pileGeo = seedPileGeometry();
        const pileMat = new THREE.MeshStandardMaterial({
            color: COLORS.seed,
            roughness: 0.5,
            emissive: COLORS.seed,
            emissiveIntensity: 0.35
        });
        this.piles = lv.seeds.map((s) => {
            const m = new THREE.Mesh(pileGeo, pileMat);
            m.scale.setScalar(1.3);
            m.position.set(s.x / 8, H - (s.y + 3) / 8, 0);
            this.level.add(shadows(m));
            return m;
        });

        // The cage, top left: roof and floor plates, bars (which lift when the duck breaks out).
        const cg = new THREE.Group();
        const cageMat = new THREE.MeshStandardMaterial({color: COLORS.cage, metalness: 0.6, roughness: 0.35});
        const bars = new THREE.Group();
        const glowMat = new THREE.MeshBasicMaterial({color: hdr(COLORS.cageGlow, 1.2), toneMapped: false});
        for (let x = -1.55; x <= 1.56; x += 0.45) {
            const bar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 3.1, 0.07), cageMat);
            bar.position.set(x, 1.6, 0.5);
            bars.add(bar);
        }
        const top = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.16, 1.1), cageMat);
        top.position.y = 3.2;
        const base = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.16, 1.1), cageMat);
        base.position.y = 0.04;
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.04, 0.04), glowMat);
        lamp.position.set(0, 3.12, 0.55);
        cg.add(bars, top, base, lamp);
        cg.position.set(CAGE.x / 8, H - 5, 0);
        this.level.add(shadows(cg));
        this.cage = {group: cg, bars, glow: glowMat};

        // The Mother Duck (visible as the game dictates).
        this.duckV?.group.parent?.remove(this.duckV.group);
        this.duckV = duckModel();
        this.duckV.group.traverse((o) => (o.castShadow = this.ts.shadowMap > 0));
        this.level.add(this.duckV.group);
        this.duckBlob = this.makeBlob(1.4);
        this.level.add(this.duckBlob);

        // Ground-level shadows for the still things.
        const still = (wx: number, feet: number, size: number) => {
            const b = this.makeBlob(size);
            this.level.add(b);
            this.placeBlob(b, tiles, wx, feet);
        };
        lv.eggs.forEach((e) => still(e.x / 8, H - (e.y + 4) / 8, 0.45));
        lv.seeds.forEach((s) => still(s.x / 8, H - (s.y + 3) / 8, 0.6));
        this.harry.group.traverse((o) => (o.castShadow = this.ts.shadowMap > 0));
        this.lastX = undefined;
        void DEAD_TIME;
    }
}

const jitter = (hex: number, r: () => number) => {
    const c = new THREE.Color(hex);
    const hsl = {h: 0, s: 0, l: 0};
    c.getHSL(hsl);
    return c.setHSL((hsl.h + (r() - 0.5) * 0.05 + 1) % 1, Math.min(1, Math.max(0, hsl.s + (r() - 0.5) * 0.16)), Math.min(0.95, Math.max(0.05, hsl.l + (r() - 0.5) * 0.1))).getHex();
};

function disposeTree(o: THREE.Object3D) {
    o.traverse((c) => {
        const mesh = c as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (mat) for (const mm of Array.isArray(mat) ? mat : [mat]) mm.dispose();
    });
}

/**
 * A blob shadow's quad: on the ground, wider than deep (x by z), tilted BLOB_TILT toward the
 * camera, which sees platform tops almost edge-on, and lifted so its front edge rests on the surface.
 */
const BLOB_TILT = 0.35;
const BLOB_GEO = new THREE.PlaneGeometry(1, DEPTH * 0.85)
    .rotateX(-Math.PI / 2 + BLOB_TILT)
    .translate(0, ((DEPTH * 0.85) / 2) * Math.sin(BLOB_TILT), 0);

function blobTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}
