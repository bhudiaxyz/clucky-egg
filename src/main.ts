/**
 * Main — composition root: boot, menus and run flow, commands, the frame loop, event routing.
 *
 * Purpose
 *   Wires the pure Game to the View, HUD, menus, input and audio. Owns the flow:
 *   boot → main menu (over a live attract farm) → run → pause / game over → menu.
 *
 * Operations
 *   - startup(): the boot sequence behind the splash, one STEPS stage at a time: detect the tier
 *     (or explain a missing WebGL2), build the View, build the attract farm, pre-compile the
 *     shaders (view.warmup), wait for fonts (capped at 1.5 s), then show the main menu. step()
 *     fills the splash's gauge, names the stage, and yields two frames so it paints even on
 *     slow devices, where each stage can take a noticeable moment.
 *   - showMenu() / startRun(n, mode): switch between the splash menu and a run. Continue starts at
 *     the deepest level reached; Level select lists every one reached so far; Random farm
 *     plays endless seeded generated farms (a fresh seed each time).
 *   - onEvent(e): Game events → sfx, sparks, HUD messages, progress saves, game over.
 *   - frame(): rAF loop — update the run (unless paused) or the attract game, drive the HUD
 *     and music intensity (from the bonus clock), and view.sync().
 *   - Commands: Esc / Start pause, M mute, R restart (paused), arrows / d-pad in menus.
 *
 * Usage
 *   index.html loads this module; nothing imports it.
 *
 * Highlights
 *   - The attract game cycles through the hand-built farms every 6 s behind the menu.
 *   - A hidden tab or lost focus pauses a run, and releases held keys.
 *   - window.__game exposes the live Game read-only for browser smoke tests.
 *
 * See also: core/game.ts, render/view.ts, ui/menu.ts, ui/hud.ts, player/input.ts, fx/audio.ts;
 * DESIGN.md "3. Architecture" and "10. UI, menus and progress".
 */
import "./styles.css";
import {Game, type GameEvent, type Mode} from "./core/game";
import {applyUiColors, COLORS} from "./core/palette";
import {markHelpSeen, record, save} from "./core/save";
import {isMuted, setMusicIntensity, sfx, toggleMute, unlock} from "./fx/audio";
import {clearInput, HELP, isTouch, pollPads, readInput, setPadHandler, setupInput} from "./player/input";
import {detectTier, Governor, TIER_SETTINGS, type TierSettings} from "./render/tier";
import {animatePreviews} from "./render/preview";
import {View} from "./render/view";
import {drawHud, message} from "./ui/hud";
import {
    closeSheet,
    farmSelectBody,
    hideIntro,
    howToBody,
    menuBack,
    menuNav,
    menuSelect,
    renderButtons,
    renderMainMenu,
    sheetOpen,
    showIntro,
    showSheet,
    wireHowTo,
} from "./ui/menu";

const IDLE = {left: false, right: false, up: false, down: false, jump: false};
const ATTRACT_SECONDS = 6;
/** Menu focus directions (dx, dy) for arrow keys and pad d-pad / stick. */
const PAD_DIRS: Record<string, [number, number]> = {up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]};
const ARROWS: Record<string, [number, number]> = {
    ArrowUp: PAD_DIRS.up,
    ArrowDown: PAD_DIRS.down,
    ArrowLeft: PAD_DIRS.left,
    ArrowRight: PAD_DIRS.right,
};

let view: View;
let settings: TierSettings;
let governor: Governor;
/** Frame-rate cap bookkeeping: time owed since the last rendered frame. */
let owed = 0;
let lastRender = 0;
let attract: Game;
let game: Game | null = null;
let paused = false;
let startN = 0;
let runMode: Mode = "classic";
let runSeed = 0;
let shownN = -1;
let last = performance.now();

const $ = (sel: string) => document.querySelector<HTMLElement>(sel)!;
const body = document.body;

/** Boot stages, in order. The splash gauge fills one stage at a time. */
const STEPS = [
    "Waking the rooster",
    "Mending the fences",
    "Laying out the farm",
    "Polishing the eggs",
    "Painting the barn",
];

