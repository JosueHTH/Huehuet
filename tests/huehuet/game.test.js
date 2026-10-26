// Task 11: la fachada de la partida. Aquí se corre por primera vez el arco completo del spec
// (nómadas que exploran, deciden por su cuenta dónde asentarse, fundan la aldea y la construyen)
// sin ninguna intervención del jugador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, stepGame, advanceGame, clampBuildings, MS_POR_TICK } from '../../src/game.js';
import { createRng } from '../../src/core/rng.js';
import { createBand, livingNpcs, bandPressure, TICKS_HASTA_MORIR } from '../../src/tribe/band.js';
import { foundSettlement, avanceFinanciable, BUILDINGS } from '../../src/tribe/settlement.js';
import { acceptanceThreshold } from '../../src/tribe/sitescore.js';
import { INTERVALO_EVALUACION, ESPERA_MINIMA } from '../../src/tribe/consensus.js';
import { ambientUses } from './purity.js';

// Estado comparable de una partida: todo lo que define el avance, sin funciones (rng, rejilla y reloj
// llevan métodos y assert.deepEqual compara funciones por referencia, así que nunca serían iguales).
const estado = (g) => ({
  seed: g.seed,
  tick: g.clock.tick,
  band: g.band,
  settlement: g.settlement,
  conocido: g.discovery.toJSON(),
  cronica: g.chronicle.entries,
  over: g.over,
  decision: g.lastDecision,
});

// Corre la partida hasta que se cumpla `condicion` o se agoten los días. Devuelve el día alcanzado.
function correrHasta(g, dias, condicion) {
  for (let d = 0; d < dias && !condicion(g); d++) stepGame(g, 24);
  return g.clock.day;
}

test('createGame con la misma semilla produce el mismo estado inicial', () => {
  assert.deepEqual(estado(createGame(99)), estado(createGame(99)));
});

test('createGame deja la partida lista: mundo, banda viva, territorio descubierto y crónica abierta', () => {
  const g = createGame(99);
  assert.equal(g.seed, 99);
  assert.equal(g.grid, g.world.grid);
  assert.ok(livingNpcs(g.band).length > 0);
  assert.deepEqual([g.band.x, g.band.y], [g.world.start.x, g.world.start.y]);
  assert.ok(g.discovery.size > 0, 'la banda ve lo que la rodea desde el primer día');
  assert.ok(g.discovery.isKnown(g.band.x, g.band.y));
  assert.equal(g.over, false);
  assert.equal(g.settlement, null);
  assert.equal(g.lastDecision, null);
  assert.equal(g.clock.tick, 0);
  assert.ok(g.chronicle.entries.length > 0, 'la crónica arranca contando de dónde salen');
});

test('tras N pasos, la misma semilla da el mismo estado', () => {
  const a = createGame(99);
  const b = createGame(99);
  stepGame(a, 2000);
  stepGame(b, 2000);
  assert.deepEqual(a.band, b.band);
  assert.deepEqual(a.discovery.toJSON(), b.discovery.toJSON());
  assert.deepEqual(a.chronicle.entries, b.chronicle.entries);
  assert.deepEqual(estado(a), estado(b));
});

test('semillas distintas dan partidas distintas', () => {
  const a = createGame(99);
  const b = createGame(100);
  stepGame(a, 500);
  stepGame(b, 500);
  assert.notDeepEqual(a.discovery.toJSON(), b.discovery.toJSON());
});

test('la banda descubre territorio con el tiempo', () => {
  const g = createGame(31);
  const antes = g.discovery.size;
  stepGame(g, 500);
  assert.ok(g.discovery.size > antes);
});

test('cada paso adelanta el reloj exactamente un tick', () => {
  const g = createGame(31);
  stepGame(g, 7);
  assert.equal(g.clock.tick, 7);
  stepGame(g, 1);
  assert.equal(g.clock.tick, 8);
});

test('stepGame ignora conteos absurdos y no retrocede el reloj', () => {
  const g = createGame(31);
  stepGame(g, 0);
  stepGame(g, -5);
  stepGame(g, NaN);
  assert.equal(g.clock.tick, 0);
});

