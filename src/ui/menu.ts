/**
 * Menu — the main menu, dialog sheets (farm select, how to play) and the level intro card.
 *
 * Purpose
 *   Screen-level UI that isn't the HUD or pause dialog, as small DOM builders over the hosts in
 *   index.html: .ls-menu (the splash doubles as the main menu), #sheet (a modal dialog styled
 *   like #pause) and #intro. main.ts owns the flow; this module only renders and reports choices.
 *   The same module as Mayhem Miner's, re-skinned.
 *
 * Operations
 *   - renderMainMenu(items): buttons into .ls-menu; the first enabled one takes focus.
 *   - showSheet({ title, body, actions, onBack }): opens #sheet; Esc / gamepad B = onBack.
 *   - renderButtons(host, actions): the shared button row builder (sheets and pause).
 *   - menuNav(dx, dy) / menuSelect() / menuBack(): arrows and gamepad d-pad / stick / A / B
 *     move focus spatially through the top-most menu and press the focused control.
 *   - farmSelectBody(reached, mode, seed, onPick): a grid of levels 1 .. reached + 1 with names.
 *   - howToBody(controls) / wireHowTo(): How to play as four pages with a pager: the rules
 *     (HOWTO), the controls, "Obstacles & dangers" and "Who's on the farm". The last two are
 *     carousels: one animated preview (render/preview.ts) at a time, ◀ ▶ to step through.
 *   - showIntro(n, name, facts, mode): the 2.4 s level title card.
 *
 * Highlights
 *   - Everything is plain buttons, so mouse, touch, keyboard and gamepads all work, and focus
 *     moves into each dialog.
 *   - Names and labels go in through textContent or an escaper; nothing is injected raw.
 *
 * See also: main.ts (flow), index.html, styles.css; DESIGN.md "10. UI, menus and progress".
 */
import {bandName} from "../core/difficulty";
import {ALL_CREATURES} from "../core/creatures";
import {HAZARDS} from "../render/props";
import {farmFor, type Mode} from "../world/generate";

export interface MenuItem {
    label: string;
    hint?: string;
    disabled?: boolean;
    action: () => void;
}

export interface Action {
    label: string;
    kbd?: string;
    primary?: boolean;
    action: () => void;
}

let onSheetBack: (() => void) | null = null;
let introTimer = 0;

const $ = (sel: string) => document.querySelector<HTMLElement>(sel)!;
export const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]!);

export function renderMainMenu(items: MenuItem[]) {
    const nav = $(".ls-menu");
    nav.replaceChildren(
        ...items.map((it) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "menu-btn";
            b.disabled = !!it.disabled;
            b.innerHTML = `<span>${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ""}`;
            b.addEventListener("click", (e) => {
                e.stopPropagation();
                it.action();
            });
            return b;
        })
    );
    nav.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus({preventScroll: true});
}

export function renderButtons(host: HTMLElement, actions: Action[]) {
    host.replaceChildren(
        ...actions.map((a) => {
            const b = document.createElement("button");
            b.type = "button";
            if (a.primary) b.className = "primary";
            b.innerHTML = `<span>${esc(a.label)}</span>${a.kbd ? `<kbd>${esc(a.kbd)}</kbd>` : ""}`;
            b.addEventListener("click", a.action);
            return b;
        })
    );
}

export const sheetOpen = () => $("#sheet").classList.contains("open");

export function showSheet(o: { title: string; body: string | Node; actions: Action[]; onBack?: () => void }) {
    const sheet = $("#sheet");
    $("#sheet-title").textContent = o.title;
    const body = $("#sheet .sheet-body");
    if (typeof o.body === "string") body.innerHTML = o.body;
    else body.replaceChildren(o.body);
    renderButtons($("#sheet .sheet-actions"), o.actions);
    onSheetBack = o.onBack ?? null;
    sheet.classList.add("open");
    (
        sheet.querySelector<HTMLElement>(".sheet-actions .primary") ??
        sheet.querySelector<HTMLElement>(".sheet-body button, .sheet-actions button")
    )?.focus({preventScroll: true});
}

export function closeSheet() {
    $("#sheet").classList.remove("open");
    onSheetBack = null;
}

