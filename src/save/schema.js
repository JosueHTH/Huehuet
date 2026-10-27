// El esquema del guardado: convierte una partida viva en datos planos y los devuelve a una partida viva.
// Pura: nada de almacenamiento, ventana, reloj de pared ni azar global. Quien guarda es store.js.
//
// "Semilla más diferencias": el terreno es función pura de la semilla, así que no se guarda. Se guarda lo
// que la simulación ha cambiado desde que nació: recursos consumidos o regenerados, territorio descubierto,
// la banda, la aldea, la crónica, el reloj y el estado del azar. Cargar regenera el mundo y aplica eso encima.
import { MS_POR_TICK, createGame } from '../game.js';
import { createClock } from '../core/clock.js';
import { generateWorld } from '../world/worldgen.js';
import { RESOURCES, regenerateResources } from '../world/resources.js';
import { discoveryFromJSON } from '../world/discovery.js';
import { BUILDINGS } from '../tribe/settlement.js';
import { livingNpcs } from '../tribe/band.js';

// ATENCIÓN antes de tocar la regeneración de recursos (REGEN_BIOMES, regenPerDay, max o la lógica de
// regenerateResources en world/resources.js) o el generador del mundo: el guardado NO almacena las celdas que
// nadie ha tocado. Las recalcula al cargar ejecutando el código de regeneración VIVO sobre el mundo de la
// semilla (ver lineaBase). Cambiar esas constantes o esa lógica altera, sin aviso ni error, el estado de toda
// partida ya guardada. Si hace falta cambiarlas: sube SCHEMA_VERSION y añade en MIGRACIONES una migración que
// fije los recursos de la versión antigua (o recalcúlalos con la regla antigua). Así una partida de la Etapa 1
// sigue abriéndose igual en la Etapa 2.
export const SCHEMA_VERSION = 1;

export class UnsupportedVersionError extends Error {
  constructor(version) {
    super(`Esta partida es de una versión más nueva del juego (schema version ${version}; este juego entiende hasta la ${SCHEMA_VERSION}). Actualiza el juego para abrirla.`);
    this.name = 'UnsupportedVersionError';
    this.version = version;
  }
}

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// --- Migración -----------------------------------------------------------------------------------

// MIGRACIONES[v] lleva un guardado de la versión v a la v + 1. Cada una recibe un objeto que puede tocar.
// La 0 es el guardado sin campo `version`: tiene ya la forma de la 1, solo le falta el sello.
const MIGRACIONES = [
  (datos) => ({ ...datos, version: 1 }),
];

export function migrate(data) {
  if (!esObjeto(data)) throw new Error('El guardado no es un objeto.');
  const origen = data.version ?? 0;
  if (!Number.isInteger(origen) || origen < 0) throw new Error(`El guardado trae una version inválida (${String(origen)}).`);
  if (origen > SCHEMA_VERSION) throw new UnsupportedVersionError(origen);
  let actual = { ...data };
  for (let v = origen; v < SCHEMA_VERSION; v++) actual = MIGRACIONES[v](actual);
  return actual;
}

// --- Valores no finitos --------------------------------------------------------------------------

// JSON convierte Infinity y NaN en null y se lleva por delante lo que la banda lleva dentro (approach.mejor
// arranca en Infinity). Se marcan para que vuelvan como lo que eran. De paso se copia en profundidad.
const NO_FINITOS = { Infinity, '-Infinity': -Infinity, NaN };

function codificar(valor) {
  if (typeof valor === 'number' && !Number.isFinite(valor)) return { $num: String(valor) };
  if (Array.isArray(valor)) return valor.map(codificar);
  if (esObjeto(valor)) {
    const salida = {};
    for (const [k, v] of Object.entries(valor)) if (v !== undefined) salida[k] = codificar(v);
    return salida;
  }
  return valor;
}

function decodificar(valor) {
  if (Array.isArray(valor)) return valor.map(decodificar);
  if (esObjeto(valor)) {
    if (typeof valor.$num === 'string' && Object.keys(valor).length === 1 && valor.$num in NO_FINITOS) return NO_FINITOS[valor.$num];
    const salida = {};
    for (const [k, v] of Object.entries(valor)) salida[k] = decodificar(v);
    return salida;
  }
  return valor;
}

// --- Metadatos para la lista de partidas ---------------------------------------------------------

// Lo que la pantalla de slots muestra sin abrir la partida. `era` es una etiqueta de cara al jugador.
export function describe(game) {
  const settled = Boolean(game.band.settled);
  return {
    day: game.clock.day,
    poblacion: livingNpcs(game.band).length,
    settled,
    era: settled ? 'Aldea' : 'Nómadas',
  };
}

// --- Serializar ----------------------------------------------------------------------------------

const sumaDeRecursos = (celda) => Object.values(celda.resources).reduce((suma, v) => suma + v, 0);

