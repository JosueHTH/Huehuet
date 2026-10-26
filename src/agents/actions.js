// Catálogo de acciones de la Etapa 1. Cada acción puntúa el estado del NPC y, si gana, se aplica.
// Forma común de `score`: urgencia de la necesidad (al cuadrado, para que crezca más que
// linealmente) x disponibilidad del recurso a su alcance x modulación por rasgos x peso.
// Devuelve 0 si la acción es imposible. Pura: el azar entra solo por el rng que recibe `apply`.
// El mundo se lee únicamente con discovery.knownCell: nada se hace sobre celdas nunca vistas.
import { applyNeed } from './needs.js';
import { consume } from '../world/resources.js';

// Pesos de balance (inventados en la Etapa 1, a afinar jugando): puntuación máxima de cada acción.
const PESO = { beber: 100, forrajear: 80, cazar: 90, talar: 40, piedra: 20, descansar: 100, explorar: 25, seguir: 30, construir: 35, desesperacion: 50 };

const ALCANCE = 1; // radio en celdas (Chebyshev) en el que un NPC alcanza un recurso

const urgencia = (valor) => (valor / 100) ** 2;
const esDeNoche = (hour) => hour >= 20 || hour < 6;
const inventario = (band, id) => band.inventory[id] ?? 0;

// La celda conocida a su alcance con más cantidad del recurso (la primera en orden de lectura si empatan), o null.
function mejorCelda(npc, ctx, resourceId) {
  let mejor = null;
  for (let dy = -ALCANCE; dy <= ALCANCE; dy++) {
    for (let dx = -ALCANCE; dx <= ALCANCE; dx++) {
      const celda = ctx.discovery.knownCell(npc.x + dx, npc.y + dy);
      if (celda && celda.resources[resourceId] > (mejor?.resources[resourceId] ?? 0)) mejor = celda;
    }
  }
  return mejor;
}

const alcanzable = (npc, ctx, resourceId) => mejorCelda(npc, ctx, resourceId) !== null;

// 0..1: cuánto del recurso hay a su alcance respecto a `suficiente`.
const disponibilidad = (npc, ctx, resourceId, suficiente) =>
  Math.min(1, (mejorCelda(npc, ctx, resourceId)?.resources[resourceId] ?? 0) / suficiente);

// Distancia (Chebyshev) del NPC al punto de la banda; los NPCs orbitan ese punto.
const distanciaALaBanda = (npc, band) => Math.max(Math.abs(band.x - npc.x), Math.abs(band.y - npc.y));

// Hay obra pendiente solo con la banda asentada y un asentamiento con cola de construcción.
// Task 7 no declara `band.settlement`; quien cree el asentamiento (Tasks 10/11) debe colgarlo ahí.
const hayObra = (band) => band.settled === true && (band.settlement?.queue?.length ?? 0) > 0;

// El edificio en el que se trabaja ahora, con su coste publicado por el asentamiento (no se importa
// el catálogo de Task 10: la aldea cuelga de la banda lo que cuesta cada obra).
function obraActual(band) {
  if (!hayObra(band)) return null;
  const id = band.settlement.queue[0];
  return band.settlement.buildings?.find((b) => b.id === id) ?? null;
}

// Multiplicador de la recolección cuando la obra en curso pide ese material y no hay suficiente.
// Sin esto nadie recoge piedra (su puntuación máxima era ~7, por debajo de explorar) y la choza y el
// almacén no se podían terminar nunca; subir el peso a secas hacía que se dejara de talar y la banda
// se quedaba sin leña para la hoguera. Así la recolección sigue el plan de obra y se apaga sola al
// llegar al material necesario, y mientras la banda es nómada nada cambia.
const EMPUJE_OBRA = 4;
const faltaParaLaObra = (band, recurso) => {
  const necesario = obraActual(band)?.cost?.[recurso] ?? 0;
  return necesario > 0 && (band.inventory[recurso] ?? 0) < necesario;
};
const empuje = (band, recurso) => (faltaParaLaObra(band, recurso) ? EMPUJE_OBRA : 1);

// Toma del recurso lo que haya a su alcance; devuelve lo obtenido (0 si no hay nada).
function tomar(npc, ctx, resourceId, cantidad) {
  const celda = mejorCelda(npc, ctx, resourceId);
  return celda ? consume(celda, resourceId, cantidad) : 0;
}

const DIRECCIONES = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
const PASO_EXPLORAR = 3;
const RADIO_VISTA = 5;
const HALLAZGO_MINIMO = 10;

