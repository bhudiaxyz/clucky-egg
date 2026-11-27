/**
 * Input — keyboard, touch controls and gamepads merged into one Input.
 *
 * Purpose
 *   The game never sees devices. This module keeps the held state of every source and hands
 *   main.ts one merged snapshot per frame.
 *
 * Operations
 *   - setupInput(): key listeners (KeyboardEvent.code, so layouts don't matter), the #t-stick
 *     nipplejs joystick (all four directions: left / right walk, up / down climb) and the
 *     #touch [data-k=jump] button, tracked per finger.
 *   - readInput(): held keys and buttons OR'd with every connected gamepad (left stick or d-pad
 *     to move; A or B to jump), plus a 100 ms jump buffer for early taps.
 *   - pollPads(): edge-detected pad buttons (and the stick as a d-pad) for menus and pause.
 *   - clearInput(): releases everything (window blur).
 *   - HELP: [key, action] rows for this device type, rendered by main.ts.
 *
 * Usage
 *   main.ts: setupInput(); each frame game.update(dt, readInput()).
 *
 * Highlights
 *   - Mapped keys preventDefault, so Space and the arrows never scroll the page or press a
 *     focused button.
 *   - The stick has a wide dead zone on the vertical axis and favours the dominant axis, so a
 *     slightly sloppy thumb walking along a platform doesn't grab a ladder, and a thumb
 *     climbing doesn't wander off sideways.
 *
 * See also: core/physics.ts (Input), main.ts (pause / menu keys), index.html (#touch); DESIGN.md "13. Input".
 */
import nipplejs from "nipplejs";
import type { Input } from "../core/physics";

export const isTouch = matchMedia("(pointer: coarse)").matches;

const held: Input = { left: false, right: false, up: false, down: false, jump: false };
/** Fingers holding the jump button (pointerId). */
const touches = new Set<number>();
const touchHeld: Input = { left: false, right: false, up: false, down: false, jump: false };
let stick: (keyof Input)[] = [];
/** Joystick dead zones, as a fraction of the stick's throw. */
const STICK_WALK = 0.3;
const STICK_CLIMB = 0.4;
/** A jump press is remembered this long, so a tap just before landing still jumps. */
const JUMP_BUFFER_MS = 100;
let jumpAt = -Infinity;

export const KEYS: Record<string, keyof Input> = {
    ArrowLeft: "left",
    KeyA: "left",
    KeyZ: "left",
    ArrowRight: "right",
    KeyD: "right",
    KeyX: "right",
    ArrowUp: "up",
    KeyW: "up",
    ArrowDown: "down",
    KeyS: "down",
    Space: "jump",
    Enter: "jump",
    ShiftLeft: "jump",
};

const KEY_HELP = [
    ["← → · A D", "Walk"],
    ["↑ ↓ · W S", "Climb a ladder"],
    ["Space", "Jump (the arc is fixed once you leave the ground)"],
    ["Esc", "Pause"],
    ["M", "Sound on / off"],
];
const TOUCH_HELP = [
    ["Stick ◀ ▶", "Walk"],
    ["Stick ▲ ▼", "Climb a ladder"],
    ["JUMP", "Jump (the arc is fixed once you leave the ground)"],
    ["❚❚", "Pause"],
];
export const HELP = isTouch ? TOUCH_HELP : KEY_HELP;

export type PadButton = "pause" | "up" | "down" | "left" | "right" | "select" | "back";
const padPrev = new Map<number, boolean[]>();
let onPadButton: (b: PadButton) => void = () => {};

export function setPadHandler(fn: typeof onPadButton) {
    onPadButton = fn;
}

function syncTouch() {
    const wasJump = touchHeld.jump;
    touchHeld.left = touchHeld.right = touchHeld.up = touchHeld.down = false;
    touchHeld.jump = touches.size > 0;
    for (const k of stick) touchHeld[k] = true;
    if (touchHeld.jump && !wasJump) jumpAt = performance.now();
    document
        .querySelectorAll<HTMLElement>("#touch [data-k]")
        .forEach((b) => b.classList.toggle("on", touchHeld[b.dataset.k as keyof Input]));
}

