import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRng } from '../../src/core/rng.js';
import { createClock } from '../../src/core/clock.js';
import { createGrid } from '../../src/world/grid.js';
import { createDiscovery } from '../../src/world/discovery.js';
import { createBand, tickBand } from '../../src/tribe/band.js';
import { scoreSite } from '../../src/tribe/sitescore.js';
import { BUILDINGS, foundSettlement, tickConstruction, RADIO_FUEGO } from '../../src/tribe/settlement.js';
import { createChronicle, record, recent } from '../../src/chronicle.js';
import { codeOnly, ambientUses } from './purity.js';

const C = 10;

// Una banda de siete en la que todos están en la obra (npc.action === 'construir'), con inventario holgado.
function bandaComoda() {
  const band = createBand(createRng(5), { x: C, y: C });
  band.inventory = { leña: 500, piedra: 500 };
  for (const npc of band.npcs) npc.action = 'construir';
  return band;
}

// Un sitio con agua y recursos, puntuado solo a través de discovery.
function sitioBueno() {
  const grid = createGrid(25, 25);
  for (const cell of grid.cells) {
    if (Math.hypot(cell.x - C, cell.y - C) > 12) continue;
    Object.assign(cell.resources, { caza: 30, forraje: 30, leña: 30, piedra: 30 });
  }
  const rio = grid.at(C + 2, C);
  rio.biome = 'rio'; rio.river = true; rio.resources.agua = 10;
  const discovery = createDiscovery(grid);
  discovery.reveal(C, C, 14);
  return scoreSite(discovery, C, C, { grid, season: 'verano' });
}

const correr = (s, band, ticks, semilla = 0) => {
  let textos = [];
  for (let i = 0; i < ticks; i++) textos = textos.concat(tickConstruction(s, band, createRng(semilla + i)));
  return textos;
};

test('foundSettlement fija el sitio y encola la hoguera primero', () => {
  const band = bandaComoda();
  const s = foundSettlement(band, sitioBueno(), 12);
  assert.equal(s.foundedDay, 12);
  assert.equal(s.queue[0], 'hoguera');
  assert.equal(band.settled, true);
  assert.deepEqual(band.site, { x: s.x, y: s.y });
  assert.equal(band.settlement, s);
});

test('BUILDINGS: hoguera, choza y almacén en ese orden, con coste y trabajo positivos', () => {
  assert.deepEqual(BUILDINGS.map((b) => b.id), ['hoguera', 'choza', 'almacen']);
  assert.deepEqual(BUILDINGS.map((b) => b.order), [0, 1, 2]);
  for (const b of BUILDINGS) assert.ok(b.work > 0 && b.label && Object.keys(b.cost).length > 0);
});

test('foundSettlement crea los tres edificios sin empezar, con la cola completa', () => {
  const s = foundSettlement(bandaComoda(), sitioBueno(), 1);
  assert.deepEqual(s.queue, ['hoguera', 'choza', 'almacen']);
  assert.deepEqual(s.buildings.map((b) => b.id), s.queue);
  for (const b of s.buildings) assert.deepEqual([b.progress, b.done], [0, false]);
  assert.deepEqual([s.buildings[0].x, s.buildings[0].y], [s.x, s.y]);
  const otros = s.buildings.slice(1).map((b) => `${b.x},${b.y}`);
  assert.equal(new Set(otros).size, 2);
  for (const b of s.buildings.slice(1)) assert.ok(Math.hypot(b.x - s.x, b.y - s.y) >= 1);
});

test('la construcción no avanza sin materiales', () => {
  const band = bandaComoda(); band.inventory = {};
  const s = foundSettlement(band, sitioBueno(), 1);
  for (let i = 0; i < 100; i++) tickConstruction(s, band, createRng(i));
  assert.equal(s.buildings.filter((b) => b.done).length, 0);
  assert.ok(s.buildings.every((b) => b.progress === 0));
});

test('la construcción no avanza si nadie trabaja en la obra', () => {
  const band = bandaComoda();
  for (const npc of band.npcs) npc.action = 'explorar';
  const s = foundSettlement(band, sitioBueno(), 1);
  correr(s, band, 100);
  assert.ok(s.buildings.every((b) => b.progress === 0));
  assert.equal(band.inventory.leña, 500);
});

