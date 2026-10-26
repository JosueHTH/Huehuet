import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRng } from '../../src/core/rng.js';
import { createClock } from '../../src/core/clock.js';
import { createGrid, BIOMES } from '../../src/world/grid.js';
import { RESOURCES } from '../../src/world/resources.js';
import { createDiscovery } from '../../src/world/discovery.js';
import { generateWorld } from '../../src/world/worldgen.js';
import { NEEDS, tickNeeds } from '../../src/agents/needs.js';
import { isElder, isAdult } from '../../src/agents/npc.js';
import { IDLE } from '../../src/agents/utility.js';
import {
  createBand, tickBand, bandPressure, isExtinct, livingNpcs, TICKS_HASTA_MORIR, INTENTOS_SIN_AVANCE,
} from '../../src/tribe/band.js';
import { ambientUses } from './purity.js';

// Rejilla 40x40 de pradera sin recursos, con la banda en el centro y 5 celdas descubiertas a su alrededor.
function escenaBanda({ hour = 12, tick, size = 7, reveal = 5, seed = 3 } = {}) {
  const grid = createGrid(40, 40);
  const discovery = createDiscovery(grid);
  discovery.reveal(20, 20, reveal);
  const band = createBand(createRng(seed), { x: 20, y: 20 }, { size });
  const clock = createClock({ tick: tick ?? hour });
  return { band, ctx: { grid, discovery, clock }, grid, discovery };
}

// Igual pero con una rejilla cuya lectura directa (at/cells) lanza: solo se puede mirar por discovery.
function sinLecturaDirecta(grid) {
  return {
    width: grid.width, height: grid.height, inBounds: grid.inBounds, forRadius: grid.forRadius,
    at() { throw new Error('lectura directa grid.at'); },
    get cells() { throw new Error('lectura directa grid.cells'); },
  };
}

const todos = (band, id, valor) => { for (const n of livingNpcs(band)) n.needs[id] = valor; };

test('createBand es determinista e incluye al menos un anciano y un adulto', () => {
  const a = createBand(createRng(3), { x: 5, y: 5 });
  const b = createBand(createRng(3), { x: 5, y: 5 });
  assert.deepEqual(a, b);
  assert.ok(a.npcs.some(isElder));
  assert.ok(a.npcs.filter(isAdult).length >= 2);
});

test('createBand: tamaño por defecto 7, campos iniciales, ids únicos y NPCs en el punto de partida', () => {
  const band = createBand(createRng(9), { x: 5, y: 6 });
  assert.equal(band.npcs.length, 7);
  assert.equal(createBand(createRng(9), { x: 1, y: 1 }, { size: 3 }).npcs.length, 3);
  assert.equal(band.x, 5);
  assert.equal(band.y, 6);
  assert.equal(band.settled, false);
  assert.equal(band.site, null);
  assert.equal(band.settlement, null);
  assert.equal(band.lastEvaluation, 0);
  for (const id of Object.keys(RESOURCES)) assert.equal(band.inventory[id], 0, id);
  assert.equal(new Set(band.npcs.map((n) => n.id)).size, 7);
  for (const n of band.npcs) assert.deepEqual([n.x, n.y], [5, 6]);
});

test('createBand compone a todos sus NPCs con un único rng: dos bandas del mismo rng no repiten ids', () => {
  const rng = createRng(11);
  const a = createBand(rng, { x: 0, y: 0 });
  const b = createBand(rng, { x: 0, y: 0 });
  const ids = [...a.npcs, ...b.npcs].map((n) => n.id);
  assert.equal(new Set(ids).size, 14);
});

test('createBand garantiza anciano y 2 adultos en muchas semillas', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const band = createBand(createRng(seed), { x: 0, y: 0 });
    assert.ok(band.npcs.some(isElder), `semilla ${seed}`);
    assert.ok(band.npcs.filter(isAdult).length >= 2, `semilla ${seed}`);
  }
});

test('bandPressure está en 0..1 y sube con el hambre', () => {
  const { band } = escenaBanda();
  const baja = bandPressure(band, { season: 'verano' });
  for (const n of livingNpcs(band)) n.needs.hambre = 95;
  const alta = bandPressure(band, { season: 'verano' });
  assert.ok(baja >= 0 && alta <= 1);
  assert.ok(alta > baja);
});

