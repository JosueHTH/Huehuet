// Los paneles que viven dentro de las hojas: la banda, la crónica, el mundo y —la central— el desglose de un
// sitio. El juego no admite órdenes: todo lo que el jugador puede hacer es ENTENDER por qué la banda hace lo
// que hace, así que estos paneles son el juego, no un anexo.
//
// El mundo se lee solo por discovery (y por sitescore, que también lee por discovery): aquí no hay rejilla.
import { h, boton, conmutador } from './dom.js';
import { NEEDS } from '../agents/needs.js';
import { RESOURCES } from '../world/resources.js';
import { SITE_FACTORS, acceptanceThreshold, candidateSites } from '../tribe/sitescore.js';
import { evaluateConsensus, decideSettlement } from '../tribe/consensus.js';
import { livingNpcs, bandPressure } from '../tribe/band.js';
import { isElder, isAdult } from '../agents/npc.js';
import { recent } from '../chronicle.js';

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

// Solo lo que de verdad llevan. Medido en la Task 15: el día 4 los seis recursos están a cero y esas seis
// filas se comían un tercio de la hoja abierta al 45%, cortando la primera ficha de NPC. Seis ceros no son
// información: lo que el jugador necesita saber es que no llevan nada, y eso se dice en una línea.
export function inventario(inv = {}) {
  const llevan = Object.values(RESOURCES).filter((r) => (inv[r.id] ?? 0) > 0);
  if (llevan.length === 0) return h('p', { class: 'inventario-vacio sheet-nota' }, 'No llevan nada encima todavía.');
  return h('ul', { class: 'inventario' }, llevan.map((r) => h('li', { dataset: { recurso: r.id } },
    h('span', { class: 'inv-label' }, r.label),
    h('b', { class: 'inv-valor' }, unDecimal(inv[r.id] ?? 0)))));
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
    inventario(game.band.inventory),
    h('h3', { class: 'sheet-sub' }, 'Quiénes son'),
    h('ul', { class: 'npc-lista' }, vivos.map((npc) => h('li', { class: 'npc-row' }, renderNpcCard(npc)))));
}

// --- La crónica ---------------------------------------------------------------------------------

export const ENTRADAS_VISIBLES = 120;

