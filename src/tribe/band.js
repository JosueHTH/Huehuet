// La banda: el grupo nómada que comparte inventario, camina por lo descubierto y puede extinguirse.
// El mundo se lee solo con discovery (knownCell / isKnown): nada se pisa ni se usa sin haberlo visto.
// Pura: el azar entra solo por el rng que recibe tickBand; no hay reloj ni estado global.
import { RESOURCES } from '../world/resources.js';
import { BIOMES } from '../world/grid.js';
import { tickNeeds } from '../agents/needs.js';
import { createNpc } from '../agents/npc.js';
import { ACTIONS } from '../agents/actions.js';
import { chooseAction, IDLE } from '../agents/utility.js';

const TAMAÑO_POR_DEFECTO = 7;
const MEMORIA_MAXIMA = 32;           // sitios abandonados que la banda recuerda

// Cifras de balance (inventadas en la Etapa 1, a afinar jugando).
export const TICKS_HASTA_MORIR = 24; // un día entero con una necesidad vital en 100
const TICKS_POR_PASO = 6;            // un nómada avanza una celda cada 6 ticks
export const INTENTOS_SIN_AVANCE = 8;  // pasos seguidos sin acercarse al sitio antes de rendirse (~2 días)
const REFUGIO_MINIMO = 0.5;          // biomas con shelter por encima de esto dan cobijo (bosque, montaña)
const RADIO_VISTA_BANDA = 4;         // lo que ve la banda al llegar a una celda
const DESVANECER_MUERTES = 1 / 72;   // las muertes recientes pesan menos con el paso de ~3 días
const MUERTES_QUE_SATURAN = 3;
export const RADIO_FUEGO = 3;        // celdas (Chebyshev) a las que calienta una hoguera terminada
const NECESIDADES_VITALES = ['hambre', 'sed', 'frio'];
const CAUSA = { hambre: 'hambre', sed: 'sed', frio: 'frío' };
const TRABAJOS = ['construir', 'talar', 'recoger_piedra', 'cazar', 'forrajear'];
const CAMINATAS = ['explorar', 'seguir'];

// Cuánto pesa la proximidad del invierno en la presión (0 = lejos, 1 = encima).
const INVIERNO_CERCA = { primavera: 0.2, verano: 0, otoño: 0.8, invierno: 1 };
// Pesos de la presión; suman 1.
const PESO_PRESION = { moral: 0.15, hambre: 0.2, sed: 0.2, frio: 0.15, muertes: 0.15, invierno: 0.15 };

export const livingNpcs = (band) => band.npcs.filter((npc) => npc.alive);
export const isExtinct = (band) => !band.npcs.some((npc) => npc.alive);

export function createBand(rng, start, opts = {}) {
  const size = Math.max(0, opts.size ?? TAMAÑO_POR_DEFECTO);
  // Todos los NPCs salen del mismo rng: los ids dependen de la instancia. Primero un anciano y dos adultos.
  const edades = [() => rng.int(45, 60), () => rng.int(18, 44), () => rng.int(18, 44)];
  const npcs = [];
  for (let i = 0; i < size; i++) {
    const age = i < edades.length ? edades[i]() : undefined;
    npcs.push(createNpc(rng, { age, x: start.x, y: start.y }));
  }
  return {
    npcs,
    inventory: Object.fromEntries(Object.keys(RESOURCES).map((id) => [id, 0])),
    x: start.x,
    y: start.y,
    settled: false,
    site: null,
    settlement: null,
    lastEvaluation: 0,
    lastEvalPressure: 0,
    lastDecisionKey: null,
    abandonedSites: [],
    recentDeaths: 0,
    approach: null,
  };
}