// --- El arco completo del spec, sin intervención del jugador -------------------------------------

test('la banda acaba asentándose por su cuenta', () => {
  let asentadas = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const g = createGame(seed);
    correrHasta(g, 400, (p) => p.band.settled || p.over);
    if (g.band.settled) asentadas++;
  }
  assert.ok(asentadas >= 4, `solo ${asentadas} de 5 se asentaron`);
});

test('al asentarse se crea el asentamiento y queda en la crónica', () => {
  const g = createGame(1);
  correrHasta(g, 400, (p) => p.band.settled || p.over);
  assert.ok(g.band.settled);
  assert.notEqual(g.settlement, null);
  assert.ok(g.chronicle.entries.some((e) => e.type === 'asentamiento'));
  const linea = g.chronicle.entries.find((e) => e.type === 'asentamiento');
  assert.match(linea.text, new RegExp(`\\(${g.settlement.x}, ${g.settlement.y}\\)`), 'la crónica dice dónde');
  assert.equal(linea.day, g.settlement.foundedDay);
});

// Las dos historias que promete el diseño: "eligieron bien" y "se conformaron".
test('hay semillas donde la banda elige bien y semillas donde se conforma', () => {
  const historias = [];
  for (const seed of [1, 2, 3, 4, 5, 7, 21, 23, 42]) {
    const g = createGame(seed);
    correrHasta(g, 400, (p) => p.band.settled || p.over);
    if (!g.band.settled || !g.lastDecision?.settle) continue;
    const { consensus, pressure } = g.lastDecision;
    historias.push({ seed, media: consensus.average, presion: pressure, comodo: consensus.average >= acceptanceThreshold(0) });
  }
  const eligieronBien = historias.filter((h) => h.comodo);
  const seConformaron = historias.filter((h) => !h.comodo);
  assert.ok(eligieronBien.length > 0, `ninguna eligió bien: ${JSON.stringify(historias)}`);
  assert.ok(seConformaron.length > 0, `ninguna se conformó: ${JSON.stringify(historias)}`);
  // Conformarse es asentarse en algo que en calma se habría rechazado, con la necesidad apretando.
  for (const h of seConformaron) assert.ok(h.presion > 0, `semilla ${h.seed} se conformó sin presión`);
});

test('la aldea se levanta: al menos un edificio termina y la crónica lo cuenta', () => {
  const g = createGame(5);
  correrHasta(g, 400, (p) => p.settlement?.buildings.some((b) => b.done));
  assert.ok(g.settlement, 'no llegó a fundar');
  assert.ok(g.settlement.buildings.some((b) => b.done), 'ninguna obra terminó');
  assert.ok(g.chronicle.entries.some((e) => e.type === 'construccion'));
});

// --- Fin de la partida ---------------------------------------------------------------------------

// Una banda que ya no llega: con hambre y sed al máximo y un día entero acumulado de saturación, el
// siguiente tick los mata por el camino normal de mortalidad (no se tocan banderas de vida a mano).
// Nótese el contraste con la prueba siguiente: con necesidades al límite pero sin esa cuenta atrás, la
// banda sobrevive porque va a buscar el agua que ya ha visto.
function partidaMoribunda(seed = 1) {
  const g = createGame(seed);
  for (const n of g.band.npcs) {
    n.needs.hambre = 100;
    n.needs.sed = 100;
    n.saturacion = TICKS_HASTA_MORIR;
  }
  return g;
}

test('la extinción termina la partida y la registra', () => {
  const g = partidaMoribunda();
  stepGame(g, 24 * 60);
  assert.equal(g.over, true);
  assert.ok(g.chronicle.entries.some((e) => e.type === 'fin'));
  assert.equal(g.chronicle.entries.filter((e) => e.type === 'fin').length, 1, 'el final se cuenta una vez');
  assert.equal(g.chronicle.entries[g.chronicle.entries.length - 1].type, 'fin', 'el final va al final');
});

