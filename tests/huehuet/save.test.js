import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, stepGame, advanceGame } from '../../src/game.js';
import { livingNpcs } from '../../src/tribe/band.js';
import { BUILDINGS } from '../../src/tribe/settlement.js';
import { MAX_ENTRADAS } from '../../src/chronicle.js';
import { SCHEMA_VERSION, UnsupportedVersionError, serialize, deserialize, migrate, lineaBase } from '../../src/save/schema.js';
import { createStore } from '../../src/save/store.js';
import { ambientUses } from './purity.js';

// --- Dobles de Storage ---------------------------------------------------------------------------

function memoria() {
  const datos = new Map();
  return {
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => { datos.set(k, String(v)); },
    removeItem: (k) => { datos.delete(k); },
    get length() { return datos.size; },
    key: (i) => [...datos.keys()][i] ?? null,
    clear: () => datos.clear(),
    _datos: datos,
  };
}
const cuotaExcedida = () => { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; return e; };
// Cabe el sondeo y lo pequeño, pero no una partida: como un localStorage lleno.
function memoriaQueFalla() {
  const m = memoria();
  const set = m.setItem;
  m.setItem = (k, v) => { if (String(v).length > 2000) throw cuotaExcedida(); set(k, v); };
  return m;
}
// Todo acceso lanza, como Safari en navegación privada.
function memoriaInaccesible() {
  const falla = () => { throw new Error('SecurityError'); };
  return { getItem: falla, setItem: falla, removeItem: falla, key: falla, clear: falla, get length() { return falla(); } };
}
// Falla en cuanto se escribe cualquier cosa tras el sondeo.
function memoriaSinEscritura() {
  const m = memoria();
  const set = m.setItem;
  let sondeo = true;
  m.setItem = (k, v) => { if (!sondeo) throw cuotaExcedida(); set(k, v); sondeo = false; };
  return m;
}

const viaJson = (o) => JSON.parse(JSON.stringify(o));
// Una partida pasada por el disco de verdad: el JSON real, no solo el objeto.
const recargar = (g) => deserialize(viaJson(serialize(g)));

// Todo lo que define el avance. Sin funciones (rng, rejilla, reloj), que deepEqual compara por referencia.
const estado = (g) => ({
  seed: g.seed,
  tick: g.clock.tick,
  hora: [g.clock.day, g.clock.hour, g.clock.season],
  band: g.band,
  settlement: g.settlement,
  conocido: g.discovery.toJSON(),
  cronica: g.chronicle.entries,
  over: g.over,
  decision: g.lastDecision,
  rng: g.rng.getState(),
  recursos: g.grid.cells.map((c) => c.resources),
});

// Partida con aldea y bajas: la que más estado tiene que conservar. Se calcula una vez.
let _larga;
const larga = () => (_larga ??= (() => { const g = createGame(3); stepGame(g, 24 * 70); return g; })());

// --- Ida y vuelta --------------------------------------------------------------------------------

test('serialize y deserialize reproducen el estado de la simulación', () => {
  const g = createGame(55); stepGame(g, 1500);
  const r = deserialize(serialize(g));
  assert.equal(r.clock.tick, g.clock.tick);
  assert.deepEqual(r.band, g.band);
  assert.deepEqual(r.discovery.toJSON(), g.discovery.toJSON());
  assert.deepEqual(r.chronicle.entries, g.chronicle.entries);
});

test('la ida y vuelta por JSON real reproduce todo el estado, incluido el azar', () => {
  const g = larga();
  assert.deepEqual(estado(recargar(g)), estado(g));
});

test('tras recargar, la simulación sigue igual que sin recargar', () => {
  const a = createGame(56); stepGame(a, 800);
  const b = deserialize(serialize(a));
  stepGame(a, 400); stepGame(b, 400);
  assert.deepEqual(b.band, a.band);
});

test('continuar una partida con aldea recargada es idéntico a no haber recargado', () => {
  const a = createGame(3); stepGame(a, 24 * 40);
  assert.ok(a.settlement, 'la prueba necesita una aldea fundada');
  const b = recargar(a);
  stepGame(a, 24 * 30); stepGame(b, 24 * 30);
  assert.deepEqual(estado(b), estado(a));
});

