import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../../src/world/worldgen.js';
import { BIOMES } from '../../src/world/grid.js';
import { RESOURCES } from '../../src/world/resources.js';

test('la misma semilla produce un mundo idéntico', () => {
  const a = generateWorld(2024), b = generateWorld(2024);
  assert.deepEqual(a.grid.cells, b.grid.cells);
  assert.deepEqual(a.start, b.start);
  assert.deepEqual(a.viableSites, b.viableSites);
});

test('semillas distintas producen mundos distintos', () => {
  assert.notDeepEqual(generateWorld(1).grid.cells, generateWorld(2).grid.cells);
});

// invariante del spec: la generación garantiza al menos un sitio viable
test('todo mundo generado contiene al menos un sitio viable', () => {
  for (let seed = 0; seed < 40; seed++) {
    const w = generateWorld(seed);
    assert.ok(w.viableSites.length > 0, `semilla ${seed} sin sitio viable`);
  }
});

test('un sitio viable tiene agua dulce a 3 celdas o menos', () => {
  const w = generateWorld(77);
  for (const site of w.viableSites) {
    let agua = false;
    w.grid.forRadius(site.x, site.y, 3, (c) => {
      if (c.biome === 'rio' || c.river) agua = true;
    });
    assert.ok(agua, `sitio ${site.x},${site.y} sin agua dulce`);
  }
});

test('un sitio viable no es una celda de agua', () => {
  const w = generateWorld(77);
  for (const site of w.viableSites) {
    const biome = w.grid.at(site.x, site.y).biome;
    assert.ok(biome !== 'agua' && biome !== 'rio', `sitio ${site.x},${site.y} en ${biome}`);
  }
});

test('la celda inicial es transitable y no es agua', () => {
  for (let seed = 0; seed < 20; seed++) {
    const w = generateWorld(seed);
    assert.notEqual(w.grid.at(w.start.x, w.start.y).biome, 'agua');
  }
});

test('la celda inicial está a 20 celdas o más del primer sitio viable', () => {
  for (let seed = 0; seed < 40; seed++) {
    const w = generateWorld(seed);
    const s = w.viableSites[0];
    const d = Math.hypot(w.start.x - s.x, w.start.y - s.y);
    assert.ok(d >= 20, `semilla ${seed}: distancia ${d}`);
  }
});

test('un mundo diminuto degrada la distancia de inicio sin colgarse', () => {
  const w = generateWorld(9, { width: 12, height: 12 });
  assert.ok(w.viableSites.length > 0);
  assert.notEqual(w.grid.at(w.start.x, w.start.y).biome, 'agua');
});

test('el mundo contiene al menos cuatro biomas distintos', () => {
  const w = generateWorld(5);
  const biomas = new Set(w.grid.cells.map((c) => c.biome));
  assert.ok(biomas.size >= 4, `solo ${biomas.size} biomas`);
});

test('el tamaño por defecto es 96x96 y opts lo cambia', () => {
  const w = generateWorld(1);
  assert.equal(w.grid.width, 96);
  assert.equal(w.grid.height, 96);
  assert.equal(w.seed, 1);
  const small = generateWorld(1, { width: 40, height: 30 });
  assert.equal(small.grid.cells.length, 40 * 30);
});

test('cada celda tiene bioma del catálogo, valores en rango y recursos finitos dentro del máximo', () => {
  const w = generateWorld(11);
  for (const c of w.grid.cells) {
    assert.ok(BIOMES[c.biome], `bioma desconocido ${c.biome}`);
    for (const v of [c.elevation, c.moisture, c.temperature]) assert.ok(v >= 0 && v <= 1);
    for (const [id, r] of Object.entries(RESOURCES)) {
      const q = c.resources[id];
      assert.ok(Number.isFinite(q) && q >= 0 && q <= r.max, `${id}=${q} en ${c.x},${c.y}`);
    }
  }
});

test('hay ríos y toda celda de río está marcada de forma coherente', () => {
  const w = generateWorld(11);
  const rios = w.grid.cells.filter((c) => c.river);
  assert.ok(rios.length > 0);
  assert.ok(rios.every((c) => c.biome === 'rio' || c.biome === 'agua'));
  assert.ok(w.grid.cells.filter((c) => c.biome === 'rio').every((c) => c.river));
});

test('generateWorld no usa Math.random', () => {
  const real = Math.random;
  Math.random = () => { throw new Error('generateWorld usó Math.random'); };
  try { generateWorld(3); } finally { Math.random = real; }
});