test('bandPressure sube al acercarse el invierno', () => {
  const { band } = escenaBanda();
  const verano = bandPressure(band, { season: 'verano' });
  const otoño = bandPressure(band, { season: 'otoño' });
  assert.ok(otoño > verano);
  assert.ok(bandPressure(band, { season: 'invierno' }) >= otoño);
});

test('bandPressure sube con la sed, el frío, la moral baja y las muertes recientes', () => {
  const base = (mut) => {
    const { band } = escenaBanda();
    mut(band);
    return bandPressure(band, { season: 'primavera' });
  };
  const neutra = base(() => {});
  assert.ok(base((b) => todos(b, 'sed', 95)) > neutra, 'sed');
  assert.ok(base((b) => todos(b, 'frio', 95)) > neutra, 'frio');
  assert.ok(base((b) => todos(b, 'moral', 5)) > neutra, 'moral');
  assert.ok(base((b) => { b.npcs[0].alive = false; b.recentDeaths = 2; }) > neutra, 'muertes');
});

test('bandPressure ignora a los muertos y está acotada con todo al máximo; una banda extinta da 1', () => {
  const { band } = escenaBanda();
  const antes = bandPressure(band, { season: 'verano' });
  band.npcs[0].alive = false;
  band.npcs[0].needs.hambre = 100; // un muerto no cuenta en la media
  band.npcs[0].needs.sed = 100;
  assert.equal(bandPressure(band, { season: 'verano' }), antes);
  for (const id of ['hambre', 'sed', 'frio']) todos(band, id, 100);
  todos(band, 'moral', 0);
  band.recentDeaths = 1000;
  const max = bandPressure(band, { season: 'invierno' });
  assert.ok(max <= 1 && max > 0.9, `max = ${max}`);
  for (const n of band.npcs) n.alive = false;
  assert.equal(bandPressure(band, { season: 'verano' }), 1);
});

test('un NPC con hambre sostenida en 100 muere', () => {
  const { band, ctx } = escenaBanda();
  const victima = livingNpcs(band)[0];
  for (let i = 0; i < 2000 && victima.alive; i++) {
    victima.needs.hambre = 100;
    tickBand(band, ctx, createRng(i));
  }
  assert.equal(victima.alive, false);
});

test('la muerte exige saturación sostenida: sobrevive el umbral y muere pasado el umbral', () => {
  for (const necesidad of ['hambre', 'sed', 'frio']) {
    const { band, ctx } = escenaBanda({ hour: 2 }); // de noche el frío sube y 100 se sostiene
    const victima = livingNpcs(band)[0];
    for (let i = 0; i < TICKS_HASTA_MORIR; i++) {
      victima.needs[necesidad] = 100;
      tickBand(band, ctx, createRng(i));
      assert.equal(victima.alive, true, `${necesidad} murió en el tick ${i + 1}`);
    }
    victima.needs[necesidad] = 100;
    const cronica = tickBand(band, ctx, createRng(99));
    assert.equal(victima.alive, false, necesidad);
    assert.ok(cronica.some((t) => t.includes(victima.nombre)), `crónica de ${necesidad}`);
  }
});

test('tocar 100 un solo tick no mata: la cuenta se recupera cuando la necesidad baja', () => {
  const { band, ctx } = escenaBanda();
  const npc = livingNpcs(band)[0];
  for (let ciclo = 0; ciclo < 5; ciclo++) {
    for (let i = 0; i < TICKS_HASTA_MORIR - 1; i++) {
      npc.needs.hambre = 0; npc.needs.frio = 0; npc.needs.sed = 100;
      tickBand(band, ctx, createRng(i));
    }
    for (let i = 0; i < TICKS_HASTA_MORIR; i++) { // se recupera
      npc.needs.hambre = 0; npc.needs.frio = 0; npc.needs.sed = 0;
      tickBand(band, ctx, createRng(i));
    }
  }
  assert.equal(npc.alive, true);
});

