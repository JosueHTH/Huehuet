import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRng } from '../../src/core/rng.js';
import { createGrid } from '../../src/world/grid.js';
import { createDiscovery } from '../../src/world/discovery.js';
import { createNpc } from '../../src/agents/npc.js';
import { createBand, bandPressure } from '../../src/tribe/band.js';
import { scoreSite, candidateSites, acceptanceThreshold } from '../../src/tribe/sitescore.js';
import {
  npcSiteScore, evaluateConsensus, decideSettlement, considerSettlement,
  RADIO_SITIO_ABANDONADO, CRECIMIENTO_PARA_REINTENTAR, INTERVALO_EVALUACION, SALTO_PRESION, ESPERA_MINIMA,
  registrarAbandono, sitiosExcluidos,
} from '../../src/tribe/consensus.js';
import { codeOnly } from './purity.js';

// --- Escenarios sintéticos -----------------------------------------------------------------------
const C = 10;

// Rejilla de pradera de 25x25 con un río a 2 celdas del centro y los recursos pedidos en un radio de 9.
function escena({ recursos = {}, agua = true, pantano = 0, rioLargo = false, season = 'verano', reveal = 14, size = 25 } = {}) {
  const grid = createGrid(size, size);
  for (const cell of grid.cells) {
    if (Math.hypot(cell.x - C, cell.y - C) > 12) continue;
    for (const [id, cantidad] of Object.entries(recursos)) cell.resources[id] = cantidad;
  }
  if (agua) {
    const rio = grid.at(C + 2, C);
    rio.biome = 'rio'; rio.river = true; rio.resources.agua = 10;
  }
  if (rioLargo) {
    for (let y = 0; y < size; y++) {
      const rio = grid.at(C + 2, y);
      rio.biome = 'rio'; rio.river = true; rio.resources.agua = 10;
    }
  }
  if (pantano) {
    for (const cell of grid.cells) {
      if (Math.hypot(cell.x - C, cell.y - C) <= pantano && !cell.river) { cell.biome = 'pantano'; }
    }
  }
  const discovery = createDiscovery(grid);
  if (reveal >= 0) discovery.reveal(C, C, reveal);
  return { grid, discovery, ctx: { grid, season } };
}

const ctxVerano = () => ({ grid: escena().grid, season: 'verano' });

// Un sitio con recursos de sobra.
function sitioBueno() {
  const { discovery, ctx } = escena({ recursos: { caza: 30, forraje: 30, leña: 30, piedra: 30 } });
  return scoreSite(discovery, C, C, ctx);
}
// Un sitio viable pero rodeado de pantano: inundación alta, defensa y refugio pobres.
function sitioRiesgoso() {
  const { discovery, ctx } = escena({ recursos: { caza: 30, forraje: 30, leña: 30, piedra: 30 }, pantano: 9 });
  return scoreSite(discovery, C, C, ctx);
}
// Un valle mediocre: viable pero lejos de una zona rica.
function descubrimientoMediocre() {
  const e = escena({ recursos: { caza: 2, forraje: 2, leña: 2, piedra: 2 } });
  return e.discovery;
}
const descubrimientoSinAgua = () => escena({ agua: false, recursos: { caza: 30, forraje: 30 } }).discovery;
const descubrimientoVacio = () => escena({ reveal: -1 }).discovery;

const NEUTRO = { cautela: 0, audacia: 0, sabiduria: 0 };

// Banda sin NPCs aleatorios; cada especificación fija edad, rasgos y si vive.
function bandaCon(especificaciones) {
  const rng = createRng(11);
  const band = createBand(rng, { x: C, y: C }, { size: 0 });
  for (const e of especificaciones) {
    const npc = createNpc(rng, { age: e.age, x: C, y: C });
    npc.traits = { ...NEUTRO, ...(e.traits ?? {}) };
    if (e.alive === false) npc.alive = false;
    if (e.nombre) npc.nombre = e.nombre;
    band.npcs.push(npc);
  }
  return band;
}
const necesidades = (band, valores) => { for (const n of band.npcs) Object.assign(n.needs, valores); };
const ADULTOS = [{ age: 50 }, { age: 30 }, { age: 25 }];
function bandaComoda() {
  const band = bandaCon(ADULTOS);
  necesidades(band, { hambre: 0, sed: 0, frio: 0, moral: 100 });
  return band;
}
function bandaDesesperada() {
  const band = bandaCon(ADULTOS);
  necesidades(band, { hambre: 90, sed: 90, frio: 90, moral: 0 });
  band.recentDeaths = 3;
  return band;
}
// Una anciana muy cauta frente a cuatro jóvenes audaces: ante un sitio inundable, Ilka discrepa.
const bandaPolarizada = () => bandaCon([
  { age: 50, nombre: 'Ilka', traits: { cautela: 1, audacia: 0, sabiduria: 0 } },
  ...['Brun', 'Teo', 'Kora', 'Tavo'].map((nombre) => ({ age: 28, nombre, traits: { cautela: 0, audacia: 1, sabiduria: 0 } })),
]);

