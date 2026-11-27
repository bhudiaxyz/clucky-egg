# Clucky Egg: design notes

## 1. Goals

A faithful Chuckie Egg in the browser: single-screen platform levels, twelve eggs, grain, hens, lifts, the Mother Duck, the bonus clock, five passes over eight levels. It reuses Mayhem Miner's engineering: a pure rules core, a stateless three.js view, procedural everything (no image or audio files), three GPU tiers with a frame-time governor, and one input model for keyboard, touch and gamepad.

## 2. Tech

TypeScript (strict), Vite, three.js (+ post-processing from `examples/jsm`), nipplejs for the touch stick. No other runtime dependencies.

## 3. Architecture

```
main.ts  ──►  Game (core/, pure)   ◄── scripts/check.ts (headless)
   │             ▲
   ├──► View (render/, reads Game) ──► Effects (fx/)
   ├──► HUD / menus (ui/, DOM)
   ├──► input (player/)   audio (fx/)
```

`Game.update(dt, input)` is the only way state changes. The View reads positions and flags and never writes back, so a paused game (dt = 0) freezes everything, and the title screen runs a real `Game` in `demo` mode behind the menu.

## 4. Levels (`world/levels.ts`)

26 × 24 tiles of 8 game pixels. Five platform tiers on rows 6, 10, 14, 18, 22. A `LevelSpec` lists platform spans per tier, ladders (`[column, upper tier]`), eggs, grain, hens, start and lifts; `parse()` turns it into tiles `# H T .` plus pixel positions. `T` is a ladder cell on a platform row: climbable *and* standable, so ladders can chain through floors. The top-left 5 × 5 is the cage.

## 5. Movement (`core/physics.ts`)

Fixed 120 Hz, pixels. Harry is a 6 × 14 box. Walk 44 px/s, climb 34, jump 135 px/s up under 520 px/s²: a 17.5 px hop lasting 0.52 s and covering 22.9 px, with direction fixed at take-off. Platforms are solid from every side. Ladder cells and lifts are one-way to land on. Falling any distance is safe; the bottom edge and lift crushes kill.

## 6. The solver (`world/solver.ts`)

A conservative tile graph: walk, drop, jump a gap of up to two cells, ladders both ways, lifts. `solves(spec)` proves every egg and pile of grain reachable. `check.ts` asserts it for all eight levels and the generator keeps a candidate only if it passes.

## 7. Generation and difficulty

`core/difficulty.ts`: bands of eight levels (one pass), `t` creeping 20% inside a band and stepping at each new one, saturating at level 40. `world/generate.ts` lays tiers from the difficulty (platform length, gaps, pits), cuts a lift shaft when lifts are due, adds ladders, scatters items and hens, then tests with the solver (60 tries, never needed). Seeds: `n * 7919 + seed * 104729 + attempt`. *Random farm* generates every level from a fresh seed.

## 8. Game rules (`core/game.ts`, `core/creatures.ts`)

Egg 100, grain 50 (and freezes the clock 2.5 s), clear bonus = remaining clock, extra life per 10,000, five lives. Death keeps eggs and eaten grain; Harry, creatures and the duck return to their starts. A timeout costs a life and refills the clock to 50 s.

Walkers patrol, turn at platform ends, usually climb towards Harry's floor at a ladder, and eat grain they reach. `core/creatures.ts` lists them with `from` (first level), `speed` and blurb; `walkerFor(n, slot)` keeps a hen in every other slot. Fliers (pass 3+) sweep a lane of air 10 px below a platform, hitting only a jumping or climbing Harry. The Mother Duck homes in on Harry through walls from pass 2.

## 9. Rendering (`render/`)

2.5D: a flat play plane with depth for blocks, a perspective camera that drifts slightly with Harry, hemisphere + key light, a warm point lamp that gutters as the clock runs low. Platforms are instanced rounded cubes (procedural rock texture) under plank caps, with neon edge strips. Back wall: copper-bar gradient, painted rock and a feature layer (`paint.ts`). Post: optional GTAO, bloom, output; per-tier MSAA, shadows, DPR and particle budgets (`tier.ts`), with the Governor stepping quality down on sustained slow frames.

### 9.1 Characters (`characters.ts`)

Voxel parts hung from joints (one voxel = 1/8 unit), at most two meshes per part (lit and glow), faces culled to those exposed to air. Poses are eased toward targets, so idle → walk → climb → jump → fall blend. `fowl()` builds hen, rooster and goose; the rest are individual rigs. Small creatures are drawn up to 1.5× larger than life so their reach reads.

## 10. UI

Splash doubles as the main menu over a live attract farm. Sheets for How to play (rules, controls, farm features and creatures as animated carousels) and Level select. Pause / game-over dialog. Touch layout: portrait gives a strip under the farm for the stick and JUMP; landscape gives mirrored gutters.

## 11. Palette and themes

`core/palette.ts`: one theme per hand-built farm; every other level gets a seeded theme (golden-ratio hue steps) so each pass looks different. Eggs and edge strips are HDR so only they bloom.

## 13. Input

Keyboard by `KeyboardEvent.code`; nipplejs four-way stick with dominant-axis dead zones; per-finger jump; gamepad stick / d-pad / A / B; 100 ms jump buffer.

## 14. Audio

WebAudio chiptune: square / triangle voices and noise. An original eight-bar C-major tune whose tempo (132 to 190 BPM) rises as the bonus clock runs down.

## 16. Checks and tooling

`npm run check` (Node's native TypeScript): parsing, reachability, jump range and gaps, ladders, lifts, rules, passes, fliers, generator determinism and solvability for 120 levels, difficulty monotonicity, GPU tiers and the governor. `scripts/smoke.py` drives a real browser (desktop, portrait and landscape phones) against `npm run preview`.
