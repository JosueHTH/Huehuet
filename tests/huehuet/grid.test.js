import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrid, BIOMES } from '../../src/world/grid.js';
import { RESOURCES, consume, regenerateResources } from '../../src/world/resources.js';

test('forRadius visita las celdas dentro del radio euclídeo y ninguna más', () => {
  const grid = createGrid(20, 20);
  const vistas = [];
  grid.forRadius(10, 10, 2, (c, d) => vistas.push([c.x, c.y, d]));
  assert.ok(vistas.every(([, , d]) => d <= 2));
  assert.ok(vistas.some(([x, y]) => x === 10 && y === 10));
  assert.ok(!vistas.some(([x, y]) => x === 13 && y === 10));
});

test('forRadius recorta en los bordes sin salirse', () => {
  const grid = createGrid(10, 10);
  let fuera = 0;
  grid.forRadius(0, 0, 3, (c) => { if (!grid.inBounds(c.x, c.y)) fuera++; });
  assert.equal(fuera, 0);
});

test('forRadius recorta en la esquina opuesta sin salirse', () => {
  const grid = createGrid(10, 10);
  let fuera = 0;
  let visitas = 0;
  grid.forRadius(9, 9, 4, (c) => { visitas++; if (!grid.inBounds(c.x, c.y)) fuera++; });
  assert.equal(fuera, 0);
  assert.ok(visitas > 0);
});

test('at devuelve null fuera de la rejilla', () => {
  const grid = createGrid(5, 5);
  assert.equal(grid.at(-1, 0), null);
  assert.equal(grid.at(5, 0), null);
});

test('consume nunca deja un recurso negativo y devuelve lo obtenido', () => {
  const grid = createGrid(3, 3);
  const cell = grid.at(1, 1);
  cell.resources.caza = 2;
  assert.equal(consume(cell, 'caza', 5), 2);
  assert.equal(cell.resources.caza, 0);
});

test('consume sobre un recurso agotado devuelve 0 y no lo vuelve negativo', () => {
  const grid = createGrid(3, 3);
  const cell = grid.at(1, 1);
  assert.equal(consume(cell, 'leña', 4), 0);
  assert.equal(cell.resources.leña, 0);
});

test('agua no se agota al consumirla', () => {
  const grid = createGrid(3, 3);
  const cell = grid.at(1, 1);
  cell.resources.agua = 3;
  assert.equal(consume(cell, 'agua', 2), 2);
  assert.equal(consume(cell, 'agua', 2), 2);
  assert.equal(cell.resources.agua, 3);
});

test('regenerateResources no supera el máximo del recurso', () => {
  const grid = createGrid(3, 3);
  const cell = grid.at(1, 1);
  cell.biome = 'bosque';
  cell.resources.leña = RESOURCES.leña.max - 1;
  regenerateResources(grid, 24 * 100);
  assert.equal(cell.resources.leña, RESOURCES.leña.max);
});

test('regenerateResources respeta el bioma: leña solo crece en bosque', () => {
  const grid = createGrid(3, 3);
  const cell = grid.at(1, 1);
  cell.biome = 'pradera';
  regenerateResources(grid, 24 * 100);
  assert.equal(cell.resources.leña, 0);
});

test('cada bioma del catálogo declara refugio y depredadores', () => {
  for (const b of Object.values(BIOMES)) {
    assert.equal(typeof b.shelter, 'number');
    assert.equal(typeof b.predators, 'number');
  }
});
