// Deterministic world generation. All randomness comes from rng forks of the seed.
import { createRng } from '../core/rng.js';
import { createGrid } from './grid.js';
import { RESOURCES } from './resources.js';
import { createValueNoise } from './noise.js';

const DEFAULT_SIZE = 96;
const WATER_LEVEL = 0.3;
const NOISE_SCALE = 1 / 24; // lattice cells per map cell, base octave
const RIVER_COUNT = 6;
const RIVER_MIN_SPACING = 14;
const FRESH_WATER_RADIUS = 3;
const MIN_START_DISTANCE = 20;

const NEIGHBOURS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Fraction of each resource's max held by a fresh cell of each biome (absent = none).
// Water is the exception: every water biome starts full.
const RESOURCE_FRACTION = {
  agua: { agua: 1, rio: 1, pantano: 1 },
  caza: { pradera: 0.6, bosque: 0.5, tundra: 0.3, colina: 0.2 },
  forraje: { pradera: 0.7, bosque: 0.6, pantano: 0.5, colina: 0.2, tundra: 0.1 },
  leña: { bosque: 0.8, colina: 0.2, pantano: 0.1 },
  piedra: { colina: 0.6, montaña: 0.9 },
  pedernal: { colina: 0.4, montaña: 0.5 },
};
const RESOURCE_SPREAD = 0.4;

const isWater = (cell) => cell.biome === 'agua' || cell.biome === 'rio';

function fillField(grid, noise, key, scale, offset) {
  for (const cell of grid.cells) {
    cell[key] = noise.fractal(cell.x * scale + offset, cell.y * scale + offset);
  }
}

function normalizeElevation(grid) {
  let min = Infinity;
  let max = -Infinity;
  for (const c of grid.cells) {
    if (c.elevation < min) min = c.elevation;
    if (c.elevation > max) max = c.elevation;
  }
  for (const c of grid.cells) c.elevation = (c.elevation - min) / (max - min);
}

function generateClimate(grid, rng) {
  const moisture = createValueNoise(rng.fork('humedad'));
  const warmth = createValueNoise(rng.fork('temperatura'));
  fillField(grid, moisture, 'moisture', NOISE_SCALE, 0);
  const halfHeight = grid.height / 2;
  for (const c of grid.cells) {
    const latitude = Math.abs(c.y + 0.5 - halfHeight) / halfHeight;
    const base = warmth.fractal(c.x * NOISE_SCALE, c.y * NOISE_SCALE);
    c.temperature = clamp01(0.5 + base * 0.5 - 0.35 * c.elevation - 0.3 * latitude);
  }
}

// Highest cells first, skipping any too close to one already chosen.
function pickRiverSources(grid, count) {
  const byHeight = [...grid.cells].sort((a, b) => b.elevation - a.elevation || a.y - b.y || a.x - b.x);
  const sources = [];
  for (const cell of byHeight) {
    if (sources.length === count) break;
    if (cell.elevation <= WATER_LEVEL) break;
    if (sources.every((s) => Math.hypot(s.x - cell.x, s.y - cell.y) >= RIVER_MIN_SPACING)) {
      sources.push(cell);
    }
  }
  return sources;
}

// Walks downhill to the lowest unvisited neighbour. Never revisits a cell, so it always
// terminates; in a basin it keeps going through the least-bad neighbour (carving an outlet).
function traceRiver(grid, source) {
  const visited = new Set();
  let cell = source;
  while (cell) {
    visited.add(cell);
    if (cell.elevation <= WATER_LEVEL) return; // reached a lake or sea
    cell.river = true;
    const onEdge = cell.x === 0 || cell.y === 0 || cell.x === grid.width - 1 || cell.y === grid.height - 1;
    if (onEdge) return;
    let lowest = null;
    for (const [dx, dy] of NEIGHBOURS) {
      const n = grid.at(cell.x + dx, cell.y + dy);
      if (visited.has(n)) continue;
      if (!lowest || n.elevation < lowest.elevation) lowest = n;
    }
    if (lowest && lowest.river) return; // joined an existing river
    cell = lowest;
  }
}

