// Consenso y decisión de asentamiento: cada adulto pondera el mejor sitio según su temperamento, los ancianos
// cuentan doble, y la banda se asienta o sigue caminando. Quien discrepa mucho queda registrado con nombre.
// Pura y determinista: sin rng ni reloj; el mundo se mira solo a través de sitescore (que usa discovery).
import { livingNpcs, bandPressure, registrarAbandono } from './band.js';
import { isElder, isAdult } from '../agents/npc.js';
import { acceptanceThreshold, candidateSites, VALOR_ALCANZABLE, valorQuePuntua } from './sitescore.js';

// --- Cifras de balance (inventadas en la Etapa 1, a afinar jugando) -------------------------------
const PESO_ANCIANO = 2;          // el voto de un anciano pesa el doble
const PESO_ADULTO = 1;
const UMBRAL_DISIDENCIA = 20;    // puntos de desvío respecto a la media ponderada
const CAUTELA = { factores: ['defensa', 'refugio', 'inundacion'], aumento: 1.5 };  // cautela 1 → ×2.5
const AUDACIA = { factores: ['caza', 'piedra'], aumento: 1.0 };                    // audacia 1 → ×2
const MEZCLA_SABIDURIA = 0.6;    // sabiduría 1 → 60% del total objetivo, 40% de la visión propia

// Memoria de sitios abandonados. Los candidatos están muy agrupados (los 8 primeros a 2-5 celdas y con totales
// casi iguales), así que se excluye un círculo entero: con 6 celdas queda fuera todo el grupo vecino.
// Un sitio vuelve a ser elegible cuando lo descubierto ha crecido en CRECIMIENTO_PARA_REINTENTAR celdas desde que
// se abandonó (unos 8-10 pasos de exploración de frontera): es lo que hace verosímil que se haya abierto una ruta.
export const RADIO_SITIO_ABANDONADO = 6;
export const CRECIMIENTO_PARA_REINTENTAR = 150;
export { registrarAbandono };

// Cadencia: candidateSites cuesta 40-60 ms, así que se evalúa una vez al día (los ticks son horas), o antes si la
// presión sube SALTO_PRESION desde la última evaluación; en ese caso nunca con menos de ESPERA_MINIMA ticks de margen.
export const INTERVALO_EVALUACION = 24;
export const SALTO_PRESION = 0.15;
export const ESPERA_MINIMA = 6;

const limitar = (v, min, max) => Math.min(max, Math.max(min, v));

// Puntuación 0..100 de un sitio vista por un NPC concreto. Reutiliza los factores ya calculados: cambia cuánto
// pesa cada uno según los rasgos, con el mismo denominador que el total objetivo (así sin rasgos coincide con él).
export function npcSiteScore(npc, site) {
  if (!site.viable) return 0;
  const { cautela = 0, audacia = 0, sabiduria = 0 } = npc.traits ?? {};
  const pesos = site.factors.map((f) => {
    let peso = f.effectiveWeight;
    if (CAUTELA.factores.includes(f.id)) peso *= 1 + CAUTELA.aumento * cautela;
    if (AUDACIA.factores.includes(f.id)) peso *= 1 + AUDACIA.aumento * audacia;
    return peso;
  });
  // Se renormaliza por la suma de pesos positivos YA reponderados: dar más peso a un factor lo vuelve más
  // importante frente a los demás, no más grande en total. Así la visión de cada NPC sigue siendo un 0..100 del
  // mismo sitio y los rasgos no inflan (ni desinflan) la media de la banda. Sin rasgos coincide con site.total.
  // Mismo normalizador que sitescore (peso × valor alcanzable), ya reponderado: sin rasgos coincide con site.total.
  const denominador = pesos.reduce((a, p, i) => a + Math.max(0, p) * (VALOR_ALCANZABLE[site.factors[i].id] ?? 1), 0);
  const base = site.factors.map((f, i) => (denominador > 0 ? valorQuePuntua(f.id, f.value) * pesos[i] / denominador * 100 : 0));
  const positivo = base.reduce((a, c) => a + Math.max(0, c), 0);
  const negativo = -base.reduce((a, c) => a + Math.min(0, c), 0);
  const escala = negativo > positivo ? positivo / negativo : 1;
  const propia = limitar(base.reduce((a, c) => a + (c < 0 ? c * escala : c), 0), 0, 100);
  const mezcla = limitar(sabiduria, 0, 1) * MEZCLA_SABIDURIA;
  return propia * (1 - mezcla) + site.total * mezcla;
}

