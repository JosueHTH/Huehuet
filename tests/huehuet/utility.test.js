import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRng } from '../../src/core/rng.js';
import { createClock } from '../../src/core/clock.js';
import { createGrid } from '../../src/world/grid.js';
import { RESOURCES } from '../../src/world/resources.js';
import { createDiscovery } from '../../src/world/discovery.js';
import { createNpc } from '../../src/agents/npc.js';
import { createNeeds } from '../../src/agents/needs.js';
import { ACTIONS } from '../../src/agents/actions.js';
import { chooseAction } from '../../src/agents/utility.js';

// Recursos que la celda central lleva de serie según su bioma (a tope, como un lugar sin explotar).
const RECURSOS_DE = {
  agua: ['agua'],
  rio: ['agua'],
  pantano: ['agua', 'forraje'],
  pradera: ['caza', 'forraje'],
  bosque: ['caza', 'forraje', 'leña'],
  colina: ['piedra'],
  montaña: ['piedra', 'pedernal'],
  tundra: ['caza'],
};

function npcCon(traits, needs = {}) {
  const npc = createNpc(createRng(7), { x: 16, y: 16 });
  npc.traits = { cautela: 0.5, audacia: 0.5, sabiduria: 0.5, ...traits };
  npc.needs = createNeeds(needs);
  return npc;
}

function escenaJunto(biome, needs = {}, clock = {}) {
  const grid = createGrid(32, 32);
  const celda = grid.at(16, 16);
  celda.biome = biome;
  for (const id of RECURSOS_DE[biome]) celda.resources[id] = RESOURCES[id].max;
  const discovery = createDiscovery(grid);
  discovery.reveal(16, 16, 5);
  const npc = npcCon({}, needs);
  const band = { npcs: [npc], inventory: {}, x: 16, y: 16, settled: false, site: null, lastEvaluation: 0 };
  const ctx = { grid, discovery, clock: createClock({ tick: clock.hour ?? 12 }) };
  return { npc, band, ctx };
}

const accion = (id) => ACTIONS.find((a) => a.id === id);

test('el catálogo tiene exactamente los ids de la Etapa 1, en orden, con etiqueta en español', () => {
  assert.deepEqual(ACTIONS.map((a) => a.id), [
    'beber', 'forrajear', 'cazar', 'talar', 'recoger_piedra', 'descansar', 'explorar', 'seguir', 'construir',
  ]);
  for (const a of ACTIONS) {
    assert.ok(typeof a.label === 'string' && a.label.length > 0, a.id);
    assert.equal(typeof a.score, 'function');
    assert.equal(typeof a.apply, 'function');
  }
});

test('un NPC sediento junto al agua elige beber', () => {
  const { npc, band, ctx } = escenaJunto('rio', { sed: 95 });
  assert.equal(chooseAction(npc, band, ctx).id, 'beber');
});

test('un NPC hambriento sin sed elige buscar comida', () => {
  const { npc, band, ctx } = escenaJunto('bosque', { hambre: 95, sed: 5 });
  assert.ok(['cazar', 'forrajear'].includes(chooseAction(npc, band, ctx).id));
});

test('un NPC agotado de noche elige descansar', () => {
  const { npc, band, ctx } = escenaJunto('bosque', { fatiga: 98, hambre: 10, sed: 10 }, { hour: 2 });
  assert.equal(chooseAction(npc, band, ctx).id, 'descansar');
});

test('un NPC audaz sin necesidades urgentes explora más que uno cauto', () => {
  const { band, ctx } = escenaJunto('pradera', {});
  const audaz = npcCon({ audacia: 1, cautela: 0 });
  const cauto = npcCon({ audacia: 0, cautela: 1 });
  const explorar = accion('explorar');
  assert.ok(explorar.score(audaz, band, ctx) > explorar.score(cauto, band, ctx));
});

test('toda acción devuelve una puntuación numérica finita y no negativa', () => {
  const { npc, band, ctx } = escenaJunto('tundra', { hambre: 50, sed: 50, frio: 50, fatiga: 50 });
  for (const a of ACTIONS) {
    const s = a.score(npc, band, ctx);
    assert.ok(Number.isFinite(s) && s >= 0, `${a.id} -> ${s}`);
  }
});