test('una muerte se anota en la crónica una sola vez, sube las muertes recientes y se desvanece', () => {
  const { band, ctx } = escenaBanda();
  const victima = livingNpcs(band)[0];
  let muertes = 0;
  for (let i = 0; i < TICKS_HASTA_MORIR + 20; i++) {
    victima.needs.hambre = 100;
    muertes += tickBand(band, ctx, createRng(i)).filter((t) => t.includes('murió')).length;
  }
  assert.equal(muertes, 1);
  const justo = band.recentDeaths;
  assert.ok(justo > 0);
  for (let i = 0; i < 200; i++) {
    for (const n of livingNpcs(band)) { n.needs.hambre = 0; n.needs.sed = 0; n.needs.frio = 0; }
    tickBand(band, ctx, createRng(i));
  }
  assert.ok(band.recentDeaths < justo);
  assert.ok(band.recentDeaths >= 0);
});

test('isExtinct solo es verdadero sin NPCs vivos', () => {
  const { band } = escenaBanda();
  assert.equal(isExtinct(band), false);
  for (const n of band.npcs.slice(1)) n.alive = false;
  assert.equal(isExtinct(band), false); // queda uno
  assert.equal(livingNpcs(band).length, 1);
  band.npcs[0].alive = false;
  assert.equal(isExtinct(band), true);
  assert.deepEqual(livingNpcs(band), []);
});

test('tickBand sobre una banda extinta no lanza y no produce crónica', () => {
  const { band, ctx } = escenaBanda();
  for (const n of band.npcs) n.alive = false;
  const antes = JSON.stringify([band, ctx.discovery.toJSON()]);
  assert.deepEqual(tickBand(band, ctx, createRng(1)), []);
  assert.equal(JSON.stringify([band, ctx.discovery.toJSON()]), antes, 'una banda extinta no camina ni descubre');
});

test('una banda nómada se mueve con el tiempo; una asentada no', () => {
  const { band, ctx } = escenaBanda();
  const origen = { x: band.x, y: band.y };
  for (let i = 0; i < 200; i++) tickBand(band, ctx, createRng(i));
  assert.ok(band.x !== origen.x || band.y !== origen.y);

  const { band: fija, ctx: ctx2 } = escenaBanda();
  fija.settled = true; fija.site = { x: fija.x, y: fija.y };
  const quieta = { x: fija.x, y: fija.y };
  for (let i = 0; i < 200; i++) tickBand(fija, ctx2, createRng(i));
  assert.deepEqual({ x: fija.x, y: fija.y }, quieta);
});

test('una banda asentada no se mueve aunque su sitio esté lejos', () => {
  const { band, ctx } = escenaBanda({ reveal: 15 });
  band.settled = true; band.site = { x: 30, y: 20 };
  for (let i = 0; i < 200; i++) tickBand(band, ctx, createRng(i));
  assert.deepEqual([band.x, band.y], [20, 20]);
});

test('la banda nómada avanza de a una celda y hacia la frontera de lo descubierto', () => {
  const { band, ctx } = escenaBanda();
  let previa = { x: band.x, y: band.y };
  let saltos = 0;
  for (let i = 0; i < 300; i++) {
    tickBand(band, ctx, createRng(i));
    assert.ok(Math.abs(band.x - previa.x) <= 1 && Math.abs(band.y - previa.y) <= 1, 'un solo paso');
    if (band.x !== previa.x || band.y !== previa.y) saltos++;
    previa = { x: band.x, y: band.y };
  }
  assert.ok(saltos >= 10, `saltos = ${saltos}`);
  assert.ok(ctx.discovery.size > 80, 'al caminar la banda descubre terreno');
  // Se ha alejado del origen.
  assert.ok(Math.max(Math.abs(band.x - 20), Math.abs(band.y - 20)) >= 5);
});

test('con band.site fijado y sin asentar, la banda se dirige allí y se detiene', () => {
  const { band, ctx } = escenaBanda({ reveal: 15 });
  band.site = { x: 28, y: 14 };
  for (let i = 0; i < 400; i++) tickBand(band, ctx, createRng(i));
  assert.deepEqual([band.x, band.y], [28, 14]);
});