// El relato rutinario ahoga los hitos: medido en la Task 15, 5 de cada 7 entradas eran «X descubrió N
// lugares nuevos». No hace falta tocar la simulación para arreglarlo, porque la crónica ya marca sus hitos
// (`keep`): basta con dejar al jugador quedarse solo con ellos. El conmutador vive en el panel y se recuerda
// mientras la hoja esté abierta.
export function renderChroniclePanel(game) {
  const entradas = recent(game.chronicle, ENTRADAS_VISIBLES);
  if (entradas.length === 0) return h('p', { class: 'chronicle-panel sheet-vacio' }, 'Todavía no ha pasado nada que contar.');
  const hitos = entradas.filter((e) => e.keep);
  const caja = h('div', { class: 'chronicle-panel' });
  let soloHitos = false;

  const entrada = (e) => h('li', { class: `cronica-entrada${e.keep ? ' cronica-hito' : ''}`, dataset: { tipo: e.type } },
    h('span', { class: 'cronica-dia' }, `Día ${e.day}`),
    h('p', { class: 'cronica-texto' }, e.text));

  function pintar() {
    const visibles = soloHitos ? hitos : entradas;
    caja.replaceChildren(
      h('div', { class: 'cronica-filtro' },
        conmutador(`Solo los hitos (${hitos.length})`, soloHitos, {
          class: 'cronica-solo-hitos',
          onclick: () => { soloHitos = !soloHitos; pintar(); },
        })),
      visibles.length === 0
        ? h('p', { class: 'sheet-vacio' }, 'Todavía no hay ningún hito que contar.')
        : h('ul', { class: 'cronica' }, visibles.map(entrada)));
  }

  pintar();
  return caja;
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

// Arma la Decision de un sitio CUALQUIERA con las mismas funciones puras que usa la banda: el apremio, el
// umbral y el consenso son los de AHORA, no los de la última evaluación.
//
// El motivo también. Tomarlo de `game.lastDecision` lo dejaba medio fresco y medio rancio presentado como una
// sola decisión: `considerSettlement` devuelve null entero mientras `band.site` esté fijado y la banda camine,
// así que la última decisión llegaba a tener 131 ticks (5,5 días) y podía contradecir el veredicto en negrita
// de su propia hoja —votos de 67 a 70 sobre un umbral de 59 y «se quedarían aquí» arriba, «aún no conoce
// ningún lugar con agua dulce» tres líneas más abajo—. Fecharlo no lo arreglaba: en el caso que lo descubrió
// la evaluación fue en el tick 102 y el candidato se conoció en el 108, los dos del día 4.
//
// Así que se le vuelve a PREGUNTAR a la banda: `decideSettlement` es pura, devuelve la Decision entera con su
// `reason` y cuesta 2,3 ms con 837 celdas conocidas (12,5 ms con 1825), y esto corre una vez por toque, no
// por fotograma. No hay nada que duplicar: hay que llamarla.
export function decisionDeSitio(game, site) {
  const pressure = bandPressure(game.band, { season: game.clock.season });
  const threshold = acceptanceThreshold(pressure);
  const consensus = evaluateConsensus(game.band, site);
  const vigente = decideSettlement(game.band, game.discovery, { season: game.clock.season });
  // El motivo habla del MEJOR sitio de la banda, que puede no ser el que el jugador tocó. Si es otro hay que
  // decirlo: «se asienta en (34, 72)» leído en la hoja de (33, 71) sería otra contradicción, ahora fresca.
  const otroSitio = vigente.site && (vigente.site.x !== site.x || vigente.site.y !== site.y) ? vigente.site : null;
  return { settle: site.viable && consensus.average >= threshold, site, consensus, threshold, pressure, reason: vigente.reason, otroSitio };
}

// La barra codifica la APORTACIÓN, no el valor, en proporción a la mayor del sitio. Bajo el rótulo «De dónde
// sale la cifra» una barra invita a comparar filas, y con el valor dibujado el orden de las barras no era el
// de los números: agua dulce (75% → +16,4) salía casi tan larga como caza (80% → +23,2), así que quien
// comparaba barras obtenía un orden distinto del que manda. El valor no se pierde: sigue a la derecha, como
// cifra, donde no invita a compararse de un vistazo.
export const anchoBarra = (f, mayorAporta) =>
  (mayorAporta > 0 ? Math.round(Math.min(1, Math.abs(f.contribution) / mayorAporta) * 100) : 0);

const filaFactor = (f, mayorAporta) => h('li', { class: `factor-row${f.contribution < 0 ? ' factor-penaliza' : ''}`, dataset: { factor: f.id } },
  h('span', { class: 'factor-label' }, f.label),
  h('span', { class: 'factor-aporta' }, conSigno(f.contribution)),
  h('span', { class: 'factor-barra' },
    h('i', { class: 'factor-relleno', style: `width:${anchoBarra(f, mayorAporta)}%` })),
  h('span', { class: 'factor-detalle' },
    'valor ', h('b', { class: 'factor-valor' }, porcentaje(f.value)),
    ' · peso ', h('b', { class: 'factor-peso' }, unDecimal(f.effectiveWeight))));

export function renderSiteBreakdown(site, decision) {
  const consenso = decision?.consensus ?? null;
  const umbral = decision?.threshold ?? acceptanceThreshold(0);
  const presion = decision?.pressure ?? 0;
  const media = consenso?.votes.length ? consenso.average : null;
  const estacional = site.factors.filter((f) => f.effectiveWeight !== f.weight);
  const mayorAporta = site.factors.reduce((a, f) => Math.max(a, Math.abs(f.contribution)), 0);

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
    h('p', { class: 'sheet-nota' }, 'Cada factor aporta su valor por su peso. La barra dibuja esa aportación, así que se pueden comparar entre sí. Los dos últimos restan.'),
    h('ul', { class: 'factores' }, site.factors.map((f) => filaFactor(f, mayorAporta))),
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

    // El encabezado no es una fecha, es una relación: lo que la banda decidiría AHORA, con estas mismas
    // cifras. Y si lo que decidiría habla de otro sitio, lo dice aquí mismo.
    decision?.reason
      ? h('div', { class: 'site-ultima' },
        h('h3', { class: 'sheet-sub' }, decision.otroSitio
          ? `Qué decidirían ahora (hablan de ${lugar(decision.otroSitio)}, no de este sitio)`
          : 'Qué decidirían ahora'),
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
    ? `El consejo le da ${entero(media)} y hacen falta ${entero(umbral)}: se quedarían aquí.`
    : `El consejo le da ${entero(media)} y hacen falta ${entero(umbral)}: por ahora no.`;
}