/** Show boot stage i, then yield two frames so the gauge and tip actually paint (slow devices). */
async function step(i: number) {
    $(".ls-gauge span").style.width = `${(i / STEPS.length) * 100}%`;
    $(".ls-tip").textContent = i < STEPS.length ? `${STEPS[i]}…` : "Ready";
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

function bootError(sub: string, tip: string) {
    $(".ls-sub").textContent = sub;
    $(".ls-sub").classList.add("error");
    $(".ls-tip").textContent = tip;
}

async function startup() {
    await step(0);
    const tier = detectTier();
    if (tier === "none")
        return bootError(
            "This game needs WebGL2, which this browser doesn't provide.",
            "Try a current Chrome, Edge, Firefox or Safari."
        );
    document.documentElement.dataset.tier = tier;
    await step(1);
    settings = TIER_SETTINGS[tier];
    view = new View($("#app"), settings);
    governor = new Governor(() => view.degrade());
    view.onContextLost = () => {
        if (game && !paused && game.phase !== "over") showPause("pause");
    };
    await step(2);
    attract = new Game(0, {demo: true});
    view.sync(attract, 0);
    await step(3);
    await view.warmup();
    await step(4);
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
    await step(STEPS.length);
    requestAnimationFrame(frame);
    showMenu();
}

function showMenu() {
    game = null;
    paused = false;
    body.classList.remove("playing");
    $("#pause").classList.remove("open");
    $("#hud").hidden = true;
    hideIntro();
    $("#boot").classList.add("ready");
    $(".ls-best").textContent = save.best ? `Best ${save.best}` : "";
    const begin = (n: number, mode: Mode = "classic") => () => (save.seenHelp ? startRun(n, mode) : howTo(() => startRun(n, mode)));
    renderMainMenu([
        ...(save.reached > 0
            ? [{label: "Continue", hint: `Level ${save.reached + 1}`, action: () => startRun(save.reached)}]
            : []),
        {label: "New game", action: begin(0)},
        {label: "Random farm", hint: "endless", action: begin(0, "random")},
        {label: "Level select", disabled: save.reached === 0, action: levelSelect},
        {label: "How to play", action: () => howTo()},
        {label: isMuted() ? "Sound: off" : "Sound: on", action: () => (toggleMute(), showMenu())},
    ]);
}

function levelSelect() {
    showSheet({
        title: "Level select",
        body: farmSelectBody(save.reached, "classic", 0, (n) => (closeSheet(), startRun(n))),
        actions: [{label: "Back", kbd: "Esc", action: closeSheet}],
    });
}

function howTo(then?: () => void) {
    let stopPreviews = () => {
    };
    const done = () => {
        stopPreviews();
        closeSheet();
        markHelpSeen();
        then?.();
    };
    showSheet({
        title: "How to play",
        body: howToBody(bindings()),
        actions: [{label: then ? "Start" : "Back", primary: true, action: done}],
        onBack: done,
    });
    wireHowTo($("#sheet .sheet-body"));
    stopPreviews = animatePreviews($("#sheet .sheet-body"));
}

function bindings() {
    return `<dl class="bindings">${HELP.map(([k, a]) => `<dt>${k}</dt><dd>${a}</dd>`).join("")}</dl>`;
}

function startRun(n: number, mode: Mode = "classic") {
    unlock();
    startN = n;
    runMode = mode;
    // Random farm: a new seed each run, so no two runs share their farms.
    runSeed = mode === "random" ? Math.floor(Math.random() * 1e6) : 0;
    game = new Game(n, {mode, seed: runSeed});
    game.onEvent = onEvent;
    shownN = -1;
    paused = false;
    clearInput();
    $("#boot").classList.remove("ready");
    $("#pause").classList.remove("open");
    $("#hud").hidden = false;
    body.classList.add("playing");
    if (isTouch) document.documentElement.requestFullscreen?.({navigationUI: "hide"}).catch(() => {
    });
}

function onEvent(e: GameEvent) {
    const g = game!;
    sfx[e]?.();
    const h = g.harry;
    const hx = h.x + 3,
        hy = h.y + 7;
    if (e === "egg") {
        const col = COLORS.eggCycle[g.left % COLORS.eggCycle.length];
        view.burst(hx, hy, col, 26);
        view.halo(hx, hy, col);
    }
    if (e === "seed") view.burst(hx, hy + 6, COLORS.seed, 16, 3);
    if (e === "eat") navigator.vibrate?.(8);
    if (e === "duck") message("The Mother Duck is loose!");
    if (e === "die") {
        view.burst(hx, hy, COLORS.straw, 50, 6);
        view.burst(hx, hy, COLORS.shirt, 40, 5);
        view.burst(hx, hy, COLORS.feather, 30, 4);
        navigator.vibrate?.(120);
    }
    if (e === "land" || e === "jump") view.burst(hx, h.y + 14, COLORS.dust, e === "land" ? 8 : 5, 1.4, 1);
    if (e === "extra") message("Extra life!");
    if (e === "clear") {
        record(g.score, g.n + 1);
        for (let i = 0; i < 12; i++) {
            const egg = g.level.eggs[i];
            if (egg) view.burst(egg.x, egg.y, COLORS.eggCycle[i % 5], 12, 3);
        }
        message(`Farm cleared! Bonus ${Math.floor(g.time)}`, 2200);
    }
    if (e === "over") {
        record(g.score, g.n);
        showPause("over");
    }
}

function showPause(kind: "pause" | "over") {
    const g = game!;
    paused = true;
    clearInput();
    const el = $("#pause");
    el.dataset.kind = kind;
    $("#pause-title").textContent = kind === "over" ? "Game over" : "Paused";
    $("#pause .p-score").textContent =
        kind === "over"
            ? `Score ${g.score} · best ${Math.max(save.best, g.score)} · reached level ${g.n + 1}`
            : `${g.n + 1}. ${g.level.name} · score ${g.score}`;
    renderButtons($("#pause nav"), [
        ...(kind === "over"
            ? [{label: "Play again", kbd: "Enter", primary: true, action: () => startRun(startN, runMode)}]
            : [
                {label: "Resume", kbd: "Esc", primary: true, action: resume},
                {label: "Restart level", kbd: "R", action: restart},
            ]),
        {label: isMuted() ? "Sound: off" : "Sound: on", kbd: "M", action: () => (toggleMute(), showPause(kind))},
        {label: "Main menu", kbd: "Q", action: showMenu},
    ]);
    $("#pause .bindings").innerHTML = bindings();
    el.classList.add("open");
    el.querySelector<HTMLElement>("nav button")?.focus({preventScroll: true});
}

function resume() {
    if (!game || game.phase === "over") return;
    paused = false;
    $("#pause").classList.remove("open");
    unlock();
}

function restart() {
    if (!game) return;
    resume();
    if (game.phase === "play") game.die();
}

function togglePause() {
    if (!game || game.phase === "over") return;
    if (paused) resume();
    else showPause("pause");
}

function frame(now: number) {
    requestAnimationFrame(frame);
    // Cap the render rate (phones and tablets: 60 fps even on 90 / 120 Hz screens; the game
    // ticks at 120 Hz, so more frames only cost heat and battery). Time owed carries over, so a
    // 90 Hz screen still averages 60.
    if (settings.maxFps) {
        owed += now - lastRender;
        lastRender = now;
        const min = 1000 / settings.maxFps;
        if (owed < min - 1) return;
        owed = Math.min(owed - min, min);
    }
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    // The governor watches steady play only (menus and pauses idle; level builds hitch).
    if (game && !paused && game.phase === "play") governor.frame(now - last);
    last = now;
    if (game) {
        if (!paused) game.update(dt, readInput());
        else pollPads();
        if (game.n !== shownN) {
            shownN = game.n;
            governor.reset();
            const lv = game.level;
            const feats = [
                `${lv.hens.length + (game.pass >= 3 ? lv.spares.length : 0)} creatures`.replace(/^0 creatures$/, "no creatures"),
                lv.lifts.length && "lifts",
                game.pass >= 1 && game.pass !== 1 && "the Mother Duck",
                game.pass === 1 && "the Mother Duck, loose",
                game.flyers.length && "bugs on the wing",
            ].filter(Boolean);
            showIntro(game.n, lv.name, [`${lv.time / 10} s bonus`, ...feats].join(" · "), game.mode);
            record(game.score, game.n);
        }
        drawHud(game, save.best);
        const f = game.time / game.level.time;
        setMusicIntensity(game.phase === "play" ? (0.4 - f) / 0.4 : 0);
    } else {
        pollPads();
        attract.update(dt, IDLE);
        if (attract.clock > ATTRACT_SECONDS) attract = new Game((attract.n + 1) % 8, {demo: true});
    }
    view.sync(game ?? attract, game && paused ? 0 : dt);
}

function inMenu() {
    return !game || paused || sheetOpen();
}

function wireEvents() {
    addEventListener("keydown", (e) => {
        if (e.repeat) return;
        if (e.code === "Escape") {
            if (menuBack()) return;
            if (game && game.phase !== "over") togglePause();
            return;
        }
        if (e.code === "KeyM") {
            toggleMute();
            if (game && paused) showPause($("#pause").dataset.kind as "pause" | "over");
            else if (!game) showMenu();
        }
        if (game && paused && e.code === "KeyR" && game.phase !== "over") restart();
        if (game && paused && e.code === "KeyQ") showMenu();
        const arrow = ARROWS[e.code];
        if (inMenu() && arrow) {
            e.preventDefault();
            menuNav(...arrow);
        }
    });
    setPadHandler((b) => {
        if (b === "pause") return togglePause();
        if (!inMenu()) return;
        if (b in PAD_DIRS) menuNav(...PAD_DIRS[b]);
        else if (b === "select") menuSelect();
        else if (b === "back" && !menuBack() && game && paused) resume();
    });
    $("#t-pause").addEventListener("pointerdown", (e) => (e.preventDefault(), togglePause()));
    addEventListener("blur", clearInput);
    document.addEventListener("visibilitychange", () => {
        governor?.reset();
        if (document.hidden && game && !paused && game.phase !== "over") showPause("pause");
    });
    $(".ls-controls").textContent = isTouch
        ? "Tap a menu item to begin"
        : HELP.map(([k, a]) => `${k}: ${a}`).join("   ·   ");
    Object.defineProperty(window, "__game", {get: () => game});
}

applyUiColors();
setupInput();
wireEvents();
startup().catch((err) => {
    console.error(err);
    bootError(`Couldn't start: ${err?.message ?? err}`, "Try ?tier=low in the address bar.");
});