test('una banda en un mundo ya descubierto por completo termina y no se mueve', () => {
  const { band, ctx, discovery } = escenaBanda();
  discovery.reveal(20, 20, 100);
  assert.equal(discovery.size, 1600);
  for (let i = 0; i < 100; i++) tickBand(band, ctx, createRng(i));
  assert.deepEqual([band.x, band.y], [20, 20]);
});

test('una banda rodeada de agua no se mueve ni se cuelga', () => {
  const { band, ctx, grid, discovery } = escenaBanda({ reveal: 6 });
  for (const celda of grid.cells) {
    if (Math.max(Math.abs(celda.x - 20), Math.abs(celda.y - 20)) === 1) celda.biome = 'agua';
  }
  for (let i = 0; i < 100; i++) tickBand(band, ctx, createRng(i));
  assert.deepEqual([band.x, band.y], [20, 20]);
  assert.ok(discovery.size > 0);
});

test('la banda rodea una laguna en vez de cruzarla', () => {
  const { band, ctx, grid } = escenaBanda({ reveal: 15 });
  for (const celda of grid.cells) {
    if (celda.x === 24 && celda.y >= 10 && celda.y <= 30) celda.biome = 'agua';
  }
  band.site = { x: 28, y: 20 };
  for (let i = 0; i < 600; i++) {
    tickBand(band, ctx, createRng(i));
    assert.notEqual(grid.at(band.x, band.y).biome, 'agua');
  }
  assert.deepEqual([band.x, band.y], [28, 20]);
});

test('la banda nunca sale de la rejilla ni entra en agua profunda', () => {
  const { band, ctx } = escenaBanda();
  for (let i = 0; i < 1000; i++) {
    tickBand(band, ctx, createRng(i));
    assert.ok(ctx.grid.inBounds(band.x, band.y));
    assert.notEqual(ctx.grid.at(band.x, band.y).biome, 'agua');
  }
});

test('en un mundo generado la banda respeta rejilla, agua y terreno descubierto', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const mundo = generateWorld(seed);
    const discovery = createDiscovery(mundo.grid);
    discovery.reveal(mundo.start.x, mundo.start.y, 6);
    const band = createBand(createRng(seed), mundo.start);
    const ctx = { grid: mundo.grid, discovery, clock: createClock({ tick: 12 }) };
    for (let i = 0; i < 600; i++) {
      tickBand(band, ctx, createRng(i));
      assert.ok(mundo.grid.inBounds(band.x, band.y), `semilla ${seed}`);
      assert.notEqual(mundo.grid.at(band.x, band.y).biome, 'agua', `semilla ${seed}`);
      assert.ok(discovery.isKnown(band.x, band.y), `semilla ${seed} pisó terreno desconocido`);
    }
  }
});

test('un sitio fuera de la rejilla no arrastra a la banda fuera', () => {
  const { band, ctx } = escenaBanda({ reveal: 25 });
  band.site = { x: -5, y: 20 };
  for (let i = 0; i < 400; i++) {
    tickBand(band, ctx, createRng(i));
    assert.ok(ctx.grid.inBounds(band.x, band.y));
  }
});

test('el borde de la rejilla no cuenta como frontera: con todo descubierto, la banda del borde no se mueve', () => {
  const { band, ctx, discovery } = escenaBanda();
  discovery.reveal(20, 20, 100); // todo descubierto
  band.x = 0; band.y = 0;
  for (let i = 0; i < 50; i++) tickBand(band, ctx, createRng(i));
  assert.deepEqual([band.x, band.y], [0, 0]);
});

test('la banda solo lee el mundo a través de discovery: grid.at y grid.cells no se tocan', () => {
  const { band, ctx, grid } = escenaBanda({ reveal: 8 });
  const ciego = { ...ctx, grid: sinLecturaDirecta(grid) };
  band.site = { x: 24, y: 20 };
  for (let i = 0; i < 100; i++) tickBand(band, ciego, createRng(i));
  const { band: b2, ctx: c2, grid: g2 } = escenaBanda();
  for (let i = 0; i < 100; i++) tickBand(b2, { ...c2, grid: sinLecturaDirecta(g2) }, createRng(i));
  assert.ok(b2.x !== 20 || b2.y !== 20);
});