test('solo cuentan los vivos que están construyendo, y más manos avanzan más', () => {
  const avance = (manos, muertos = 0) => {
    const band = bandaComoda();
    band.npcs.forEach((npc, i) => {
      if (i >= manos) npc.action = 'cazar';
    });
    for (let i = 0; i < muertos; i++) band.npcs[i].alive = false;
    const s = foundSettlement(band, sitioBueno(), 1);
    tickConstruction(s, band, createRng(1));
    return s.buildings[0].progress;
  };
  assert.ok(avance(0) === 0);
  assert.ok(avance(2) > 0);
  assert.ok(Math.abs(avance(4) - 2 * avance(2)) < 1e-9);
  assert.equal(avance(2, 2), 0, 'los muertos no construyen');
  assert.ok(avance(3, 1) < avance(3, 0));
});

test('con materiales suficientes la hoguera se completa y lo cuenta', () => {
  const band = bandaComoda(); band.inventory = { leña: 999, piedra: 999 };
  const s = foundSettlement(band, sitioBueno(), 1);
  const textos = correr(s, band, 500);
  assert.ok(s.buildings.some((b) => b.id === 'hoguera' && b.done));
  assert.ok(textos.some((t) => t.includes('hoguera')));
});

test('la crónica narra completaciones, no cada tick de obra', () => {
  const band = bandaComoda(); band.inventory = { leña: 9999, piedra: 9999 };
  const s = foundSettlement(band, sitioBueno(), 1);
  const textos = correr(s, band, 3000);
  assert.equal(textos.length, 3);
  assert.equal(new Set(textos).size, 3);
  assert.ok(textos[0].includes('hoguera') && textos[1].includes('choza') && textos[2].toLowerCase().includes('almac'));
  // nada que contar con la obra terminada
  assert.deepEqual(tickConstruction(s, band, createRng(1)), []);
});

test('los edificios se completan en el orden de la cola', () => {
  const band = bandaComoda(); band.inventory = { leña: 9999, piedra: 9999 };
  const s = foundSettlement(band, sitioBueno(), 1);
  const orden = [];
  for (let i = 0; i < 3000; i++) {
    tickConstruction(s, band, createRng(i));
    for (const b of s.buildings) if (b.done && !orden.includes(b.id)) orden.push(b.id);
    // nunca un edificio posterior con avance mientras uno anterior no está hecho
    const primeroPendiente = s.buildings.findIndex((b) => !b.done);
    if (primeroPendiente >= 0) {
      for (const b of s.buildings.slice(primeroPendiente + 1)) assert.equal(b.progress, 0);
    }
  }
  assert.deepEqual(orden, ['hoguera', 'choza', 'almacen']);
  assert.deepEqual(s.queue, []);
});

test('construir descuenta del inventario', () => {
  const band = bandaComoda(); band.inventory = { leña: 50, piedra: 50 };
  const s = foundSettlement(band, sitioBueno(), 1);
  correr(s, band, 500);
  assert.ok(band.inventory.leña < 50);
});

test('el descuento total de una obra terminada es exactamente su coste', () => {
  const band = bandaComoda(); band.inventory = { leña: 100, piedra: 100 };
  const s = foundSettlement(band, sitioBueno(), 1);
  correr(s, band, 3000);
  const gastoLeña = BUILDINGS.reduce((a, b) => a + (b.cost.leña ?? 0), 0);
  const gastoPiedra = BUILDINGS.reduce((a, b) => a + (b.cost.piedra ?? 0), 0);
  assert.ok(Math.abs(band.inventory.leña - (100 - gastoLeña)) < 1e-6);
  assert.ok(Math.abs(band.inventory.piedra - (100 - gastoPiedra)) < 1e-6);
});

