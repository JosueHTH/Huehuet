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
import { ACTIONS } from '../../src/agents/actions.js';
import { chooseAction } from '../../src/agents/utility.js';
import { createNpc } from '../../src/agents/npc.js';
import { createGrid } from '../../src/world/grid.js';
import { createDiscovery } from '../../src/world/discovery.js';
import { createClock } from '../../src/core/clock.js';
import { MAX_ENTRADAS, record } from '../../src/chronicle.js';
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
  for (const seed of [1, 2, 3, 4, 5, 7, 21, 22, 23, 42]) {
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
  assert.ok(seConformaron.length >= 2, `conformarse debe ser habitual, no una rareza: ${JSON.stringify(seConformaron)}`);
  // Y el caso fuerte, fijado por su semilla para que una regresión lo nombre: la 22 es un mundo pobre
  // (su mejor sitio con el mapa entero descubierto es 56.5) y la banda aguanta 64 días antes de
  // aceptar un 51.8 frente a los 70 que pediría en calma, con la presión en 0.43.
  const apurada = seConformaron.find((h) => h.seed === 22);
  assert.ok(apurada, `la semilla 22 debía asentarse conformándose: ${JSON.stringify(historias)}`);
  assert.ok(apurada.presion >= 0.35, `la 22 se conformó con poca presión (${apurada.presion.toFixed(2)})`);
  assert.ok(apurada.media <= acceptanceThreshold(0) - 8, `la 22 ya no se asienta claramente por debajo del umbral en calma (${apurada.media.toFixed(1)})`);
  // Y el caso contrario: alguna se asienta porque el sitio es bueno, no porque no le quede otra.
  const tranquila = eligieronBien.find((h) => h.presion <= 0.3);
  assert.ok(tranquila, `nadie eligió bien en calma: ${JSON.stringify(eligieronBien)}`);
});

// El pago de todo el juego es llegar al sitio elegido y levantar la aldea. Si la hoguera no está lista
// antes del invierno (día 90) la banda se congela, así que fundar tiene que servir de algo y pronto.
test('una banda que funda termina su hoguera poco después, no meses más tarde', () => {
  const PLAZO = 20;
  const tardanzas = [];
  for (const seed of [1, 2, 3, 4, 5]) {
    const g = createGame(seed);
    correrHasta(g, 400, (p) => p.band.settled || p.over);
    if (!g.band.settled) continue;
    const fundado = g.settlement.foundedDay;
    correrHasta(g, PLAZO + 1, (p) => p.settlement.buildings[0].done || p.over);
    const hoguera = g.settlement.buildings[0];
    tardanzas.push({ seed, fundado, lista: hoguera.done ? g.clock.day - fundado : null, progreso: +hoguera.progress.toFixed(2) });
  }
  assert.ok(tardanzas.length >= 4, `solo ${tardanzas.length} de 5 fundaron`);
  for (const t of tardanzas) {
    assert.ok(t.lista !== null && t.lista <= PLAZO, `semilla ${t.seed}: la hoguera sigue al ${Math.round(t.progreso * 100)}% ${PLAZO} días después de fundar`);
  }
});

// Las dos mitades del mismo trato: la aldea terminada tiene que pagar (se sobrevive al invierno), y el
// invierno tiene que seguir doliendo (la extinción sigue siendo alcanzable). Si lo primero se cumpliera
// siempre y en todas partes, el arco se quedaría sin apuesta.
const SEMILLAS_INVIERNO = [1, 2, 3, 4, 5, 9, 11];
const inviernos = new Map();   // simular un invierno cuesta segundos: las dos mitades comparten la medición

function inviernoDe(seed) {
  if (!inviernos.has(seed)) {
    const g = createGame(seed);
    correrHasta(g, 400, (p) => p.band.settled || p.over);
    correrHasta(g, 130 - g.clock.day, (p) => p.over);   // el invierno va del día 90 al 119
    inviernos.set(seed, g.band.settled
      ? { seed, vivos: livingNpcs(g.band).length, aldea: g.settlement.queue.length === 0, dia: g.clock.day }
      : null);
  }
  return inviernos.get(seed);
}

const inviernosMedidos = () => SEMILLAS_INVIERNO.map(inviernoDe).filter(Boolean);