test('recargar y continuar con advanceGame también coincide', () => {
  const a = createGame(56); stepGame(a, 300);
  const b = recargar(a);
  for (let i = 0; i < 40; i++) { advanceGame(a, 1000, 4); advanceGame(b, 1000, 4); }
  assert.deepEqual(estado(b), estado(a));
});

test('recargar dos veces seguidas no cambia nada', () => {
  const g = larga();
  assert.deepEqual(estado(recargar(recargar(g))), estado(g));
});

test('una partida terminada (sin supervivientes) se recarga terminada', () => {
  const g = createGame(5); stepGame(g, 10);
  for (const n of g.band.npcs) n.alive = false;
  stepGame(g, 1);
  assert.equal(g.over, true);
  const r = recargar(g);
  assert.equal(r.over, true);
  assert.deepEqual(estado(r), estado(g));
});

test('la presión del invierno y todo lo demás se conserva: campos de la banda uno a uno', () => {
  const g = larga();
  const r = recargar(g);
  for (const campo of ['recentDeaths', 'approach', 'abandonedSites', 'lastEvalPressure', 'lastDecisionKey', 'lastEvaluation', 'site', 'settled', 'x', 'y', 'inventory']) {
    assert.deepEqual(r.band[campo], g.band[campo], campo);
  }
});

// --- Piezas que se pierden en silencio ---------------------------------------------------------------

test('cada NPC conserva su saturación acumulada', () => {
  const g = createGame(61); stepGame(g, 100);
  g.band.npcs[0].saturacion = 17;
  g.band.npcs[1].saturacion = 3;
  const r = recargar(g);
  assert.equal(r.band.npcs[0].saturacion, 17);
  assert.equal(r.band.npcs[1].saturacion, 3);
});

test('las muertes recientes (decaimiento) sobreviven', () => {
  const g = createGame(62); stepGame(g, 50);
  g.band.recentDeaths = 2.5;
  assert.equal(recargar(g).band.recentDeaths, 2.5);
});

test('los NPCs conservan identidad: ids, vivos y muertos, sin repeticiones', () => {
  const g = larga();
  const r = recargar(g);
  assert.deepEqual(r.band.npcs.map((n) => [n.id, n.alive, n.nombre]), g.band.npcs.map((n) => [n.id, n.alive, n.nombre]));
  assert.equal(new Set(r.band.npcs.map((n) => n.id)).size, r.band.npcs.length);
  assert.equal(livingNpcs(r.band).length, livingNpcs(g.band).length);
});

test('las entradas de hito de la crónica conservan keep y no se desalojan tras recargar', () => {
  const g = larga();
  assert.ok(g.chronicle.entries.some((e) => e.keep), 'la prueba necesita hitos');
  const r = recargar(g);
  assert.deepEqual(r.chronicle.entries.map((e) => !!e.keep), g.chronicle.entries.map((e) => !!e.keep));
  const inicio = r.chronicle.entries.find((e) => e.type === 'inicio');
  assert.ok(inicio);
  // Llenarla de rutina no puede desalojar el hito fundacional.
  const lleno = recargar(createGame(70));
  for (let i = 0; i < MAX_ENTRADAS + 50; i++) lleno.chronicle.entries.push({ day: 1, type: 'banda', text: `r${i}` });
  stepGame(lleno, 400);
  assert.ok(lleno.chronicle.entries.some((e) => e.type === 'inicio'), 'el inicio se desalojó: se perdió keep');
});

test('la aldea es una sola: game.settlement es el objeto de la banda tras cargar', () => {
  const r = recargar(larga());
  assert.ok(r.band.settlement);
  assert.equal(r.settlement, r.band.settlement);
  stepGame(r, 24);
  assert.equal(r.settlement, r.band.settlement);
});

test('el guardado serializa la aldea una sola vez', () => {
  const g = larga();
  const json = JSON.stringify(serialize(g));
  const marca = `"foundedDay":${g.settlement.foundedDay}`;
  assert.equal(json.split(marca).length - 1, 1, 'la aldea está duplicada en el guardado');
});

test('el coste de los edificios no se guarda y se reconstruye desde BUILDINGS', () => {
  const g = larga();
  const datos = viaJson(serialize(g));
  for (const b of datos.settlement.buildings) assert.ok(!('cost' in b), 'cost no debe guardarse');
  const r = deserialize(datos);
  for (const b of r.settlement.buildings) {
    assert.deepEqual(b.cost, BUILDINGS.find((d) => d.id === b.id).cost);
  }
  // Y es una copia: mutar la de la partida no toca el catálogo.
  r.settlement.buildings[0].cost.leña = 999;
  assert.notEqual(BUILDINGS[0].cost.leña, 999);
});