function focusables(): HTMLElement[] {
    const root = sheetOpen() ? $("#sheet") : $("#pause").classList.contains("open") ? $("#pause") : $(".ls-menu");
    return [...root.querySelectorAll<HTMLElement>("button:not([disabled])")].filter((e) => e.offsetParent !== null);
}

/**
 * Spatial focus move: the nearest control in direction (dx, dy), so grids and the two-column
 * short-screen menu work with all four arrows. Nothing that way: step through document order.
 */
export function menuNav(dx: number, dy: number) {
    const els = focusables();
    if (!els.length) return;
    const cur = document.activeElement as HTMLElement;
    const i = els.indexOf(cur);
    if (i < 0) return els[0].focus({preventScroll: true});
    const a = cur.getBoundingClientRect();
    let best: HTMLElement | undefined,
        bestD = Infinity;
    for (const e of els) {
        const b = e.getBoundingClientRect();
        const ex = b.left + b.width / 2 - (a.left + a.width / 2),
            ey = b.top + b.height / 2 - (a.top + a.height / 2);
        const along = ex * dx + ey * dy;
        const d = along + 2 * Math.abs(dx ? ey : ex);
        if (along > 1 && d < bestD) ((bestD = d), (best = e));
    }
    (best ?? els[(i + dx + dy + els.length) % els.length]).focus({preventScroll: true});
}

export function menuSelect() {
    const el = document.activeElement as HTMLElement | null;
    if (el && focusables().includes(el)) el.click();
}

/** Esc / B on a sheet: run its back action. Returns whether a sheet handled it. */
export function menuBack() {
    if (!sheetOpen()) return false;
    (onSheetBack ?? closeSheet)();
    return true;
}

export function farmSelectBody(reached: number, mode: Mode, seed: number, onPick: (n: number) => void) {
    const grid = document.createElement("div");
    grid.className = "cavern-grid";
    for (let n = 0; n <= reached; n++) {
        const b = document.createElement("button");
        b.type = "button";
        b.innerHTML = `<b>${n + 1}</b><span>${esc(farmFor(n, mode, seed).name)}</span>`;
        b.addEventListener("click", () => onPick(n));
        grid.append(b);
    }
    return grid;
}

export const HOWTO = `
<ol class="howto">
  <li><b>Collect all twelve eggs.</b> They glint. The count is in the bottom bar; take the last one to clear the farm.</li>
  <li><b>Gobble the grain</b> for 50 points. Taking a pile freezes the bonus clock for a moment, but the first creature to reach a pile eats it.</li>
  <li><b>Beat the clock.</b> The bonus ticks down all the time; run out and you lose a life. What's left when you clear a farm is added to your score.</li>
  <li><b>Climb ladders, ride lifts.</b> Platforms are solid, so ladders are the only way up. A lift wraps from the top of the screen back to the bottom: don't ride it into the ceiling.</li>
  <li><b>Jumps are committed.</b> Choose your direction before you leave the ground. You can fall any distance, but not out of the bottom of the screen.</li>
  <li><b>Mind the farm.</b> Hens and every other creature hurt on touch. After the first eight farms the Mother Duck breaks loose; later still come extra hens, bugs on the wing, and faster everything.</li>
</ol>`;

const MOVES = {walk: "patrols a platform", fly: "sweeps the air", boss: "flies at you"};

interface Slide {
    id: string;
    name: string;
    meta: string;
    blurb: string;
}

/** Help's characters, in order: Harry, then every creature in the order they arrive. */
const CAST: Slide[] = [
    {
        id: "harry",
        name: "Harry (you)",
        meta: "hen-house farmer",
        blurb: "Walks, climbs and jumps. The lamp over his head dims and gutters as the bonus clock runs low.",
    },
    ...ALL_CREATURES.map((c) => ({
        id: c.id,
        name: c.name,
        meta: `${MOVES[c.kind]} · ${c.kind === "boss" ? "from the second pass" : `from level ${c.from + 1}`}`,
        blurb: c.blurb,
    })),
];

const SETS: Record<string, Slide[]> = {cast: CAST, hazards: HAZARDS};

