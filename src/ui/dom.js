// Los ayudantes de DOM que comparten la pantalla de partidas, el HUD, las hojas y los paneles. No saben
// nada del juego. Hubo dos copias de `h` (esta y la de slots.js, de la Task 14) hasta que la Task 16 las
// unificó: dos copias de lo mismo divergen en silencio, y la de slots.js ya se había quedado sin `dataset`.

export function h(etiqueta, props = {}, ...hijos) {
  const el = globalThis.document.createElement(etiqueta);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'type') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const hijo of hijos.flat()) if (hijo !== undefined && hijo !== null && hijo !== false) el.append(hijo);
  return el;
}

export const boton = (texto, props = {}) =>
  h('button', { type: 'button', ...props, class: `btn ${props.class ?? ''}`.trim() }, texto);

// Un conmutador: lo que el jugador enciende y apaga. aria-pressed es lo que lo hace legible para un lector
// de pantalla y, de paso, lo único observable desde fuera de que está activo.
export const conmutador = (texto, activo, props = {}) =>
  boton(texto, { ...props, 'aria-pressed': activo ? 'true' : 'false', class: `btn-toggle${activo ? ' on' : ''} ${props.class ?? ''}`.trim() });
