import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRng } from '../../src/core/rng.js';
import { BIOMES } from '../../src/world/grid.js';
import {
  NEEDS, createNeeds, tickNeeds, applyNeed,
} from '../../src/agents/needs.js';
import { createNpc, NOMBRES, isElder, isAdult } from '../../src/agents/npc.js';

test('las necesidades nunca salen de 0..100 bajo cualquier secuencia', () => {
  const rng = createRng(1);
  let needs = createNeeds();
  const biomas = Object.keys(BIOMES);
  for (let i = 0; i < 20000; i++) {
    needs = tickNeeds(needs, {
      hour: i % 24, season: 'invierno', biome: rng.pick(biomas),
      walking: rng.chance(0.5), working: rng.chance(0.5),
      nearFire: rng.chance(0.3), sheltered: rng.chance(0.3),
    });
    for (const { id } of NEEDS) {
      assert.ok(needs[id] >= 0 && needs[id] <= 100, `${id} = ${needs[id]}`);
    }
  }
});

test('applyNeed acota por ambos extremos', () => {
  assert.equal(applyNeed(createNeeds({ sed: 95 }), 'sed', 50).sed, 100);
  assert.equal(applyNeed(createNeeds({ sed: 5 }), 'sed', -50).sed, 0);
});

test('tickNeeds no muta la instancia recibida', () => {
  const needs = createNeeds();
  const copia = { ...needs };
  const resultado = tickNeeds(needs, { hour: 2, season: 'invierno', biome: 'tundra', walking: true, working: false, nearFire: false, sheltered: false });
  assert.deepEqual(needs, copia);
  assert.notEqual(resultado, needs);
});

test('el frío sube de noche en invierno sin fuego y baja junto al fuego', () => {
  const ctx = { hour: 2, season: 'invierno', biome: 'tundra', walking: false, working: false, sheltered: false };
  const sinFuego = tickNeeds(createNeeds({ frio: 40 }), { ...ctx, nearFire: false });
  const conFuego = tickNeeds(createNeeds({ frio: 40 }), { ...ctx, nearFire: true });
  assert.ok(sinFuego.frio > 40);
  assert.ok(conFuego.frio < 40);
});

test('caminar cansa más que estar quieto', () => {
  const base = { hour: 12, season: 'verano', biome: 'pradera', working: false, nearFire: false, sheltered: false };
  const andando = tickNeeds(createNeeds(), { ...base, walking: true });
  const quieto = tickNeeds(createNeeds(), { ...base, walking: false });
  assert.ok(andando.fatiga > quieto.fatiga);
});

test('dormir de noche reduce la fatiga', () => {
  const dormido = tickNeeds(createNeeds({ fatiga: 80 }), { hour: 1, season: 'verano', biome: 'pradera', walking: false, working: false, nearFire: true, sheltered: true });
  assert.ok(dormido.fatiga < 80);
});

test('createNpc es determinista y produce rasgos en 0..1', () => {
  const a = createNpc(createRng(5)), b = createNpc(createRng(5));
  assert.deepEqual(a, b);
  for (const v of Object.values(a.traits)) assert.ok(v >= 0 && v <= 1);
});

test('createNpc asigna nombre del catálogo e id único', () => {
  const rng = createRng(8);
  const ids = new Set();
  for (let i = 0; i < 50; i++) {
    const npc = createNpc(rng);
    assert.ok(NOMBRES.includes(npc.nombre));
    assert.equal(ids.has(npc.id), false);
    ids.add(npc.id);
  }
});

test('isElder e isAdult usan los umbrales de edad', () => {
  assert.equal(isElder(createNpc(createRng(1), { age: 45 })), true);
  assert.equal(isElder(createNpc(createRng(1), { age: 44 })), false);
  assert.equal(isAdult(createNpc(createRng(1), { age: 15 })), true);
  assert.equal(isAdult(createNpc(createRng(1), { age: 14 })), false);
});

// Extras: invariante en la entrada, errores ruidosos, catálogo y pureza de src/agents.

test('createNeeds acota también los valores recibidos por overrides', () => {
  const n = createNeeds({ hambre: 500, sed: -20 });
  assert.equal(n.hambre, 100);
  assert.equal(n.sed, 0);
});

test('applyNeed no altera las demás necesidades ni la instancia recibida', () => {
  const original = createNeeds();
  const copia = { ...original };
  const n = applyNeed(original, 'frio', 5);
  assert.deepEqual(original, copia);
  assert.equal(n.frio, original.frio + 5);
  assert.equal(n.hambre, original.hambre);
  assert.equal(n.sed, original.sed);
  assert.equal(n.fatiga, original.fatiga);
  assert.equal(n.moral, original.moral);
});

test('tickNeeds rechaza una estación desconocida en lugar de producir NaN', () => {
  assert.throws(() => tickNeeds(createNeeds(), { hour: 2, season: 'lluvia', biome: 'pradera', walking: false, working: false, nearFire: false, sheltered: false }));
});

test('el catálogo de nombres tiene al menos 40 nombres distintos', () => {
  assert.ok(NOMBRES.length >= 40);
  assert.equal(new Set(NOMBRES).size, NOMBRES.length);
});

test('los rasgos de un NPC se reparten entre semillas y no son todos iguales', () => {
  const rasgos = new Set();
  for (let seed = 1; seed <= 20; seed++) rasgos.add(createNpc(createRng(seed)).traits.cautela);
  assert.ok(rasgos.size > 1);
});

test('src/agents no usa APIs ambientales ni aleatoriedad global', () => {
  const dir = new URL('../../src/agents/', import.meta.url);
  const prohibidos = ['window', 'document', 'canvas', 'localStorage', 'Date.now', 'Math.random'];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const fuente = readFileSync(new URL(f, dir), 'utf8');
    for (const p of prohibidos) assert.ok(!fuente.includes(p), `${f} menciona ${p}`);
  }
});