// Disidente: quien se desvía MÁS de UMBRAL_DISIDENCIA puntos de la media (exactamente 20 no cuenta). Lleva su nombre.
export function dissentersOf(votes, average) {
  return votes
    .map((v) => ({ npcId: v.npcId, nombre: v.nombre, score: v.score, delta: v.score - average }))
    .filter((d) => Math.abs(d.delta) > UMBRAL_DISIDENCIA);
}

// Consensus = { average, votes: [{ npcId, nombre, score, elder, weight }], dissenters: [{ npcId, nombre, score, delta }] }.
// Votan los adultos vivos, en el orden de la banda. La media es ponderada; delta = puntuación − media.
export function evaluateConsensus(band, site) {
  const votes = livingNpcs(band).filter(isAdult).map((npc) => {
    const elder = isElder(npc);
    return { npcId: npc.id, nombre: npc.nombre, score: npcSiteScore(npc, site), elder, weight: elder ? PESO_ANCIANO : PESO_ADULTO };
  });
  const pesoTotal = votes.reduce((a, v) => a + v.weight, 0);
  const average = pesoTotal === 0 ? 0 : votes.reduce((a, v) => a + v.score * v.weight, 0) / pesoTotal;
  return { average, votes, dissenters: dissentersOf(votes, average) };
}

// --- Memoria de abandonos ----------------------------------------------------------------------------

// Celdas {x, y} excluidas: un círculo de RADIO_SITIO_ABANDONADO alrededor de cada abandono aún no reintentable.
export function sitiosExcluidos(band, discovery) {
  const celdas = [];
  const r = RADIO_SITIO_ABANDONADO;
  for (const a of band.abandonedSites ?? []) {
    if (discovery.size - a.known >= CRECIMIENTO_PARA_REINTENTAR) continue;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) celdas.push({ x: a.x + dx, y: a.y + dy });
    }
  }
  return celdas;
}

// --- Decisión ---------------------------------------------------------------------------------------

const redondear = (v) => Math.round(v);
const lugar = (s) => `(${s.x}, ${s.y})`;

function factorDecisivo(site) {
  return site.factors.reduce((mejor, f) => (f.contribution > mejor.contribution ? f : mejor)).label.toLowerCase();
}
function factorDebil(site) {
  return site.factors.filter((f) => f.weight > 0).reduce((peor, f) => (f.contribution < peor.contribution ? f : peor)).label.toLowerCase();
}

function razonAsentarse(site, consenso, umbral, presion) {
  const decisivo = factorDecisivo(site);
  if (consenso.average >= acceptanceThreshold(0)) {
    return `La banda decide asentarse en ${lugar(site)}: lo que más pesa es ${decisivo} y el consejo lo ve claro (${redondear(consenso.average)} de ${redondear(umbral)}).`;
  }
  return `La banda no puede seguir esperando y se asienta en ${lugar(site)}, aunque no es un lugar ideal (${redondear(consenso.average)} frente a los ${redondear(acceptanceThreshold(0))} que pediría en calma): lo que lo salva es ${decisivo}. Apremia la necesidad (${Math.round(presion * 100)}%).`;
}

function razonRechazo(site, consenso, umbral) {
  return `La banda descarta ${lugar(site)}: el consejo le da ${redondear(consenso.average)} y hacen falta ${redondear(umbral)}; flojea en ${factorDebil(site)}. Siguen buscando.`;
}

const vacia = (extra) => ({ settle: false, site: null, consensus: null, threshold: 0, pressure: 0, reason: '', ...extra });

