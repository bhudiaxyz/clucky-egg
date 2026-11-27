/**
 * Creatures — the roster of farm and barn animals, insects and bugs that chase Harry. Pure data.
 *
 * Purpose
 *   One list that the rules (speed, when each arrives), the renderer (which voxel model to
 *   build) and How to play (names, blurbs) all read. Models live in render/characters.ts.
 *
 * Operations
 *   - WALKERS: creatures that patrol a platform, climb ladders towards Harry and stop to eat
 *     grain. The hen is the original's; the rest arrive level by level (`from` is the
 *     overall 0-based level index), so a run keeps meeting newcomers. `speed` scales the
 *     level's hen speed: snails are slow, ants and chicks quick.
 *   - FLYERS: creatures that sweep a lane of open air between two floors from pass 3 on. They
 *     are only dangerous to a jumping or climbing Harry, which is where the lane sits.
 *   - walkerFor(n, slot) / flyerFor(n, slot): who fills slot `slot` of level n: the newest
 *     arrivals first, with the plain hen kept in every other slot so the hen stays the star.
 *   - creatureInfo(id): metadata for any id, including "duck" (the mother duck).
 *
 * Usage
 *   core/game.ts assigns kinds when a level loads; render/characters.ts maps ids to models.
 *
 * See also: render/characters.ts, ui/menu.ts (Who's on the farm); DESIGN.md "8. Game rules".
 */
export interface CreatureInfo {
    id: string;
    name: string;
    kind: "walk" | "fly" | "boss";
    /** First overall level (0-based) it can appear on. */
    from: number;
    /** Multiplier on the level's creature speed. */
    speed: number;
    /** How How-to-play describes it. */
    blurb: string;
    /** Preview colour in How to play (in play each farm tints its own). */
    preview: number;
}

export const WALKERS: CreatureInfo[] = [
    {
        id: "hen",
        name: "Hen",
        kind: "walk",
        from: 0,
        speed: 1,
        blurb: "The original. Paces her platform, turns at the ends, climbs ladders after you and stops to gobble grain.",
        preview: 0xf6f2ea,
    },
    {
        id: "chick",
        name: "Chick",
        kind: "walk",
        from: 1,
        speed: 1.3,
        blurb: "Tiny, fluffy and quick. It's low, but your boots are lower: jump well clear.",
        preview: 0xffd23a,
    },
    {
        id: "rat",
        name: "Barn rat",
        kind: "walk",
        from: 2,
        speed: 1.2,
        blurb: "Scurries along the beams with a swinging tail. Loves grain more than hens do.",
        preview: 0x9a8a80,
    },
    {
        id: "rooster",
        name: "Rooster",
        kind: "walk",
        from: 3,
        speed: 1.1,
        blurb: "Tall and proud with a big comb and a flowing tail. Taller than Harry, so there's no ducking him.",
        preview: 0xd0503a,
    },
    {
        id: "beetle",
        name: "Dung beetle",
        kind: "walk",
        from: 4,
        speed: 0.9,
        blurb: "Six legs, steady pace. Turns at the end of every platform and climbs without hurry.",
        preview: 0x3ab0b0,
    },
    {
        id: "ladybird",
        name: "Ladybird",
        kind: "walk",
        from: 5,
        speed: 1,
        blurb: "Friendly colours, unfriendly manners. Spotted shell, keen on every ladder.",
        preview: 0xe04a3a,
    },
    {
        id: "snail",
        name: "Garden snail",
        kind: "walk",
        from: 6,
        speed: 0.55,
        blurb: "Very slow, and it leaves things to eat behind. Easy to dodge, easy to forget about.",
        preview: 0xc89a6a,
    },
    {
        id: "ant",
        name: "Field ant",
        kind: "walk",
        from: 7,
        speed: 1.35,
        blurb: "Three body segments and a hurry. Scuttles faster than any hen.",
        preview: 0x8a3a2a,
    },
    {
        id: "caterpillar",
        name: "Caterpillar",
        kind: "walk",
        from: 16,
        speed: 0.7,
        blurb: "Rears up as it inches along, taller at the head than the tail.",
        preview: 0x8ad04a,
    },
    {
        id: "hedgehog",
        name: "Hedgehog",
        kind: "walk",
        from: 18,
        speed: 0.8,
        blurb: "A shuffling ball of spines. Slow, but nothing about it is soft.",
        preview: 0x9a7a5a,
    },
    {
        id: "goose",
        name: "Goose",
        kind: "walk",
        from: 20,
        speed: 0.9,
        blurb: "Long neck, longer temper. Big and hard to leap over cleanly.",
        preview: 0xf0f0f0,
    },
    {
        id: "mole",
        name: "Mole",
        kind: "walk",
        from: 22,
        speed: 0.8,
        blurb: "Paddles along on big digging claws. Slow-looking, but steady to the end of its platform.",
        preview: 0xa07a6a,
    },
    {
        id: "spider",
        name: "Barn spider",
        kind: "walk",
        from: 24,
        speed: 1.1,
        blurb: "Eight legs scuttling sideways along the rafters. Mind the leg reach.",
        preview: 0xd04a4a,
    },
];

export const FLYERS: CreatureInfo[] = [
    {
        id: "bee",
        name: "Bumblebee",
        kind: "fly",
        from: 16,
        speed: 1,
        blurb: "Hums back and forth across a lane of air between two floors. Only a jump or a ladder takes you into it.",
        preview: 0xffd23a,
    },
    {
        id: "bat",
        name: "Barn bat",
        kind: "fly",
        from: 24,
        speed: 1.1,
        blurb: "Sweeps the rafters and ignores platforms; only the walls turn it.",
        preview: 0x9a6ad0,
    },
    {
        id: "moth",
        name: "Barn moth",
        kind: "fly",
        from: 32,
        speed: 1.15,
        blurb: "Flutters through the lamplight. Faster in the deeper farms.",
        preview: 0xd0b04a,
    },
    {
        id: "dragonfly",
        name: "Dragonfly",
        kind: "fly",
        from: 40,
        speed: 1.3,
        blurb: "Darts the length of its lane in a blink. Time your jump for after it has passed.",
        preview: 0x3ad0d0,
    },
];

export const DUCK: CreatureInfo = {
    id: "duck",
    name: "Mother Duck",
    kind: "boss",
    from: 0,
    speed: 1,
    blurb: "Caged at the top left until you've been round once, then loose and homing in on Harry through walls and floors.",
    preview: 0xffd23a,
};

export const ALL_CREATURES: CreatureInfo[] = [...WALKERS, ...FLYERS, DUCK];

export const creatureInfo = (id: string): CreatureInfo => ALL_CREATURES.find((c) => c.id === id) ?? WALKERS[0];

/** Who fills walker slot `slot` of level n: newest arrivals first, hens in every other slot. */
export function walkerFor(n: number, slot: number): CreatureInfo {
    const pool = WALKERS.filter((c) => c.from <= n);
    if (n < 16 ? slot % 2 === 0 : slot % 3 === 0) return WALKERS[0];
    return pool[pool.length - 1 - ((n + slot) % pool.length)];
}

export function flyerFor(n: number, slot: number): CreatureInfo {
    const pool = FLYERS.filter((c) => c.from <= Math.max(n, 16));
    return pool[pool.length - 1 - ((n + slot) % pool.length)];
}
