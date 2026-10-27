// Los paneles que viven dentro de las hojas: la banda, la crónica, el mundo y —la central— el desglose de un
// sitio. El juego no admite órdenes: todo lo que el jugador puede hacer es ENTENDER por qué la banda hace lo
// que hace, así que estos paneles son el juego, no un anexo.
//
// El mundo se lee solo por discovery (y por sitescore, que también lee por discovery): aquí no hay rejilla.
import { h, boton, conmutador } from './dom.js';
import { NEEDS } from '../agents/needs.js';
import { RESOURCES } from '../world/resources.js';
import { SITE_FACTORS, acceptanceThreshold, candidateSites } from '../tribe/sitescore.js';
import { evaluateConsensus } from '../tribe/consensus.js';
import { livingNpcs, bandPressure } from '../tribe/band.js';
import { isElder, isAdult } from '../agents/npc.js';
import { recent } from '../chronicle.js';

const TICKS_POR_DIA = 24;   // los de createClock por defecto

// --- Formato ------------------------------------------------------------------------------------
// Las cantidades del modelo son fraccionarias (3.7000000000000002 de leña). En pantalla se redondean a un
// decimal: dos ya no dicen nada al jugador y el ruido binario no es información.
export const unDecimal = (v) => String(Math.round(v * 10) / 10);
export const porcentaje = (v) => `${Math.round(v * 100)}%`;
// Una aportación se lee mejor con su signo delante: +11.2 suma, -3.4 resta.
export const conSigno = (v) => {
  const n = Math.round(v * 10) / 10;
  return `${n > 0 ? '+' : ''}${n}`;
};
const entero = (v) => String(Math.round(v));
const lugar = (s) => `(${s.x}, ${s.y})`;
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// --- La banda -----------------------------------------------------------------------------------

const etiquetaEdad = (npc) => (isElder(npc) ? 'consejo' : isAdult(npc) ? 'adulto' : 'criatura');

// Una necesidad es una barra con su cifra: la barra se compara de un vistazo, la cifra se puede citar.
const filaNecesidad = (npc, need) => h('li', { class: 'need', dataset: { need: need.id } },
  h('span', { class: 'need-label' }, need.label),
  h('span', { class: 'need-barra' }, h('i', { class: `need-relleno need-${need.id}`, style: `width:${Math.round(npc.needs[need.id])}%` })),
  h('span', { class: 'need-valor' }, entero(npc.needs[need.id])));

export function renderNpcCard(npc) {
  const t = npc.traits ?? {};
  return h('article', { class: 'npc-card', dataset: { npc: npc.id } },
    h('header', { class: 'npc-cabecera' },
      h('span', { class: 'npc-nombre' }, npc.nombre),
      h('span', { class: 'npc-edad' }, `${npc.age} años · ${etiquetaEdad(npc)}`)),
    h('p', { class: 'npc-accion' }, npc.action ? `Ahora: ${npc.action}` : 'Ahora: sin nada entre manos'),
    h('ul', { class: 'npc-necesidades' }, NEEDS.map((need) => filaNecesidad(npc, need))),
    h('p', { class: 'npc-rasgos' },
      `Cautela ${unDecimal(t.cautela ?? 0)} · Audacia ${unDecimal(t.audacia ?? 0)} · Sabiduría ${unDecimal(t.sabiduria ?? 0)}`));
}

export function renderBandPanel(game) {
  const vivos = livingNpcs(game.band);
  const presion = bandPressure(game.band, { season: game.clock.season });
  return h('div', { class: 'band-panel' },
    h('p', { class: 'band-resumen' },
      `${plural(vivos.length, 'habitante', 'habitantes')} · ${game.band.settled ? 'Aldea' : 'Nómadas'} · apremio ${porcentaje(presion)}`),
    h('p', { class: 'band-explica' }, game.band.settled
      ? `Asentada en ${lugar(game.band)} desde el día ${game.settlement?.foundedDay ?? 0}.`
      : `Caminando${game.band.site ? ` hacia ${lugar(game.band.site)}` : ', aún sin destino'}. Con el apremio al ${porcentaje(presion)} aceptarían un sitio de ${entero(acceptanceThreshold(presion))} puntos.`),
    h('h3', { class: 'sheet-sub' }, 'Lo que llevan encima'),
    h('ul', { class: 'inventario' }, Object.values(RESOURCES).map((r) => h('li', { dataset: { recurso: r.id } },
      h('span', { class: 'inv-label' }, r.label),
      h('b', { class: 'inv-valor' }, unDecimal(game.band.inventory[r.id] ?? 0))))),
    h('h3', { class: 'sheet-sub' }, 'Quiénes son'),
    h('ul', { class: 'npc-lista' }, vivos.map((npc) => h('li', { class: 'npc-row' }, renderNpcCard(npc)))));
}