test('la aldea terminada paga: casi todas las bandas que la levantan pasan su primer invierno', () => {
  const conAldea = inviernosMedidos().filter((r) => r.aldea);
  assert.ok(conAldea.length >= 5, `muy pocas terminaron la aldea: ${JSON.stringify(inviernosMedidos())}`);
  const vivas = conAldea.filter((r) => r.vivos > 0);
  assert.ok(vivas.length >= Math.ceil(conAldea.length * 2 / 3),
    `con la aldea en pie solo sobrevivieron ${vivas.length} de ${conAldea.length}: ${JSON.stringify(conAldea)}`);
  // Fijada por su número: sin el tirón de la hoguera, esta banda se congelaba el día 98 con su aldea
  // entera en pie, porque su gente andaba lejos del fuego. Es el caso que el arreglo rescata.
  const rescatada = inviernoDe(2);
  assert.ok(rescatada.aldea && rescatada.vivos > 0, `la semilla 2 vuelve a morir con la aldea en pie: ${JSON.stringify(rescatada)}`);
});

test('el invierno sigue doliendo: la extinción sigue siendo alcanzable', () => {
  const resultados = inviernosMedidos();
  const extintas = resultados.filter((r) => r.vivos === 0);
  assert.ok(extintas.length > 0, `ninguna de las ${resultados.length} bandas se extinguió: el invierno dejó de ser una apuesta`);
  const vivas = resultados.filter((r) => r.vivos > 0);
  assert.ok(vivas.length > extintas.length, `el invierno mata demasiado: vivas ${vivas.length}, extintas ${extintas.length}`);
  // Fijada por su número para que una regresión la nombre: la 9 funda el día 16, levanta la aldea
  // entera y aun así se apaga en el invierno.
  const congelada = inviernoDe(9);
  assert.ok(congelada && congelada.vivos === 0, `la semilla 9 ya no se congela: ${JSON.stringify(congelada)}`);
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

test('tras la extinción el tick se corta ahí: no se decide ni se construye sobre una banda muerta', () => {
  const g = partidaMoribunda();
  g.band.lastEvaluation = -1000;   // la evaluación toca justo en el tick en que mueren
  stepGame(g, 1);
  assert.equal(g.over, true);
  assert.equal(g.chronicle.entries[g.chronicle.entries.length - 1].type, 'fin', 'nada se cuenta después del final');
  assert.equal(g.lastDecision, null, 'una banda muerta no elige dónde vivir');
  assert.equal(g.band.site, null);
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

test('advanceGame descarta un dt o una velocidad imposibles y no rompe el reloj', () => {
  const g = createGame(4);
  for (const [dt, v] of [[NaN, 1], [1000, NaN], [Infinity, 1]]) assert.equal(advanceGame(g, dt, v), 0);
  assert.equal(g.clock.tick, 0);
  assert.equal(advanceGame(g, MS_POR_TICK * 3, 1), 3, 'el reloj sigue sano después');
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

test('fundar junto al borde no deja edificios fuera del mapa', () => {
  const g = createGame(7);
  g.band.x = 0;
  g.band.y = 0;
  g.band.site = { x: 0, y: 0 };
  stepGame(g, 1);
  assert.ok(g.settlement, 'la banda ya estaba en su sitio: debía fundar');
  for (const b of g.settlement.buildings) {
    assert.ok(g.grid.inBounds(b.x, b.y), `${b.id} cae fuera del mapa en (${b.x}, ${b.y})`);
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

test('la crónica llena no se come los hitos: la fundación sigue ahí tras rebasar el tope', () => {
  const g = createGame(2);
  correrHasta(g, 400, (p) => p.band.settled || p.over);
  assert.ok(g.band.settled, 'la semilla 2 debería fundar');
  correrHasta(g, 400, (p) => p.chronicle.entries.length >= MAX_ENTRADAS);
  assert.equal(g.chronicle.entries.length, MAX_ENTRADAS, 'la crónica debe llegar a su tope');
  const tipos = {};
  for (const e of g.chronicle.entries) tipos[e.type] = (tipos[e.type] ?? 0) + 1;
  assert.ok(g.chronicle.entries.some((e) => e.type === 'asentamiento'), `la fundación se perdió: ${JSON.stringify(tipos)}`);
  assert.ok(g.chronicle.entries.some((e) => e.type === 'inicio'), `el comienzo se perdió: ${JSON.stringify(tipos)}`);
  assert.ok(g.chronicle.entries.some((e) => e.type === 'decision'), `las decisiones se perdieron: ${JSON.stringify(tipos)}`);
  // Y el relato rutinario sí rota: no se guarda todo para siempre.
  assert.ok((tipos.banda ?? 0) > 0, 'el día a día debe seguir contándose');
});

test('las muertes no se desalojan: quien murió sigue nombrado cuando la crónica se llena', () => {
  const g = createGame(2);   // pierde seis personas y desborda el tope de la crónica
  const muertos = new Map();   // id -> día en que murió, contado por las banderas de vida, no por el texto
  for (let d = 0; d < 300 && g.chronicle.entries.length < MAX_ENTRADAS + 50; d++) {
    const vivos = new Set(livingNpcs(g.band).map((n) => n.id));
    stepGame(g, 24);
    for (const npc of g.band.npcs) if (vivos.has(npc.id) && !npc.alive) muertos.set(npc.id, g.clock.day);
    if (g.over) break;
  }
  assert.ok(muertos.size >= 2, `la semilla 2 debería perder gente: murieron ${muertos.size}`);
  assert.ok(g.chronicle.entries.length >= MAX_ENTRADAS, `la crónica debe desbordar: ${g.chronicle.entries.length}`);
  const lineasDeMuerte = g.chronicle.entries.filter((e) => e.type === 'muerte');
  assert.equal(lineasDeMuerte.length, muertos.size, `murieron ${muertos.size} y la crónica recuerda ${lineasDeMuerte.length}`);
  for (const npc of g.band.npcs) {
    if (!muertos.has(npc.id)) continue;
    assert.ok(lineasDeMuerte.some((e) => e.text.includes(npc.nombre)), `${npc.nombre} murió y ya nadie lo recuerda`);
  }
});

test('una muerte con nombre sobrevive a mil líneas de rutina', () => {
  const g = createGame(1);
  const victima = g.band.npcs[0];
  victima.needs.sed = 100;
  victima.saturacion = TICKS_HASTA_MORIR;   // muere en el tick siguiente, por el camino normal
  stepGame(g, 1);
  assert.equal(victima.alive, false);
  const muerte = g.chronicle.entries.find((e) => e.type === 'muerte');
  assert.ok(muerte && muerte.text.includes(victima.nombre), `la muerte no quedó anotada como tal: ${JSON.stringify(g.chronicle.entries.slice(-3))}`);
  for (let i = 0; i < MAX_ENTRADAS * 2; i++) record(g.chronicle, { day: 1, type: 'banda', text: `rutina ${i}` });
  assert.ok(g.chronicle.entries.some((e) => e.type === 'muerte' && e.text.includes(victima.nombre)),
    `${victima.nombre} murió y el día a día se la llevó por delante`);
});

test('el fin se registra aunque la crónica esté llena', () => {
  const g = partidaMoribunda();
  for (let i = 0; i < MAX_ENTRADAS; i++) record(g.chronicle, { day: 0, type: 'banda', text: `relleno ${i}` });
  stepGame(g, 1);
  assert.equal(g.over, true);
  assert.ok(g.chronicle.entries.some((e) => e.type === 'fin'), 'el final no puede caerse del tope');
  assert.equal(g.chronicle.entries.length, MAX_ENTRADAS);
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

// --- Balance medido en este Task (Step C) --------------------------------------------------------
// Las dos correcciones que hicieron falta para que el arco se pueda correr. Se prueban aquí, con el
// catálogo de acciones real, porque son decisiones de balance de Task 11, no del catálogo.

// Escena a mano: pradera seca con un río conocido a `distancia` celdas al este del NPC.
function escenaConRioLejos(distancia, needs = {}) {
  const grid = createGrid(40, 40);
  for (let y = 0; y < 40; y++) {
    const rio = grid.at(16 + distancia, y);
    rio.biome = 'rio';
    rio.river = true;
    rio.resources.agua = 10;
  }
  const discovery = createDiscovery(grid);
  discovery.reveal(16, 16, distancia + 2);   // la banda ya ha visto el río
  const npc = createNpc(createRng(5), { x: 16, y: 16 });
  npc.needs = { ...npc.needs, ...needs };
  const band = createBand(createRng(5), { x: 16, y: 16 }, { size: 0 });
  band.npcs.push(npc);
  return { npc, band, ctx: { grid, discovery, clock: createClock({ tick: 12 }) } };
}

const accion = (id) => ACTIONS.find((a) => a.id === id);

test('un NPC sediento camina hacia el agua que ya conoce, no al azar', () => {
  const { npc, band, ctx } = escenaConRioLejos(9, { sed: 90 });
  const antes = npc.x;
  accion('explorar').apply(npc, band, ctx, createRng(1));
  assert.ok(npc.x > antes, `se alejó del río: ${antes} -> ${npc.x}`);
  assert.equal(npc.y, 16, 'no da vueltas: va derecho');
});

test('sin agua conocida el paso desesperado sigue siendo exploración al azar', () => {
  const grid = createGrid(40, 40);
  const discovery = createDiscovery(grid);
  discovery.reveal(16, 16, 5);
  const npc = createNpc(createRng(5), { x: 16, y: 16 });
  npc.needs = { ...npc.needs, sed: 95 };
  const band = createBand(createRng(5), { x: 16, y: 16 }, { size: 0 });
  const destinos = new Set();
  for (let seed = 0; seed < 12; seed++) {
    const copia = { ...npc, x: 16, y: 16 };
    accion('explorar').apply(copia, band, { grid, discovery, clock: createClock({ tick: 12 }) }, createRng(seed));
    destinos.add(`${copia.x},${copia.y}`);
  }
  assert.ok(destinos.size > 1, 'sin meta conocida no puede haber una sola dirección');
});

test('un NPC sediento no se mueve si el agua conocida ya está a su alcance: bebe', () => {
  const { npc, band, ctx } = escenaConRioLejos(1, { sed: 90 });
  assert.equal(chooseAction(npc, band, ctx).id, 'beber');
});

test('la recolección sigue el plan de obra: sube con lo que falta y se apaga al tenerlo', () => {
  const g = createGame(7);
  const band = g.band;
  const sueltos = accion('talar').score(band.npcs[0], band, { grid: g.grid, discovery: g.discovery, clock: g.clock });
  const sitio = { x: band.x, y: band.y };
  for (const celda of g.grid.cells) { celda.resources.leña = 10; celda.resources.piedra = 20; }
  g.discovery.reveal(band.x, band.y, 3);
  const ctx = { grid: g.grid, discovery: g.discovery, clock: g.clock };
  const npc = band.npcs[0];
  const nomada = { talar: accion('talar').score(npc, band, ctx), piedra: accion('recoger_piedra').score(npc, band, ctx) };
  foundSettlement(band, sitio, 0);
  const conObra = { talar: accion('talar').score(npc, band, ctx), piedra: accion('recoger_piedra').score(npc, band, ctx) };
  assert.ok(conObra.talar > nomada.talar, 'la hoguera pide leña');
  assert.equal(conObra.piedra, nomada.piedra, 'la hoguera no pide piedra: nada que empujar');
  band.inventory.leña = 1000;
  assert.equal(accion('talar').score(npc, band, ctx), nomada.talar, 'con leña de sobra el empuje se apaga');
  // La choza (segunda en la cola) sí pide piedra.
  band.settlement.queue.shift();
  assert.ok(accion('recoger_piedra').score(npc, band, ctx) > nomada.piedra, 'la choza pide piedra');
  assert.ok(sueltos >= 0);
});

test('mientras la banda es nómada el plan de obra no existe y nada cambia', () => {
  const g = createGame(7);
  for (const celda of g.grid.cells) { celda.resources.leña = 10; celda.resources.piedra = 20; }
  g.discovery.reveal(g.band.x, g.band.y, 3);
  const ctx = { grid: g.grid, discovery: g.discovery, clock: g.clock };
  const npc = g.band.npcs[0];
  const base = accion('talar').score(npc, g.band, ctx);
  g.band.settlement = { x: 0, y: 0, buildings: [{ id: 'hoguera', cost: { leña: 6 } }], queue: ['hoguera'] };
  assert.equal(accion('talar').score(npc, g.band, ctx), base, 'sin band.settled no hay obra');
});