test('las puntuaciones siguen siendo finitas y no negativas con necesidades extremas', () => {
  for (const valor of [0, 100]) {
    for (const biome of Object.keys(RECURSOS_DE)) {
      const { npc, band, ctx } = escenaJunto(biome, { hambre: valor, sed: valor, frio: valor, fatiga: valor, moral: valor });
      for (const a of ACTIONS) {
        const s = a.score(npc, band, ctx);
        assert.ok(Number.isFinite(s) && s >= 0, `${a.id}/${biome}/${valor} -> ${s}`);
      }
    }
  }
});

test('chooseAction es determinista ante empates', () => {
  const { npc, band, ctx } = escenaJunto('pradera', {});
  const a = chooseAction(npc, band, ctx).id;
  for (let i = 0; i < 10; i++) assert.equal(chooseAction(npc, band, ctx).id, a);
});

test('chooseAction elige la mayor puntuación y, en empate, la primera del catálogo', () => {
  const { npc, band, ctx } = escenaJunto('pradera', {});
  const fija = (id, s) => ({ id, label: id, score: () => s, apply: () => null });
  assert.equal(chooseAction(npc, band, ctx, [fija('a', 1), fija('b', 9), fija('c', 3)]).id, 'b');
  assert.equal(chooseAction(npc, band, ctx, [fija('a', 5), fija('b', 5), fija('c', 5)]).id, 'a');
  assert.equal(chooseAction(npc, band, ctx, [fija('a', 2), fija('b', 7), fija('c', 7)]).id, 'b');
  assert.equal(chooseAction(npc, band, ctx, [fija('a', 0), fija('b', 0)]).id, 'a');
});

test('chooseAction no consume el rng ni modifica al NPC', () => {
  const { npc, band, ctx } = escenaJunto('rio', { sed: 80 });
  const antes = JSON.stringify([npc, band]);
  chooseAction(npc, band, ctx);
  assert.equal(JSON.stringify([npc, band]), antes);
});

test('la urgencia crece más que linealmente: sed 90 puntúa más del doble que sed 45', () => {
  const alta = escenaJunto('rio', { sed: 90 });
  const media = escenaJunto('rio', { sed: 45 });
  const beber = accion('beber');
  assert.ok(beber.score(alta.npc, alta.band, alta.ctx) > 2 * beber.score(media.npc, media.band, media.ctx));
});

test('las necesidades mandan: sed y fatiga cambian la puntuación, no un valor fijo', () => {
  const { band, ctx } = escenaJunto('rio', {});
  const serena = npcCon({}, { sed: 5, fatiga: 5 });
  const sedienta = npcCon({}, { sed: 95, fatiga: 5 });
  const cansada = npcCon({}, { sed: 5, fatiga: 95 });
  assert.ok(accion('beber').score(sedienta, band, ctx) > accion('beber').score(serena, band, ctx));
  assert.ok(accion('descansar').score(cansada, band, ctx) > accion('descansar').score(serena, band, ctx));
});

test('un NPC desesperado antepone sobrevivir a explorar', () => {
  const { npc, band, ctx } = escenaJunto('rio', { sed: 90 });
  const audaz = { ...npc, traits: { cautela: 0, audacia: 1, sabiduria: 0.5 } };
  assert.equal(chooseAction(audaz, band, ctx).id, 'beber');
});

test('sin agua conocida a su alcance, beber puntúa 0 aunque haya sed', () => {
  const { npc, band, ctx } = escenaJunto('pradera', { sed: 100 });
  assert.equal(accion('beber').score(npc, band, ctx), 0);
});

