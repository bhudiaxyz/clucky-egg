# Clucky Egg

A browser clone of the classic **Chuckie Egg** (Doug Anderson, 1983): a farmer on a stack of platforms, twelve eggs to collect a level, ten piles of grain, hens that chase you up the ladders, lifts that wrap from the top of the screen to the bottom, a caged Mother Duck, and a bonus clock that never stops.

Built with **TypeScript, Vite and three.js**, as a sibling of [Mayhem Miner](../mayhem-miner): the same architecture, voxel-style rigged characters, procedural textures, menus, controls and GPU tiering, with a new game on top. Playable on desktop, tablets and (especially) phones, in portrait or landscape.

## Play

```bash
npm install
npm run dev        # http://localhost:5192/clucky-egg/
npm run build      # typecheck + production build into dist/
npm run check      # headless asserts over the rules, levels, generator and tiers
```

| Device                | Controls                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| Keyboard              | ← → / A D walk · ↑ ↓ / W S climb · Space jump · Esc pause · M sound · R restart (paused)         |
| Touch                 | Four-way stick (left / right walk, up / down climb) and a JUMP button; ❚❚ pauses                |
| Gamepad               | Left stick or d-pad · A / B jump · Start pause; d-pad and A / B drive the menus                  |

Add `?tier=low` (or `mobile-high`, `high`) to the address to force a graphics tier.

## The game

- **Eggs and grain.** Twelve eggs a level (100 each); ten piles of grain (50 each). Taking grain freezes the bonus clock briefly; the first creature to reach a pile stops to eat it.
- **The clock.** Bonus counts down ten a second. At zero you lose a life; clear the farm and what is left is added to your score.
- **Movement.** Platforms are solid, so ladders are the way up. Jumps are committed once you leave the ground. Falling any distance is safe; only the bottom of the screen kills. Lifts rise and wrap, and carrying you into the ceiling is fatal.
- **Five lives**, an extra one every 10,000 points.
- **Passes** (after the original): 1 hens and a caged duck · 2 the Mother Duck loose, no hens · 3 both · 4 more hens and bugs on the wing · 5+ faster, three fliers.
- **Hand-built farms and endless generated ones.** The eight classic layouts, then from level 40 (or from level 1 in *Random farm*) farms generated from a seed and proven completable by a solver.
- **A whole barnyard.** Hen, chick, barn rat, rooster, dung beetle, ladybird, snail, ant, caterpillar, hedgehog, goose, mole, barn spider; fliers: bumblebee, barn bat, moth, dragonfly; and the Mother Duck. Each has its own speed and voxel rig.

## Structure

```
src/
  core/      pure rules: game, physics, creatures, difficulty, palette, save, random
  world/     levels, farms (generated), solver
  render/    view, characters (voxel rigs), paint (procedural textures), props, preview, tier
  fx/        audio (WebAudio synth + tune), effects (sparks, halos, motes)
  ui/        hud, menu     player/ input (keyboard, touch stick, gamepad)
scripts/     check.ts (headless asserts), smoke.py (Playwright), ts-resolve.mjs
```

See [DESIGN.md](DESIGN.md) for the details.

## Credits

Game design by Doug Anderson (A&F Software); this is an independent, non-commercial homage with original art, sound and levels. Architecture, tooling and rendering approach follow Mayhem Miner.