// --- Votantes y pesos ----------------------------------------------------------------------------
test('solo votan los adultos vivos', () => {
  const band = bandaCon([{ age: 50 }, { age: 30 }, { age: 8 }, { age: 30, alive: false }]);
  const c = evaluateConsensus(band, sitioBueno());
  assert.equal(c.votes.length, 2);
});

test('un niño de 14 no vota y uno de 15 sí; el anciano empieza a los 45', () => {
  const c = evaluateConsensus(bandaCon([{ age: 14 }, { age: 15 }, { age: 44 }, { age: 45 }]), sitioBueno());
  assert.equal(c.votes.length, 3);
  assert.deepEqual(c.votes.map((v) => v.elder), [false, false, true]);
});

test('el voto de un anciano pesa el doble', () => {
  const c = evaluateConsensus(bandaCon([{ age: 50 }, { age: 30 }]), sitioBueno());
  const anciano = c.votes.find((v) => v.elder);
  const joven = c.votes.find((v) => !v.elder);
  assert.equal(anciano.weight, joven.weight * 2);
  assert.ok(joven.weight > 0);
});

test('la media ponderada se inclina hacia los ancianos', () => {
  const band = bandaCon([{ age: 50, traits: { cautela: 1, audacia: 0, sabiduria: 1 } },
                         { age: 20, traits: { cautela: 0, audacia: 1, sabiduria: 0 } }]);
  const c = evaluateConsensus(band, sitioRiesgoso());
  const anciano = c.votes.find((v) => v.elder);
  const joven = c.votes.find((v) => !v.elder);
  assert.notEqual(anciano.score, joven.score, 'la prueba necesita votos distintos');
  assert.ok(Math.abs(c.average - anciano.score) < Math.abs(c.average - joven.score));
});

test('la media es exactamente la ponderada: dos ancianos y un joven', () => {
  const band = bandaCon([
    { age: 50, traits: { cautela: 1 } }, { age: 60, traits: { cautela: 1 } }, { age: 20, traits: { audacia: 1 } },
  ]);
  const c = evaluateConsensus(band, sitioRiesgoso());
  const pesos = c.votes.reduce((a, v) => a + v.weight, 0);
  const esperada = c.votes.reduce((a, v) => a + v.score * v.weight, 0) / pesos;
  assert.ok(Math.abs(c.average - esperada) < 1e-9);
  const sinPesos = c.votes.reduce((a, v) => a + v.score, 0) / c.votes.length;
  assert.ok(Math.abs(c.average - sinPesos) > 0.5, 'la media ponderada debe diferir de la simple');
});

test('un anciano pesa el doble y no el triple: media de un anciano y un joven', () => {
  const band = bandaCon([{ age: 50, traits: { cautela: 1 } }, { age: 20, traits: { audacia: 1 } }]);
  const c = evaluateConsensus(band, sitioRiesgoso());
  const [a, j] = [c.votes.find((v) => v.elder), c.votes.find((v) => !v.elder)];
  assert.ok(Math.abs(c.average - (2 * a.score + j.score) / 3) < 1e-9);
});

test('una banda sin adultos vivos no vota nada y no revienta', () => {
  const c = evaluateConsensus(bandaCon([{ age: 5 }, { age: 30, alive: false }]), sitioBueno());
  assert.deepEqual(c.votes, []);
  assert.deepEqual(c.dissenters, []);
  assert.equal(c.average, 0);
});

test('cada voto trae id, nombre, puntuación, anciano y peso', () => {
  const c = evaluateConsensus(bandaComoda(), sitioBueno());
  for (const v of c.votes) {
    assert.equal(typeof v.npcId, 'string');
    assert.ok(v.nombre.length > 0);
    assert.equal(typeof v.score, 'number');
    assert.equal(typeof v.elder, 'boolean');
    assert.ok(v.weight > 0);
  }
});

