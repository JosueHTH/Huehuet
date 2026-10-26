import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGrid } from '../../src/world/grid.js';
import { createDiscovery } from '../../src/world/discovery.js';
import { generateWorld } from '../../src/world/worldgen.js';
import { SITE_FACTORS, scoreSite, acceptanceThreshold, candidateSites } from '../../src/tribe/sitescore.js';
import { codeOnly } from './purity.js';

const C = 10; // celda central de la rejilla sintética de 25x25

// Rejilla de pradera con los recursos pedidos repartidos alrededor del centro y, si se pide, un río a 2 celdas.
// revealRadius controla lo descubierto: con 0 solo se conoce la celda central.
function sitio(recursos = {}, season = 'verano', { revealRadius = 14, size = 25, agua = recursos.agua } = {}) {
  const grid = createGrid(size, size);
  for (const cell of grid.cells) {
    if (Math.hypot(cell.x - C, cell.y - C) > 9) continue;
    for (const [id, cantidad] of Object.entries(recursos)) if (id !== 'agua') cell.resources[id] = cantidad;
  }
  if (agua) {
    const rio = grid.at(C + 2, C);
    rio.biome = 'rio';
    rio.river = true;
    rio.resources.agua = 10;
  }
  const discovery = createDiscovery(grid);
  discovery.reveal(C, C, revealRadius);
  return { grid, discovery, ctx: { grid, season }, pos: { x: C, y: C } };
}

const sitioArgs = (recursos, season, opts) => {
  const { discovery, ctx, pos } = sitio(recursos, season, opts);
  return [discovery, pos.x, pos.y, ctx];
};

const escenaDescubierta = (world, radio = 30) => {
  const discovery = createDiscovery(world.grid);
  discovery.reveal(world.start.x, world.start.y, radio);
  return { discovery, ctx: { grid: world.grid, season: 'verano' } };
};

const contribucion = (s, id) => s.factors.find((f) => f.id === id).contribution;

test('un sitio sin agua dulce conocida puntúa cero y no es viable', () => {
  const { discovery, ctx, pos } = sitio({ agua: false, caza: 10, forraje: 10, leña: 10, piedra: 10 });
  const s = scoreSite(discovery, pos.x, pos.y, ctx);
  assert.equal(s.total, 0);
  assert.equal(s.viable, false);
});

test('un sitio sin agua devuelve igualmente todos los factores, con sus valores', () => {
  const s = scoreSite(...sitioArgs({ agua: false, caza: 10, forraje: 10 }));
  assert.deepEqual(s.factors.map((f) => f.id), SITE_FACTORS.map((f) => f.id));
  assert.ok(s.factors.find((f) => f.id === 'caza').value > 0, 'el valor de caza debe verse aunque no sea viable');
  assert.equal(s.factors.find((f) => f.id === 'agua').value, 0);
  assert.equal(s.factors.reduce((a, f) => a + f.contribution, 0), 0);
});

test('el agua a más de 3 celdas no cuenta; a 3 celdas sí', () => {
  const lejos = sitio({ caza: 5 });
  const rioLejos = lejos.grid.at(C + 4, C);
  rioLejos.biome = 'rio'; rioLejos.river = true;
  assert.equal(scoreSite(lejos.discovery, C, C, lejos.ctx).viable, false);
  const cerca = sitio({ caza: 5 });
  const rioCerca = cerca.grid.at(C + 3, C);
  rioCerca.biome = 'rio'; rioCerca.river = true;
  assert.equal(scoreSite(cerca.discovery, C, C, cerca.ctx).viable, true);
});

test('el agua conocida pero no dulce (lago) no vuelve viable un sitio', () => {
  const s = sitio({ caza: 5 });
  s.grid.at(C + 1, C).biome = 'agua';
  assert.equal(scoreSite(s.discovery, C, C, s.ctx).viable, false);
});

test('con todo igual, un sitio con agua gana a uno sin agua', () => {
  const conAgua = scoreSite(...sitioArgs({ agua: true, caza: 5 }));
  const sinAgua = scoreSite(...sitioArgs({ agua: false, caza: 5 }));
  assert.ok(conAgua.total > sinAgua.total);
  assert.equal(conAgua.viable, true);
});