// Costura de la Etapa 1 (Task 11): la puntuación de `explorar` ya sube por desesperación cuando una
// necesidad vital no tiene con qué satisfacerse a su alcance, pero el movimiento era siempre al azar:
// un NPC sediento que YA ha visto un río se alejaba de él y moría de sed en dos días. Aquí la salida
// se vuelve coherente con su motivo: si hay desesperación y la banda conoce una celda con ese recurso,
// se camina hacia ella. Sin recurso conocido (o sin desesperación) sigue siendo exploración al azar.
const RADIO_BUSQUEDA_VITAL = 24;          // celdas a la redonda en las que se busca el recurso conocido
const SED_DESESPERADA = 50;               // a partir de aquí la sed dirige el paso
const HAMBRE_DESESPERADA = 60;

// La celda conocida más cercana (anillos Chebyshev crecientes) con algo de `resourceId`, o null.
// Orden de lectura fijo dentro de cada anillo: el resultado es reproducible.
function celdaConocidaMasCercana(npc, ctx, resourceId, radio) {
  for (let r = 1; r <= radio; r++) {
    let mejor = null;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const celda = ctx.discovery.knownCell(npc.x + dx, npc.y + dy);
        if (celda && celda.resources[resourceId] > 0) {
          const d2 = dx * dx + dy * dy;
          if (!mejor || d2 < mejor.d2) mejor = { celda, d2 };
        }
      }
    }
    if (mejor) return mejor.celda;
  }
  return null;
}

// Hacia dónde tira la necesidad: agua si la sed aprieta y no hay agua a su alcance, comida si es el hambre.
// Devuelve la celda meta conocida o null.
function metaVital(npc, ctx) {
  if (npc.needs.sed >= SED_DESESPERADA && !alcanzable(npc, ctx, 'agua')) {
    const agua = celdaConocidaMasCercana(npc, ctx, 'agua', RADIO_BUSQUEDA_VITAL);
    if (agua) return agua;
  }
  if (npc.needs.hambre >= HAMBRE_DESESPERADA
    && !alcanzable(npc, ctx, 'forraje') && !alcanzable(npc, ctx, 'caza')) {
    const forraje = celdaConocidaMasCercana(npc, ctx, 'forraje', RADIO_BUSQUEDA_VITAL);
    if (forraje) return forraje;
    const caza = celdaConocidaMasCercana(npc, ctx, 'caza', RADIO_BUSQUEDA_VITAL);
    if (caza) return caza;
  }
  return null;
}

// Paso de hasta PASO_EXPLORAR celdas hacia la meta, sin pasarse de largo y sin salir de la rejilla.
function pasoHacia(npc, ctx, meta) {
  const acercar = (actual, destino) => {
    const delta = destino - actual;
    return Math.sign(delta) * Math.min(PASO_EXPLORAR, Math.abs(delta));
  };
  const x = npc.x + acercar(npc.x, meta.x);
  const y = npc.y + acercar(npc.y, meta.y);
  return ctx.grid.inBounds(x, y) ? { x, y } : null;
}