test('el agua junto al NPC pero nunca descubierta no cuenta', () => {
  const grid = createGrid(32, 32);
  grid.at(17, 16).biome = 'rio';
  grid.at(17, 16).resources.agua = 10;
  const discovery = createDiscovery(grid); // no se revela nada
  const npc = npcCon({}, { sed: 100 });
  const band = { npcs: [npc], inventory: {}, x: 16, y: 16, settled: false, site: null, lastEvaluation: 0 };
  const ctx = { grid, discovery, clock: createClock({ tick: 12 }) };
  assert.equal(accion('beber').score(npc, band, ctx), 0);
  assert.ok(accion('beber').apply(npc, band, ctx, createRng(1)) === null);
  assert.equal(npc.needs.sed, 100);
  discovery.reveal(16, 16, 2);
  assert.ok(accion('beber').score(npc, band, ctx) > 0);
});

test('sin recursos a su alcance las acciones de recolección puntúan 0', () => {
  const { npc, band, ctx } = escenaJunto('tundra', { hambre: 100, frio: 100 });
  ctx.grid.at(16, 16).resources.caza = 0;
  for (const id of ['forrajear', 'cazar', 'talar', 'recoger_piedra']) {
    assert.equal(accion(id).score(npc, band, ctx), 0, id);
  }
});

test('seguir y construir puntúan 0 si el NPC ya está en la banda y no hay obra', () => {
  const { npc, band, ctx } = escenaJunto('bosque', { frio: 100 });
  assert.equal(accion('seguir').score(npc, band, ctx), 0);
  assert.equal(accion('construir').score(npc, band, ctx), 0);
});

test('beber reduce la sed y no agota el río', () => {
  const { npc, band, ctx } = escenaJunto('rio', { sed: 90 });
  accion('beber').apply(npc, band, ctx, createRng(1));
  assert.ok(npc.needs.sed < 90);
  assert.equal(ctx.grid.at(16, 16).resources.agua, RESOURCES.agua.max);
});

test('beber nunca saca la sed de 0..100 ni deja de ser un número', () => {
  const { npc, band, ctx } = escenaJunto('rio', { sed: 3 });
  accion('beber').apply(npc, band, ctx, createRng(1));
  assert.equal(npc.needs.sed, 0);
});

test('forrajear reduce el hambre y descuenta forraje de la celda', () => {
  const { npc, band, ctx } = escenaJunto('bosque', { hambre: 80 });
  const celda = ctx.grid.at(16, 16);
  accion('forrajear').apply(npc, band, ctx, createRng(1));
  assert.ok(npc.needs.hambre < 80);
  assert.ok(celda.resources.forraje < RESOURCES.forraje.max);
});

test('cazar con éxito reduce el hambre, descuenta caza y deja crónica; sin éxito, nada cambia', () => {
  let exitos = 0;
  let fallos = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { npc, band, ctx } = escenaJunto('bosque', { hambre: 80 });
    const celda = ctx.grid.at(16, 16);
    const texto = accion('cazar').apply(npc, band, ctx, createRng(seed));
    if (npc.needs.hambre < 80) {
      exitos++;
      assert.equal(typeof texto, 'string');
      assert.ok(texto.length > 0);
      assert.ok(celda.resources.caza < RESOURCES.caza.max);
    } else {
      fallos++;
      assert.equal(texto, null);
      assert.equal(celda.resources.caza, RESOURCES.caza.max);
    }
  }
  assert.ok(exitos > 0 && fallos > 0, `éxitos ${exitos}, fallos ${fallos}`);
});

test('talar añade leña al inventario de la banda y la descuenta de la celda', () => {
  const { npc, band, ctx } = escenaJunto('bosque', {});
  const celda = ctx.grid.at(npc.x, npc.y);
  celda.resources.leña = 10;
  const antes = band.inventory.leña ?? 0;
  accion('talar').apply(npc, band, ctx, createRng(1));
  assert.ok(band.inventory.leña > antes);
  assert.ok(celda.resources.leña < 10);
  assert.equal(band.inventory.leña - antes, 10 - celda.resources.leña);
});

test('recoger_piedra añade piedra al inventario y la descuenta de la celda', () => {
  const { npc, band, ctx } = escenaJunto('colina', {});
  const celda = ctx.grid.at(npc.x, npc.y);
  accion('recoger_piedra').apply(npc, band, ctx, createRng(1));
  assert.ok(band.inventory.piedra > 0);
  assert.equal(band.inventory.piedra, RESOURCES.piedra.max - celda.resources.piedra);
});