for (const id of ['caza', 'forraje', 'leña', 'piedra']) {
  test(`más ${id} nunca baja la puntuación`, () => {
    let previa = -1;
    for (const cantidad of [0, 2, 5, 10, 20, 100]) {
      const s = scoreSite(...sitioArgs({ agua: true, [id]: cantidad }));
      assert.ok(s.total >= previa, `${id} ${cantidad} bajó la puntuación`);
      previa = s.total;
    }
    const sin = scoreSite(...sitioArgs({ agua: true, [id]: 0 })).total;
    assert.ok(previa > sin, `${id} debe influir en el resultado`);
  });
}

test('la puntuación se mantiene en 0..100 con recursos extremos', () => {
  const s = scoreSite(...sitioArgs({ agua: true, caza: 1e6, forraje: 1e6, leña: 1e6, piedra: 1e6 }));
  assert.ok(s.total >= 0 && s.total <= 100, `total = ${s.total}`);
  assert.ok(s.total > 60, 'con recursos de sobra el sitio debe puntuar alto');
  for (const f of s.factors) assert.ok(f.value >= 0 && f.value <= 1, `${f.id} value ${f.value}`);
});

test('las aportaciones de los factores suman el total', () => {
  for (const season of ['primavera', 'verano', 'otoño', 'invierno']) {
    for (const recursos of [{ agua: true, caza: 6, forraje: 4, leña: 3 }, { agua: true }, { agua: true, caza: 1e6, leña: 1e6 }]) {
      const s = scoreSite(...sitioArgs(recursos, season));
      const suma = s.factors.reduce((a, f) => a + f.contribution, 0);
      assert.ok(Math.abs(suma - s.total) < 0.01, `${season}: suma ${suma} total ${s.total}`);
    }
  }
});

test('los factores de penalización restan y nunca llevan el total por debajo de cero', () => {
  const s = sitio({ agua: true });
  for (const cell of s.grid.cells) {
    if (Math.hypot(cell.x - C, cell.y - C) <= 4) { cell.biome = 'pantano'; cell.river = true; }
  }
  const r = scoreSite(s.discovery, C, C, s.ctx);
  assert.ok(contribucion(r, 'inundacion') < 0, 'un sitio rodeado de agua debe sufrir inundación');
  assert.ok(r.total >= 0);
  const suma = r.factors.reduce((a, f) => a + f.contribution, 0);
  assert.ok(Math.abs(suma - r.total) < 0.01);
  const bosque = sitio({ agua: true });
  for (const cell of bosque.grid.cells) if (Math.hypot(cell.x - C, cell.y - C) <= 4) cell.biome = 'bosque';
  assert.ok(contribucion(scoreSite(bosque.discovery, C, C, bosque.ctx), 'depredadores') < 0);
});

test('scoreSite expone un factor por cada entrada de SITE_FACTORS', () => {
  const s = scoreSite(...sitioArgs({ agua: true }));
  assert.deepEqual(s.factors.map((f) => f.id), SITE_FACTORS.map((f) => f.id));
  assert.deepEqual(SITE_FACTORS.map((f) => f.id),
    ['agua', 'caza', 'forraje', 'leña', 'piedra', 'defensa', 'refugio', 'inundacion', 'depredadores']);
  for (const f of s.factors) {
    assert.equal(typeof f.label, 'string');
    assert.ok(f.label.length > 0);
    assert.equal(typeof f.value, 'number');
    assert.equal(typeof f.weight, 'number');
    assert.equal(typeof f.contribution, 'number');
  }
});

test('SITE_FACTORS lleva los radios y el carácter eliminatorio del diseño', () => {
  const por = Object.fromEntries(SITE_FACTORS.map((f) => [f.id, f]));
  assert.equal(por.agua.eliminatory, true);
  assert.equal(SITE_FACTORS.filter((f) => f.eliminatory).length, 1);
  assert.deepEqual([por.agua.radius, por.caza.radius, por.forraje.radius, por.leña.radius, por.piedra.radius], [3, 6, 4, 5, 8]);
  assert.ok(por.inundacion.weight < 0 && por.depredadores.weight < 0);
  for (const id of ['caza', 'forraje']) assert.ok(por[id].weight > por.leña.weight, `${id} pesa más que leña`);
  assert.ok(por.leña.weight > 0 && por.piedra.weight > 0 && por.defensa.weight > 0 && por.refugio.weight > 0);
});