test('la extinción corta el paso en seco: el reloj no llega al final del lote', () => {
  const g = partidaMoribunda();
  stepGame(g, 24 * 60);
  assert.ok(g.clock.tick < 24 * 60, `el reloj siguió corriendo tras la extinción (${g.clock.tick})`);
});

test('antes del fin la crónica cuenta las muertes: el relato no se corta antes de la banda', () => {
  const g = partidaMoribunda();
  stepGame(g, 24 * 60);
  const fin = g.chronicle.entries.findIndex((e) => e.type === 'fin');
  const muertes = g.chronicle.entries.filter((e, i) => i < fin && /murió/.test(e.text));
  assert.ok(muertes.length > 0, 'nadie murió antes del final');
});

test('una banda al límite pero con mundo alrededor no se extingue: va a por el agua', () => {
  const g = createGame(1);
  for (const n of g.band.npcs) { n.needs.hambre = 100; n.needs.sed = 100; }
  stepGame(g, 24 * 10);
  assert.equal(g.over, false);
  assert.ok(livingNpcs(g.band).length > 0);
  assert.ok(livingNpcs(g.band).some((n) => n.needs.sed < 90), 'alguien tuvo que beber');
});

test('stepGame sobre una partida terminada no cambia nada', () => {
  const g = createGame(1);
  g.over = true;
  const antes = { tick: g.clock.tick, entries: g.chronicle.entries.length, estado: estado(g) };
  stepGame(g, 100);
  assert.equal(g.clock.tick, antes.tick);
  assert.equal(g.chronicle.entries.length, antes.entries);
  assert.deepEqual(estado(g), antes.estado);
});

test('advanceGame sobre una partida terminada no corre ni un tick', () => {
  const g = createGame(1);
  g.over = true;
  assert.equal(advanceGame(g, 100000, 1), 0);
  assert.equal(g.clock.tick, 0);
});

// --- Avance por tiempo real ----------------------------------------------------------------------

test('advanceGame respeta el acotado del reloj', () => {
  const g = createGame(4);
  assert.ok(advanceGame(g, 600000, 10) <= 24);
});

test('advanceGame devuelve los ticks corridos y los simula', () => {
  const g = createGame(4);
  const ticks = advanceGame(g, MS_POR_TICK * 5, 1);
  assert.equal(ticks, 5);
  assert.equal(g.clock.tick, 5);
  const porPasos = createGame(4);
  stepGame(porPasos, 5);
  assert.deepEqual(estado(g), estado(porPasos), 'avanzar por tiempo o por pasos da la misma partida');
});

test('advanceGame no simula nada si no se ha acumulado un tick', () => {
  const g = createGame(4);
  assert.equal(advanceGame(g, MS_POR_TICK / 4, 1), 0);
  assert.equal(g.clock.tick, 0);
  assert.equal(g.discovery.size, createGame(4).discovery.size);
});

// --- Contratos de cableado -----------------------------------------------------------------------

test('Game.settlement es una vista de band.settlement, no una copia', () => {
  const g = createGame(1);
  const propia = Object.getOwnPropertyDescriptor(g, 'settlement');
  assert.ok(propia.get, 'settlement debe ser un getter');
  assert.equal(propia.value, undefined);
  const falso = { x: 3, y: 4, foundedDay: 1, buildings: [], queue: [] };
  g.band.settlement = falso;
  assert.equal(g.settlement, falso, 'la fachada debe leer band.settlement, la única fuente');
  g.band.settlement = null;
  assert.equal(g.settlement, null);
});

test('la fundación ocurre al llegar, no al decidir', () => {
  const g = createGame(4);
  let decidido = null;
  for (let d = 0; d < 400 && !g.band.settled; d++) {
    stepGame(g, 24);
    if (!decidido && g.band.site) {
      decidido = { ...g.band.site, dia: g.clock.day };
      const lejos = Math.max(Math.abs(g.band.x - g.band.site.x), Math.abs(g.band.y - g.band.site.y));
      if (lejos > 0) {
        assert.equal(g.band.settled, false, 'decidir no es fundar: hay que caminar hasta allí');
        assert.equal(g.settlement, null);
      }
    }
  }
  assert.ok(decidido, 'la banda no decidió nada en 400 días');
  assert.ok(g.band.settled);
  assert.deepEqual([g.settlement.x, g.settlement.y], [g.band.x, g.band.y], 'se funda donde está la banda');
});