// --- La crónica ---------------------------------------------------------------------------------

export const ENTRADAS_VISIBLES = 120;

export function renderChroniclePanel(game) {
  const entradas = recent(game.chronicle, ENTRADAS_VISIBLES);
  if (entradas.length === 0) return h('p', { class: 'chronicle-panel sheet-vacio' }, 'Todavía no ha pasado nada que contar.');
  return h('div', { class: 'chronicle-panel' },
    h('ul', { class: 'cronica' }, entradas.map((e) => h('li', { class: `cronica-entrada${e.keep ? ' cronica-hito' : ''}`, dataset: { tipo: e.type } },
      h('span', { class: 'cronica-dia' }, `Día ${e.day}`),
      h('p', { class: 'cronica-texto' }, e.text)))));
}

// --- El mundo -----------------------------------------------------------------------------------

// handlers = { layers, onToggleLayer(id), onSite(site), onSave() -> string|null }.
// El panel se repinta solo: el estado de las capas vive fuera (lo usa el renderer) y aquí solo se lee.
export function renderWorldPanel(game, handlers = {}) {
  const caja = h('div', { class: 'world-panel' });
  const aviso = h('p', { class: 'world-aviso', role: 'status' });

  function pintar() {
    const capa = handlers.layers?.resources ?? null;
    const sitios = candidateSites(game.discovery, { season: game.clock.season });
    caja.replaceChildren(
      h('h3', { class: 'sheet-sub' }, 'Capas del mapa'),
      h('p', { class: 'sheet-nota' }, 'Tiñen el mapa con lo que la banda ha visto, no con lo que hay.'),
      h('div', { class: 'capas' }, Object.values(RESOURCES).map((r) =>
        conmutador(r.label, capa === r.id, { class: 'capa', dataset: { capa: r.id }, onclick: () => { handlers.onToggleLayer?.(r.id); pintar(); } }))),
      h('h3', { class: 'sheet-sub' }, 'Sitios que la banda considera'),
      sitios.length === 0
        ? h('p', { class: 'sheet-nota' }, 'Aún no conocen ningún lugar con agua dulce cerca. Siguen explorando.')
        : h('ul', { class: 'candidatos' }, sitios.map((s) => h('li', {}, botonCandidato(s, handlers)))),
      h('p', { class: 'world-descubierto' }, `Conocen ${plural(game.discovery.size, 'celda', 'celdas')} de su mundo.`),
      h('h3', { class: 'sheet-sub' }, 'Partida'),
      h('div', { class: 'world-acciones' }, boton('Guardar la partida', {
        class: 'btn-primary',
        onclick: () => { const r = handlers.onSave?.(); aviso.textContent = r ?? 'Partida guardada.'; },
      })),
      aviso);
  }

  pintar();
  return caja;
}

// Un candidato se presenta por lo que lo hace bueno: la cifra sola no explica nada.
function botonCandidato(s, handlers) {
  const mejor = s.factors.reduce((a, f) => (f.contribution > a.contribution ? f : a));
  return boton([
    h('span', { class: 'cand-total' }, entero(s.total)),
    h('span', { class: 'cand-lugar' }, lugar(s)),
    h('span', { class: 'cand-por' }, `lo que más pesa: ${mejor.label.toLowerCase()}`),
  ], { class: 'candidate', dataset: { x: String(s.x), y: String(s.y) }, onclick: () => handlers.onSite?.(s) });
}

// --- El desglose de sitio: la pantalla que hace legible el sistema de la Task 8 ------------------

// Arma la Decision de un sitio CUALQUIERA con las mismas funciones puras que usa la banda: el apremio y el
// umbral son los de ahora (no los de la última evaluación), y el consenso es el de este sitio. `reason` es lo
// que la banda dijo la última vez que decidió: es su voz, no una frase inventada por la interfaz.
export function decisionDeSitio(game, site) {
  const pressure = bandPressure(game.band, { season: game.clock.season });
  const threshold = acceptanceThreshold(pressure);
  const consensus = evaluateConsensus(game.band, site);
  // `reasonDay` no es adorno: la última decisión puede ser de hace días y hablar de otro sitio (o de que no
  // había ninguno). Visto junto a un sitio de 71 puntos, «aún no conocen ningún lugar» parece una mentira;
  // con su día delante es lo que es, una frase vieja. Lo descubrió una captura, no una prueba.
  const reasonDay = Math.floor((game.band.lastEvaluation ?? 0) / TICKS_POR_DIA);
  return { settle: site.viable && consensus.average >= threshold, site, consensus, threshold, pressure, reason: game.lastDecision?.reason ?? '', reasonDay };
}

