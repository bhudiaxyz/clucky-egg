/**
 * Preview — animated turntable of one character or prop at a time, for How to play's carousels.
 *
 * Purpose
 *   Shows Harry, every creature and each farm feature turning slowly and moving, on a few small
 *   canvases, with one shared renderer (browsers allow only a handful of WebGL contexts).
 *
 * Operations
 *   - animatePreviews(root): finds the canvas[data-preview] elements under `root`, builds the
 *     shared renderer and scene, and renders each visible canvas's model every frame by
 *     copying the renderer's output into it. Returns a stop function that disposes the lot.
 *   - A canvas's data-preview is a creature id (core/creatures.ts), "harry", or a prop id
 *     (render/props.ts); models are built lazily and kept.
 *
 * Highlights
 *   - Hidden pages (offsetParent null) cost nothing. With reduced motion the models hold still.
 *
 * See also: ui/menu.ts (the carousels), render/characters.ts, render/props.ts; DESIGN.md "10.1 Screens".
 */
import * as THREE from "three";
import {ALL_CREATURES} from "../core/creatures";
import {type Character, modelFor as makeModel} from "./characters";
import {type PropId, propModel, PROPS} from "./props";

const SIZE = 192;

export function animatePreviews(root: HTMLElement): () => void {
    const canvases = [...root.querySelectorAll<HTMLCanvasElement>("canvas[data-preview]")];
    if (!canvases.length) return () => {
    };
    let renderer: THREE.WebGLRenderer;
    try {
        renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, preserveDrawingBuffer: true});
    } catch {
        return () => {
        };
    }
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xe0e8ff, 0x302820, 2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 5, 4);
    scene.add(key);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(1.5, 1.6, 5.2);
    camera.lookAt(0, 1, 0);

    const models = new Map<string, Character>();
    const modelFor = (id: string) => {
        let m = models.get(id);
        if (!m) {
            const c = ALL_CREATURES.find((e) => e.id === id);
            m = c ? makeModel(c.id, c.preview) : PROPS.includes(id as PropId) ? propModel(id as PropId) : makeModel("harry", 0);
            // Small creatures are shown larger, as in the game (render/view.ts).
            m.group.scale.setScalar(Math.min(1.8, Math.max(0.9, 14 / m.h)));
            m.group.visible = false;
            scene.add(m.group);
            models.set(id, m);
        }
        return m;
    };

    // Reduced motion: still render (so a changed creature shows), but hold the pose and turn.
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0,
        last = performance.now(),
        t = 0;
    const frame = (now: number) => {
        const dt = still ? 0 : Math.max(0, Math.min(0.05, (now - last) / 1000));
        last = now;
        t += dt;
        for (const cv of canvases) {
            if (!cv.offsetParent) continue; // on a hidden Help page: don't spend a render on it
            const m = modelFor(cv.dataset.preview ?? "harry");
            m.group.visible = true;
            m.group.rotation.y = -0.45 + Math.sin(t * 0.6) * 0.7;
            m.pose({dt, t, phase: t * 5, mode: "walk", land: 0, reach: 0});
            renderer.render(scene, camera);
            const ctx = cv.getContext("2d")!;
            ctx.clearRect(0, 0, cv.width, cv.height);
            ctx.drawImage(renderer.domElement, 0, 0, cv.width, cv.height);
            m.group.visible = false;
        }
        raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
        cancelAnimationFrame(raf);
        scene.traverse((o) => {
            const mesh = o as THREE.Mesh;
            mesh.geometry?.dispose();
            const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
            if (mat)
                for (const mm of Array.isArray(mat) ? mat : [mat]) {
                    for (const t of [
                        (mm as THREE.MeshStandardMaterial).map,
                        (mm as THREE.MeshStandardMaterial).bumpMap,
                    ])
                        t?.dispose();
                    mm.dispose();
                }
        });
        renderer.dispose();
        renderer.forceContextLoss();
    };
}