// --- Disidencia ---------------------------------------------------------------------------------
test('un NPC que se desvía más de 20 puntos queda registrado como disidente', () => {
  const c = evaluateConsensus(bandaPolarizada(), sitioRiesgoso());
  assert.ok(c.dissenters.length > 0);
  assert.ok(c.dissenters.every((d) => Math.abs(d.delta) > 20));
  assert.ok(c.dissenters.every((d) => typeof d.nombre === 'string' && d.nombre.length > 0));
  assert.ok(c.dissenters.every((d) => typeof d.npcId === 'string' && typeof d.score === 'number'));
});

test('quien no se desvía más de 20 puntos no es disidente, y el delta es puntuación menos media', () => {
  const c = evaluateConsensus(bandaPolarizada(), sitioRiesgoso());
  for (const v of c.votes) {
    const d = c.dissenters.find((x) => x.npcId === v.npcId);
    const delta = v.score - c.average;
    if (Math.abs(delta) > 20) {
      assert.ok(d, `${v.nombre} se desvía ${delta} y debe constar`);
      assert.ok(Math.abs(d.delta - delta) < 1e-9);
    } else {
      assert.equal(d, undefined, `${v.nombre} se desvía ${delta} y no debe constar`);
    }
  }
  // la prueba es significativa: hay disidentes y también quien no lo es
  assert.ok(c.dissenters.length > 0 && c.dissenters.length < c.votes.length);
});

test('una banda unánime no tiene disidentes', () => {
  const c = evaluateConsensus(bandaComoda(), sitioRiesgoso());
  assert.deepEqual(c.dissenters, []);
});

test('el disidente conserva su nombre propio', () => {
  const c = evaluateConsensus(bandaPolarizada(), sitioRiesgoso());
  assert.ok(c.dissenters.some((d) => d.nombre === 'Ilka'), JSON.stringify(c.dissenters));
});

// --- Puntuación personal ------------------------------------------------------------------------
test('sin rasgos, la puntuación personal es el total objetivo', () => {
  const s = sitioRiesgoso();
  assert.ok(Math.abs(npcSiteScore({ traits: NEUTRO }, s) - s.total) < 1e-9);
});

test('la cautela baja la puntuación de un sitio inundable; la audacia no', () => {
  const s = sitioRiesgoso();
  const cauto = npcSiteScore({ traits: { ...NEUTRO, cautela: 1 } }, s);
  assert.ok(cauto < s.total - 1, `${cauto} vs ${s.total}`);
});

test('la cautela premia un sitio seguro: defensa y refugio pesan más', () => {
  const { discovery, ctx, grid } = escena({ recursos: { caza: 30 } });
  for (const cell of grid.cells) if (Math.hypot(cell.x - C, cell.y - C) <= 3 && cell.x !== C + 2) { cell.biome = 'bosque'; }
  grid.at(C, C).elevation = 0.9;
  const s = scoreSite(discovery, C, C, ctx);
  const cauto = npcSiteScore({ traits: { ...NEUTRO, cautela: 1 } }, s);
  assert.ok(cauto > s.total + 0.5, `${cauto} vs ${s.total}`);
});

test('la audacia sube el peso de caza y piedra', () => {
  const { discovery, ctx } = escena({ recursos: { caza: 30, piedra: 30 } });
  const s = scoreSite(discovery, C, C, ctx);
  assert.ok(npcSiteScore({ traits: { ...NEUTRO, audacia: 1 } }, s) > s.total + 0.5);
  const { discovery: d2, ctx: c2 } = escena({ recursos: { forraje: 30 } });
  const s2 = scoreSite(d2, C, C, c2);
  assert.ok(Math.abs(npcSiteScore({ traits: { ...NEUTRO, audacia: 1 } }, s2) - s2.total) < 1e-9, 'sin caza ni piedra la audacia no cambia nada');
});

test('la sabiduría acerca la puntuación al total objetivo', () => {
  const s = sitioRiesgoso();
  const sin = npcSiteScore({ traits: { ...NEUTRO, cautela: 1 } }, s);
  const sabio = npcSiteScore({ traits: { ...NEUTRO, cautela: 1, sabiduria: 1 } }, s);
  assert.ok(Math.abs(sabio - s.total) < Math.abs(sin - s.total));
  assert.ok(Math.abs(sabio - s.total) > 1e-6 || Math.abs(sin - s.total) > 1e-6);
});

