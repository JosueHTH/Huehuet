import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRng } from '../../src/core/rng.js';
import { BIOMES } from '../../src/world/grid.js';
import {
  NEEDS, createNeeds, tickNeeds, applyNeed,
} from '../../src/agents/needs.js';
import { createNpc, NOMBRES, isElder, isAdult } from '../../src/agents/npc.js';
import { ambientUses } from './purity.js';

const SEASONS = ['primavera', 'verano', 'otoño', 'invierno'];
const DIA = { hour: 12, season: 'verano', biome: 'pradera', walking: false, working: false, nearFire: false, sheltered: false };

test('las necesidades nunca salen de 0..100 bajo cualquier secuencia', () => {
  const rng = createRng(1);
  const biomas = Object.keys(BIOMES);
  const extremos = () => Object.fromEntries(NEEDS.map(({ id }) => [id, rng.pick([0, 100, rng.int(0, 100)])]));
  const alcanzados = new Set();
  let needs = createNeeds(extremos());
  for (let i = 0; i < 20000; i++) {
    if (i % 500 === 0) {
      needs = createNeeds(extremos());
      for (const { id } of NEEDS) {
        if (needs[id] === 0) alcanzados.add(`${id}:0`);
        if (needs[id] === 100) alcanzados.add(`${id}:100`);
      }
    }
    needs = tickNeeds(needs, {
      hour: i % 24, season: rng.pick(SEASONS), biome: rng.pick(biomas),
      walking: rng.chance(0.5), working: rng.chance(0.5),
      nearFire: rng.chance(0.3), sheltered: rng.chance(0.3),
    });
    for (const { id } of NEEDS) {
      assert.ok(needs[id] >= 0 && needs[id] <= 100, `${id} = ${needs[id]}`);
      if (needs[id] === 0) alcanzados.add(`${id}:0`);
      if (needs[id] === 100) alcanzados.add(`${id}:100`);
    }
  }
  // La prueba debe llegar a ambos extremos de cada necesidad, no vagar por el centro.
  for (const { id } of NEEDS) {
    assert.ok(alcanzados.has(`${id}:0`), `${id} nunca llegó a 0`);
    assert.ok(alcanzados.has(`${id}:100`), `${id} nunca llegó a 100`);
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

// Cobertura de cada cota: cada una debe fallar si se retira sola.

test('fatiga no baja de 0 al dormir con fatiga baja', () => {
  const durmiendo = { hour: 1, season: 'verano', biome: 'pradera', walking: false, working: false, nearFire: false, sheltered: true };
  assert.equal(tickNeeds(createNeeds({ fatiga: 3 }), durmiendo).fatiga, 0);
});

test('moral no supera 100 a cubierto, junto al fuego y bien alimentado', () => {
  const comodo = { hour: 12, season: 'verano', biome: 'pradera', walking: false, working: false, nearFire: true, sheltered: true };
  assert.equal(tickNeeds(createNeeds({ moral: 99.9 }), comodo).moral, 100);
});

test('tickNeeds restablece el rango desde entradas fuera de rango, en ambos sentidos', () => {
  const ctx = { hour: 1, season: 'verano', biome: 'montaña', walking: false, working: false, nearFire: true, sheltered: true };
  for (const { id } of NEEDS) {
    for (const valor of [-50, 150]) {
      const entrada = { ...createNeeds(), [id]: valor };
      const salida = tickNeeds(entrada, ctx)[id];
      assert.ok(salida >= 0 && salida <= 100, `${id} desde ${valor} dio ${salida}`);
    }
  }
});

// Constantes que el jugador ve o que las pruebas de otras tareas dan por hechas.

test('los ids de las necesidades son exactamente los del contrato', () => {
  assert.deepEqual(NEEDS.map((n) => n.id), ['hambre', 'sed', 'frio', 'fatiga', 'moral']);
});

test('las etiquetas de las necesidades están en español, con tilde en Frío', () => {
  assert.deepEqual(NEEDS.map((n) => n.label), ['Hambre', 'Sed', 'Frío', 'Fatiga', 'Moral']);
});

test('las cuatro estaciones existen con sus claves exactas y pesan el frío como se espera', () => {
  // Frío de partida 50, mediodía, pradera (refugio 0.1), sin fuego ni refugio: 50 + estación - 1 - 0.2.
  const esperado = { primavera: 48.8, verano: 46.8, otoño: 49.8, invierno: 51.8 };
  for (const season of SEASONS) {
    const frio = tickNeeds(createNeeds({ frio: 50 }), { ...DIA, season }).frio;
    assert.ok(Math.abs(frio - esperado[season]) < 1e-9, `${season}: ${frio}`);
  }
});

test('la noche empieza a las 20 y termina a las 6', () => {
  // Invierno, frío de partida 50, pradera: de noche +2 frente a -1 de día.
  const frioA = (hour) => tickNeeds(createNeeds({ frio: 50 }), { ...DIA, season: 'invierno', hour }).frio;
  assert.ok(Math.abs(frioA(19) - 51.8) < 1e-9, 'a las 19 es de día');
  assert.ok(Math.abs(frioA(20) - 54.8) < 1e-9, 'a las 20 es de noche');
  assert.ok(Math.abs(frioA(5) - 54.8) < 1e-9, 'a las 5 es de noche');
  assert.ok(Math.abs(frioA(6) - 51.8) < 1e-9, 'a las 6 es de día');
});

test('createNpc consume el mismo flujo de rng con o sin edad explícita', () => {
  const sin = createNpc(createRng(9));
  const con = createNpc(createRng(9), { age: 30 });
  assert.equal(con.nombre, sin.nombre);
  assert.deepEqual(con.traits, sin.traits);
  assert.equal(con.age, 30);
});

// Pureza: el detector se prueba a sí mismo antes de confiar en él.

test('el detector marca APIs ambientales en código real', () => {
  assert.deepEqual(ambientUses('const t = new Date();'), ['new Date']);
  assert.deepEqual(ambientUses('const x = Math.random();'), ['Math.random']);
  assert.deepEqual(ambientUses('const x = Math [ "random" ]();'), ["Math['random']"]);
  assert.deepEqual(ambientUses("const x = Math['random']();"), ["Math['random']"]);
  assert.deepEqual(ambientUses('const t = Date.now();'), ['Date.now']);
  assert.deepEqual(ambientUses('const t = performance.now();'), ['performance.now']);
  assert.deepEqual(ambientUses('const g = globalThis;'), ['globalThis']);
  assert.deepEqual(ambientUses('window.open();'), ['window']);
  assert.deepEqual(ambientUses('document.title = "x";'), ['document']);
  assert.deepEqual(ambientUses('localStorage.clear();'), ['localStorage']);
});

test('el detector ve dentro de la interpolación de plantillas', () => {
  assert.deepEqual(ambientUses('const s = `${Date.now()}`;'), ['Date.now']);
});

test('el detector ignora comentarios y cadenas', () => {
  const fuente = '// window document\n/* new Date() Math.random() */ const s = "window"; const t = `document`; const u = \'localStorage\';';
  assert.deepEqual(ambientUses(fuente), []);
});

test('src/agents no usa APIs ambientales ni aleatoriedad global', () => {
  const dir = new URL('../../src/agents/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const hallazgos = ambientUses(readFileSync(new URL(f, dir), 'utf8'));
    assert.deepEqual(hallazgos, [], `${f} usa ${hallazgos.join(', ')}`);
  }
});