// Decision = { settle, site, consensus, threshold, pressure, reason }.
// Devuelve temprano si la banda ya está asentada o no hay candidatos. Nunca se asienta en un sitio no viable.
export function decideSettlement(band, discovery, ctx) {
  const pressure = bandPressure(band, ctx);
  const threshold = acceptanceThreshold(pressure);
  if (band.settled) return vacia({ pressure, threshold, reason: 'La banda ya está asentada: no hay nada más que decidir.' });
  const excluidas = sitiosExcluidos(band, discovery);
  let [site] = candidateSites(discovery, ctx, { exclude: excluidas });
  // Si lo único elegible está excluido, la exclusión caduca: en un mapa casi explorado no habría nada nuevo
  // que descubrir y el recuerdo sería una trampa permanente.
  if (!site && excluidas.length > 0) [site] = candidateSites(discovery, ctx);
  if (!site) {
    return vacia({ pressure, threshold, reason: 'La banda aún no conoce ningún lugar con agua dulce donde asentarse y sigue explorando.' });
  }
  const consensus = evaluateConsensus(band, site);
  if (consensus.votes.length === 0) {
    return { settle: false, site, consensus, threshold, pressure, reason: `Nadie con edad para decidir puede juzgar ${lugar(site)}: la banda sigue su camino.` };
  }
  const settle = site.viable && consensus.average >= threshold;
  const reason = settle ? razonAsentarse(site, consensus, threshold, pressure) : razonRechazo(site, consensus, threshold);
  return { settle, site, consensus, threshold, pressure, reason };
}

// --- Cadencia y crónica ---------------------------------------------------------------------------

const lineaDisidente = (d, site) =>
  `${d.nombre} ${d.delta < 0 ? 'desconfió' : 'se entusiasmó'} de ${lugar(site)} (${Math.abs(redondear(d.delta))} puntos de diferencia con la banda). ${d.delta < 0 ? 'Nadie la escuchó.' : 'Nadie le hizo caso.'}`;

// Evalúa solo si toca: cada INTERVALO_EVALUACION ticks desde band.lastEvaluation, o antes (pasados ESPERA_MINIMA)
// si la presión subió SALTO_PRESION desde la última evaluación. Devuelve null cuando no toca; si toca, anota la
// evaluación en la banda y devuelve { decision, chronicle }. Si decide asentarse fija band.site como destino.
// Mientras band.site esté fijado (la banda camina hacia él) no se vuelve a decidir: ni cambia el destino ni se
// repite la crónica. Si lo abandona (band.site a null), la siguiente evaluación decide de nuevo con su exclusión.
// La crónica solo habla cuando cambia el resultado (sitio, veredicto o número de abandonos): un mismo rechazo
// no se repite cada día. Los disidentes solo se anotan si la banda se asienta: solo entonces nadie los escuchó.
export function considerSettlement(band, discovery, ctx, tick) {
  if (band.settled || band.site) return null;
  const transcurrido = tick - band.lastEvaluation;
  const presion = bandPressure(band, ctx);
  const subida = presion - (band.lastEvalPressure ?? presion) >= SALTO_PRESION;
  const toca = transcurrido >= INTERVALO_EVALUACION || (subida && transcurrido >= ESPERA_MINIMA);
  if (!toca) return null;
  band.lastEvaluation = tick;
  band.lastEvalPressure = presion;
  const decision = decideSettlement(band, discovery, ctx);
  if (decision.settle) band.site = { x: decision.site.x, y: decision.site.y };
  const clave = `${decision.site ? `${decision.site.x},${decision.site.y}` : 'sin-sitio'}|${decision.settle}|${(band.abandonedSites ?? []).length}`;
  if (clave === band.lastDecisionKey) return { decision, chronicle: [] };
  band.lastDecisionKey = clave;
  const chronicle = [decision.reason];
  if (decision.settle) for (const d of decision.consensus.dissenters) chronicle.push(lineaDisidente(d, decision.site));
  return { decision, chronicle };
}