test('un sitio no viable vale 0 para todos y la puntuación personal se queda en 0..100', () => {
  const { discovery, ctx } = escena({ agua: false, recursos: { caza: 30 } });
  const malo = scoreSite(discovery, C, C, ctx);
  assert.equal(npcSiteScore({ traits: { cautela: 1, audacia: 1, sabiduria: 0 } }, malo), 0);
  const rico = scoreSite(...(() => { const e = escena({ recursos: { caza: 1e6, forraje: 1e6, leña: 1e6, piedra: 1e6 } }); return [e.discovery, C, C, e.ctx]; })());
  for (const t of [{ cautela: 1, audacia: 1, sabiduria: 0 }, { cautela: 0, audacia: 1, sabiduria: 0.3 }]) {
    const p = npcSiteScore({ traits: t }, rico);
    assert.ok(p >= 0 && p <= 100, `p = ${p}`);
  }
});

// --- Decisión -----------------------------------------------------------------------------------
test('una banda cómoda rechaza un sitio mediocre', () => {
  const d = decideSettlement(bandaComoda(), descubrimientoMediocre(), ctxVerano());
  assert.equal(d.settle, false);
  assert.ok(d.threshold > (d.site?.total ?? 0));
  assert.ok(d.site, 'hay un sitio candidato, solo que no basta');
});

// el sistema central del spec: el mismo sitio, dos bandas, dos resultados
test('una banda desesperada acepta el mismo sitio que una cómoda rechaza', () => {
  const disc = descubrimientoMediocre(), ctx = ctxVerano();
  const comoda = decideSettlement(bandaComoda(), disc, ctx);
  const desesperada = decideSettlement(bandaDesesperada(), disc, ctx);
  assert.equal(comoda.settle, false);
  assert.equal(desesperada.settle, true);
  assert.deepEqual([desesperada.site.x, desesperada.site.y], [comoda.site.x, comoda.site.y]);
  assert.ok(desesperada.threshold < comoda.threshold);
  assert.ok(desesperada.pressure > comoda.pressure);
});

test('la decisión informa la presión y el umbral reales', () => {
  const band = bandaDesesperada(), ctx = ctxVerano();
  const d = decideSettlement(band, descubrimientoMediocre(), ctx);
  assert.equal(d.pressure, bandPressure(band, ctx));
  assert.equal(d.threshold, acceptanceThreshold(d.pressure));
  assert.ok(d.consensus && Array.isArray(d.consensus.votes));
});

test('se asienta exactamente cuando la media alcanza el umbral', () => {
  const disc = descubrimientoMediocre(), ctx = ctxVerano();
  for (const band of [bandaComoda(), bandaDesesperada()]) {
    const d = decideSettlement(band, disc, ctx);
    assert.equal(d.settle, d.consensus.average >= d.threshold);
  }
});

test('barrido de presión: se asienta si y solo si la media alcanza el umbral, también cerca del límite', () => {
  const disc = descubrimientoMediocre(), ctx = ctxVerano();
  let cerca = 0; let si = 0; let no = 0;
  for (let hambre = 0; hambre <= 100; hambre += 2) {
    const band = bandaCon(ADULTOS);
    necesidades(band, { hambre, sed: hambre, frio: hambre / 2, moral: 100 - hambre });
    const d = decideSettlement(band, disc, ctx);
    assert.equal(d.settle, d.consensus.average >= d.threshold, `hambre ${hambre}`);
    if (d.threshold > d.consensus.average && d.threshold - d.consensus.average < 10) cerca++;
    if (d.settle) si++; else no++;
  }
  assert.ok(si > 0 && no > 0, 'el barrido debe cruzar el límite');
  assert.ok(cerca > 0, 'el barrido debe dejar casos cerca del límite por debajo');
});

test('una banda cómoda sí se asienta en un sitio que supera su umbral', () => {
  // Se baja la exigencia con el mismo sitio y la presión máxima de la banda hasta que el umbral queda por debajo.
  const disc = escena({ recursos: { caza: 1e6, forraje: 1e6, leña: 1e6, piedra: 1e6 } }).discovery;
  const band = bandaComoda();
  const d = decideSettlement(band, disc, ctxVerano());
  assert.ok(d.consensus.average >= d.threshold, `${d.consensus.average} vs ${d.threshold}`);
  assert.equal(d.settle, true);
});

test('nunca se asienta en un sitio no viable, ni con presión máxima', () => {
  const d = decideSettlement(bandaDesesperada(), descubrimientoSinAgua(), ctxVerano());
  assert.equal(d.settle, false);
});