test('una aldea a medio construir conserva progreso y cola', () => {
  const g = larga();
  const r = recargar(g);
  assert.deepEqual(r.settlement.queue, g.settlement.queue);
  assert.deepEqual(r.settlement.buildings.map((b) => [b.progress, b.done]), g.settlement.buildings.map((b) => [b.progress, b.done]));
});

test('un valor no finito (approach.mejor = Infinity) sobrevive al JSON', () => {
  const g = createGame(63); stepGame(g, 30);
  g.band.approach = { x: 1, y: 2, mejor: Infinity, sinAvance: 3 };
  const r = recargar(g);
  assert.equal(r.band.approach.mejor, Infinity);
});

test('lastDecision sobrevive a la ida y vuelta', () => {
  const g = larga();
  assert.ok(g.lastDecision, 'la prueba necesita una decisión');
  assert.deepEqual(recargar(g).lastDecision, g.lastDecision);
});

// --- Tamaño y forma ----------------------------------------------------------------------------------

test('el guardado no incluye la rejilla generada', () => {
  const g = createGame(57); stepGame(g, 300);
  const json = JSON.stringify(serialize(g));
  assert.ok(!json.includes('"elevation"'), 'la rejilla se está guardando');
  assert.ok(!json.includes('"biome"'), 'la rejilla se está guardando');
});

test('un guardado típico es pequeño frente a la rejilla', () => {
  const g = larga();
  const bytes = JSON.stringify(serialize(g)).length;
  const rejilla = JSON.stringify(g.grid.cells).length;
  assert.ok(bytes < rejilla / 5, `${bytes} bytes frente a ${rejilla} de rejilla`);
  assert.ok(bytes < 200 * 1024, `${bytes} bytes: no cabe con holgura en localStorage`);
});

test('los recursos consumidos sobreviven a la ida y vuelta', () => {
  const g = createGame(58); stepGame(g, 1500);
  const r = deserialize(serialize(g));
  for (const c of g.grid.cells) {
    assert.deepEqual(r.grid.at(c.x, c.y).resources, c.resources);
  }
});

test('las diferencias de recursos son solo de celdas que cambiaron', () => {
  const g = createGame(58); stepGame(g, 5);
  const datos = serialize(g);
  assert.ok(datos.resources.length < g.grid.cells.length, 'se guardan todas las celdas');
  for (const d of datos.resources) assert.equal(d.length, 3);
});

test('el reloj se restaura al tick guardado', () => {
  const g = createGame(64); stepGame(g, 777);
  const r = recargar(g);
  assert.equal(r.clock.tick, 777);
  assert.equal(r.clock.hour, g.clock.hour);
  assert.equal(r.clock.season, g.clock.season);
});

test('la partida recargada no comparte objetos mutables con el guardado', () => {
  const g = createGame(65); stepGame(g, 100);
  const datos = serialize(g);
  const r = deserialize(datos);
  r.band.inventory.leña = 12345;
  r.chronicle.entries.length = 0;
  assert.notEqual(datos.band.inventory.leña, 12345);
  assert.ok(datos.chronicle.length > 0);
});

test('serialize no cambia la partida', () => {
  const g = createGame(66); stepGame(g, 200);
  const antes = viaJson(estado(g));
  serialize(g);
  assert.deepEqual(viaJson(estado(g)), antes);
});

test('serialize rechaza un mundo que la semilla no reproduce', () => {
  const g = createGame(67, { riverCount: 0 });
  assert.throws(() => serialize(g), /semilla/i);
});

test('el tamaño del mundo se conserva', () => {
  const g = createGame(68, { width: 40, height: 40 });
  const r = recargar(g);
  assert.equal(r.grid.width, 40);
  assert.equal(r.grid.height, 40);
});

// --- Migración y datos dañados -----------------------------------------------------------------

test('migrate lleva una partida sin version a la versión actual', () => {
  const data = serialize(createGame(59));
  delete data.version;
  assert.equal(migrate(data).version, SCHEMA_VERSION);
});