test('la leña pesa más cuando se acerca el invierno', () => {
  const otoño = scoreSite(...sitioArgs({ agua: true, leña: 20 }, 'otoño'));
  const verano = scoreSite(...sitioArgs({ agua: true, leña: 20 }, 'verano'));
  assert.ok(contribucion(otoño, 'leña') > contribucion(verano, 'leña'));
  const invierno = scoreSite(...sitioArgs({ agua: true, leña: 20 }, 'invierno'));
  assert.ok(contribucion(invierno, 'leña') > contribucion(verano, 'leña'));
});

test('la estación no cambia el peso ni el valor de la leña, solo su aportación', () => {
  const a = scoreSite(...sitioArgs({ agua: true, leña: 20 }, 'otoño')).factors.find((f) => f.id === 'leña');
  const b = scoreSite(...sitioArgs({ agua: true, leña: 20 }, 'verano')).factors.find((f) => f.id === 'leña');
  assert.equal(a.value, b.value);
  assert.equal(a.weight, b.weight);
});

test('scoreSite solo usa celdas conocidas', () => {
  const { discovery, ctx, pos } = sitio({ agua: true, caza: 20 }, 'verano', { revealRadius: 0 });
  assert.equal(scoreSite(discovery, pos.x, pos.y, ctx).total, 0);
});

test('un sitio no descubierto no es viable aunque rodee agua', () => {
  const { discovery, ctx } = sitio({ agua: true, caza: 20 }, 'verano', { revealRadius: 0 });
  discovery.reveal(C + 2, C, 0);
  assert.equal(scoreSite(discovery, C, C + 1, ctx).viable, false);
});

test('scoreSite es determinista', () => {
  const a = scoreSite(...sitioArgs({ agua: true, caza: 6, forraje: 4, leña: 3 }, 'otoño'));
  const b = scoreSite(...sitioArgs({ agua: true, caza: 6, forraje: 4, leña: 3 }, 'otoño'));
  assert.deepEqual(a, b);
});

test('acceptanceThreshold baja al subir la presión', () => {
  assert.ok(acceptanceThreshold(0) > acceptanceThreshold(0.5));
  assert.ok(acceptanceThreshold(0.5) > acceptanceThreshold(1));
});

test('acceptanceThreshold vale 70 sin presión y 25 con presión máxima', () => {
  assert.equal(acceptanceThreshold(0), 70);
  assert.equal(acceptanceThreshold(1), 25);
  assert.ok(Math.abs(acceptanceThreshold(0.5) - 47.5) < 1e-9);
});

test('acceptanceThreshold acota la entrada a 0..1', () => {
  assert.equal(acceptanceThreshold(-1), 70);
  assert.equal(acceptanceThreshold(2), 25);
  assert.equal(acceptanceThreshold(Infinity), 25);
});

test('acceptanceThreshold se mantiene en 0..100', () => {
  for (const p of [-1, 0, 0.5, 1, 2]) {
    const t = acceptanceThreshold(p);
    assert.ok(t >= 0 && t <= 100, `presión ${p} -> ${t}`);
  }
});

test('candidateSites devuelve sitios ordenados y respeta el límite', () => {
  const { discovery, ctx } = escenaDescubierta(generateWorld(21));
  const sitios = candidateSites(discovery, ctx, { limit: 5 });
  assert.ok(sitios.length > 0 && sitios.length <= 5);
  for (let i = 1; i < sitios.length; i++) {
    assert.ok(sitios[i - 1].total >= sitios[i].total);
  }
});

test('candidateSites usa un límite de 8 por defecto', () => {
  const { discovery, ctx } = escenaDescubierta(generateWorld(21));
  assert.equal(candidateSites(discovery, ctx).length, 8);
});

test('candidateSites descarta los no viables', () => {
  const { discovery, ctx } = escenaDescubierta(generateWorld(22));
  const sitios = candidateSites(discovery, ctx);
  assert.ok(sitios.length > 0);
  for (const s of sitios) assert.equal(s.viable, true);
});

