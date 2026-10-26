import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGrid, BIOMES } from '../../src/world/grid.js';
import { createDiscovery } from '../../src/world/discovery.js';
import { generateWorld } from '../../src/world/worldgen.js';
import { SITE_FACTORS, scoreSite, acceptanceThreshold, candidateSites, VALOR_ALCANZABLE, valorQuePuntua } from '../../src/tribe/sitescore.js';
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
  assert.equal(a.weight, b.weight, 'weight es el peso base');
  assert.ok(a.effectiveWeight > b.effectiveWeight, 'effectiveWeight lleva el modificador estacional');
  assert.equal(a.effectiveWeight, a.weight * 1.5);
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

test('una celda de río no es un sitio viable, aunque tenga agua a distancia 0', () => {
  const s = sitio({ agua: true, caza: 5 });
  const rio = s.grid.at(C + 2, C);
  const r = scoreSite(s.discovery, rio.x, rio.y, s.ctx);
  assert.equal(r.viable, false);
  assert.equal(r.total, 0);
  assert.ok(!candidateSites(s.discovery, s.ctx, { limit: 1000 }).some((c) => c.x === rio.x && c.y === rio.y));
});

test('ningún candidato de un mundo generado es una celda de agua o río', () => {
  for (const seed of [21, 22, 23, 24]) {
    const world = generateWorld(seed);
    const { discovery, ctx } = escenaDescubierta(world);
    for (const c of candidateSites(discovery, ctx, { limit: 1000 })) {
      const b = discovery.knownCell(c.x, c.y).biome;
      assert.ok(b !== 'agua' && b !== 'rio', `semilla ${seed}: candidato en ${b} (${c.x},${c.y})`);
    }
  }
});

test('el desglose publicado reproduce cada aportación (peso efectivo, normalizador y escala de penalización)', () => {
  const casos = [
    sitioArgs({ agua: true, caza: 6, forraje: 4, leña: 20 }, 'otoño'),
    sitioArgs({ agua: true, caza: 6, leña: 20 }, 'verano'),
  ];
  const pantanoso = sitio({ agua: false });
  for (const cell of pantanoso.grid.cells) if (Math.hypot(cell.x - C, cell.y - C) <= 4) cell.biome = 'pantano';
  const rio = pantanoso.grid.at(C + 3, C);
  rio.biome = 'rio'; rio.river = true;
  casos.push([pantanoso.discovery, C, C, { ...pantanoso.ctx, season: 'otoño' }]);
  for (const args of casos) {
    const s = scoreSite(...args);
    assert.equal(s.viable, true);
    // Task 11: el normalizador es lo máximo REALMENTE alcanzable (peso efectivo × VALOR_ALCANZABLE), no la
    // suma de pesos a secas: normalizando por esta última ningún sitio de un mundo generado pasaba de 64.
    const pesoTotal = s.factors.reduce((a, f) => a + Math.max(0, f.effectiveWeight) * (VALOR_ALCANZABLE[f.id] ?? 1), 0);
    assert.ok(Math.abs(s.weightTotal - pesoTotal) < 1e-9, 'weightTotal = suma de pesos efectivos positivos alcanzables');
    for (const f of s.factors) {
      const escala = f.effectiveWeight < 0 ? s.penaltyScale : 1;
      const esperado = (valorQuePuntua(f.id, f.value) * f.effectiveWeight / s.weightTotal) * 100 * escala;
      assert.ok(Math.abs(esperado - f.contribution) < 1e-9, `${f.id}: ${esperado} vs ${f.contribution}`);
    }
  }
  const [, , , ctxOtoño] = casos[0];
  const leña = scoreSite(...casos[0]).factors.find((f) => f.id === 'leña');
  assert.equal(leña.effectiveWeight, leña.weight * 1.5, 'el modificador de leña está activo en otoño');
  assert.ok(ctxOtoño.season === 'otoño');
  assert.ok(scoreSite(...casos[2]).penaltyScale < 1, 'el caso pantanoso activa el tope de penalización');
  assert.equal(scoreSite(...casos[0]).penaltyScale, 1);
});