test('sin sitios conocidos la decisión es negativa y explica por qué', () => {
  const d = decideSettlement(bandaComoda(), descubrimientoVacio(), ctxVerano());
  assert.equal(d.settle, false);
  assert.equal(d.site, null);
  assert.equal(d.consensus, null);
  assert.ok(d.reason.length > 0);
});

test('toda decisión trae una razón en español no vacía', () => {
  const disc = descubrimientoMediocre(), ctx = ctxVerano();
  const asentada = bandaComoda(); asentada.settled = true;
  const sinVotantes = bandaCon([{ age: 5 }]);
  const casos = [
    decideSettlement(bandaComoda(), disc, ctx),
    decideSettlement(bandaDesesperada(), disc, ctx),
    decideSettlement(bandaComoda(), descubrimientoVacio(), ctx),
    decideSettlement(bandaDesesperada(), descubrimientoSinAgua(), ctx),
    decideSettlement(asentada, disc, ctx),
    decideSettlement(sinVotantes, disc, ctx),
  ];
  for (const d of casos) {
    assert.equal(typeof d.reason, 'string');
    assert.ok(d.reason.trim().length > 10, `razón: "${d.reason}"`);
  }
});

test('la razón distingue la historia de la banda cómoda y la de la desesperada', () => {
  const disc = descubrimientoMediocre(), ctx = ctxVerano();
  const comoda = decideSettlement(bandaComoda(), disc, ctx);
  const desesperada = decideSettlement(bandaDesesperada(), disc, ctx);
  assert.notEqual(comoda.reason, desesperada.reason);
  assert.match(comoda.reason, /rechaz|descart|no basta|esper/i);
  assert.match(desesperada.reason, /no (puede|pueden)|necesidad|urge|apremia|aunque|sin esperar/i);
});

test('la razón nombra el factor decisivo al asentarse', () => {
  const disc = escena({ recursos: { caza: 1e6, forraje: 1e6, leña: 1e6, piedra: 1e6 } }).discovery;
  const d = decideSettlement(bandaComoda(), disc, ctxVerano());
  assert.equal(d.settle, true);
  const mejor = [...d.site.factors].sort((a, b) => b.contribution - a.contribution)[0];
  assert.ok(d.reason.includes(mejor.label.toLowerCase()), `"${d.reason}" debe nombrar ${mejor.label}`);
});

test('una banda ya asentada no vuelve a decidir', () => {
  const band = bandaComoda();
  band.settled = true;
  const d = decideSettlement(band, descubrimientoMediocre(), ctxVerano());
  assert.equal(d.settle, false);
  const desesperada = bandaDesesperada(); desesperada.settled = true;
  assert.equal(decideSettlement(desesperada, descubrimientoMediocre(), ctxVerano()).settle, false);
});

test('una banda sin adultos vivos no se asienta', () => {
  const d = decideSettlement(bandaCon([{ age: 5 }, { age: 30, alive: false }]), descubrimientoMediocre(), ctxVerano());
  assert.equal(d.settle, false);
});

test('decideSettlement es determinista', () => {
  const band = bandaComoda(), disc = descubrimientoMediocre(), ctx = ctxVerano();
  assert.deepEqual(decideSettlement(band, disc, ctx), decideSettlement(band, disc, ctx));
  const polar = bandaPolarizada();
  assert.deepEqual(decideSettlement(polar, disc, ctx), decideSettlement(polar, disc, ctx));
});

test('decideSettlement no consume azar ni cambia a la banda', () => {
  const band = bandaDesesperada(), disc = descubrimientoMediocre(), ctx = ctxVerano();
  const antes = JSON.stringify(band);
  const aleatorio = Math.random;
  Math.random = () => { throw new Error('decideSettlement no puede usar azar'); };
  try { decideSettlement(band, disc, ctx); } finally { Math.random = aleatorio; }
  assert.equal(JSON.stringify(band), antes);
});