test('con materiales escasos la obra avanza hasta donde llega el stock, sin negativos', () => {
  const band = bandaComoda(); band.inventory = { leña: 3, piedra: 0 };
  const s = foundSettlement(band, sitioBueno(), 1);
  tickConstruction(s, band, createRng(1));
  const hoguera = s.buildings[0];
  // 7 manos piden 3.5 de leña en un tick; con 3 se financia la parte que alcanza
  assert.ok(hoguera.progress > 0, 'debe avanzar con stock positivo');
  assert.ok(Math.abs(hoguera.progress - 3 / 6) < 1e-9);
  assert.ok(Math.abs(band.inventory.leña) < 1e-9);
  correr(s, band, 1000);
  for (const v of Object.values(band.inventory)) assert.ok(v >= 0);
  assert.ok(Math.abs(hoguera.progress - 0.5) < 1e-9, 'sin más leña no pasa de lo financiado');
  assert.equal(hoguera.done, false);
  // llega más leña: se reanuda y termina
  band.inventory.leña = 500;
  correr(s, band, 500);
  assert.ok(hoguera.done);
});

test('con 5 de leña la hoguera llega a 5/6 en lugar de quedarse atascada', () => {
  const band = bandaComoda(); band.inventory = { leña: 5, piedra: 0 };
  const s = foundSettlement(band, sitioBueno(), 1);
  correr(s, band, 10);
  assert.ok(Math.abs(s.buildings[0].progress - 5 / 6) < 1e-9);
});

test('foundSettlement es idempotente: repetirla conserva la aldea y su progreso', () => {
  const band = bandaComoda(); band.inventory = { leña: 999, piedra: 999 };
  const s = foundSettlement(band, sitioBueno(), 3);
  correr(s, band, 500);
  const antes = JSON.stringify(s);
  const otra = foundSettlement(band, { ...sitioBueno(), x: C + 5, y: C + 5 }, 99);
  assert.equal(otra, s);
  assert.equal(band.settlement, s);
  assert.equal(JSON.stringify(band.settlement), antes);
  assert.equal(s.foundedDay, 3);
  assert.ok(s.buildings[0].done);
});

test('el progreso nunca es negativo ni pasa de 1', () => {
  const band = bandaComoda(); band.inventory = { leña: 9999, piedra: 9999 };
  const s = foundSettlement(band, sitioBueno(), 1);
  for (let i = 0; i < 2000; i++) {
    tickConstruction(s, band, createRng(i));
    for (const b of s.buildings) assert.ok(b.progress >= 0 && b.progress <= 1);
  }
  assert.ok(s.buildings.every((b) => b.progress === 1 && b.done));
});

test('el rng no cambia el resultado de la cola', () => {
  const resultado = (semilla) => {
    const band = bandaComoda();
    const s = foundSettlement(band, sitioBueno(), 1);
    const textos = correr(s, band, 400, semilla);
    return JSON.stringify([s, band.inventory, textos]);
  };
  assert.equal(resultado(1), resultado(9999));
});

test('record conserva orden y recent devuelve las más nuevas primero', () => {
  const c = createChronicle();
  record(c, { day: 1, type: 'migracion', text: 'uno' });
  record(c, { day: 2, type: 'migracion', text: 'dos' });
  assert.deepEqual(recent(c, 1).map((e) => e.text), ['dos']);
  assert.deepEqual(recent(c, 2).map((e) => e.text), ['dos', 'uno']);
});

test('la crónica se recorta a 500 entradas descartando las antiguas', () => {
  const c = createChronicle();
  for (let i = 0; i < 600; i++) record(c, { day: i, type: 'x', text: `e${i}` });
  assert.equal(c.entries.length, 500);
  assert.equal(c.entries[0].text, 'e100');
  assert.equal(c.entries[499].text, 'e599');
  assert.equal(recent(c, 1)[0].text, 'e599');
});

test('recent acepta n mayor que el número de entradas y n cero', () => {
  const c = createChronicle();
  assert.deepEqual(recent(c, 5), []);
  record(c, { day: 1, type: 'x', text: 'solo' });
  assert.equal(recent(c, 50).length, 1);
  assert.deepEqual(recent(c, 0), []);
});

test('recent no muta la crónica ni expone su arreglo', () => {
  const c = createChronicle();
  record(c, { day: 1, type: 'x', text: 'a' });
  record(c, { day: 2, type: 'x', text: 'b' });
  recent(c, 2).reverse();
  assert.deepEqual(c.entries.map((e) => e.text), ['a', 'b']);
});

