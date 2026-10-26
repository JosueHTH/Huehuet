// Five needs (0..100) and their per-tick dynamics. Pure: no clock, no randomness, no mutation.
// One tick is one simulated hour. Every value is clamped once, after all contributions are summed.
import { BIOMES } from '../world/grid.js';

export const NEEDS = [
  { id: 'hambre', label: 'Hambre' },
  { id: 'sed', label: 'Sed' },
  { id: 'frio', label: 'Frío' },
  { id: 'fatiga', label: 'Fatiga' },
  { id: 'moral', label: 'Moral' },
];

const DEFAULTS = { hambre: 20, sed: 20, frio: 10, fatiga: 10, moral: 70 };

// Cold added per tick by season. Summer warms the band, winter chills it.
const SEASON_COLD = { primavera: 0, verano: -2, otoño: 1, invierno: 3 };

const clamp = (value) => Math.min(100, Math.max(0, value));

const isNight = (hour) => hour >= 20 || hour < 6;

export function createNeeds(overrides = {}) {
  const merged = { ...DEFAULTS, ...overrides };
  return Object.fromEntries(NEEDS.map(({ id }) => [id, clamp(merged[id])]));
}

export function applyNeed(needs, id, delta) {
  if (!NEEDS.some((need) => need.id === id)) throw new Error(`necesidad desconocida: ${id}`);
  return { ...needs, [id]: clamp(needs[id] + delta) };
}

export function tickNeeds(needs, ctx) {
  const seasonCold = SEASON_COLD[ctx.season];
  if (seasonCold === undefined) throw new Error(`estación desconocida: ${ctx.season}`);
  const biome = BIOMES[ctx.biome];
  if (!biome) throw new Error(`bioma desconocido: ${ctx.biome}`);

  const night = isNight(ctx.hour);
  const sleeping = night && ctx.sheltered;

  const hambre = needs.hambre + 1.5 + (ctx.working ? 0.5 : 0);
  const sed = needs.sed + 2 + (ctx.walking ? 1 : 0) + (ctx.working ? 0.5 : 0);
  const frio = needs.frio + seasonCold + (night ? 2 : -1)
    - biome.shelter * 2 - (ctx.sheltered ? 2 : 0) - (ctx.nearFire ? 6 : 0);
  const fatiga = sleeping
    ? needs.fatiga - 6
    : needs.fatiga + 0.8 + (ctx.walking ? 1.5 : 0) + (ctx.working ? 1 : 0);
  const moral = needs.moral
    + (ctx.sheltered ? 0.3 : 0)
    + (ctx.nearFire ? 0.5 : 0)
    - (needs.hambre > 60 ? 0.8 : 0)
    - (needs.sed > 60 ? 0.8 : 0)
    - (needs.frio > 70 ? 0.5 : 0);

  return {
    hambre: clamp(hambre),
    sed: clamp(sed),
    frio: clamp(frio),
    fatiga: clamp(fatiga),
    moral: clamp(moral),
  };
}