/** One carousel: an animated preview (render/preview.ts) with ◀ ▶ to step through a set. */
function carousel(set: string, title: string, note: string) {
    const label = set === "cast" ? "character" : "feature";
    return `<h3 class="cr-title">${title}</h3>
<div class="cr-card" data-set="${set}">
  <button class="cr-nav" data-step="-1" aria-label="Previous ${label}">◀</button>
  <canvas data-preview="${SETS[set][0].id}" width="192" height="192" aria-hidden="true"></canvas>
  <button class="cr-nav" data-step="1" aria-label="Next ${label}">▶</button>
  <div class="cr-text" aria-live="polite"><b></b><span class="cr-meta"></span><p></p><span class="cr-count"></span></div>
</div>
<p class="cr-note">${note}</p>`;
}

/** How to play's four pages, in order: the rules, the controls, farm features, creatures. */
const PAGES = ["How to play", "Controls", "On the farm", "Who's on the farm"];

/**
 * How to play as four pages, one shown at a time, with a ◀ n / 4 · title ▶ pager under each.
 * `controls` is the device's bindings list (main.ts). wireHowTo() hooks up the pager and carousels.
 */
export function howToBody(controls: string) {
    const pages = [
        HOWTO,
        controls,
        carousel(
            "hazards",
            "On the farm",
            "Platforms are solid from below, ladders are the way up, and a fall of any height is safe: only the bottom of the screen is fatal."
        ),
        carousel(
            "cast",
            "Who's on the farm",
            "Touching any creature costs a life, and each one's reach is about a farmer's height, even the low ones. Hens keep turning up; the rest arrive level by level, then in later passes."
        ),
    ];
    return (
        pages
            .map((html, i) => `<section class="ht-page" data-page="${i}"${i ? " hidden" : ""}>${html}</section>`)
            .join("") +
        `<div class="ht-pager"><button class="cr-nav ht-prev" aria-label="Previous page">◀</button>` +
        `<span class="ht-step" aria-live="polite"></span>` +
        `<button class="cr-nav ht-next" aria-label="Next page">▶</button></div>`
    );
}

export function wireHowTo(root: HTMLElement) {
    wireCarousels(root);
    const pages = [...root.querySelectorAll<HTMLElement>(".ht-page")];
    const step = root.querySelector<HTMLElement>(".ht-step")!;
    let i = 0;
    const show = () => {
        pages.forEach((p, k) => (p.hidden = k !== i));
        step.textContent = `${i + 1} / ${pages.length} · ${PAGES[i]}`;
    };
    root.querySelector(".ht-prev")!.addEventListener(
        "click",
        () => ((i = (i + pages.length - 1) % pages.length), show())
    );
    root.querySelector(".ht-next")!.addEventListener("click", () => ((i = (i + 1) % pages.length), show()));
    show();
}

function wireCarousels(root: HTMLElement) {
    for (const card of root.querySelectorAll<HTMLElement>(".cr-card")) {
        const slides = SETS[card.dataset.set!];
        let i = 0;
        const show = () => {
            const c = slides[i];
            card.querySelector("canvas")!.dataset.preview = c.id;
            card.querySelector(".cr-text b")!.textContent = c.name;
            card.querySelector(".cr-meta")!.textContent = c.meta;
            card.querySelector(".cr-text p")!.textContent = c.blurb;
            card.querySelector(".cr-count")!.textContent = `${i + 1} / ${slides.length}`;
        };
        card.querySelectorAll<HTMLButtonElement>(".cr-nav").forEach((b) =>
            b.addEventListener("click", () => {
                i = (i + Number(b.dataset.step) + slides.length) % slides.length;
                show();
            })
        );
        show();
    }
}

export function showIntro(n: number, name: string, facts: string, mode: Mode) {
    const kind = mode === "random" ? "Random farm" : n < 40 ? `Level ${n + 1} of 40` : `Level ${n + 1} · endless`;
    $("#intro-num").textContent = `${kind} · ${bandName(n)}`;
    $("#intro-name").textContent = name;
    $("#intro-facts").textContent = facts;
    const el = $("#intro");
    el.classList.add("show");
    clearTimeout(introTimer);
    introTimer = window.setTimeout(() => el.classList.remove("show"), 2400);
}

export function hideIntro() {
    clearTimeout(introTimer);
    $("#intro").classList.remove("show");
}