// Fallback: a river with land banks running through the vertical centre of the map.
function carveCentralRiver(grid, rng) {
  const bank = WATER_LEVEL + 0.02;
  let x = Math.floor(grid.width / 2);
  for (let y = 0; y < grid.height; y++) {
    x = Math.min(grid.width - 2, Math.max(1, x + rng.int(-1, 1)));
    for (let dx = -1; dx <= 1; dx++) {
      const c = grid.at(x + dx, y);
      c.elevation = Math.max(c.elevation, bank);
    }
    grid.at(x, y).river = true;
  }
}

function biomeFor(cell) {
  const { elevation: e, moisture: m, temperature: t } = cell;
  if (e <= WATER_LEVEL) return 'agua';
  if (cell.river) return 'rio';
  if (e > 0.75) return 'montaña';
  if (t < 0.25) return 'tundra';
  if (e > 0.62) return 'colina';
  if (m > 0.62 && e < WATER_LEVEL + 0.08) return 'pantano';
  if (m > 0.5) return 'bosque';
  return 'pradera';
}

function assignBiomesAndResources(grid, rng) {
  for (const cell of grid.cells) cell.biome = biomeFor(cell);
  // Fixed iteration order and one draw per resource per cell keep the stream stable.
  for (const cell of grid.cells) {
    for (const id of Object.keys(RESOURCES)) {
      const roll = rng.next();
      const fraction = RESOURCE_FRACTION[id][cell.biome] ?? 0;
      const spread = id === 'agua' ? 0 : (roll - 0.5) * RESOURCE_SPREAD;
      const amount = fraction === 0 ? 0 : clamp01(fraction + spread) * RESOURCES[id].max;
      cell.resources[id] = Math.round(amount * 100) / 100;
    }
  }
}

function findViableSites(grid) {
  const sites = [];
  for (const cell of grid.cells) {
    if (isWater(cell)) continue;
    let fresh = false;
    grid.forRadius(cell.x, cell.y, FRESH_WATER_RADIUS, (n) => {
      if (n.river) fresh = true;
    });
    if (fresh) sites.push({ x: cell.x, y: cell.y });
  }
  return sites;
}

// Start must be >= MIN_START_DISTANCE from the NEAREST viable site so the band has to walk.
// If no land cell qualifies, fall back to the land cell farthest from its nearest site.
export function chooseStart(grid, sites, rng) {
  const nearest = (c) => {
    let best = Infinity;
    for (const s of sites) best = Math.min(best, Math.hypot(c.x - s.x, c.y - s.y));
    return best;
  };
  const scored = grid.cells.filter((c) => !isWater(c)).map((c) => ({ c, d: nearest(c) }));
  const far = scored.filter((e) => e.d >= MIN_START_DISTANCE);
  let pool = far;
  if (far.length === 0) {
    const best = Math.max(...scored.map((e) => e.d));
    pool = scored.filter((e) => e.d === best);
  }
  const pick = rng.pick(pool).c;
  return { x: pick.x, y: pick.y };
}

export function generateWorld(seed, opts = {}) {
  // riverCount is a test seam: 0 forces the central-river fallback.
  const { width = DEFAULT_SIZE, height = DEFAULT_SIZE, riverCount = RIVER_COUNT } = opts;
  const rng = createRng(seed);
  const grid = createGrid(width, height);

  fillField(grid, createValueNoise(rng.fork('elevacion')), 'elevation', NOISE_SCALE, 0);
  normalizeElevation(grid);
  generateClimate(grid, rng);
  for (const source of pickRiverSources(grid, riverCount)) traceRiver(grid, source);
  assignBiomesAndResources(grid, rng.fork('recursos'));

  let viableSites = findViableSites(grid);
  if (viableSites.length === 0) {
    carveCentralRiver(grid, rng.fork('rio-central'));
    assignBiomesAndResources(grid, rng.fork('recursos'));
    viableSites = findViableSites(grid);
    if (viableSites.length === 0) {
      throw new Error(`generateWorld: la semilla ${seed} no tiene sitio viable tras el río central`);
    }
  }

  const start = chooseStart(grid, viableSites, rng.fork('inicio'));
  return { seed, grid, start, viableSites };
}