test('tickBand no llama a apply cuando se elige IDLE y esa acción cuenta como no trabajar', () => {
  const { band, ctx } = escenaBanda();
  const apply = IDLE.apply;
  let llamadas = 0;
  IDLE.apply = () => { llamadas++; return null; };
  try {
    const cronica = tickBand(band, ctx, createRng(1), []);
    assert.deepEqual(cronica, []);
  } finally {
    IDLE.apply = apply;
  }
  assert.equal(llamadas, 0);
  for (const n of band.npcs) assert.equal(n.action, IDLE.id);
});

test('tickBand asigna npc.action con la acción elegida', () => {
  const { band, ctx } = escenaBanda();
  tickBand(band, ctx, createRng(1));
  for (const n of band.npcs) assert.equal(typeof n.action, 'string');
});

test('ctx.working sale de npc.action: solo las cinco labores añaden 0.5 de hambre', () => {
  const hambreTrasUnTick = (accionPrevia) => {
    const { band, ctx } = escenaBanda({ size: 2 });
    const npc = band.npcs[0];
    npc.action = accionPrevia;
    npc.needs.hambre = 50;
    tickBand(band, ctx, createRng(1), []); // IDLE: la acción nueva no altera el hambre
    return npc.needs.hambre;
  };
  const reposo = hambreTrasUnTick('descansar');
  for (const accion of ['construir', 'talar', 'recoger_piedra', 'cazar', 'forrajear']) {
    assert.equal(hambreTrasUnTick(accion) - reposo, 0.5, accion);
  }
  for (const accion of ['beber', 'descansar', 'explorar', 'seguir', 'esperar', null]) {
    assert.equal(hambreTrasUnTick(accion), reposo, String(accion));
  }
});

test('las necesidades de los NPCs se mantienen en 0..100 durante la simulación', () => {
  const { band, ctx } = escenaBanda();
  for (let i = 0; i < 500; i++) {
    tickBand(band, ctx, createRng(i));
    for (const n of band.npcs) for (const { id } of NEEDS) assert.ok(n.needs[id] >= 0 && n.needs[id] <= 100);
  }
});

test('tickBand es determinista con la misma semilla', () => {
  const correr = () => {
    const { band, ctx } = escenaBanda();
    const cronica = [];
    for (let i = 0; i < 300; i++) cronica.push(...tickBand(band, ctx, createRng(i)));
    return JSON.stringify([band, cronica, ctx.discovery.toJSON()]);
  };
  assert.equal(correr(), correr());
});

test('src/tribe no usa APIs ambientales ni aleatoriedad global', () => {
  const dir = new URL('../../src/tribe/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const hallazgos = ambientUses(readFileSync(new URL(f, dir), 'utf8'));
    assert.deepEqual(hallazgos, [], `${f} usa ${hallazgos.join(', ')}`);
  }
});

test('el nómada avanza como mucho una celda cada pocos ticks con un reloj que corre', () => {
  const { band, ctx } = escenaBanda({ reveal: 15 });
  ctx.clock = createClock({ tick: 1, msPerTick: 1 });
  band.site = { x: 38, y: 20 };
  let pasos = 0;
  for (let i = 0; i < 60; i++) {
    const antes = [band.x, band.y];
    tickBand(band, ctx, createRng(i));
    ctx.clock.advance(1, 1);
    if (band.x !== antes[0] || band.y !== antes[1]) pasos++;
  }
  assert.ok(pasos >= 5 && pasos <= 15, `pasos = ${pasos}`); // ~ 1 cada 6 ticks, no 1 por tick
});

test('un sitio en terreno sin descubrir es inalcanzable: la banda no pisa lo que no ha visto', () => {
  const { band, ctx } = escenaBanda({ reveal: 5 });
  band.site = { x: 30, y: 20 };
  for (let i = 0; i < INTENTOS_SIN_AVANCE - 1; i++) { // antes de rendirse
    tickBand(band, ctx, createRng(i), []); // sin acciones: nadie explora
    assert.ok(ctx.discovery.isKnown(band.x, band.y));
  }
  assert.deepEqual([band.x, band.y], [20, 20]);
});

// --- Refugio por bioma ---