const filaFactor = (f) => h('li', { class: `factor-row${f.contribution < 0 ? ' factor-penaliza' : ''}`, dataset: { factor: f.id } },
  h('span', { class: 'factor-label' }, f.label),
  h('span', { class: 'factor-aporta' }, conSigno(f.contribution)),
  h('span', { class: 'factor-barra' },
    h('i', { class: 'factor-relleno', style: `width:${Math.round(Math.min(1, f.value) * 100)}%` })),
  h('span', { class: 'factor-detalle' },
    'valor ', h('b', { class: 'factor-valor' }, porcentaje(f.value)),
    ' · peso ', h('b', { class: 'factor-peso' }, unDecimal(f.effectiveWeight))));

export function renderSiteBreakdown(site, decision) {
  const consenso = decision?.consensus ?? null;
  const umbral = decision?.threshold ?? acceptanceThreshold(0);
  const presion = decision?.pressure ?? 0;
  const media = consenso?.votes.length ? consenso.average : null;
  const estacional = site.factors.filter((f) => f.effectiveWeight !== f.weight);

  return h('div', { class: 'site-breakdown', dataset: { x: String(site.x), y: String(site.y) } },
    h('header', { class: 'site-cabecera' },
      h('p', { class: 'site-lugar' }, `El sitio de ${lugar(site)}`),
      h('p', { class: 'site-cifras' },
        h('b', { class: 'site-total' }, entero(site.total)), ' puntos de 100 · hacen falta ',
        h('b', { class: 'site-umbral' }, entero(umbral))),
      h('p', { class: 'site-veredicto' }, veredicto(site, decision, media, umbral)),
      h('p', { class: 'site-balance' },
        'Suman ', h('b', { class: 'site-suma' }, unDecimal(suma(site, (c) => c > 0))),
        ' y restan ', h('b', { class: 'site-resta' }, unDecimal(-suma(site, (c) => c < 0))),
        '.')),

    h('p', { class: 'site-presion' },
      `El apremio de la banda va al ${entero(presion * 100)}%: por eso hoy aceptarían ${entero(umbral)} puntos y no los ${entero(acceptanceThreshold(0))} que pedirían en calma.`),

    h('h3', { class: 'sheet-sub' }, 'De dónde sale la cifra'),
    h('p', { class: 'sheet-nota' }, 'Cada factor aporta su valor por su peso. Los dos últimos restan.'),
    h('ul', { class: 'factores' }, site.factors.map(filaFactor)),
    estacional.length > 0
      ? h('p', { class: 'sheet-nota site-estacion' }, `La estación cambia el peso de ${estacional.map((f) => f.label.toLowerCase()).join(', ')}.`)
      : null,
    !site.viable ? h('p', { class: 'site-inviable' }, 'Sin agua dulce a la vista o sobre el agua: no es un sitio donde se pueda vivir, y por eso no puntúa.') : null,

    h('h3', { class: 'sheet-sub' }, 'Lo que opina la banda'),
    consenso && consenso.votes.length > 0
      ? h('ul', { class: 'votos' }, consenso.votes.map((v) => h('li', { class: 'voto', dataset: { npc: v.npcId } },
        h('span', { class: 'voto-nombre' }, v.nombre), h('span', { class: 'voto-nota' }, entero(v.score)),
        v.elder ? h('span', { class: 'voto-anciano' }, 'cuenta doble') : null)))
      : h('p', { class: 'sheet-nota' }, 'Nadie con edad para decidir puede juzgarlo.'),
    consenso && consenso.dissenters.length > 0
      ? h('p', { class: 'site-disidencia' }, `Se apartan del grupo: ${consenso.dissenters.map((d) => `${d.nombre} (${conSigno(d.delta)})`).join(', ')}.`)
      : null,

    decision?.reason
      ? h('div', { class: 'site-ultima' },
        h('h3', { class: 'sheet-sub' }, `Lo último que decidieron (día ${decision.reasonDay ?? 0})`),
        h('p', { class: 'site-motivo' }, decision.reason))
      : null);
}

// Lo que suman las aportaciones positivas y lo que restan las negativas. Las dos penalizaciones son las dos
// últimas filas: sin esta línea el jugador no sabe que existen hasta que se desplaza.
const suma = (site, cumple) => site.factors.reduce((a, f) => a + (cumple(f.contribution) ? f.contribution : 0), 0);

function veredicto(site, decision, media, umbral) {
  if (!site.viable) return 'Aquí no se puede vivir.';
  if (media === null) return 'No hay quien lo juzgue.';
  return decision?.settle
    ? `El consejo le da ${entero(media)} de ${entero(umbral)}: se quedarían aquí.`
    : `El consejo le da ${entero(media)} y hacen falta ${entero(umbral)}: por ahora no.`;
}
