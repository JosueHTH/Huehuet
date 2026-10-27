// La pantalla de partidas: lo primero que ve el jugador. Lista los slots del almacén, deja crear, continuar,
// renombrar y borrar, y mientras tanto calienta la memoria de lineaBase para que abrir un slot no congele el hilo.
// Lo puro (acciones, nombres, qué calentar, la miniatura) se exporta suelto y se prueba en Node; lo que toca el
// DOM solo se monta con mountSlotScreen y se prueba en el navegador.
import { h, boton } from './dom.js';
import { BIOME_COLORS, UNKNOWN_COLOR } from '../render/sprites.js';
import { lineaBase } from '../save/schema.js';
import { createGame } from '../game.js';

const TICKS_POR_DIA = 24;       // los de createClock por defecto
const TAMANO_MUNDO = 96;        // el de generateWorld por defecto: es el que guardan los slots hasta ahora
const CALENTAR_MAX = 3;         // la memoria de lineaBase guarda 4: queda un hueco para el slot que se abra

// --- Lo puro -------------------------------------------------------------------------------------

// Miniatura del mundo conocido: un fondo gris y una celda de bioma por cada celda descubierta. Lo descubierto
// se pide por discovery.knownCells(), el único camino de lectura del mundo: la rejilla entera no se recorre
// ni se toca.
export function renderThumbnail(game, size, createCanvas = () => globalThis.document.createElement('canvas')) {
  const lienzo = createCanvas();
  lienzo.width = size;
  lienzo.height = size;
  const ctx = lienzo.getContext('2d');
  const kx = size / game.grid.width, ky = size / game.grid.height;
  ctx.fillStyle = UNKNOWN_COLOR;
  ctx.fillRect(0, 0, size, size);
  for (const celda of game.discovery.knownCells()) {
    ctx.fillStyle = BIOME_COLORS[celda.biome] ?? UNKNOWN_COLOR;
    ctx.fillRect(Math.floor(celda.x * kx), Math.floor(celda.y * ky), Math.ceil(kx), Math.ceil(ky));
  }
  return lienzo.toDataURL('image/png');
}

// Un slot creado y nunca escrito: la Task 12 lo sostiene a propósito (de ahí que `Slot` lleve `seed`).
// Es el slot cuyo día es 0 y que no tiene miniatura, es decir, el que no ha guardado nada todavía.
export const sinComenzar = (slot) => slot.thumbnail === null && slot.day === 0;

const plural = (n, uno, varios) => (n === 1 ? uno : varios);

// El resumen de la ficha. Un slot sin comenzar no tiene cifras que enseñar: las del índice son ceros de
// relleno, y pintarlos le dice al jugador que su banda de siete está en cero. Se dice lo que de verdad se sabe.
export function datosDeSlot(slot) {
  if (sinComenzar(slot)) return 'Sin comenzar';
  return `Día ${slot.day} · ${slot.era} · ${slot.poblacion} ${plural(slot.poblacion, 'habitante', 'habitantes')}`;
}

// Un slot dañado no se puede abrir ni renombrar con sentido: solo se puede quitar de en medio.
export function accionesDeSlot(slot) {
  return slot.damaged ? ['borrar'] : ['continuar', 'renombrar', 'borrar'];
}

export function nombreNuevo(slots) {
  const usados = new Set(slots.map((s) => s.nombre));
  let n = 1;
  while (usados.has(`Partida ${n}`)) n++;
  return `Partida ${n}`;
}

// Los slots que el jugador probablemente abrirá: los más recientes, sin los dañados.
export function slotsACalentar(slots) {
  return slots.filter((s) => !s.damaged).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, CALENTAR_MAX);
}

// El primer tick del día guardado: nunca por encima del real, así que la memoria solo tiene que avanzar después.
export const ticksParaCalentar = (slot) => slot.day * TICKS_POR_DIA;

function cuandoHayHueco(tarea) {
  if (typeof globalThis.requestIdleCallback === 'function') {
    const id = globalThis.requestIdleCallback(tarea, { timeout: 2000 });
    return () => globalThis.cancelIdleCallback(id);
  }
  const id = setTimeout(tarea, 200);
  return () => clearTimeout(id);
}

// --- El DOM --------------------------------------------------------------------------------------