test('migrate no muta su entrada', () => {
  const data = serialize(createGame(59));
  delete data.version;
  migrate(data);
  assert.equal(data.version, undefined);
});

test('migrate rechaza una versión superior a la soportada', () => {
  const data = serialize(createGame(60));
  data.version = SCHEMA_VERSION + 1;
  assert.throws(() => migrate(data), /version/i);
  assert.throws(() => migrate(data), UnsupportedVersionError);
});

test('migrate rechaza lo que no es un objeto o tiene una versión absurda', () => {
  for (const malo of [null, 'texto', 7, [], { version: 'x' }, { version: -1 }, { version: 1.5 }]) {
    assert.throws(() => migrate(malo), Error, JSON.stringify(malo));
  }
});

test('deserialize rechaza un guardado incompleto en lugar de inventar estado', () => {
  const datos = viaJson(serialize(createGame(69)));
  for (const campo of ['seed', 'tick', 'band', 'discovery', 'chronicle', 'resources', 'rng']) {
    const roto = { ...datos }; delete roto[campo];
    assert.throws(() => deserialize(roto), Error, campo);
  }
});

test('deserialize rechaza edificios desconocidos', () => {
  const datos = viaJson(serialize(larga()));
  datos.settlement.buildings[0].id = 'castillo';
  assert.throws(() => deserialize(datos), Error);
});

// --- Slots ---------------------------------------------------------------------------------------

test('createSlot, listSlots y deleteSlot gestionan el índice', () => {
  const store = createStore(memoria());
  const slot = store.createSlot('Primera', 7);
  assert.equal(store.listSlots().length, 1);
  store.deleteSlot(slot.id);
  assert.deepEqual(store.listSlots(), []);
});

test('un slot nuevo trae sus metadatos completos y ids distintos', () => {
  const store = createStore(memoria());
  const a = store.createSlot('A', 1), b = store.createSlot('B', 2);
  assert.notEqual(a.id, b.id);
  assert.equal(a.nombre, 'A');
  assert.equal(a.day, 0);
  assert.equal(a.settled, false);
  assert.equal(a.thumbnail, null);
  assert.equal(typeof a.updatedAt, 'number');
  assert.equal(typeof a.era, 'string');
  assert.ok(a.era.length > 0);
});

test('createSlot no reutiliza el id de un slot borrado ni de uno ya existente', () => {
  const store = createStore(memoria());
  const ids = new Set();
  for (let i = 0; i < 6; i++) {
    const s = store.createSlot(`S${i}`, i);
    assert.ok(!ids.has(s.id), 'id repetido');
    ids.add(s.id);
    if (i % 2) store.deleteSlot(s.id);
  }
});

test('el nombre se limpia: vacío cae a un nombre por defecto y se acota', () => {
  const store = createStore(memoria());
  assert.ok(store.createSlot('   ', 1).nombre.length > 0);
  assert.ok(store.createSlot('x'.repeat(500), 2).nombre.length <= 60);
});

test('writeSlot actualiza los metadatos del índice', () => {
  const store = createStore(memoria());
  const slot = store.createSlot('Partida', 8);
  const g = createGame(8); stepGame(g, 24 * 10);
  assert.equal(store.writeSlot(slot.id, g).ok, true);
  const leido = store.listSlots().find((s) => s.id === slot.id);
  assert.equal(leido.day, g.clock.day);
  assert.equal(leido.poblacion, livingNpcs(g.band).length);
  assert.equal(leido.settled, g.band.settled);
});

test('writeSlot refleja la aldea en los metadatos', () => {
  const store = createStore(memoria());
  const slot = store.createSlot('Aldea', 3);
  store.writeSlot(slot.id, larga());
  const m = store.listSlots()[0];
  assert.equal(m.settled, true);
  assert.equal(m.day, larga().clock.day);
});

test('writeSlot y readSlot devuelven una partida equivalente', () => {
  const store = createStore(memoria());
  const slot = store.createSlot('P', 3);
  store.writeSlot(slot.id, larga());
  const r = store.readSlot(slot.id);
  assert.equal(r.ok, true);
  assert.deepEqual(estado(r.game), estado(larga()));
});

test('writeSlot sobre un slot que no existe informa del fallo sin lanzar', () => {
  const store = createStore(memoria());
  const r = store.writeSlot('no-existe', createGame(1));
  assert.equal(r.ok, false);
  assert.ok(r.error.length > 0);
});