test('la decisión se evalúa con la cadencia de la banda, no en cada tick', () => {
  const g = createGame(2);
  const evaluaciones = new Set();
  for (let t = 0; t < 24 * 10 && !g.band.settled; t++) {
    stepGame(g, 1);
    evaluaciones.add(g.band.lastEvaluation);
  }
  const ticks = g.clock.tick;
  assert.ok(evaluaciones.size <= Math.ceil(ticks / ESPERA_MINIMA) + 1, `${evaluaciones.size} evaluaciones en ${ticks} ticks`);
  assert.ok(evaluaciones.size >= Math.floor(ticks / INTERVALO_EVALUACION), 'tampoco debe dejar de evaluar');
});

test('game.js no busca candidatos por su cuenta: la cadencia es de consensus', () => {
  const fuente = readFileSync(new URL('../../src/game.js', import.meta.url), 'utf8');
  assert.ok(!/candidateSites/.test(fuente), 'game.js no debe llamar a candidateSites: cuesta 40-60 ms por llamada');
  assert.ok(/considerSettlement/.test(fuente), 'la decisión entra por considerSettlement');
});

test('los edificios caben en la rejilla aunque el sitio esté pegado al borde', () => {
  const g = createGame(7);
  const rng = createRng(1);
  for (const sitio of [{ x: 0, y: 0 }, { x: g.grid.width - 1, y: g.grid.height - 1 }, { x: 1, y: g.grid.height - 2 }]) {
    const band = createBand(rng, sitio, { size: 1 });
    const s = foundSettlement(band, sitio, 0);
    clampBuildings(s, g.grid);
    for (const b of s.buildings) {
      assert.ok(g.grid.inBounds(b.x, b.y), `${b.id} cae fuera del mapa en (${b.x}, ${b.y})`);
    }
  }
});

test('la obra no se atasca en silencio con un coste de cero: NaN no envenena el mínimo', () => {
  assert.equal(avanceFinanciable({ leña: 0 }, {}), Infinity, 'lo que no cuesta nada no limita el avance');
  assert.equal(avanceFinanciable({ leña: 0, piedra: 4 }, { piedra: 2 }), 0.5);
  assert.equal(avanceFinanciable({}, {}), Infinity);
  assert.equal(avanceFinanciable({ leña: 6 }, { leña: 3 }), 0.5);
  for (const def of BUILDINGS) {
    const avance = avanceFinanciable(def.cost, Object.fromEntries(Object.keys(def.cost).map((id) => [id, 1e6])));
    assert.ok(Number.isFinite(avance) && avance > 0, `${def.id}: ${avance}`);
  }
});

// --- Pureza y determinismo -----------------------------------------------------------------------

test('stepGame no usa Math.random', () => {
  const real = Math.random;
  Math.random = () => { throw new Error('la simulación usó Math.random'); };
  try {
    stepGame(createGame(6), 500);
  } finally {
    Math.random = real;
  }
});

test('src/game.js no usa APIs ambientales ni aleatoriedad global', () => {
  const hallazgos = ambientUses(readFileSync(new URL('../../src/game.js', import.meta.url), 'utf8'));
  assert.deepEqual(hallazgos, [], `src/game.js usa ${hallazgos.join(', ')}`);
});

test('la fachada no toma decisiones con la verdad del generador', () => {
  const fuente = readFileSync(new URL('../../src/game.js', import.meta.url), 'utf8');
  assert.ok(!/viableSites/.test(fuente), 'viableSites es la verdad del generador: la banda no la conoce');
});

test('la presión que mueve la decisión es la de la banda y vive en 0..1', () => {
  const g = createGame(3);
  stepGame(g, 24 * 20);
  const p = bandPressure(g.band, { season: g.clock.season });
  assert.ok(p >= 0 && p <= 1);
  if (g.lastDecision) assert.ok(g.lastDecision.pressure >= 0 && g.lastDecision.pressure <= 1);
});