test('candidateSites no propone un sitio cuya agua no se ha visto, aunque el generador lo dé por viable', () => {
  const world = generateWorld(23);
  const discovery = createDiscovery(world.grid);
  for (const sitioViable of world.viableSites) discovery.reveal(sitioViable.x, sitioViable.y, 0);
  assert.deepEqual(candidateSites(discovery, { grid: world.grid, season: 'verano' }), []);
});

// Una rejilla cuya lectura directa lanza: solo se puede mirar a través de discovery.
function rejillaOpaca(grid) {
  return {
    width: grid.width, height: grid.height, inBounds: grid.inBounds,
    at() { throw new Error('lectura directa grid.at'); },
    get cells() { throw new Error('lectura directa grid.cells'); },
    forRadius() { throw new Error('lectura directa grid.forRadius'); },
  };
}

test('scoreSite y candidateSites no leen la rejilla más que a través de discovery', () => {
  const { discovery, grid } = sitio({ agua: true, caza: 6 });
  const ctx = { grid: rejillaOpaca(grid), season: 'otoño' };
  assert.doesNotThrow(() => scoreSite(discovery, C, C, ctx));
  assert.ok(candidateSites(discovery, ctx).length > 0);
});

test('el código de sitescore.js no toca la rejilla ni el generador', () => {
  const codigo = codeOnly(readFileSync(new URL('../../src/tribe/sitescore.js', import.meta.url), 'utf8'));
  assert.ok(!/\.at\(/.test(codigo), 'usa .at(');
  assert.ok(!/\bcells\b/.test(codigo), 'usa cells');
  assert.ok(!/viableSites/.test(codigo), 'usa viableSites');
  assert.ok(!/\bforRadius\b/.test(codigo), 'usa forRadius');
  assert.deepEqual(codigo.match(/\bgrid\b(?!\.inBounds)/g) ?? [], [], 'usa grid más allá de grid.inBounds');
});

test('candidateSites respeta opts.exclude (arreglo o conjunto de {x,y})', () => {
  const { discovery, ctx } = escenaDescubierta(generateWorld(21));
  const base = candidateSites(discovery, ctx, { limit: 8 });
  const [primero, segundo] = base;
  const sinPrimero = candidateSites(discovery, ctx, { limit: 8, exclude: [{ x: primero.x, y: primero.y }] });
  assert.ok(!sinPrimero.some((s) => s.x === primero.x && s.y === primero.y));
  assert.equal(sinPrimero.length, 8, 'el hueco se rellena con el siguiente candidato');
  assert.deepEqual(sinPrimero[0], segundo);
  const conSet = candidateSites(discovery, ctx, { limit: 8, exclude: new Set([{ x: primero.x, y: primero.y }]) });
  assert.deepEqual(conSet, sinPrimero);
  assert.deepEqual(candidateSites(discovery, ctx, { limit: 8, exclude: [] }), base);
});

test('candidateSites excluir todo lo viable devuelve vacío', () => {
  const { discovery, ctx } = escenaDescubierta(generateWorld(22), 12);
  const todos = candidateSites(discovery, ctx, { limit: 100000 });
  assert.deepEqual(candidateSites(discovery, ctx, { limit: 100000, exclude: todos }), []);
});

// Escena con muchos empates exactos: río en toda una columna y recursos uniformes.
function escenaEmpates() {
  const grid = createGrid(40, 40);
  for (const cell of grid.cells) {
    cell.resources.caza = 3; cell.resources.forraje = 3;
    if (cell.x === 20) { cell.biome = 'rio'; cell.river = true; }
  }
  const discovery = createDiscovery(grid);
  discovery.reveal(20, 20, 30);
  return { discovery, ctx: { grid, season: 'verano' } };
}

test('candidateSites desempata por y y luego por x, sea cual sea el orden de entrada', () => {
  const { discovery, ctx } = escenaEmpates();
  const invertido = { knownCell: discovery.knownCell, knownCells: () => discovery.knownCells().reverse() };
  const a = candidateSites(discovery, ctx, { limit: 200 });
  const b = candidateSites(invertido, ctx, { limit: 200 });
  assert.deepEqual(a, b);
  let empates = 0;
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1]; const q = a[i];
    if (p.total === q.total) {
      empates++;
      assert.ok(p.y < q.y || (p.y === q.y && p.x < q.x), `empate mal ordenado: (${p.x},${p.y}) antes de (${q.x},${q.y})`);
    } else {
      assert.ok(p.total > q.total);
    }
  }
  assert.ok(empates > 10, `la escena debe tener empates (${empates})`);
});