test('decideSettlement no recibe ni usa un rng', () => {
  assert.equal(decideSettlement.length, 3);
  const fuente = codeOnly(readFileSync(new URL('../../src/tribe/consensus.js', import.meta.url), 'utf8'));
  assert.doesNotMatch(fuente, /\brng\b|createRng|\.chance\(|\.pick\(|\.int\(/);
});

// --- Sin lectura directa del mundo ----------------------------------------------------------------
test('el consenso solo lee el mundo por discovery: ni grid.at ni grid.cells', () => {
  const fuente = codeOnly(readFileSync(new URL('../../src/tribe/consensus.js', import.meta.url), 'utf8'));
  assert.doesNotMatch(fuente, /\.at\(/);
  assert.doesNotMatch(fuente, /\bcells\b/);
  assert.doesNotMatch(fuente, /forRadius/);
  assert.doesNotMatch(fuente, /viableSites/);
  for (const uso of fuente.matchAll(/\bgrid\b(?!\s*[,}:])\s*(\.\s*\w+)?/g)) {
    assert.ok(!uso[1] || /inBounds/.test(uso[1]), `uso prohibido de grid: ${uso[0]}`);
  }
});

test('una rejilla cuya lectura directa lanza no afecta a la decisión', () => {
  const ciego = {
    width: 25, height: 25, inBounds: () => true, forRadius() { throw new Error('forRadius'); },
    at() { throw new Error('grid.at'); }, get cells() { throw new Error('grid.cells'); },
  };
  const disc = descubrimientoMediocre();
  const d = decideSettlement(bandaDesesperada(), disc, { grid: ciego, season: 'verano' });
  assert.ok(d.reason.length > 0);
});

// --- Memoria de sitios abandonados --------------------------------------------------------------
test('una banda recién creada tiene memoria de abandonos vacía', () => {
  assert.deepEqual(createBand(createRng(1), { x: 1, y: 1 }).abandonedSites, []);
});

function mejorSitio(disc, band) {
  return decideSettlement(band, disc, ctxVerano()).site;
}

test('un sitio abandonado y todo su radio se excluyen de la propuesta', () => {
  const e = escena({ recursos: { caza: 8, forraje: 8, leña: 8, piedra: 8 }, rioLargo: true });
  const band = bandaComoda();
  const primero = mejorSitio(e.discovery, band);
  registrarAbandono(band, primero, e.discovery);
  const nuevo = mejorSitio(e.discovery, band);
  assert.ok(nuevo, 'sigue habiendo candidatos fuera del radio');
  assert.ok(Math.hypot(nuevo.x - primero.x, nuevo.y - primero.y) > RADIO_SITIO_ABANDONADO,
    `${nuevo.x},${nuevo.y} está a ${Math.hypot(nuevo.x - primero.x, nuevo.y - primero.y)} de ${primero.x},${primero.y}`);
});

test('la exclusión es un radio, no una coordenada: los vecinos inmediatos tampoco se proponen', () => {
  const e = escena({ recursos: { caza: 8, forraje: 8, leña: 8, piedra: 8 }, rioLargo: true });
  const band = bandaComoda();
  const primero = mejorSitio(e.discovery, band);
  registrarAbandono(band, primero, e.discovery);
  const vecinos = candidateSites(e.discovery, e.ctx, { limit: 3 }).filter((s) => s.x !== primero.x || s.y !== primero.y);
  assert.ok(vecinos.some((v) => Math.hypot(v.x - primero.x, v.y - primero.y) <= RADIO_SITIO_ABANDONADO),
    'el escenario debe tener vecinos cercanos con buena puntuación');
  assert.notDeepEqual([mejorSitio(e.discovery, band).x, mejorSitio(e.discovery, band).y], [vecinos[0].x, vecinos[0].y]);
});

test('el borde del radio: a 6 celdas se excluye, a 7 ya no (distancia euclídea)', () => {
  const band = bandaComoda();
  registrarAbandono(band, { x: 12, y: 12 }, { size: 100 });
  const fuera = sitiosExcluidos(band, { size: 100 });
  const tiene = (x, y) => fuera.some((c) => c.x === x && c.y === y);
  assert.equal(RADIO_SITIO_ABANDONADO, 6);
  assert.ok(tiene(12, 12) && tiene(18, 12) && tiene(12, 6) && tiene(8, 8), 'dentro del radio');
  assert.ok(!tiene(19, 12) && !tiene(12, 5), 'a 7 celdas ya no');
  assert.ok(tiene(16, 16) && !tiene(17, 16), 'la distancia es euclídea: (4,4) dentro, (5,4) fuera');
});

test('abandonar sitios sucesivos no hace buclear a la banda: cada propuesta es nueva y lejana', () => {
  const e = escena({ recursos: { caza: 8, forraje: 8, leña: 8, piedra: 8 }, rioLargo: true });
  const band = bandaComoda();
  const vistos = [];
  for (let i = 0; i < 4; i++) {
    const s = decideSettlement(band, e.discovery, e.ctx).site;
    if (!s) break;
    for (const previo of vistos) assert.ok(Math.hypot(s.x - previo.x, s.y - previo.y) > RADIO_SITIO_ABANDONADO);
    vistos.push(s);
    registrarAbandono(band, s, e.discovery);
  }
  assert.ok(vistos.length >= 2);
});

test('si todo lo conocido está excluido, no hay sitio y la razón lo explica', () => {
  const e = escena({ recursos: { caza: 8 }, reveal: 6 });
  const band = bandaComoda();
  for (let i = 0; i < 40; i++) {
    const s = decideSettlement(band, e.discovery, e.ctx).site;
    if (!s) break;
    registrarAbandono(band, s, e.discovery);
  }
  const d = decideSettlement(band, e.discovery, e.ctx);
  assert.equal(d.site, null);
  assert.equal(d.settle, false);
  assert.match(d.reason, /abandon|alcanz|descart/i);
});

test('un sitio abandonado vuelve a ser elegible cuando lo descubierto ha crecido lo bastante, no antes', () => {
  const e = escena({ recursos: { caza: 8, forraje: 8, leña: 8, piedra: 8 }, rioLargo: true, reveal: 8 });
  const band = bandaComoda();
  const primero = mejorSitio(e.discovery, band);
  registrarAbandono(band, primero, e.discovery);
  assert.notDeepEqual(mejorSitio(e.discovery, band) && [mejorSitio(e.discovery, band).x, mejorSitio(e.discovery, band).y], [primero.x, primero.y]);

  // crecimiento insuficiente: sigue excluido
  const antes = e.discovery.size;
  let r = 9;
  while (e.discovery.size - antes < CRECIMIENTO_PARA_REINTENTAR - 1 && r < 40) { e.discovery.reveal(C, C, r); r += 0.25; }
  assert.ok(e.discovery.size - antes <= CRECIMIENTO_PARA_REINTENTAR + 40);
  const crecido = e.discovery.size - antes;
  if (crecido < CRECIMIENTO_PARA_REINTENTAR) {
    const s = decideSettlement(band, e.discovery, e.ctx).site;
    assert.ok(s === null || Math.hypot(s.x - primero.x, s.y - primero.y) > RADIO_SITIO_ABANDONADO, 'antes de crecer lo bastante sigue excluido');
  }

  // crecimiento suficiente: ya puede volver a proponerse el mejor
  e.discovery.reveal(C, C, 24);
  assert.ok(e.discovery.size - antes >= CRECIMIENTO_PARA_REINTENTAR);
  const despues = decideSettlement(band, e.discovery, e.ctx).site;
  const mejorAhora = candidateSites(e.discovery, e.ctx, { limit: 1 })[0];
  assert.deepEqual([despues.x, despues.y], [mejorAhora.x, mejorAhora.y]);
});

test('el reintento se abre justo al crecer CRECIMIENTO_PARA_REINTENTAR celdas', () => {
  const band = bandaComoda();
  registrarAbandono(band, { x: 12, y: 12 }, { size: 400 });
  assert.ok(sitiosExcluidos(band, { size: 400 + CRECIMIENTO_PARA_REINTENTAR - 1 }).length > 0);
  assert.deepEqual(sitiosExcluidos(band, { size: 400 + CRECIMIENTO_PARA_REINTENTAR }), []);
});

test('registrarAbandono guarda coordenadas y tamaño de lo descubierto, y no duplica en memoria sin límite', () => {
  const e = escena();
  const band = bandaComoda();
  registrarAbandono(band, { x: 3, y: 4 }, e.discovery);
  assert.deepEqual(band.abandonedSites, [{ x: 3, y: 4, known: e.discovery.size }]);
  for (let i = 0; i < 200; i++) registrarAbandono(band, { x: i % 20, y: 1 }, e.discovery);
  assert.ok(band.abandonedSites.length <= 32);
});

test('una banda sin la propiedad abandonedSites (partida antigua) decide igual', () => {
  const band = bandaComoda();
  delete band.abandonedSites;
  const d = decideSettlement(band, descubrimientoMediocre(), ctxVerano());
  assert.ok(d.site);
});

// --- Cadencia -----------------------------------------------------------------------------------
test('considerSettlement no evalúa en cada tick: solo cada INTERVALO_EVALUACION', () => {
  const e = escena({ recursos: { caza: 2 } });
  const band = bandaComoda();
  let evaluaciones = 0;
  for (let tick = 1; tick <= 24 * 10; tick++) {
    const r = considerSettlement(band, e.discovery, e.ctx, tick);
    if (r) evaluaciones++;
  }
  assert.equal(evaluaciones, 10);
});

test('considerSettlement devuelve null y no toca a la banda entre evaluaciones', () => {
  const e = escena({ recursos: { caza: 2 } });
  const band = bandaComoda();
  assert.ok(considerSettlement(band, e.discovery, e.ctx, INTERVALO_EVALUACION));
  const fotografia = JSON.stringify(band);
  for (let tick = INTERVALO_EVALUACION + 1; tick < 2 * INTERVALO_EVALUACION; tick++) {
    assert.equal(considerSettlement(band, e.discovery, e.ctx, tick), null);
  }
  assert.equal(JSON.stringify(band), fotografia);
  assert.equal(band.lastEvaluation, INTERVALO_EVALUACION);
});

test('un salto de presión adelanta la evaluación, pero no antes de ESPERA_MINIMA', () => {
  const e = escena({ recursos: { caza: 2 } });
  const band = bandaComoda();
  assert.ok(considerSettlement(band, e.discovery, e.ctx, INTERVALO_EVALUACION));
  const t0 = INTERVALO_EVALUACION;
  necesidades(band, { hambre: 100, sed: 100, frio: 100, moral: 0 });
  assert.ok(bandPressure(band, e.ctx) - band.lastEvalPressure >= SALTO_PRESION);
  for (let t = t0 + 1; t < t0 + ESPERA_MINIMA; t++) assert.equal(considerSettlement(band, e.discovery, e.ctx, t), null, `tick ${t}`);
  assert.ok(considerSettlement(band, e.discovery, e.ctx, t0 + ESPERA_MINIMA));
  assert.equal(band.lastEvaluation, t0 + ESPERA_MINIMA);
});

test('una presión que sube poco no adelanta la evaluación', () => {
  const e = escena({ recursos: { caza: 2 } });
  const band = bandaComoda();
  assert.ok(considerSettlement(band, e.discovery, e.ctx, INTERVALO_EVALUACION));
  necesidades(band, { hambre: 10 });
  assert.ok(bandPressure(band, e.ctx) - band.lastEvalPressure < SALTO_PRESION);
  assert.equal(considerSettlement(band, e.discovery, e.ctx, INTERVALO_EVALUACION + ESPERA_MINIMA), null);
});

test('una banda asentada no se vuelve a evaluar nunca', () => {
  const e = escena({ recursos: { caza: 2 } });
  const band = bandaDesesperada(); band.settled = true;
  assert.equal(considerSettlement(band, e.discovery, e.ctx, 500), null);
});

test('al decidir asentarse, la banda fija el sitio y la crónica cuenta la razón', () => {
  const e = escena({ recursos: { caza: 1e6, forraje: 1e6, leña: 1e6, piedra: 1e6 } });
  const band = bandaComoda();
  const r = considerSettlement(band, e.discovery, e.ctx, INTERVALO_EVALUACION);
  assert.equal(r.decision.settle, true);
  assert.deepEqual(band.site && [band.site.x, band.site.y], [r.decision.site.x, r.decision.site.y]);
  assert.ok(r.chronicle.includes(r.decision.reason));
});

test('la crónica recuerda al disidente por su nombre', () => {
  const e = escena({ recursos: { caza: 30, forraje: 30, leña: 30, piedra: 30 }, pantano: 9 });
  const band = bandaPolarizada();
  necesidades(band, { hambre: 100, sed: 100, frio: 100, moral: 0 });
  band.recentDeaths = 3;
  const r = considerSettlement(band, e.discovery, e.ctx, INTERVALO_EVALUACION);
  assert.ok(r.decision.consensus.dissenters.length > 0);
  for (const d of r.decision.consensus.dissenters) {
    assert.ok(r.chronicle.some((linea) => linea.includes(d.nombre)), `falta ${d.nombre}`);
  }
});

test('un rechazo no fija sitio', () => {
  const e = escena({ recursos: { caza: 2, forraje: 2, leña: 2, piedra: 2 } });
  const band = bandaComoda();
  const r = considerSettlement(band, e.discovery, e.ctx, INTERVALO_EVALUACION);
  assert.equal(r.decision.settle, false);
  assert.equal(band.site, null);
  assert.ok(r.chronicle.length > 0);
});