// La línea base: la rejilla recién generada, llevada a lo que sería tras `tick` horas de regeneración SIN que
// nadie tocara nada. Las diferencias se guardan contra ella. Contra el mundo virgen casi todas las celdas
// diferirían (el mundo nace por debajo de su máximo y la regeneración lo sube en todas partes: 400 KB tras un
// día); contra esta línea solo quedan las celdas que la banda gastó y aún no se han repuesto.
// Usa la regeneración real, un tick cada vez, para coincidir bit a bit con la simulación, y deja de tocar las
// celdas que ya no cambian (casi todas en un par de días). Aun así cuesta ~0,5 s desde cero, así que se
// recuerdan las últimas (memoización de una función pura: misma semilla, mismo tamaño, tick mayor o igual).
//
// POR QUÉ importa: las celdas intactas no se guardan; se recalculan aquí con la regeneración viva. Cualquier
// cambio en REGEN_BIOMES, regenPerDay, max o regenerateResources cambia lo que las partidas viejas cargan.
// Ese cambio exige subir SCHEMA_VERSION y migrar (ver la nota junto a SCHEMA_VERSION).
//
// Acotada a CAPACIDAD_MEMO entradas (4: dos o tres ranuras alternándose y alguna más; ~9k celdas ligeras
// cada una, unos pocos MB). Si se llena sale la menos usada. Cambiar de ranura no vuelve a pagar el coste en frío.
const CAPACIDAD_MEMO = 4;
const recuerdos = new Map();   // clave -> { tick, celdas, activas }; el orden de inserción es el de uso

const ligera = (grid) => grid.cells.map((c) => ({ biome: c.biome, resources: { ...c.resources } }));

export function lineaBase(seed, ancho, alto, tick, virgen) {
  const clave = `${seed}|${ancho}|${alto}`;
  let recuerdo = recuerdos.get(clave);
  recuerdos.delete(clave);
  if (!recuerdo || recuerdo.tick > tick) {
    const celdas = ligera(virgen ?? generateWorld(seed, { width: ancho, height: alto }).grid);
    recuerdo = { tick: 0, celdas, activas: celdas };
  }
  recuerdos.set(clave, recuerdo);   // la más reciente al final
  while (recuerdos.size > CAPACIDAD_MEMO) recuerdos.delete(recuerdos.keys().next().value);
  while (recuerdo.tick < tick && recuerdo.activas.length > 0) {
    const antes = recuerdo.activas.map(sumaDeRecursos);
    regenerateResources({ cells: recuerdo.activas }, 1);
    recuerdo.activas = recuerdo.activas.filter((celda, i) => sumaDeRecursos(celda) !== antes[i]);
    recuerdo.tick++;
  }
  recuerdo.tick = tick;   // sin celdas activas, los ticks que faltan no cambian nada
  // Una copia: quien la reciba puede mutarla sin corromper la memoria que alimenta todos los guardados.
  return ligera({ cells: recuerdo.celdas });
}
lineaBase.tamano = () => recuerdos.size;

// Pone la memoria de lineaBase al día de la partida, para que guardar no tenga que ponerse al día dentro de
// un fotograma.
//
// POR QUÉ: medido, el primer autoguardado de una partida nueva paraba la página 283-333 ms dentro de un
// solo fotograma, veinte fotogramas seguidos perdidos. Serializar necesita la línea base al tick de ahora, y
// con la memoria en el tick 0 lineaBase tenía que reponer 120 ticks de golpe sobre las 9216 celdas. La
// pantalla de slots calienta en tiempo libre, pero solo hasta el tick que el slot tenía guardado, y el
// jugador pulsa «Continuar» antes de que el hueco llegue.
//
// Llamarla a menudo (una vez por hueco libre) reparte ese coste en trozos de milisegundos que además
// decrecen solos: las celdas dejan de cambiar en un par de días y la reposición se queda sin nada que hacer.
//
// NUNCA por delante de la partida: pedir a lineaBase un tick MENOR que el recordado le obliga a generar el
// mundo entero otra vez, que es medio segundo. Por eso el tick que se pide es siempre el del reloj.
// En el tick 0 la rejilla de la partida es virgen (nadie ha gastado ni repuesto nada), así que sirve de
// línea base tal cual y no hay que generar un segundo mundo idéntico al que createGame acaba de generar.
export function calentarLinea(game) {
  const { seed, grid, clock } = game;
  lineaBase(seed, grid.width, grid.height, clock.tick, clock.tick === 0 ? grid : undefined);
}