test('candidateSites es determinista para una semilla y devuelve lo mismo tras revelar más', () => {
  const run = () => {
    const { discovery, ctx } = escenaDescubierta(generateWorld(24));
    return candidateSites(discovery, ctx, { limit: 8 });
  };
  assert.deepEqual(run(), run());
});

test('candidateSites ve lo que se descubre después (la caché no queda obsoleta)', () => {
  const world = generateWorld(21);
  const discovery = createDiscovery(world.grid);
  const ctx = { grid: world.grid, season: 'verano' };
  assert.deepEqual(candidateSites(discovery, ctx), []);
  discovery.reveal(world.start.x, world.start.y, 30);
  const tras = candidateSites(discovery, ctx);
  assert.ok(tras.length > 0);
  discovery.reveal(world.start.x, world.start.y, 60);
  const mas = candidateSites(discovery, ctx, { limit: 1000 });
  assert.ok(mas.length >= tras.length);
});

test('una banda apurada acepta lo que una cómoda rechaza', () => {
  const { discovery, ctx } = escenaDescubierta(generateWorld(21));
  const mejor = candidateSites(discovery, ctx, { limit: 1 })[0];
  assert.ok(mejor.total >= acceptanceThreshold(1), `el mejor sitio (${mejor.total}) debe superar el umbral de máxima presión`);
});

test('el refugio y la defensa influyen: bosque y altura suben la puntuación', () => {
  const llano = scoreSite(...sitioArgs({ agua: true }));
  const bosque = sitio({ agua: true });
  for (const cell of bosque.grid.cells) if (Math.hypot(cell.x - C, cell.y - C) <= 3) cell.biome = 'bosque';
  const b = scoreSite(bosque.discovery, C, C, bosque.ctx);
  assert.ok(contribucion(b, 'refugio') > contribucion(llano, 'refugio'));
  const alto = sitio({ agua: true });
  alto.grid.at(C, C).elevation = 0.8;
  const a = scoreSite(alto.discovery, C, C, alto.ctx);
  assert.ok(contribucion(a, 'defensa') > contribucion(llano, 'defensa'));
  assert.ok(a.total > llano.total);
});

test('si las penalizaciones superan a lo demás, el total es 0 y las aportaciones siguen sumándolo', () => {
  const s = sitio({ agua: false });
  for (const cell of s.grid.cells) if (Math.hypot(cell.x - C, cell.y - C) <= 4) cell.biome = 'pantano';
  const rio = s.grid.at(C + 3, C);
  rio.biome = 'rio'; rio.river = true;
  const r = scoreSite(s.discovery, C, C, s.ctx);
  assert.equal(r.viable, true);
  assert.ok(r.factors.filter((f) => f.weight < 0).reduce((a, f) => a - f.value * f.weight, 0) > 0);
  const suma = r.factors.reduce((a, f) => a + f.contribution, 0);
  assert.ok(Math.abs(suma - r.total) < 1e-9, `suma ${suma} total ${r.total}`);
  assert.ok(r.total >= 0);
  assert.ok(r.factors.every((f) => f.weight > 0 ? f.contribution >= 0 : f.contribution <= 0));
});

test('una celda de lago junto a un río no es candidata', () => {
  const s = sitio({ agua: true, caza: 5 });
  s.grid.at(C, C).biome = 'agua';
  assert.equal(scoreSite(s.discovery, C, C, s.ctx).viable, false);
  assert.ok(!candidateSites(s.discovery, s.ctx, { limit: 1000 }).some((c) => c.x === C && c.y === C));
});

test('el valor de cada recurso crece de forma gradual y saturada, sin llegar a 1 con cantidades moderadas', () => {
  for (const id of ['caza', 'forraje', 'leña', 'piedra']) {
    const valores = [1, 2, 5, 10, 20].map((n) => scoreSite(...sitioArgs({ agua: true, [id]: n })).factors.find((f) => f.id === id).value);
    for (let i = 1; i < valores.length; i++) assert.ok(valores[i] > valores[i - 1], `${id}: ${valores}`);
    assert.ok(valores[valores.length - 1] < 1, `${id} satura demasiado pronto: ${valores}`);
  }
});