test('descansar reduce la fatiga', () => {
  const { npc, band, ctx } = escenaJunto('bosque', { fatiga: 80 });
  accion('descansar').apply(npc, band, ctx, createRng(1));
  assert.ok(npc.needs.fatiga < 80);
});

test('explorar revela celdas nuevas', () => {
  const { npc, band, ctx } = escenaJunto('pradera', {});
  const antes = ctx.discovery.size;
  accion('explorar').apply(npc, band, ctx, createRng(1));
  assert.ok(ctx.discovery.size > antes);
});

test('explorar mueve al NPC dentro de la rejilla, incluso en una esquina', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { npc, band, ctx } = escenaJunto('pradera', {});
    npc.x = 0;
    npc.y = 0;
    accion('explorar').apply(npc, band, ctx, createRng(seed));
    assert.ok(ctx.grid.inBounds(npc.x, npc.y), `${npc.x},${npc.y}`);
    assert.ok(npc.x !== 0 || npc.y !== 0);
  }
});

test('explorar cuenta un hallazgo grande en la crónica', () => {
  const { npc, band, ctx } = escenaJunto('pradera', {});
  const texto = accion('explorar').apply(npc, band, ctx, createRng(1));
  assert.equal(typeof texto, 'string');
  assert.ok(texto.includes(npc.nombre));
});

test('seguir acerca al NPC al punto de la banda y puntúa por la distancia a él', () => {
  const { npc, band, ctx } = escenaJunto('pradera', {});
  band.x = 10;
  band.y = 16;
  npc.x = 14;
  npc.y = 18;
  const seguir = accion('seguir');
  const lejos = seguir.score(npc, band, ctx);
  assert.ok(lejos > 0);
  seguir.apply(npc, band, ctx, createRng(1));
  assert.equal(npc.x, 13);
  assert.equal(npc.y, 17);
  assert.ok(seguir.score(npc, band, ctx) < lejos);
  npc.x = 10;
  npc.y = 16;
  assert.equal(seguir.score(npc, band, ctx), 0);
});

const asentada = (band, cola = ['hoguera']) => {
  band.settled = true;
  band.settlement = { queue: cola, buildings: [] };
};

test('construir puntúa 0 mientras la banda es nómada o no hay obra pendiente', () => {
  const { npc, band, ctx } = escenaJunto('bosque', { frio: 80 });
  band.inventory.leña = 50;
  const construir = accion('construir');
  assert.equal(construir.score(npc, band, ctx), 0); // nómada
  band.settlement = { queue: ['hoguera'], buildings: [] };
  assert.equal(construir.score(npc, band, ctx), 0); // hay obra pero la banda no está asentada
  asentada(band, []);
  assert.equal(construir.score(npc, band, ctx), 0); // asentada sin obra
  band.settlement = null;
  assert.equal(construir.score(npc, band, ctx), 0); // sin asentamiento
  delete band.settlement;
  assert.equal(construir.score(npc, band, ctx), 0);
});

test('construir puntúa más de 0 con la banda asentada y obra pendiente, y puede ganar', () => {
  const { npc, band, ctx } = escenaJunto('pradera', {});
  asentada(band);
  assert.ok(accion('construir').score(npc, band, ctx) > 0);
});

test('construir solo anota que el NPC trabaja: no toca inventario, obra ni contadores', () => {
  const { npc, band, ctx } = escenaJunto('bosque', {});
  asentada(band);
  band.inventory.leña = 9;
  const sinNpcs = () => JSON.stringify({ ...band, npcs: undefined, needs: npc.needs });
  const antes = sinNpcs();
  const texto = accion('construir').apply(npc, band, ctx, createRng(1));
  assert.equal(texto, null);
  assert.equal(sinNpcs(), antes);
  assert.equal(band.fogatas, undefined);
  assert.equal(npc.action, 'construir');
});

test('las acciones solo usan la rejilla a través de discovery.knownCell', () => {
  const fuente = readFileSync(new URL('../../src/agents/actions.js', import.meta.url), 'utf8');
  assert.ok(!/\.at\s*\(/.test(fuente), 'actions.js no debe llamar a grid.at');
});