test('readSlot de un slot sin partida escrita informa sin lanzar', () => {
  const store = createStore(memoria());
  const slot = store.createSlot('Vacía', 1);
  const r = store.readSlot(slot.id);
  assert.equal(r.ok, false);
  assert.ok(r.error.length > 0);
});

test('renameSlot cambia el nombre y conserva la partida', () => {
  const store = createStore(memoria());
  const slot = store.createSlot('Vieja', 9);
  store.writeSlot(slot.id, createGame(9));
  store.renameSlot(slot.id, 'Nueva');
  assert.equal(store.listSlots()[0].nombre, 'Nueva');
  assert.equal(store.readSlot(slot.id).ok, true);
});

test('renameSlot de un slot inexistente no lanza ni crea nada', () => {
  const store = createStore(memoria());
  store.renameSlot('fantasma', 'X');
  assert.deepEqual(store.listSlots(), []);
});

test('deleteSlot borra solo su partida', () => {
  const store = createStore(memoria());
  const a = store.createSlot('A', 1), b = store.createSlot('B', 2);
  store.writeSlot(a.id, createGame(1)); store.writeSlot(b.id, createGame(2));
  store.deleteSlot(a.id);
  assert.equal(store.readSlot(b.id).ok, true);
  assert.equal(store.listSlots().length, 1);
  assert.equal(store.listSlots()[0].id, b.id);
});

test('deleteSlot elimina la clave de datos del slot y deja la de los demás', () => {
  const mem = memoria();
  const store = createStore(mem);
  const a = store.createSlot('A', 1), b = store.createSlot('B', 2);
  store.writeSlot(a.id, createGame(1)); store.writeSlot(b.id, createGame(2));
  store.deleteSlot(a.id);
  assert.equal(mem.getItem(`huehuet.save.${a.id}`), null);
  assert.notEqual(mem.getItem(`huehuet.save.${b.id}`), null);
});

test('las claves de almacenamiento son las del contrato', () => {
  const mem = memoria();
  const store = createStore(mem);
  const s = store.createSlot('A', 1);
  store.writeSlot(s.id, createGame(1));
  assert.notEqual(mem.getItem('huehuet.saves.v1'), null);
  assert.notEqual(mem.getItem(`huehuet.save.${s.id}`), null);
  assert.ok(!mem.getItem('huehuet.saves.v1').includes('"resources"'), 'el índice no lleva datos de partida');
});

test('el índice persiste: otro store sobre el mismo almacenamiento ve los slots', () => {
  const mem = memoria();
  const s = createStore(mem).createSlot('Persistente', 4);
  const otro = createStore(mem);
  assert.equal(otro.listSlots()[0].id, s.id);
  assert.equal(otro.listSlots()[0].nombre, 'Persistente');
});

test('la sonda de disponibilidad no deja basura en el almacenamiento', () => {
  const mem = memoria();
  createStore(mem);
  assert.equal(mem._datos.size, 0);
});

// --- Fallos de almacenamiento ------------------------------------------------------------------

test('writeSlot informa del fallo sin lanzar cuando el almacenamiento está lleno', () => {
  const store = createStore(memoriaQueFalla());
  const slot = store.createSlot('X', 1);
  const r = store.writeSlot(slot.id, createGame(1));
  assert.equal(r.ok, false);
  assert.ok(r.error.length > 0);
});

test('un fallo de escritura no deja el índice diciendo que la partida está guardada', () => {
  const store = createStore(memoriaQueFalla());
  const slot = store.createSlot('X', 1);
  const g = createGame(1); stepGame(g, 24 * 5);
  store.writeSlot(slot.id, g);
  assert.equal(store.listSlots()[0].day, 0);
});

test('un fallo de escritura conserva la partida anterior ya guardada', () => {
  const mem = memoria();
  const store = createStore(mem);
  const slot = store.createSlot('X', 1);
  store.writeSlot(slot.id, createGame(1));
  const antes = mem.getItem(`huehuet.save.${slot.id}`);
  const set = mem.setItem;
  mem.setItem = () => { throw cuotaExcedida(); };
  const r = store.writeSlot(slot.id, larga());
  mem.setItem = set;
  assert.equal(r.ok, false);
  assert.equal(mem.getItem(`huehuet.save.${slot.id}`), antes);
  assert.equal(store.readSlot(slot.id).ok, true);
});