// 0..1: cuánto empuja la situación a la banda a moverse. Solo mira a los vivos; sin vivos, presión máxima.
export function bandPressure(band, { season }) {
  const vivos = livingNpcs(band);
  if (vivos.length === 0) return 1;
  const media = (id) => vivos.reduce((suma, npc) => suma + npc.needs[id], 0) / vivos.length / 100;
  const presion = PESO_PRESION.moral * (1 - media('moral'))
    + PESO_PRESION.hambre * media('hambre')
    + PESO_PRESION.sed * media('sed')
    + PESO_PRESION.frio * media('frio')
    + PESO_PRESION.muertes * Math.min(1, (band.recentDeaths ?? 0) / MUERTES_QUE_SATURAN)
    + PESO_PRESION.invierno * (INVIERNO_CERCA[season] ?? 0);
  return Math.min(1, Math.max(0, presion));
}

// --- Migración -------------------------------------------------------------------------------

const VECINOS = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];

// Transitable = descubierto y no agua. knownCell devuelve null fuera de la rejilla y en lo no visto.
const transitable = (ctx, x, y) => {
  const celda = ctx.discovery.knownCell(x, y);
  return celda !== null && celda.biome !== 'agua';
};

// Una celda es frontera si es transitable y alguna vecina dentro de la rejilla sigue sin descubrir.
const esFrontera = (ctx, x, y) => VECINOS.some(([dx, dy]) =>
  ctx.grid.inBounds(x + dx, y + dy) && !ctx.discovery.isKnown(x + dx, y + dy));

// Búsqueda en anchura por celdas transitables hasta la más cercana que cumpla `esMeta`.
// Termina siempre: cada celda se visita una vez y solo hay tantas como celdas descubiertas.
// Devuelve el primer paso {x, y, largo} del camino más corto (largo = celdas hasta la meta), o null si no hay camino.
function primerPaso(ctx, desde, esMeta) {
  const clave = (x, y) => `${x},${y}`;
  const visitadas = new Set([clave(desde.x, desde.y)]);
  const cola = VECINOS.map(([dx, dy]) => ({ x: desde.x + dx, y: desde.y + dy, paso: { x: desde.x + dx, y: desde.y + dy }, largo: 1 }));
  for (let i = 0; i < cola.length; i++) {
    const nodo = cola[i];
    const k = clave(nodo.x, nodo.y);
    if (visitadas.has(k) || !transitable(ctx, nodo.x, nodo.y)) continue;
    visitadas.add(k);
    if (esMeta(nodo.x, nodo.y)) return { ...nodo.paso, largo: nodo.largo };
    for (const [dx, dy] of VECINOS) cola.push({ x: nodo.x + dx, y: nodo.y + dy, paso: nodo.paso, largo: nodo.largo + 1 });
  }
  return null;
}

// Anota un sitio inalcanzable junto con lo descubierto en ese momento. Conserva solo los MEMORIA_MAXIMA más recientes.
// consensus.js lo usa para excluir un radio alrededor de cada uno.
export function registrarAbandono(band, site, discovery) {
  band.abandonedSites = [...(band.abandonedSites ?? []), { x: site.x, y: site.y, known: discovery.size }].slice(-MEMORIA_MAXIMA);
}

// Hacia band.site. Si en INTENTOS_SIN_AVANCE pasos seguidos no se acorta el camino (o no hay camino), se rinde:
// suelta el sitio, vuelve a explorar la frontera y lo anota en la crónica.
function pasoHaciaSitio(band, ctx, cronica) {
  const { x, y } = band.site;
  if (band.x === x && band.y === y) { band.approach = null; return null; }
  if (band.approach?.x !== x || band.approach?.y !== y) band.approach = { x, y, mejor: Infinity, sinAvance: 0 };
  const paso = primerPaso(ctx, band, (cx, cy) => cx === x && cy === y);
  const enfoque = band.approach;
  if (paso && paso.largo < enfoque.mejor) {
    enfoque.mejor = paso.largo;
    enfoque.sinAvance = 0;
    return paso;
  }
  enfoque.sinAvance++;
  if (enfoque.sinAvance < INTENTOS_SIN_AVANCE) return paso;
  registrarAbandono(band, { x, y }, ctx.discovery);
  band.site = null;
  band.approach = null;
  cronica.push(`La banda no logra llegar al lugar elegido (${x}, ${y}) y vuelve a explorar.`);
  return null;
}

