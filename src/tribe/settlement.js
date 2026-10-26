// La aldea: lo que la banda levanta al llegar al sitio elegido. Una cola fija (hoguera, choza, almacén) que
// avanza con el trabajo de quienes están en la obra y se paga con el inventario compartido.
// Pura y determinista: el orden y el resultado de la obra no dependen del rng (se recibe por contrato, no se usa).
// El mundo no se toca: el sitio llega ya puntuado desde sitescore.
import { livingNpcs, RADIO_FUEGO } from './band.js';
export { RADIO_FUEGO };

// Cifras de balance (inventadas en la Etapa 1, a afinar jugando).
// work = horas-persona de obra; cost = lo que se gasta en total, repartido en proporción al avance.
export const BUILDINGS = [
  { id: 'hoguera', label: 'Hoguera', cost: { leña: 6 }, work: 12, order: 0 },
  { id: 'choza', label: 'Choza', cost: { leña: 12, piedra: 4 }, work: 48, order: 1 },
  { id: 'almacen', label: 'Almacén', cost: { leña: 16, piedra: 10 }, work: 72, order: 2 },
];

const RADIO_ANILLO = 2;              // distancia de la choza y el almacén a la hoguera, que está en el centro
const ANILLO = [[1, 0], [-1, 0]];    // direcciones del anillo, en orden de construcción
const EPSILON = 1e-9;

const TEXTOS = {
  hoguera: 'Prendieron la primera hoguera de la aldea. Su luz quedó fija en el centro del campamento y la banda empezó a reunirse a su alrededor.',
  choza: 'Se alzó la primera choza: techo de ramas y barro donde guarecerse de la lluvia y del viento.',
  almacen: 'El almacén quedó listo. Ya hay un lugar donde guardar lo recolectado para los días difíciles.',
};

// Fija la aldea en el sitio y deja la cola completa. `site` es un SiteScore (solo se usan x e y).
// Idempotente: si la banda ya tiene aldea la devuelve intacta (una segunda llamada no reinicia nada).
export function foundSettlement(band, site, day) {
  if (band.settlement) return band.settlement;
  const { x, y } = site;
  const buildings = BUILDINGS.map((def, i) => {
    const [dx, dy] = i === 0 ? [0, 0] : ANILLO[(i - 1) % ANILLO.length];
    // `cost` se publica en el edificio para que la banda sepa qué material le falta sin conocer este catálogo.
    return { id: def.id, x: x + dx * RADIO_ANILLO, y: y + dy * RADIO_ANILLO, cost: { ...def.cost }, progress: 0, done: false };
  });
  const settlement = { x, y, foundedDay: day, buildings, queue: BUILDINGS.map((b) => b.id) };
  band.settled = true;
  band.site = { x, y };
  band.settlement = settlement;
  return settlement;
}

// Fracción de la obra que el inventario puede pagar. Un coste de 0 no limita nada y se deja fuera:
// 0 / 0 es NaN y NaN envenena Math.min, así que la obra se habría detenido en silencio, sin error ni
// crónica, imposible de ver desde fuera. Sin ningún coste con total > 0, nada limita (Infinity).
export function avanceFinanciable(cost, inventory) {
  const limites = Object.entries(cost)
    .filter(([, total]) => total > 0)
    .map(([recurso, total]) => (inventory[recurso] ?? 0) / total);
  return Math.min(Infinity, ...limites);
}

// Convierte en progreso el trabajo de este tick: cada NPC vivo con action === 'construir' aporta una hora-persona.
// Sin manos o sin materiales para ese avance no pasa nada. Devuelve las líneas de crónica (solo al terminar algo).
export function tickConstruction(settlement, band, rng) {
  const id = settlement.queue[0];
  if (id === undefined) return [];
  const def = BUILDINGS.find((b) => b.id === id);
  const edificio = settlement.buildings.find((b) => b.id === id);
  const manos = livingNpcs(band).filter((npc) => npc.action === 'construir').length;
  if (manos === 0) return [];

  // El avance se limita a lo que el stock puede pagar: con poco material se avanza poco, nunca se atasca.
  const avance = Math.min(manos / def.work, 1 - edificio.progress, avanceFinanciable(def.cost, band.inventory));
  if (!(avance > 0)) return [];
  const gasto = Object.entries(def.cost).map(([recurso, total]) => [recurso, total * avance]);
  if (gasto.some(([recurso, cantidad]) => (band.inventory[recurso] ?? 0) + EPSILON < cantidad)) return [];

  for (const [recurso, cantidad] of gasto) band.inventory[recurso] = Math.max(0, (band.inventory[recurso] ?? 0) - cantidad);
  edificio.progress = Math.min(1, Math.max(0, edificio.progress + avance));
  if (1 - edificio.progress > EPSILON) return [];

  edificio.progress = 1;
  edificio.done = true;
  settlement.queue.shift();
  return [TEXTOS[id]];
}
