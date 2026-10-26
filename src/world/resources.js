// Resource catalogue and per-cell resource rules. Pure functions: no clock, no randomness.

export const TICKS_PER_DAY = 24;

export const RESOURCES = {
  agua: { id: 'agua', label: 'Agua', max: 10, regenPerDay: 10 },
  caza: { id: 'caza', label: 'Caza', max: 5, regenPerDay: 0.5 },
  forraje: { id: 'forraje', label: 'Forraje', max: 8, regenPerDay: 1 },
  leña: { id: 'leña', label: 'Leña', max: 10, regenPerDay: 1 },
  piedra: { id: 'piedra', label: 'Piedra', max: 20, regenPerDay: 0 },
  pedernal: { id: 'pedernal', label: 'Pedernal', max: 5, regenPerDay: 0 },
};

// Biomes in which each resource regenerates. Resources absent here never regenerate.
const REGEN_BIOMES = {
  agua: ['agua', 'rio', 'pantano'],
  caza: ['pradera', 'bosque', 'tundra'],
  forraje: ['pradera', 'bosque', 'pantano'],
  leña: ['bosque'],
};

// Water sources are never depleted by consumption.
const INEXHAUSTIBLE = new Set(['agua']);

export function regenerateResources(grid, ticks) {
  const days = ticks / TICKS_PER_DAY;
  for (const cell of grid.cells) {
    for (const [resourceId, biomes] of Object.entries(REGEN_BIOMES)) {
      if (!biomes.includes(cell.biome)) continue;
      const { max, regenPerDay } = RESOURCES[resourceId];
      const current = cell.resources[resourceId];
      cell.resources[resourceId] = Math.min(max, current + regenPerDay * days);
    }
  }
}

// Returns the amount actually obtained, which is at most what the cell holds.
export function consume(cell, resourceId, amount) {
  const available = cell.resources[resourceId];
  const obtained = Math.min(Math.max(amount, 0), available);
  if (!INEXHAUSTIBLE.has(resourceId)) {
    cell.resources[resourceId] = available - obtained;
  }
  return obtained;
}