test('sheltered sale del bioma: en bosque el frío sube menos que en tundra, exactamente como con refugio', () => {
  const frioTrasUnTick = (biome) => {
    const { band, ctx, grid } = escenaBanda({ hour: 2, size: 2 });
    for (const celda of grid.cells) celda.biome = biome;
    const npc = band.npcs[0];
    npc.action = null;
    npc.needs.frio = 50;
    const previas = { ...npc.needs };
    tickBand(band, ctx, createRng(1), []);
    return { real: npc.needs.frio, previas };
  };
  const ctxNeeds = (biome, sheltered) => ({ hour: 2, season: 'primavera', biome, walking: false, working: false, nearFire: false, sheltered });
  const bosque = frioTrasUnTick('bosque');
  const tundra = frioTrasUnTick('tundra');
  assert.equal(bosque.real, tickNeeds(bosque.previas, ctxNeeds('bosque', true)).frio);
  assert.equal(tundra.real, tickNeeds(tundra.previas, ctxNeeds('tundra', false)).frio);
  assert.ok(bosque.real < tundra.real);
  // Una colina (shelter 0.4) no alcanza el umbral de refugio.
  const colina = frioTrasUnTick('colina');
  assert.equal(colina.real, tickNeeds(colina.previas, ctxNeeds('colina', false)).frio);
});

// --- Sitio inalcanzable ---

function correrConReloj(band, ctx, ticks) {
  ctx.clock = createClock({ tick: 1, msPerTick: 1 });
  const cronica = [];
  for (let i = 0; i < ticks; i++) {
    for (const n of livingNpcs(band)) { n.needs.hambre = 0; n.needs.sed = 0; n.needs.frio = 0; } // sin muertes por hambre
    cronica.push(...tickBand(band, ctx, createRng(i), []));
    ctx.clock.advance(1, 1);
  }
  return cronica;
}

test('un sitio inalcanzable se abandona: la banda lo anota en la crónica y vuelve a explorar', () => {
  const { band, ctx } = escenaBanda({ reveal: 6 });
  band.site = { x: 35, y: 20 }; // sin descubrir: no hay camino
  const cronica = correrConReloj(band, ctx, 300);
  const lineas = cronica.filter((t) => t.includes('no logra llegar'));
  assert.equal(lineas.length, 1);
  assert.equal(band.site, null);
  assert.ok(ctx.discovery.size > 200, 'retomó la exploración de la frontera');
  assert.ok(Math.max(Math.abs(band.x - 20), Math.abs(band.y - 20)) >= 5);
});

test('un sitio al otro lado de agua que no se puede rodear se abandona', () => {
  const { band, ctx, grid } = escenaBanda({ reveal: 15 });
  for (const celda of grid.cells) if (celda.x === 24) celda.biome = 'agua'; // muro de lado a lado
  band.site = { x: 28, y: 20 };
  const cronica = correrConReloj(band, ctx, 200);
  assert.equal(cronica.filter((t) => t.includes('no logra llegar')).length, 1);
  assert.equal(band.site, null);
});

test('un sitio alcanzable no se abandona aunque exija un rodeo largo que aleja de él', () => {
  const { band, ctx, grid } = escenaBanda({ reveal: 30 });
  for (const celda of grid.cells) if (celda.x === 24 && celda.y >= 2 && celda.y <= 37) celda.biome = 'agua';
  band.site = { x: 28, y: 20 }; // el rodeo sube hasta y=1: ~19 celdas de distancia en línea recta
  const cronica = correrConReloj(band, ctx, 900);
  assert.deepEqual(cronica.filter((t) => t.includes('no logra llegar')), []);
  assert.deepEqual([band.x, band.y], [28, 20]);
  assert.deepEqual(band.site, { x: 28, y: 20 });
});

test('una banda llegada a su sitio no se rinde por quedarse quieta', () => {
  const { band, ctx } = escenaBanda({ reveal: 15 });
  band.site = { x: 22, y: 20 };
  const cronica = correrConReloj(band, ctx, 300);
  assert.deepEqual(cronica.filter((t) => t.includes('no logra llegar')), []);
  assert.deepEqual([band.x, band.y], [22, 20]);
});