export function setupInput() {
    addEventListener("keydown", (e) => {
        const k = KEYS[e.code];
        if (!k || (e.target instanceof HTMLButtonElement && !document.body.classList.contains("playing"))) return;
        if (k === "jump" && !e.repeat) jumpAt = performance.now();
        held[k] = true;
        e.preventDefault();
    });
    addEventListener("keyup", (e) => {
        const k = KEYS[e.code];
        if (k) held[k] = false;
    });
    document.querySelector("#touch [data-k=jump]")!.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        touches.add((e as PointerEvent).pointerId);
        syncTouch();
    });
    const end = (e: PointerEvent) => touches.delete(e.pointerId) && syncTouch();
    addEventListener("pointerup", end);
    addEventListener("pointercancel", end);
    setupStick(document.querySelector<HTMLElement>("#t-stick")!);
}

/** The joystick fills #t-stick. It is rebuilt whenever the zone resizes (shown, rotated). */
function setupStick(zone: HTMLElement) {
    let pad: ReturnType<typeof nipplejs.create> | undefined;
    const set = (keys: (keyof Input)[]) => ((stick = keys), syncTouch());
    new ResizeObserver(() => {
        pad?.destroy();
        pad = undefined;
        set([]);
        if (!zone.clientHeight) return;
        pad = nipplejs.create({
            zone,
            mode: "static",
            position: { left: "50%", top: "50%" },
            size: Math.min(zone.clientWidth, zone.clientHeight),
            color: { front: "var(--accent)", back: "color-mix(in srgb, var(--ink) 30%, transparent)" },
        });
        pad.on("move", (e) => {
            const { x, y } = e.data.vector;
            const keys: (keyof Input)[] = [];
            // The dominant axis wins, so a diagonal doesn't walk and climb at once.
            if (Math.abs(y) > Math.abs(x) * 1.1 && Math.abs(y) > STICK_CLIMB) keys.push(y > 0 ? "up" : "down");
            else if (Math.abs(x) > STICK_WALK) keys.push(x < 0 ? "left" : "right");
            set(keys);
        });
        pad.on("end", () => set([]));
    }).observe(zone);
}

export function clearInput() {
    held.left = held.right = held.up = held.down = held.jump = false;
    touches.clear();
    stick = [];
    syncTouch();
    jumpAt = -Infinity;
}

/** Edge-detected gamepad buttons; movement is OR'd into `out` when given. */
export function pollPads(out?: Input) {
    for (const pad of navigator.getGamepads?.() ?? []) {
        if (!pad) continue;
        const b = pad.buttons.map((x) => x.pressed || x.value > 0.5);
        const x = pad.axes[0] ?? 0,
            y = pad.axes[1] ?? 0;
        // Virtual buttons past the standard 17: the left stick as a d-pad, for menus and movement.
        b[20] = y < -0.6;
        b[21] = y > 0.6;
        b[22] = x < -0.6;
        b[23] = x > 0.6;
        const prev = padPrev.get(pad.index) ?? [];
        const edge = (i: number) => b[i] && !prev[i];
        if (edge(9)) onPadButton("pause");
        if (edge(12) || edge(20)) onPadButton("up");
        if (edge(13) || edge(21)) onPadButton("down");
        if (edge(14) || edge(22)) onPadButton("left");
        if (edge(15) || edge(23)) onPadButton("right");
        if (edge(0)) onPadButton("select");
        if (edge(1)) onPadButton("back");
        if (edge(0) || edge(1) || edge(2)) jumpAt = performance.now();
        padPrev.set(pad.index, b);
        if (!out) continue;
        out.left ||= x < -0.4 || !!b[14];
        out.right ||= x > 0.4 || !!b[15];
        out.up ||= y < -0.55 || !!b[12];
        out.down ||= y > 0.55 || !!b[13];
        out.jump ||= !!b[0] || !!b[1] || !!b[2];
    }
}

export function readInput(): Input {
    const out: Input = {
        left: held.left || touchHeld.left,
        right: held.right || touchHeld.right,
        up: held.up || touchHeld.up,
        down: held.down || touchHeld.down,
        jump: held.jump || touchHeld.jump,
    };
    pollPads(out);
    out.jump ||= performance.now() - jumpAt < JUMP_BUFFER_MS;
    return out;
}
