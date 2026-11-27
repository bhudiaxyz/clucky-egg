/**
 * HUD — the level name bar and the bottom status bar (bonus clock, score, best, eggs, lives).
 *
 * Purpose
 *   Shows the game state over the canvas as plain DOM.
 *
 * Operations
 *   - drawHud(game, best): writes each field only when its text or style actually changed,
 *     since identical DOM writes still cost a style recalculation every frame on phones.
 *   - message(text, ms): a fading status line (extra life, the duck breaking loose).
 *
 * Highlights
 *   - The bonus bar turns red and blinks under 20%, and shows an ice-blue "frozen" glow while
 *     grain has stopped the clock.
 *
 * See also: main.ts, index.html (#hud), styles.css; DESIGN.md "10. UI, menus and progress".
 */
import type { Game } from "../core/game";
import { bandName } from "../core/difficulty";

const $ = (id: string) => document.getElementById(id)!;
const last = new Map<string, string>();
let msgTimer = 0;

function put(id: string, text: string) {
    if (last.get(id) === text) return;
    last.set(id, text);
    $(id).textContent = text;
}

function flag(key: string, el: HTMLElement, cls: string, on: boolean) {
    const v = on ? "1" : "";
    if (last.get(key) === v) return;
    last.set(key, v);
    el.classList.toggle(cls, on);
}

export function drawHud(g: Game, best: number) {
    put("h-name", `${g.n + 1}. ${g.level.name}`);
    put("h-score", String(g.score).padStart(6, "0"));
    put("h-best", String(Math.max(best, g.score)).padStart(6, "0"));
    put("h-eggs", `◖◗ ${g.left}`);
    put("h-bonus", String(Math.max(0, Math.floor(g.time))).padStart(4, "0"));
    put("h-lives", "♥".repeat(Math.max(0, Math.min(g.lives, 9))));
    put("h-band", `${bandName(g.n)} · pass ${g.pass + 1}`);
    const f = Math.max(0, g.time / g.level.time);
    const w = `${(Math.min(1, f) * 100).toFixed(1)}%`;
    if (last.get("bar") !== w) {
        last.set("bar", w);
        $("h-air").style.width = w;
    }
    flag("low", $("hud"), "low-air", f < 0.2 && g.phase === "play");
    flag("frozen", $("hud"), "frozen", g.freeze > 0 && g.phase === "play");
}

export function message(text: string, ms = 1800) {
    const el = $("h-msg");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(msgTimer);
    msgTimer = window.setTimeout(() => el.classList.remove("show"), ms);
}