export const ACTIONS = [
  {
    id: 'beber',
    label: 'Beber',
    score: (npc, band, ctx) => PESO.beber * urgencia(npc.needs.sed) * disponibilidad(npc, ctx, 'agua', 1),
    apply(npc, band, ctx) {
      const obtenido = tomar(npc, ctx, 'agua', 4);
      npc.needs = applyNeed(npc.needs, 'sed', -10 * obtenido);
      return null;
    },
  },
  {
    id: 'forrajear',
    label: 'Forrajear',
    score: (npc, band, ctx) => PESO.forrajear * urgencia(npc.needs.hambre)
      * disponibilidad(npc, ctx, 'forraje', 2) * (0.8 + 0.4 * npc.traits.sabiduria),
    apply(npc, band, ctx) {
      const obtenido = tomar(npc, ctx, 'forraje', 2);
      npc.needs = applyNeed(npc.needs, 'hambre', -12 * obtenido);
      return null;
    },
  },
  {
    id: 'cazar',
    label: 'Cazar',
    score: (npc, band, ctx) => PESO.cazar * urgencia(npc.needs.hambre)
      * disponibilidad(npc, ctx, 'caza', 1) * (0.6 + 0.8 * npc.traits.audacia) * (1 - 0.5 * npc.traits.cautela),
    apply(npc, band, ctx, rng) {
      if (!rng.chance(0.45 + 0.4 * npc.traits.audacia)) return null;
      const obtenido = tomar(npc, ctx, 'caza', 1);
      if (obtenido === 0) return null;
      npc.needs = applyNeed(npc.needs, 'hambre', -45 * obtenido);
      return `${npc.nombre} cazó una presa para la banda.`;
    },
  },
  {
    id: 'talar',
    label: 'Talar',
    score: (npc, band, ctx) => PESO.talar * (0.1 + urgencia(npc.needs.frio)) * disponibilidad(npc, ctx, 'leña', 2)
      * empuje(band, 'leña'),
    apply(npc, band, ctx) {
      band.inventory.leña = inventario(band, 'leña') + tomar(npc, ctx, 'leña', 2);
      return null;
    },
  },
  {
    id: 'recoger_piedra',
    label: 'Recoger piedra',
    score: (npc, band, ctx) => PESO.piedra * (0.15 + 0.2 * npc.traits.sabiduria) * disponibilidad(npc, ctx, 'piedra', 2)
      * empuje(band, 'piedra'),
    apply(npc, band, ctx) {
      band.inventory.piedra = inventario(band, 'piedra') + tomar(npc, ctx, 'piedra', 2);
      return null;
    },
  },
  {
    id: 'descansar',
    label: 'Descansar',
    score: (npc, band, ctx) => PESO.descansar * urgencia(npc.needs.fatiga) * (esDeNoche(ctx.clock.hour) ? 1.3 : 1),
    apply(npc) {
      npc.needs = applyNeed(npc.needs, 'fatiga', -15);
      return null;
    },
  },
  {
    id: 'explorar',
    label: 'Explorar',
    // La urgencia resta peso a explorar (hay cosas más importantes) pero nunca lo anula; y cuando una
    // necesidad alta no tiene con qué satisfacerse a su alcance, explorar es la salida y su peso sube.
    score: (npc, band, ctx) => PESO.explorar * (0.3 + 0.7 * npc.traits.audacia)
      * (1 - 0.8 * urgencia(Math.max(npc.needs.hambre, npc.needs.sed, npc.needs.frio, npc.needs.fatiga)))
      + PESO.desesperacion * Math.max(
        alcanzable(npc, ctx, 'agua') ? 0 : urgencia(npc.needs.sed),
        alcanzable(npc, ctx, 'forraje') || alcanzable(npc, ctx, 'caza') ? 0 : urgencia(npc.needs.hambre),
      ),
    apply(npc, band, ctx, rng) {
      const meta = metaVital(npc, ctx);
      const dirigido = meta ? pasoHacia(npc, ctx, meta) : null;
      if (dirigido) {
        npc.x = dirigido.x;
        npc.y = dirigido.y;
      } else {
        const posibles = DIRECCIONES.filter(([dx, dy]) =>
          ctx.grid.inBounds(npc.x + dx * PASO_EXPLORAR, npc.y + dy * PASO_EXPLORAR));
        const [dx, dy] = rng.pick(posibles);
        npc.x += dx * PASO_EXPLORAR;
        npc.y += dy * PASO_EXPLORAR;
      }
      const nuevas = ctx.discovery.reveal(npc.x, npc.y, RADIO_VISTA);
      return nuevas >= HALLAZGO_MINIMO ? `${npc.nombre} descubrió ${nuevas} lugares nuevos.` : null;
    },
  },
  {
    id: 'seguir',
    label: 'Volver con la banda',
    score: (npc, band) => PESO.seguir * Math.min(1, distanciaALaBanda(npc, band) / 8) * (0.5 + 0.5 * npc.traits.cautela),
    apply(npc, band) {
      npc.x += Math.sign(band.x - npc.x);
      npc.y += Math.sign(band.y - npc.y);
      return null;
    },
  },
  {
    id: 'construir',
    label: 'Trabajar en la obra',
    // Costura con Task 10: esta acción NO construye nada. Solo marca que el NPC dedica el tick a la obra
    // (npc.action = 'construir'). Task 10 cuenta cuántos NPCs la eligieron en el tick y lo convierte en
    // progreso con tickConstruction; el inventario y los edificios son suyos, nunca de aquí.
    score: (npc, band) => (hayObra(band) ? PESO.construir * (0.2 + urgencia(npc.needs.frio)) : 0),
    apply(npc) {
      npc.action = 'construir';
      return null;
    },
  },
];