test('con el almacenamiento lleno la sesión sigue: createSlot devuelve un slot en memoria', () => {
  const store = createStore(memoriaSinEscritura());
  const slot = store.createSlot('X', 1);
  assert.ok(slot.id);
  assert.equal(store.writeSlot(slot.id, createGame(1)).ok, false);
  assert.equal(store.listSlots().length, 1);
  assert.equal(store.available, false);
});

test('la advertencia por almacenamiento no disponible se emite una sola vez', () => {
  const avisos = [];
  const store = createStore(memoriaInaccesible(), { warn: (m) => avisos.push(m) });
  store.createSlot('A', 1); store.createSlot('B', 2);
  store.writeSlot(store.listSlots()[0].id, createGame(1));
  store.writeSlot(store.listSlots()[0].id, createGame(1));
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /[a-záéíóúñ]/i);
});

test('un almacenamiento inaccesible deja available en falso sin lanzar', () => {
  const store = createStore(memoriaInaccesible());
  assert.equal(store.available, false);
  assert.deepEqual(store.listSlots(), []);
});

test('con almacenamiento inaccesible todo el contrato sigue sin lanzar', () => {
  const store = createStore(memoriaInaccesible());
  const s = store.createSlot('A', 1);
  assert.doesNotThrow(() => store.renameSlot(s.id, 'B'));
  assert.equal(store.writeSlot(s.id, createGame(1)).ok, false);
  assert.equal(store.readSlot(s.id).ok, false);
  assert.doesNotThrow(() => store.deleteSlot(s.id));
});

test('sin almacenamiento alguno (undefined) tampoco lanza', () => {
  const store = createStore(undefined);
  assert.equal(typeof store.available, 'boolean');
  assert.doesNotThrow(() => store.listSlots());
});

test('un almacenamiento que funciona deja available en verdadero', () => {
  assert.equal(createStore(memoria()).available, true);
});

// --- Guardados dañados -------------------------------------------------------------------------

test('una partida con JSON corrupto se marca como dañada sin romper la lista', () => {
  const mem = memoria();
  const store = createStore(mem);
  const slot = store.createSlot('Rota', 1);
  store.writeSlot(slot.id, createGame(1));
  mem.setItem(`huehuet.save.${slot.id}`, '{esto no es json');
  const r = store.readSlot(slot.id);
  assert.equal(r.ok, false);
  assert.equal(r.damaged, true);
  assert.equal(store.listSlots().length, 1);
  assert.equal(store.listSlots()[0].damaged, true);
});

test('el daño persiste en el índice y el slot dañado se puede borrar', () => {
  const mem = memoria();
  const store = createStore(mem);
  const a = store.createSlot('Sana', 2), b = store.createSlot('Rota', 1);
  store.writeSlot(a.id, createGame(2)); store.writeSlot(b.id, createGame(1));
  mem.setItem(`huehuet.save.${b.id}`, '{x');
  store.readSlot(b.id);
  assert.equal(createStore(mem).listSlots().find((s) => s.id === b.id).damaged, true);
  assert.equal(store.readSlot(a.id).ok, true);
  store.deleteSlot(b.id);
  assert.equal(mem.getItem(`huehuet.save.${b.id}`), null);
  assert.equal(store.listSlots().length, 1);
});

test('un JSON válido con estructura rota también se marca como dañado', () => {
  const mem = memoria();
  const store = createStore(mem);
  const slot = store.createSlot('Rota', 1);
  store.writeSlot(slot.id, createGame(1));
  const datos = JSON.parse(mem.getItem(`huehuet.save.${slot.id}`));
  delete datos.band;
  mem.setItem(`huehuet.save.${slot.id}`, JSON.stringify(datos));
  const r = store.readSlot(slot.id);
  assert.equal(r.ok, false);
  assert.equal(r.damaged, true);
});

test('una partida que no es un objeto JSON se marca como dañada', () => {
  const mem = memoria();
  const store = createStore(mem);
  const slot = store.createSlot('Rota', 1);
  for (const raro of ['null', '42', '"texto"', '[]']) {
    mem.setItem(`huehuet.save.${slot.id}`, raro);
    const r = store.readSlot(slot.id);
    assert.equal(r.ok, false, raro);
    assert.equal(r.damaged, true, raro);
  }
});

