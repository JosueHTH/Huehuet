// El HUD: una franja superior compacta con el estado de la partida y una barra inferior al alcance del pulgar
// con la pausa, las velocidades y los tres botones que abren las hojas. Flota sobre el mapa y se aloja en las
// áreas seguras del teléfono con --safe-top / --safe-bottom (los mismos que usa la pantalla de slots).
//
// El HUD no corre el tiempo: solo dice a qué velocidad querría el jugador que corriera (handlers.onSpeed).
// Quien lo haga correr es el bucle de la partida.
import { h, boton, conmutador } from './dom.js';
import { livingNpcs } from '../tribe/band.js';

// Las del spec: pausa, x1, x3 y x10.
export const VELOCIDADES = [
  { label: 'Pausa', value: 0 },
  { label: 'x1', value: 1 },
  { label: 'x3', value: 3 },
  { label: 'x10', value: 10 },
];
export const VELOCIDAD_INICIAL = 1;

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const horaDe = (h24) => `${String(h24).padStart(2, '0')}:00`;

export function mountHud(root, handlers = {}) {
  let velocidad = VELOCIDAD_INICIAL;

  const dia = h('span', { class: 'hud-dia' }, 'Día 0');
  const estacion = h('span', { class: 'hud-estacion' }, '');
  const hora = h('span', { class: 'hud-hora' }, '');
  const poblacion = h('span', { class: 'hud-poblacion' }, '');
  const era = h('span', { class: 'hud-era' }, '');
  const arriba = h('div', { class: 'hud-top', role: 'status', 'aria-live': 'off' },
    h('div', { class: 'hud-linea' }, dia, estacion, hora),
    h('div', { class: 'hud-linea hud-linea-2' }, poblacion, era));

  const botonesVelocidad = VELOCIDADES.map((v) => conmutador(v.label, v.value === velocidad, {
    class: 'hud-vel',
    dataset: { velocidad: String(v.value) },
    onclick: () => elegirVelocidad(v.value),
  }));

  const hojas = [
    { id: 'banda', label: 'Banda' },
    { id: 'cronica', label: 'Crónica' },
    { id: 'mundo', label: 'Mundo' },
  ].map((s) => boton(s.label, { class: 'hud-hoja', dataset: { hoja: s.id }, onclick: () => handlers.onOpenSheet?.(s.id) }));

  const abajo = h('div', { class: 'hud-bottom' },
    h('div', { class: 'hud-row hud-row-vel', role: 'group', 'aria-label': 'Velocidad del tiempo' }, botonesVelocidad),
    h('div', { class: 'hud-row hud-row-hojas', role: 'group', 'aria-label': 'Paneles' }, hojas));

  root.append(arriba, abajo);

  function elegirVelocidad(valor) {
    velocidad = valor;
    for (const b of botonesVelocidad) {
      const activo = Number(b.dataset.velocidad) === valor;
      b.setAttribute('aria-pressed', activo ? 'true' : 'false');
      b.classList.toggle('on', activo);
    }
    handlers.onSpeed?.(valor);
  }

  // Solo se reescribe lo que ha cambiado: `update` corre en cada fotograma y asignar textContent invalida el
  // diseño de la página aunque el texto sea el mismo.
  const poner = (el, texto) => { if (el.textContent !== texto) el.textContent = texto; };

  const api = {
    get speed() { return velocidad; },

    update(game) {
      const { clock, band } = game;
      poner(dia, `Día ${clock.day}`);
      poner(estacion, clock.season);
      poner(hora, horaDe(clock.hour));
      poner(poblacion, plural(livingNpcs(band).length, 'habitante', 'habitantes'));
      poner(era, game.over ? 'se apagó' : band.settled ? 'Aldea' : 'Nómadas');
    },

    setSpeed(valor) { elegirVelocidad(valor); },

    destroy() { arriba.remove(); abajo.remove(); },
  };
  return api;
}
