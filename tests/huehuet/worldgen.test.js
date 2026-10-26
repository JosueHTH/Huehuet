import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { generateWorld, chooseStart } from '../../src/world/worldgen.js';
import { createRng } from '../../src/core/rng.js';
import { createGrid, BIOMES } from '../../src/world/grid.js';
import { RESOURCES } from '../../src/world/resources.js';
import { ambientUses } from './purity.js';

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

const nearestSiteDistance = (w, x, y) =>
  Math.min(...w.viableSites.map((s) => Math.hypot(x - s.x, y - s.y)));

test('la celda inicial está a 20 celdas o más del sitio viable MÁS CERCANO, o maximiza esa distancia', () => {
  for (let seed = 0; seed < 40; seed++) {
    const w = generateWorld(seed);
    const d = nearestSiteDistance(w, w.start.x, w.start.y);
    if (d >= 20) continue;
    // Imposible cumplir 20: ninguna celda no acuática puede estar más lejos del sitio más cercano.
    const maximo = Math.max(...w.grid.cells
      .filter((c) => c.biome !== 'agua' && c.biome !== 'rio')
      .map((c) => nearestSiteDistance(w, c.x, c.y)));
    assert.ok(d >= maximo - 1e-9, `semilla ${seed}: start a ${d}, pero existe una celda a ${maximo}`);
  }
});

test('la restricción de 20 celdas no es vacua: se cumple en alguna semilla', () => {
  let cumplen = 0;
  for (let seed = 0; seed < 40; seed++) {
    const w = generateWorld(seed);
    if (nearestSiteDistance(w, w.start.x, w.start.y) >= 20) cumplen++;
  }
  assert.ok(cumplen > 0, 'ninguna semilla cumple la distancia de 20: la restricción sería vacua');
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

// Completeness and soundness against an independent definition (no grid.forRadius).
test('viableSites es exactamente el conjunto de celdas no acuáticas con río a distancia <= 3', () => {
  for (const seed of [77, 5, 31]) {
    const w = generateWorld(seed);
    const rios = w.grid.cells.filter((c) => c.river);
    const esperado = w.grid.cells
      .filter((c) => c.biome !== 'agua' && c.biome !== 'rio')
      .filter((c) => rios.some((r) => (c.x - r.x) ** 2 + (c.y - r.y) ** 2 <= 9))
      .map((c) => `${c.x},${c.y}`);
    assert.deepEqual(w.viableSites.map((s) => `${s.x},${s.y}`), esperado, `semilla ${seed}`);
  }
});

test('la celda inicial nunca es río ni agua', () => {
  for (let seed = 0; seed < 40; seed++) {
    const w = generateWorld(seed);
    const c = w.grid.at(w.start.x, w.start.y);
    assert.ok(c.biome !== 'agua' && c.biome !== 'rio' && !c.river, `semilla ${seed}: ${c.biome}`);
  }
});

const gridPlano = (w, h) => {
  const g = createGrid(w, h);
  for (const c of g.cells) c.biome = 'pradera';
  return g;
};

test('chooseStart sin celdas a 20 elige la más lejana al sitio más cercano', () => {
  const g = gridPlano(10, 10);
  const start = chooseStart(g, [{ x: 0, y: 0 }], createRng(1));
  assert.deepEqual(start, { x: 9, y: 9 });
});

test('chooseStart maximiza la distancia al sitio MÁS CERCANO con varios sitios', () => {
  const g = gridPlano(10, 1);
  const start = chooseStart(g, [{ x: 0, y: 0 }, { x: 9, y: 0 }], createRng(1));
  assert.ok(start.x === 4 || start.x === 5, `x=${start.x}`);
});

test('chooseStart excluye río y agua aunque estén más lejos', () => {
  const g = gridPlano(40, 1);
  for (const c of g.cells) {
    if (c.x >= 20 && c.x < 30) c.biome = 'rio';
    if (c.x >= 30) c.biome = 'agua';
  }
  const start = chooseStart(g, [{ x: 0, y: 0 }], createRng(1));
  assert.equal(start.x, 19);
});

test('en un mundo pequeño la inicial maximiza la distancia al sitio más cercano', () => {
  const w = generateWorld(9, { width: 12, height: 12 });
  const cerca = (x, y) => Math.min(...w.viableSites.map((s) => Math.hypot(x - s.x, y - s.y)));
  const d = cerca(w.start.x, w.start.y);
  assert.ok(d < 20, 'la rama de degradación debe ejecutarse');
  const maximo = Math.max(...w.grid.cells
    .filter((c) => c.biome !== 'agua' && c.biome !== 'rio')
    .map((c) => cerca(c.x, c.y)));
  assert.equal(d, maximo);
});

// Red de seguridad del invariante: sin ríos generados, la reserva debe crear sitios viables.
test('sin ríos generados, el río central garantiza sitios viables', () => {
  for (const seed of [0, 1, 2, 3, 4]) {
    const w = generateWorld(seed, { riverCount: 0 });
    assert.ok(w.viableSites.length > 0, `semilla ${seed}`);
    const centro = w.grid.cells.filter((c) => c.river);
    assert.equal(centro.length, w.grid.height, 'un río de una celda por fila');
    assert.ok(centro.every((c) => c.biome === 'rio'));
    assert.ok(w.grid.at(w.start.x, w.start.y).biome !== 'rio');
  }
});

test('src/world no usa APIs ambientales ni aleatoriedad global', () => {
  const dir = new URL('../../src/world/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const hallazgos = ambientUses(readFileSync(new URL(f, dir), 'utf8'));
    assert.deepEqual(hallazgos, [], `${f} usa ${hallazgos.join(', ')}`);
  }
});