test('una versión de guardado superior se rechaza con un mensaje y sin marcar daño', () => {
  const mem = memoria();
  const store = createStore(mem);
  const slot = store.createSlot('Futura', 1);
  store.writeSlot(slot.id, createGame(1));
  const datos = JSON.parse(mem.getItem(`huehuet.save.${slot.id}`));
  datos.version = SCHEMA_VERSION + 1;
  mem.setItem(`huehuet.save.${slot.id}`, JSON.stringify(datos));
  const r = store.readSlot(slot.id);
  assert.equal(r.ok, false);
  assert.ok(!r.damaged, 'una versión nueva no es un daño: no hay que invitar a borrarla');
  assert.match(r.error, /versi[oó]n/i);
  assert.equal(r.unsupported, true);
  // y el dato no se tocó
  assert.equal(JSON.parse(mem.getItem(`huehuet.save.${slot.id}`)).version, SCHEMA_VERSION + 1);
});

test('readSlot no lanza si el almacenamiento falla al leer', () => {
  const mem = memoria();
  const store = createStore(mem);
  const slot = store.createSlot('X', 1);
  store.writeSlot(slot.id, createGame(1));
  mem.getItem = () => { throw new Error('boom'); };
  let r;
  assert.doesNotThrow(() => { r = store.readSlot(slot.id); });
  assert.equal(r.ok, false);
});

test('un índice corrupto no impide arrancar', () => {
  const mem = memoria();
  mem.setItem('huehuet.saves.v1', 'basura');
  assert.deepEqual(createStore(mem).listSlots(), []);
});

test('un índice con forma incorrecta se trata como vacío y se puede seguir creando', () => {
  for (const raro of ['{"a":1}', 'null', '"x"', '7']) {
    const mem = memoria();
    mem.setItem('huehuet.saves.v1', raro);
    const store = createStore(mem);
    assert.deepEqual(store.listSlots(), [], raro);
    store.createSlot('Nueva', 1);
    assert.equal(store.listSlots().length, 1, raro);
  }
});

test('un índice con entradas basura conserva las válidas', () => {
  const mem = memoria();
  const store = createStore(mem);
  const s = store.createSlot('Buena', 1);
  const idx = JSON.parse(mem.getItem('huehuet.saves.v1'));
  const lista = Array.isArray(idx) ? idx : idx.slots;
  lista.push(null, 5, 'x', { sinId: true });
  mem.setItem('huehuet.saves.v1', JSON.stringify(Array.isArray(idx) ? lista : { ...idx, slots: lista }));
  const ids = createStore(mem).listSlots().map((x) => x.id);
  assert.deepEqual(ids, [s.id]);
});

test('listSlots no lanza si el almacenamiento falla al leer el índice', () => {
  const mem = memoria();
  const store = createStore(mem);
  store.createSlot('X', 1);
  mem.getItem = () => { throw new Error('boom'); };
  assert.doesNotThrow(() => store.listSlots());
});

// --- Pureza ------------------------------------------------------------------------------------

test('src/save/schema.js no usa APIs ambientales ni almacenamiento', () => {
  const hallazgos = ambientUses(readFileSync(new URL('../../src/save/schema.js', import.meta.url), 'utf8'));
  assert.deepEqual(hallazgos, [], `schema.js usa ${hallazgos.join(', ')}`);
});

test('src/save/store.js no alcanza el almacenamiento global por su cuenta', () => {
  const fuente = ambientUses(readFileSync(new URL('../../src/save/store.js', import.meta.url), 'utf8'));
  // Lo único ambiental permitido: el valor por defecto del almacenamiento y el reloj de pared de updatedAt.
  assert.deepEqual(fuente.filter((u) => !['globalThis', 'localStorage', 'Date.now'].includes(u)), [], 'store.js usa APIs ambientales');
  const texto = readFileSync(new URL('../../src/save/store.js', import.meta.url), 'utf8');
  assert.equal((texto.match(/globalThis/g) ?? []).length, 1, 'globalThis solo en el valor por defecto');
  assert.equal((texto.match(/Date\.now/g) ?? []).length, 1, 'Date.now solo como reloj por defecto');
});