// Mueve la banda una celda si toca. Devuelve true si se movió. Asentada, no se mueve nunca.
function migrar(band, ctx, cronica) {
  if (band.settled || ctx.clock.tick % TICKS_POR_PASO !== 0) return false;
  ctx.discovery.reveal(band.x, band.y, RADIO_VISTA_BANDA);
  let paso = band.site ? pasoHaciaSitio(band, ctx, cronica) : null;
  if (!band.site) paso = primerPaso(ctx, band, (x, y) => esFrontera(ctx, x, y));
  if (!paso) return false;
  band.x = paso.x;
  band.y = paso.y;
  ctx.discovery.reveal(band.x, band.y, RADIO_VISTA_BANDA);
  return true;
}

// --- Mortalidad ------------------------------------------------------------------------------

// Cuenta ticks acumulados con una necesidad vital en 100 (baja de a uno cuando se recupera).
// Devuelve la causa de muerte, o null si el NPC sigue vivo.
function saturar(npc) {
  const causa = NECESIDADES_VITALES.find((id) => npc.needs[id] >= 100);
  npc.saturacion = Math.max(0, (npc.saturacion ?? 0) + (causa ? 1 : -1));
  return npc.saturacion > TICKS_HASTA_MORIR ? causa : null;
}

// Calienta solo una hoguera terminada de la aldea (band.settlement es la única fuente). Los NPCs no van pegados
// a la banda: lo que cuenta es su propia distancia a la hoguera.
function cercaDelFuego(band, npc) {
  const fuego = band.settlement?.buildings?.find((b) => b.id === 'hoguera' && b.done);
  return Boolean(fuego) && Math.max(Math.abs(npc.x - fuego.x), Math.abs(npc.y - fuego.y)) <= RADIO_FUEGO;
}

// --- Tick ------------------------------------------------------------------------------------

// Un NPC: necesidades, muerte por saturación sostenida, elección y aplicación de una acción.
function tickNpc(npc, band, ctx, rng, actions, seMovio, cronica) {
  const celda = ctx.discovery.knownCell(npc.x, npc.y) ?? ctx.discovery.knownCell(band.x, band.y);
  npc.needs = tickNeeds(npc.needs, {
    hour: ctx.clock.hour,
    season: ctx.clock.season,
    biome: celda?.biome ?? 'pradera',
    walking: seMovio || CAMINATAS.includes(npc.action),
    working: TRABAJOS.includes(npc.action),
    nearFire: cercaDelFuego(band, npc),
    sheltered: (BIOMES[celda?.biome]?.shelter ?? 0) > REFUGIO_MINIMO,
  });
  const causa = saturar(npc);
  if (causa) {
    npc.alive = false;
    band.recentDeaths = (band.recentDeaths ?? 0) + 1;
    cronica.push(`${npc.nombre} murió de ${CAUSA[causa]}.`);
    return;
  }
  const accion = chooseAction(npc, band, ctx, actions);
  npc.action = accion.id;
  if (accion === IDLE) return;
  const texto = accion.apply(npc, band, ctx, rng);
  if (texto) cronica.push(texto);
}

// Avanza la banda una hora. `actions` solo existe para poder probar el caso IDLE.
export function tickBand(band, ctx, rng, actions = ACTIONS) {
  if (isExtinct(band)) return [];
  const cronica = [];
  const seMovio = migrar(band, ctx, cronica);
  for (const npc of livingNpcs(band)) tickNpc(npc, band, ctx, rng, actions, seMovio, cronica);
  band.recentDeaths = Math.max(0, (band.recentDeaths ?? 0) - DESVANECER_MUERTES);
  return cronica;
}