export function mountSlotScreen(root, store, handlers = {}) {
  const calentar = handlers.warm ?? lineaBase;
  const cuandoLibre = handlers.idle ?? cuandoHayHueco;
  let modo = null;            // { id, tipo: 'borrar' | 'renombrar' }
  let errores = new Map();    // id -> mensaje de por qué no se pudo abrir
  let cancelarCalentado = () => {};
  let visible = true;

  root.classList.add('slots-screen');
  const cabecera = h('header', { class: 'slots-header' },
    h('h1', {}, 'Huehuet'),
    h('p', { class: 'subtitulo' }, 'Tus partidas'));
  const aviso = h('p', { class: 'aviso aviso-guardado', role: 'status', hidden: true },
    'No se puede guardar en este navegador. Puedes jugar igualmente, pero la partida se perderá al cerrar.');
  const lista = h('div', { class: 'slots-list' });
  const vacio = h('p', { class: 'slots-empty' }, 'Sin partidas todavía. Crea una nueva y mira cómo la banda busca su lugar.');
  const nueva = boton('Nueva partida', { class: 'btn-primary', onclick: crear });
  const pie = h('footer', { class: 'slots-footer' }, nueva);
  root.append(cabecera, aviso, h('main', { class: 'slots-body' }, lista, vacio), pie);

  function crear() {
    const semilla = Math.floor(Math.random() * 2 ** 31);
    store.createSlot(nombreNuevo(store.listSlots()), semilla);
    modo = null;
    refresh();
    // La partida nueva queda al final de la lista: que se vea.
    lista.lastElementChild?.scrollIntoView?.({ block: 'nearest' });
  }

  function continuar(slot) {
    const r = store.readSlot(slot.id);
    if (r.ok) { handlers.onPlay?.(slot.id, r.game); return; }
    if (r.damaged) { refresh(); return; }    // ahora el índice la marca dañada: la tarjeta cambia sola
    // Un slot recién creado aún no tiene guardado: se empieza de cero con su semilla. Si el almacén no está
    // disponible también se juega, en memoria.
    if (!r.unsupported && sinComenzar(slot)) {
      handlers.onPlay?.(slot.id, createGame(slot.seed));
      return;
    }
    errores.set(slot.id, r.error);
    refresh();
  }

  function miniatura(slot) {
    return slot.thumbnail
      ? h('img', { class: 'slot-thumb', src: slot.thumbnail, alt: '', width: 96, height: 96 })
      : h('div', { class: 'slot-thumb slot-thumb-vacia', 'aria-hidden': 'true' });
  }

  function acciones(slot) {
    if (modo?.id === slot.id && modo.tipo === 'borrar') {
      return h('div', { class: 'slot-confirm' },
        h('p', { class: 'slot-confirm-texto' }, `¿Borrar «${slot.nombre}»? No se puede deshacer.`),
        h('div', { class: 'slot-actions' },
          boton('Confirmar', { class: 'btn-danger', onclick: () => { modo = null; store.deleteSlot(slot.id); refresh(); } }),
          boton('Cancelar', { onclick: () => { modo = null; refresh(); } })));
    }
    if (modo?.id === slot.id && modo.tipo === 'renombrar') {
      const campo = h('input', { class: 'slot-input', type: 'text', value: slot.nombre, maxLength: 60, 'aria-label': 'Nombre de la partida', enterKeyHint: 'done' });
      const guardar = () => { modo = null; store.renameSlot(slot.id, campo.value); refresh(); };
      campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') guardar(); });
      queueMicrotask(() => { campo.focus(); campo.select(); });
      return h('div', { class: 'slot-rename' }, campo,
        h('div', { class: 'slot-actions' },
          boton('Guardar', { class: 'btn-primary', onclick: guardar }),
          boton('Cancelar', { onclick: () => { modo = null; refresh(); } })));
    }
    const hechos = {
      continuar: () => boton('Continuar', { class: 'btn-primary', 'aria-label': `Continuar ${slot.nombre}`, onclick: () => continuar(slot) }),
      renombrar: () => boton('Renombrar', { 'aria-label': `Renombrar ${slot.nombre}`, onclick: () => { modo = { id: slot.id, tipo: 'renombrar' }; refresh(); } }),
      borrar: () => boton('Borrar', { class: 'btn-quiet', 'aria-label': `Borrar ${slot.nombre}`, onclick: () => { modo = { id: slot.id, tipo: 'borrar' }; refresh(); } }),
    };
    return h('div', { class: 'slot-actions' }, accionesDeSlot(slot).map((a) => hechos[a]()));
  }

  function tarjeta(slot) {
    return h('article', { class: `slot${slot.damaged ? ' slot-danado' : ''}`, 'data-id': slot.id },
      h('div', { class: 'slot-main' },
        miniatura(slot),
        h('div', { class: 'slot-info' },
          h('h2', { class: 'slot-nombre' }, slot.nombre),
          slot.damaged
            ? h('p', { class: 'aviso' }, 'Esta partida está dañada y no se puede abrir. Puedes borrarla.')
            : h('p', { class: 'slot-datos' }, datosDeSlot(slot)))),
      errores.has(slot.id) ? h('p', { class: 'aviso', role: 'alert' }, errores.get(slot.id)) : null,
      acciones(slot));
  }

  function refresh() {
    const slots = store.listSlots();
    errores = new Map([...errores].filter(([id]) => slots.some((s) => s.id === id)));
    aviso.hidden = store.available;
    lista.replaceChildren(...slots.map(tarjeta));
    vacio.hidden = slots.length > 0;
    programarCalentado(slots);
  }

  // Calentar la memoria de lineaBase en tiempo libre, un slot por tarea (cada uno puede costar casi un segundo
  // en frío) y nunca en el primer fotograma. Se repite en cada refresh: así un cambio de slot reordena la memoria.
  function programarCalentado(slots) {
    cancelarCalentado();
    if (!visible) return;
    const pendientes = slotsACalentar(slots).reverse();    // el más reciente al final: es el último en tocarse y el último en salir
    let cancelado = false;
    let cancelarTarea = () => {};
    const siguiente = () => {
      if (cancelado) return;
      const slot = pendientes.shift();
      if (!slot) return;
      try { calentar(slot.seed, TAMANO_MUNDO, TAMANO_MUNDO, ticksParaCalentar(slot)); } catch { /* calentar es una ayuda: nunca rompe la pantalla */ }
      cancelarTarea = cuandoLibre(siguiente);
    };
    cancelarTarea = cuandoLibre(siguiente);
    cancelarCalentado = () => { cancelado = true; cancelarTarea(); };
  }

  return {
    refresh,
    show() { visible = true; root.hidden = false; refresh(); },
    hide() { visible = false; root.hidden = true; cancelarCalentado(); },
  };
}