function diferenciasDeRecursos(game) {
  const { grid, seed } = game;
  const base = lineaBase(seed, grid.width, grid.height, game.clock.tick);
  const diferencias = [];
  grid.cells.forEach((celda, i) => {
    const original = base[i];
    if (original.biome !== celda.biome) {
      throw new Error(`El mundo de la semilla ${seed} no se puede reproducir (celda ${i}): no se puede guardar solo con la semilla.`);
    }
    for (const id of Object.keys(RESOURCES)) {
      if (celda.resources[id] !== original.resources[id]) diferencias.push([i, id, celda.resources[id]]);
    }
  });
  return diferencias;
}

// El coste y el calor del edificio salen del catálogo: guardarlos duplicaría BUILDINGS y un cambio de
// balance no llegaría a las partidas ya empezadas.
const edificioAPlano = ({ id, x, y, progress, done }) => ({ id, x, y, progress, done });

export function serialize(game) {
  const { settlement, ...banda } = game.band;
  return {
    version: SCHEMA_VERSION,
    seed: game.seed,
    width: game.grid.width,
    height: game.grid.height,
    tick: game.clock.tick,
    over: game.over,
    rng: game.rng.getState(),
    lastDecision: codificar(game.lastDecision),
    band: codificar(banda),
    settlement: settlement ? codificar({ ...settlement, buildings: settlement.buildings.map(edificioAPlano) }) : null,
    discovery: game.discovery.toJSON(),
    resources: diferenciasDeRecursos(game),
    chronicle: game.chronicle.entries.map((e) => (e.keep ? { day: e.day, type: e.type, text: e.text, keep: true } : { day: e.day, type: e.type, text: e.text })),
  };
}

// --- Deserializar --------------------------------------------------------------------------------

const exigir = (condicion, mensaje) => { if (!condicion) throw new Error(`Guardado dañado: ${mensaje}.`); };

function aldeaDesdePlano(plano) {
  exigir(esObjeto(plano) && Array.isArray(plano.buildings) && Array.isArray(plano.queue), 'la aldea no tiene la forma esperada');
  const buildings = plano.buildings.map((b) => {
    const def = BUILDINGS.find((d) => d.id === (esObjeto(b) ? b.id : undefined));
    exigir(def, `edificio desconocido (${String(esObjeto(b) ? b.id : b)})`);
    const edificio = { id: b.id, x: b.x, y: b.y, cost: { ...def.cost }, progress: b.progress, done: b.done };
    return def.warmth === undefined ? edificio : { ...edificio, warmth: def.warmth };
  });
  return { ...plano, buildings };
}

export function deserialize(data) {
  const d = migrate(data);
  exigir(Number.isFinite(d.seed), 'falta la semilla');
  exigir(Number.isInteger(d.tick) && d.tick >= 0, 'falta el tick');
  exigir(Number.isInteger(d.rng), 'falta el estado del azar');
  exigir(esObjeto(d.band) && Array.isArray(d.band.npcs) && esObjeto(d.band.inventory), 'falta la banda');
  exigir(Array.isArray(d.discovery), 'falta el territorio descubierto');
  exigir(Array.isArray(d.resources), 'faltan los recursos');
  exigir(Array.isArray(d.chronicle), 'falta la crónica');
  exigir(d.settlement === null || esObjeto(d.settlement), 'la aldea no tiene la forma esperada');

  const opciones = Number.isInteger(d.width) && Number.isInteger(d.height) ? { width: d.width, height: d.height } : {};
  const game = createGame(d.seed, opciones);   // un solo sitio define la forma de una partida

  // game.grid acaba de nacer: es el mundo virgen. Se lleva a la línea base y encima van las diferencias.
  const base = lineaBase(d.seed, game.grid.width, game.grid.height, d.tick, game.grid);
  game.grid.cells.forEach((celda, i) => { celda.resources = { ...base[i].resources }; });
  for (const entrada of d.resources) {
    exigir(Array.isArray(entrada) && entrada.length === 3, 'diferencia de recursos mal formada');
    const [i, id, cantidad] = entrada;
    exigir(Number.isInteger(i) && i >= 0 && i < game.grid.cells.length && id in RESOURCES && Number.isFinite(cantidad), 'diferencia de recursos fuera de rango');
    game.grid.cells[i].resources[id] = cantidad;
  }

  game.discovery = discoveryFromJSON(game.grid, d.discovery);
  game.clock = createClock({ msPerTick: MS_POR_TICK, tick: d.tick });
  game.rng.setState(d.rng);
  game.over = d.over === true;
  game.lastDecision = d.lastDecision === undefined ? null : decodificar(d.lastDecision);

  game.band = decodificar(d.band);
  game.band.settlement = d.settlement === null ? null : aldeaDesdePlano(decodificar(d.settlement));

  game.chronicle.entries = d.chronicle.map((e) => {
    exigir(esObjeto(e) && typeof e.text === 'string' && typeof e.type === 'string', 'entrada de crónica mal formada');
    return e.keep === true ? { day: e.day, type: e.type, text: e.text, keep: true } : { day: e.day, type: e.type, text: e.text };
  });
  return game;
}