test('inundacion es un factor vivo: un sitio rodeado de agua puntúa menos que el mismo sitio en seco', () => {
  const seco = sitio({ agua: true, caza: 6, forraje: 4 });
  const mojado = sitio({ agua: true, caza: 6, forraje: 4 });
  for (const cell of mojado.grid.cells) {
    const d = Math.hypot(cell.x - C, cell.y - C);
    if (d > 0 && d <= 2 && !(cell.x === C + 2 && cell.y === C)) { cell.biome = 'rio'; cell.river = true; }
  }
  const a = scoreSite(seco.discovery, C, C, seco.ctx);
  const b = scoreSite(mojado.discovery, C, C, mojado.ctx);
  const fa = a.factors.find((f) => f.id === 'inundacion');
  const fb = b.factors.find((f) => f.id === 'inundacion');
  assert.ok(fb.value > fa.value, `${fb.value} vs ${fa.value}`);
  assert.ok(fb.contribution < fa.contribution);
  assert.ok(fa.value > 0 && fa.value < 1, 'incluso el sitio seco ve el río de al lado');
});

test('agua: más cerca es mejor en cada distancia de 1 a 3, y a 4 no es viable', () => {
  const resultados = [1, 2, 3, 4].map((d) => {
    const s = sitio({ caza: 5 });
    const rio = s.grid.at(C + d, C);
    rio.biome = 'rio'; rio.river = true;
    return scoreSite(s.discovery, C, C, s.ctx);
  });
  const valores = resultados.map((r) => r.factors.find((f) => f.id === 'agua').value);
  assert.ok(valores[0] > valores[1] && valores[1] > valores[2] && valores[2] > valores[3], `${valores}`);
  assert.ok(resultados[0].total > resultados[1].total && resultados[1].total > resultados[2].total);
  assert.equal(resultados[3].total, 0);
  const aDistanciaCero = sitio({ caza: 5 });
  const celda = aDistanciaCero.grid.at(C, C); celda.biome = 'rio'; celda.river = true;
  assert.equal(scoreSite(aDistanciaCero.discovery, C, C, aDistanciaCero.ctx).factors.find((f) => f.id === 'agua').value, 1);
});

test('defensa y refugio no bajan al aumentar su entrada', () => {
  let previa = { d: -1, dt: -1 };
  for (const altura of [0, 0.1, 0.3, 0.6, 1]) {
    const s = sitio({ agua: true });
    s.grid.at(C, C).elevation = altura;
    const r = scoreSite(s.discovery, C, C, s.ctx);
    const v = r.factors.find((f) => f.id === 'defensa').value;
    assert.ok(v >= previa.d && r.total >= previa.dt, `defensa con altura ${altura}`);
    previa = { d: v, dt: r.total };
  }
  assert.ok(previa.d > 0);
  let prev = { v: -1, t: -1 };
  for (const radio of [0, 1, 2, 3]) {
    const s = sitio({ agua: true });
    for (const cell of s.grid.cells) {
      if (Math.hypot(cell.x - C, cell.y - C) <= radio && !cell.river) cell.biome = 'montaña';
    }
    const r = scoreSite(s.discovery, C, C, s.ctx);
    const v = r.factors.find((f) => f.id === 'refugio').value;
    assert.ok(v >= prev.v, `refugio con radio ${radio}`);
    prev = { v, t: r.total };
  }
  assert.ok(prev.v > 0.3);
});

test('los biomas tienen shelter y predators en 0..1 (de lo que depende el recorte de valores)', () => {
  for (const [id, b] of Object.entries(BIOMES)) {
    assert.ok(b.shelter >= 0 && b.shelter <= 1, `${id}.shelter = ${b.shelter}`);
    assert.ok(b.predators >= 0 && b.predators <= 1, `${id}.predators = ${b.predators}`);
  }
});

// --- Normalizador alcanzable (Task 11, palanca 1) -----------------------------------------------
// Normalizar por la suma de TODOS los pesos suponía que existen sitios excelentes en los nueve
// factores a la vez: ninguno de diez mundos pasaba de 64 con el umbral en calma en 70. Se normaliza
// por lo realmente alcanzable y lo que puntúa de cada factor se recorta a ese máximo.

