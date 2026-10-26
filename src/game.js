// La fachada de la partida: el único punto por el que la interfaz, el renderizado y el guardado tocan
// la simulación. Aquí se corre el arco completo del spec sin que el jugador pueda dar una sola orden:
// la banda explora, decide por su cuenta dónde asentarse, camina hasta allí, funda la aldea y la construye.
//
// Pura y determinista: todo el azar sale de un rng derivado de la semilla y todo el tiempo del reloj de ticks.
// No se mira el reloj de pared ni el navegador, y una partida guardada se reproduce con solo la semilla.
// El mundo se juzga siempre a través de discovery: la rejilla se usa aquí para regenerar recursos y para
// que los edificios no caigan fuera del mapa, nunca para decidir nada en nombre de la banda.
import { createRng } from './core/rng.js';
import { createClock } from './core/clock.js';
import { generateWorld } from './world/worldgen.js';
import { createDiscovery } from './world/discovery.js';
import { regenerateResources } from './world/resources.js';
import { createBand, tickBand, isExtinct, livingNpcs } from './tribe/band.js';
import { considerSettlement } from './tribe/consensus.js';
import { foundSettlement, tickConstruction } from './tribe/settlement.js';
import { createChronicle, record } from './chronicle.js';

// Un tick es una hora simulada. A velocidad 1, MS_POR_TICK ms de tiempo real valen un tick, así que
// stepGame adelanta el reloj de a un tick exacto con el mismo acumulador que usa advanceGame.
export const MS_POR_TICK = 400;
export const RADIO_VISTA_INICIAL = 6;   // lo que la banda ve del primer campamento

const lugar = (x, y) => `(${x}, ${y})`;

// --- Crear ---------------------------------------------------------------------------------------

export function createGame(seed, opts = {}) {
  const world = generateWorld(seed, opts);
  const rng = createRng(seed).fork('simulacion');   // fork propio: la generación del mundo no se mezcla
  const band = createBand(rng, world.start);
  const discovery = createDiscovery(world.grid);
  discovery.reveal(world.start.x, world.start.y, RADIO_VISTA_INICIAL);
  const chronicle = createChronicle();

  const game = {
    seed,
    world,
    grid: world.grid,
    discovery,
    band,
    clock: createClock({ msPerTick: MS_POR_TICK }),
    chronicle,
    rng,
    over: false,
    lastDecision: null,
    // band.settlement es la única fuente: una segunda copia se desincronizaría al guardar y cargar.
    get settlement() {
      return this.band.settlement;
    },
  };

  record(chronicle, {
    day: 0,
    keep: true,
    type: 'inicio',
    text: `${livingNpcs(band).length} nómadas acampan en ${lugar(band.x, band.y)}. No conocen nada más allá de lo que alcanzan a ver, y buscan un lugar donde quedarse.`,
  });
  return game;
}

// --- Un tick -------------------------------------------------------------------------------------

// Mete los edificios dentro de la rejilla. settlement.js los coloca a x±2 del sitio y no tiene rejilla
// con la que comprobarlo: un sitio junto al borde deja la choza o el almacén fuera del mapa.
export function clampBuildings(settlement, grid) {
  for (const b of settlement.buildings) {
    b.x = Math.min(grid.width - 1, Math.max(0, b.x));
    b.y = Math.min(grid.height - 1, Math.max(0, b.y));
  }
  return settlement;
}

// Tipos que son hitos de la partida: el relato rutinario rota con el tope, estos no se pierden nunca.
// (Lo rutinario son las líneas de la banda: hallazgos de exploración, muertes, caza.)
const HITOS = new Set(['inicio', 'decision', 'asentamiento', 'construccion', 'fin']);

const anotar = (game, clock, type, textos) => {
  for (const text of textos) record(game.chronicle, { day: clock.day, type, text, keep: HITOS.has(type) });
};

// Funda la aldea si la banda ya está encima del sitio que eligió. La fundación es a la LLEGADA, no a la
// decisión: entre una y otra la banda camina, y puede incluso rendirse y volver a buscar.
function fundarSiLlego(game, clock) {
  const { band } = game;
  if (band.settled || !band.site) return;
  if (band.x !== band.site.x || band.y !== band.site.y) return;
  const settlement = foundSettlement(band, band.site, clock.day);
  clampBuildings(settlement, game.grid);
  anotar(game, clock, 'asentamiento', [
    `La banda deja de caminar en ${lugar(settlement.x, settlement.y)}: aquí levantará su aldea. Lo primero será una hoguera que no haya que apagar al amanecer.`,
  ]);
}

// Orden del spec: el mundo se repone, la banda vive su hora (y puede extinguirse), se decide si hay
// sitio donde asentarse, se funda al llegar y avanza la obra. Todo lo que devuelven esos módulos
// termina en la crónica con el día del reloj.
function simularTick(game, clock) {
  const { grid, discovery, band, rng } = game;
  const ctx = { grid, discovery, clock, season: clock.season };

  regenerateResources(grid, 1);
  anotar(game, clock, 'banda', tickBand(band, ctx, rng));

  if (isExtinct(band)) {
    game.over = true;
    anotar(game, clock, 'fin', [
      `No quedó nadie. La banda se apagó en ${lugar(band.x, band.y)} el día ${clock.day} y con ella su historia.`,
    ]);
    return;
  }

  // La cadencia (una vez al día, o antes si la presión salta) la lleva considerSettlement con
  // band.lastEvaluation: buscar candidatos cuesta 40-60 ms y hacerlo cada tick trabaría el teléfono.
  const evaluacion = considerSettlement(band, discovery, ctx, clock.tick);
  if (evaluacion) {
    game.lastDecision = evaluacion.decision;
    anotar(game, clock, 'decision', evaluacion.chronicle);
  }

  fundarSiLlego(game, clock);
  if (band.settlement) anotar(game, clock, 'construccion', tickConstruction(band.settlement, band, rng));
}

// --- Avanzar -------------------------------------------------------------------------------------

// Corre `ticks` pasos completos. Sobre una partida terminada no cambia nada: ni el reloj, ni la crónica.
export function stepGame(game, ticks) {
  const total = Math.floor(ticks);
  if (!Number.isFinite(total)) return;
  for (let i = 0; i < total; i++) {
    if (game.over) return;
    game.clock.advance(MS_POR_TICK, 1);   // exactamente un tick: el acumulador queda en cero
    simularTick(game, game.clock);
  }
}

// Único punto por el que la interfaz hace avanzar el tiempo. Devuelve los ticks corridos; el acotado
// (y el descarte del acumulador tras una pausa larga) es el del reloj, no se duplica aquí.
// Cada tick se simula con su propia hora: un lote de 24 no vive las 24 horas a la vez.
export function advanceGame(game, dtMs, speed) {
  // Un dtMs o una velocidad no finitos envenenarían el acumulador del reloj para siempre: se descartan.
  if (game.over || !Number.isFinite(dtMs) || !Number.isFinite(speed)) return 0;
  const desde = game.clock.tick;
  const ticks = game.clock.advance(dtMs, speed);
  for (let i = 1; i <= ticks; i++) {
    if (game.over) break;
    simularTick(game, createClock({ msPerTick: MS_POR_TICK, tick: desde + i }));
  }
  return ticks;
}
