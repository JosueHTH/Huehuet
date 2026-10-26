// Decisión por utilidad: se puntúa todo el catálogo y gana la mayor puntuación.
// Sin azar: en un empate gana la primera acción del catálogo, para que la partida se pueda repetir desde su semilla.
import { ACTIONS } from './actions.js';

export function chooseAction(npc, band, ctx, actions = ACTIONS) {
  let mejor = null;
  let mejorPuntuacion = -Infinity;
  for (const accion of actions) {
    const puntuacion = accion.score(npc, band, ctx);
    if (puntuacion > mejorPuntuacion) {
      mejor = accion;
      mejorPuntuacion = puntuacion;
    }
  }
  return mejor;
}