// Un sitio buenísimo de verdad: río pegado, recursos de sobra, bosque alrededor y en lo alto.
function sitioExcelente(season = 'verano') {
  const grid = createGrid(25, 25);
  for (const cell of grid.cells) {
    cell.biome = 'bosque';
    cell.elevation = 0.2;
    for (const id of ['caza', 'forraje', 'leña', 'piedra']) cell.resources[id] = 1e6;
  }
  grid.at(C, C).elevation = 1;
  const rio = grid.at(C + 1, C);
  rio.biome = 'rio';
  rio.river = true;
  rio.resources.agua = 10;
  const discovery = createDiscovery(grid);
  discovery.reveal(C, C, 14);
  return scoreSite(discovery, C, C, { grid, season });
}

test('valorQuePuntua recorta cada factor a lo alcanzable y deja enteras las penalizaciones', () => {
  for (const [id, tope] of Object.entries(VALOR_ALCANZABLE)) {
    assert.equal(valorQuePuntua(id, 1), tope, id);
    assert.equal(valorQuePuntua(id, tope), tope, id);
    assert.equal(valorQuePuntua(id, tope / 2), tope / 2, `${id} por debajo del tope no se toca`);
  }
  for (const id of ['inundacion', 'depredadores']) assert.equal(valorQuePuntua(id, 1), 1, id);
  assert.equal(valorQuePuntua('factor-inventado', 0.42), 0.42, 'lo que no tiene tope pasa tal cual');
});

test('el normalizador es lo alcanzable, no la suma de pesos: un sitio excelente llega a ~100', () => {
  const s = sitioExcelente();
  const pesosASecas = SITE_FACTORS.reduce((a, f) => a + Math.max(0, f.weight), 0);
  assert.ok(s.weightTotal < pesosASecas, `${s.weightTotal} debería ser menor que ${pesosASecas}`);
  const positivas = s.factors.reduce((a, f) => a + Math.max(0, f.contribution), 0);
  assert.ok(positivas > 95, `un sitio excelente debe agotar la escala: ${positivas}`);
  assert.ok(positivas <= 100.0001, `pero no pasarse de 100: ${positivas}`);
  assert.ok(s.total > 85, `y su total, ya con penalizaciones, debe ser alto: ${s.total}`);
});

test('las aportaciones positivas nunca suman más de 100, ni con recursos absurdos', () => {
  for (const season of ['primavera', 'verano', 'otoño', 'invierno']) {
    for (const s of [sitioExcelente(season), scoreSite(...sitioArgs({ agua: true, caza: 1e9, forraje: 1e9, leña: 1e9, piedra: 1e9 }, season))]) {
      const positivas = s.factors.reduce((a, f) => a + Math.max(0, f.contribution), 0);
      assert.ok(positivas <= 100.0001, `${season}: las positivas suman ${positivas}`);
      const suma = s.factors.reduce((a, f) => a + f.contribution, 0);
      assert.ok(Math.abs(suma - s.total) < 0.01, `${season}: el acotado a 100 rompió la identidad: suma ${suma} total ${s.total}`);
    }
  }
});

test('pasado lo alcanzable, más cantidad no puntúa más', () => {
  // leña: el tope se alcanza con mucho menos que 1e6, así que multiplicar por mil no cambia nada.
  const generoso = scoreSite(...sitioArgs({ agua: true, leña: 1e3 }));
  const absurdo = scoreSite(...sitioArgs({ agua: true, leña: 1e6 }));
  const aporta = (s) => s.factors.find((f) => f.id === 'leña').contribution;
  assert.ok(aporta(generoso) > 0);
  assert.equal(aporta(absurdo), aporta(generoso), 'el exceso no puede seguir sumando');
  assert.equal(absurdo.total, generoso.total);
  // El valor publicado, en cambio, sigue siendo el real: la interfaz no miente sobre lo que hay.
  assert.ok(absurdo.factors.find((f) => f.id === 'leña').value > VALOR_ALCANZABLE.leña);
});

test('el mejor sitio de un mundo generado alcanza el umbral de una banda en calma', () => {
  for (const seed of [21, 23, 42]) {
    const world = generateWorld(seed);
    const discovery = createDiscovery(world.grid);
    discovery.reveal(Math.floor(world.grid.width / 2), Math.floor(world.grid.height / 2), 200);
    const mejor = candidateSites(discovery, { grid: world.grid, season: 'verano' }, { limit: 1 })[0];
    assert.ok(mejor.total >= acceptanceThreshold(0), `semilla ${seed}: el mejor sitio del mundo es ${mejor.total} y en calma se piden ${acceptanceThreshold(0)}`);
  }
});
