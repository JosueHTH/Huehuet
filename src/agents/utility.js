// Decisión por utilidad: se puntúa todo el catálogo y gana la mayor puntuación.
// Sin azar: en un empate gana la primera acción del catálogo, para que la partida se pueda repetir desde su semilla.
import { ACTIONS } from './actions.js';

// Acción nula, fuera del catálogo: es lo que devuelve chooseAction cuando ninguna acción puntúa más de 0,
// para que "nada es viable" se distinga de "esta es la mejor". Quien la reciba decide qué hacer (p. ej. avisar).
export const IDLE = { id: 'esperar', label: 'Esperar', score: () => 0, apply: () => null };

export function chooseAction(npc, band, ctx, actions = ACTIONS) {
  let mejor = null;
  let mejorPuntuacion = 0;
  for (const accion of actions) {
    const puntuacion = accion.score(npc, band, ctx);
    if (puntuacion > mejorPuntuacion) {
      mejor = accion;
      mejorPuntuacion = puntuacion;
    }
  }
  return mejor ?? IDLE;
}
