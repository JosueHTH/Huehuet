// Hojas deslizables desde abajo. Una hoja se arrastra por su asa y engancha al 45% o al 90% de la altura de
// la pantalla; si el dedo la baja lo suficiente, se cierra. El cuerpo se desplaza por dentro y nunca llega a
// la barra de gestos, porque la hoja reserva --safe-bottom.
//
// Lo que se mueve es el ALTO de la hoja, no su desplazamiento: así su borde inferior está siempre pegado al
// borde de la pantalla y el relleno de área segura cae donde tiene que caer. Con translateY la hoja al 45%
// tendría el 45% inferior fuera de la pantalla y el relleno con él.
import { h, boton } from './dom.js';

export const SNAPS = [0.45, 0.9];

const limitar = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createSheet(root, opts = {}) {
  const alturaVista = opts.viewportHeight ?? (() => globalThis.innerHeight);
  const titulo = h('h2', { class: 'sheet-title' }, opts.title ?? '');
  const cuerpo = h('div', { class: 'sheet-body' });
  const asa = h('div', { class: 'sheet-grab', 'aria-hidden': 'true' });
  const cabecera = h('header', { class: 'sheet-head' }, titulo,
    boton('Cerrar', { class: 'btn-quiet sheet-close', onclick: () => api.close() }));
  const mango = h('div', { class: 'sheet-handle' }, asa, cabecera);
  const el = h('section', { class: 'sheet', role: 'dialog', 'aria-label': opts.title ?? 'Hoja', hidden: true },
    mango, cuerpo);
  root.append(el);

  let snap = SNAPS[0];
  let visible = 0;              // px de alto de la hoja ahora mismo
  let arrastre = null;          // { id, y0, alto0 }

  const maximo = () => alturaVista() * SNAPS[SNAPS.length - 1];
  const colocar = (px) => { visible = px; el.style.height = `${px}px`; };

  // El punto de enganche más cercano al alto actual. `null` quiere decir cerrada: bajar la hoja la cierra,
  // no la deja en un tercer tamaño improvisado.
  function masCercano(px) {
    const opciones = [...SNAPS.map((s) => ({ snap: s, px: s * alturaVista() })), { snap: null, px: 0 }];
    return opciones.reduce((mejor, o) => (Math.abs(o.px - px) < Math.abs(mejor.px - px) ? o : mejor));
  }

  function enganchar() {
    const destino = masCercano(visible);
    if (destino.snap === null) { api.close(); return; }
    snap = destino.snap;
    el.dataset.snap = String(snap);
    colocar(destino.px);
  }

  mango.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;      // el botón de cerrar no arrastra la hoja
    arrastre = { id: e.pointerId, y0: e.clientY, alto0: visible };
    mango.setPointerCapture?.(e.pointerId);
  });
  mango.addEventListener('pointermove', (e) => {
    if (!arrastre || e.pointerId !== arrastre.id) return;
    // El dedo baja (dy > 0) y la hoja se hace más baja: el borde superior sigue al dedo.
    colocar(limitar(arrastre.alto0 - (e.clientY - arrastre.y0), 0, maximo()));
  });
  const soltar = (e) => {
    if (!arrastre || e.pointerId !== arrastre.id) return;
    arrastre = null;
    enganchar();
  };
  mango.addEventListener('pointerup', soltar);
  mango.addEventListener('pointercancel', soltar);

  const api = {
    get isOpen() { return el.classList.contains('open'); },
    get snap() { return snap; },
    get element() { return el; },

    open(destino) {
      snap = SNAPS.includes(destino) ? destino : SNAPS[0];
      el.hidden = false;
      el.classList.add('open');
      el.dataset.snap = String(snap);
      colocar(snap * alturaVista());
      // Y DESPUÉS de darle alto. setContent también lo pone a cero, pero lo hace con la hoja oculta: sin
      // alto no hay nada que desplazar, y al abrirla el navegador restaura el desplazamiento de la hoja
      // anterior. Medido en una captura: cerrar la hoja de la banda desplazada y abrir la crónica la dejaba
      // 400 px más abajo, empezando a media frase.
      cuerpo.scrollTop = 0;
    },

    close() {
      arrastre = null;
      el.classList.remove('open');
      el.hidden = true;
      colocar(0);
    },

    setTitle(texto) {
      titulo.textContent = texto;
      el.setAttribute('aria-label', texto);
    },

    setContent(node) {
      cuerpo.replaceChildren(node);
      cuerpo.scrollTop = 0;
    },

    destroy() { el.remove(); },
  };
  return api;
}