// --- Fuego y protección contra el frío ---------------------------------------------------------

function escenaFuego({ hoguera = true, distancia = 0 } = {}) {
  const grid = createGrid(40, 40);
  const discovery = createDiscovery(grid);
  discovery.reveal(20, 20, 8);
  const band = createBand(createRng(3), { x: 20, y: 20 }, { size: 1 });
  band.inventory = { leña: 500, piedra: 500 };
  const s = foundSettlement(band, { x: 20, y: 20 }, 1);
  if (hoguera) s.buildings[0].done = true;
  band.npcs[0].x = 20 + distancia;
  const ctx = { grid, discovery, clock: createClock({ tick: 12 }) };
  return { band, ctx };
}

const fríoTrasUnTick = (esc) => {
  esc.band.npcs[0].needs.frio = 50;
  tickBand(esc.band, esc.ctx, createRng(1));
  return esc.band.npcs[0].needs.frio;
};

test('junto a una hoguera terminada el frío baja más que sin ella', () => {
  const con = fríoTrasUnTick(escenaFuego({ hoguera: true }));
  const sin = fríoTrasUnTick(escenaFuego({ hoguera: false }));
  assert.ok(con < sin, `con=${con} sin=${sin}`);
});

test('la hoguera solo protege dentro de RADIO_FUEGO', () => {
  const cerca = fríoTrasUnTick(escenaFuego({ distancia: RADIO_FUEGO }));
  const lejos = fríoTrasUnTick(escenaFuego({ distancia: RADIO_FUEGO + 1 }));
  const sin = fríoTrasUnTick(escenaFuego({ hoguera: false }));
  assert.ok(cerca < lejos);
  assert.equal(lejos, sin);
});

test('una banda sin asentar no tiene fuego aunque haya una hoguera terminada a la vista', () => {
  const esc = escenaFuego({ hoguera: true });
  esc.band.settled = false;
  esc.band.settlement = null;
  const sin = fríoTrasUnTick(escenaFuego({ hoguera: false }));
  assert.equal(fríoTrasUnTick(esc), sin);
});

test('una hoguera a medio construir no calienta', () => {
  const esc = escenaFuego({ hoguera: false });
  esc.band.settlement.buildings[0].progress = 0.9;
  const sin = fríoTrasUnTick(escenaFuego({ hoguera: false }));
  assert.equal(fríoTrasUnTick(esc), sin);
});

// --- Pureza y aislamiento del mundo ------------------------------------------------------------

test('src/chronicle.js no usa APIs ambientales ni aleatoriedad global', () => {
  const hallazgos = ambientUses(readFileSync(new URL('../../src/chronicle.js', import.meta.url), 'utf8'));
  assert.deepEqual(hallazgos, []);
});

test('settlement.js no usa APIs ambientales ni aleatoriedad global', () => {
  const hallazgos = ambientUses(readFileSync(new URL('../../src/tribe/settlement.js', import.meta.url), 'utf8'));
  assert.deepEqual(hallazgos, []);
});

test('el código de settlement.js no toca la rejilla ni el generador', () => {
  const codigo = codeOnly(readFileSync(new URL('../../src/tribe/settlement.js', import.meta.url), 'utf8'));
  assert.ok(!/\.at\(/.test(codigo), 'usa .at(');
  assert.ok(!/\bcells\b/.test(codigo), 'usa cells');
  assert.ok(!/viableSites/.test(codigo), 'usa viableSites');
  assert.ok(!/\bforRadius\b/.test(codigo), 'usa forRadius');
  assert.deepEqual(codigo.match(/\bgrid\b(?!\.inBounds)/g) ?? [], [], 'usa grid más allá de grid.inBounds');
});

test('el relato de la hoguera no promete lo que la mecánica no cumple', () => {
  const band = bandaComoda();
  const s = foundSettlement(band, sitioBueno(), 1);
  const [texto] = correr(s, band, 200);
  assert.ok(texto.includes('hoguera'));
  assert.ok(!/nadie|todos|siempre|nunca/i.test(texto), texto);
});