test('solo store.js toca el almacenamiento: ningún otro módulo de src/ lo nombra', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const raiz = new URL('../../src/', import.meta.url).pathname;
  const ficheros = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? ficheros(join(d, n)) : [join(d, n)]));
  for (const f of ficheros(raiz).filter((x) => x.endsWith('.js') && !x.endsWith('save/store.js'))) {
    assert.ok(!/localStorage|sessionStorage|indexedDB/.test(readFileSync(f, 'utf8')), `${f} toca el almacenamiento`);
  }
});

test('el rng reanuda su flujo exactamente desde el estado guardado', async () => {
  const { createRng } = await import('../../src/core/rng.js');
  const a = createRng(9); for (let i = 0; i < 17; i++) a.next();
  const b = createRng(9); b.setState(a.getState());
  assert.deepEqual([a.next(), a.int(0, 99), a.chance(0.5)], [b.next(), b.int(0, 99), b.chance(0.5)]);
});

// --- Revisión: regeneración documentada, coste en frío, setState estricto, línea base aislada ------

test('schema.js documenta que cambiar la regeneración exige subir SCHEMA_VERSION y migrar', () => {
  const fuente = readFileSync(new URL('../../src/save/schema.js', import.meta.url), 'utf8');
  const [antesDeVersion] = fuente.split('export const SCHEMA_VERSION');
  const [, antesDeMemo] = fuente.split('const sumaDeRecursos');
  const nota = /REGEN_BIOMES[^]*regenPerDay/;
  const exige = /sub(ir|e) SCHEMA_VERSION/;
  assert.ok(nota.test(antesDeVersion.slice(-1500)) && exige.test(antesDeVersion.slice(-1500)), 'falta la nota junto a SCHEMA_VERSION');
  const cuerpo = fuente.slice(fuente.indexOf('const sumaDeRecursos'), fuente.indexOf('const CAPACIDAD_MEMO'));
  assert.ok(nota.test(cuerpo) && exige.test(cuerpo), 'falta la nota junto a la línea base');
  assert.ok(antesDeMemo.length > 0);
});

test('writeSlot con almacenamiento bloqueado no serializa la partida', () => {
  const store = createStore(memoriaInaccesible());
  const slot = store.createSlot('X', 1);
  let accesos = 0;
  const espia = new Proxy(createGame(1), { get(t, p) { accesos++; return Reflect.get(t, p); } });
  const r = store.writeSlot(slot.id, espia);
  assert.equal(r.ok, false);
  assert.equal(accesos, 0, 'se serializó para nada');
});

test('alternar entre dos semillas no vuelve a pagar el coste en frío', () => {
  const a = createGame(101); stepGame(a, 24 * 3);
  const b = createGame(102); stepGame(b, 24 * 3);
  let t = performance.now(); serialize(a); const fria = performance.now() - t;
  serialize(b);
  t = performance.now(); serialize(a); serialize(b); const tibia = (performance.now() - t) / 2;
  assert.ok(tibia < fria / 3, `alternar cuesta ${tibia.toFixed(0)} ms frente a ${fria.toFixed(0)} ms en frío`);
});

test('la memoria de líneas base está acotada (no crece sin límite)', () => {
  for (let s = 200; s < 230; s++) lineaBase(s, 8, 8, 0, null);
  assert.ok(lineaBase.tamano() <= 4);
});

test('lineaBase devuelve una copia: mutarla no corrompe guardados posteriores', () => {
  const g = createGame(103); stepGame(g, 48);
  const antes = JSON.stringify(serialize(g));
  const base = lineaBase(g.seed, g.grid.width, g.grid.height, g.clock.tick);
  for (const c of base) { c.biome = 'x'; for (const k of Object.keys(c.resources)) c.resources[k] = -1; }
  assert.equal(JSON.stringify(serialize(g)), antes);
});

test('rng.setState rechaza lo que no es un entero de 32 bits', async () => {
  const { createRng } = await import('../../src/core/rng.js');
  const r = createRng(1);
  for (const malo of [undefined, NaN, Infinity, 1.5, '7', null, -1, 2 ** 32, 2 ** 32 + 5]) {
    assert.throws(() => r.setState(malo), /estado|state/i, String(malo));
  }
  const antes = r.getState();
  assert.throws(() => r.setState(NaN));
  assert.equal(r.getState(), antes, 'un valor malo no debe tocar el estado');
  r.setState(2 ** 32 - 1); assert.equal(r.getState(), 2 ** 32 - 1);
  r.setState(0); assert.equal(r.getState(), 0);
});
