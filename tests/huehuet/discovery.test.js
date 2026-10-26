import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrid } from '../../src/world/grid.js';
import { generateWorld } from '../../src/world/worldgen.js';
import { createDiscovery, discoveryFromJSON } from '../../src/world/discovery.js';

test('nada es conocido al empezar', () => {
  const d = createDiscovery(createGrid(10, 10));
  assert.equal(d.size, 0);
  assert.equal(d.isKnown(5, 5), false);
  assert.equal(d.knownCell(5, 5), null);
});

test('reveal marca el radio y devuelve el número de celdas nuevas', () => {
  const d = createDiscovery(createGrid(20, 20));
  const nuevas = d.reveal(10, 10, 2);
  assert.ok(nuevas > 0);
  assert.ok(d.isKnown(10, 10));
  assert.ok(d.isKnown(11, 10));
  assert.equal(d.isKnown(15, 10), false);
  assert.equal(d.reveal(10, 10, 2), 0, 'revelar lo mismo no cuenta celdas nuevas');
});

test('knownCell devuelve la celda real una vez conocida', () => {
  const grid = createGrid(10, 10);
  const d = createDiscovery(grid);
  d.reveal(3, 3, 1);
  assert.equal(d.knownCell(3, 3), grid.at(3, 3));
});

test('knownSites solo incluye celdas conocidas', () => {
  const w = generateWorld(11);
  const d = createDiscovery(w.grid);
  d.reveal(w.start.x, w.start.y, 4);
  for (const s of d.knownSites()) assert.ok(d.isKnown(s.x, s.y));
});

test('toJSON y discoveryFromJSON reproducen el conjunto conocido', () => {
  const grid = createGrid(16, 16);
  const d = createDiscovery(grid);
  d.reveal(8, 8, 3);
  const r = discoveryFromJSON(grid, d.toJSON());
  assert.equal(r.size, d.size);
  assert.ok(r.isKnown(8, 8));
  assert.equal(r.isKnown(0, 0), false);
});

// --- pruebas adicionales: fijan el comportamiento exacto que las anteriores dejan abierto ---

test('reveal usa distancia euclídea: la esquina a distancia 2.83 queda fuera de radio 2', () => {
  const d = createDiscovery(createGrid(30, 30));
  d.reveal(10, 10, 2);
  assert.equal(d.isKnown(12, 12), false, 'un cuadrado de radio 2 la incluiría');
  assert.equal(d.isKnown(12, 11), false, 'distancia 2.24 queda fuera');
  assert.equal(d.isKnown(11, 11), true, 'distancia 1.41 queda dentro');
});

test('reveal devuelve solo las celdas nuevas al solaparse dos radios', () => {
  const d = createDiscovery(createGrid(20, 20));
  assert.equal(d.reveal(5, 5, 1), 5);
  assert.equal(d.reveal(6, 5, 1), 3, 'el disco de (6,5) tiene 5 celdas, 2 ya conocidas');
  assert.equal(d.size, 8);
});

test('reveal recorta el disco al tablero sin contar celdas fuera', () => {
  const d = createDiscovery(createGrid(10, 10));
  const nuevas = d.reveal(0, 0, 2);
  assert.equal(nuevas, 6, '(0,0),(1,0),(0,1),(1,1),(2,0),(0,2)');
  assert.equal(d.size, 6);
  assert.equal(d.isKnown(-1, 0), false);
});

test('size es la suma de las celdas nuevas devueltas por reveal', () => {
  const d = createDiscovery(createGrid(25, 25));
  const total = d.reveal(4, 4, 3) + d.reveal(7, 4, 2) + d.reveal(4, 4, 3);
  assert.equal(d.size, total);
});

test('knownCell es null para una celda no conocida aunque exista en el tablero', () => {
  const d = createDiscovery(createGrid(10, 10));
  d.reveal(3, 3, 1);
  assert.equal(d.knownCell(4, 4), null);
  assert.equal(d.knownCell(-1, 0), null);
  assert.equal(d.knownCell(10, 0), null);
});

test('knownSites devuelve solo los sitios revelados entre los sitios dados', () => {
  const grid = createGrid(20, 20);
  const sitios = [{ x: 2, y: 2 }, { x: 15, y: 15 }];
  const d = createDiscovery(grid, sitios);
  d.reveal(2, 2, 1);
  assert.deepEqual(d.knownSites(), [{ x: 2, y: 2 }]);
});

test('toJSON emite índices planos y→fila, con ancho y alto distintos', () => {
  const d = createDiscovery(createGrid(10, 6));
  d.reveal(7, 2, 0);
  d.reveal(0, 0, 0);
  assert.deepEqual(d.toJSON(), [0, 27]);
});

test('toJSON emite los índices en orden ascendente', () => {
  const grid = createGrid(12, 9);
  const d = createDiscovery(grid);
  d.reveal(9, 7, 2);
  d.reveal(1, 1, 1);
  const indices = d.toJSON();
  assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
  assert.equal(indices.length, d.size);
});

test('discoveryFromJSON acepta índices en cualquier orden', () => {
  const grid = createGrid(10, 6);
  const r = discoveryFromJSON(grid, [27, 0]);
  assert.deepEqual(r.toJSON(), [0, 27]);
  assert.ok(r.isKnown(7, 2));
});

test('discoveryFromJSON ignora índices fuera de rango, no enteros y duplicados', () => {
  const grid = createGrid(10, 6);
  const r = discoveryFromJSON(grid, [-1, 60, 1.5, NaN, 0, 0]);
  assert.equal(r.size, 1);
  assert.deepEqual(r.toJSON(), [0]);
});

test('el round-trip de un mundo generado conserva exactamente las celdas conocidas', () => {
  const w = generateWorld(5);
  const d = createDiscovery(w.grid);
  d.reveal(w.start.x, w.start.y, 6);
  const r = discoveryFromJSON(w.grid, d.toJSON());
  assert.deepEqual(r.toJSON(), d.toJSON());
  for (let y = 0; y < w.grid.height; y++) {
    for (let x = 0; x < w.grid.width; x++) {
      assert.equal(r.isKnown(x, y), d.isKnown(x, y), `celda ${x},${y}`);
    }
  }
  assert.equal(r.knownCell(w.start.x, w.start.y), w.grid.at(w.start.x, w.start.y));
});
