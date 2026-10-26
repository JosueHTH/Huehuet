// La crónica: el relato de la banda, en orden, con las más recientes al final.
// Guarda como máximo MAX_ENTRADAS; al pasarse descarta las más antiguas. Pura: sin reloj ni azar.
export const MAX_ENTRADAS = 500;

export function createChronicle() {
  return { entries: [] };
}

// `keep` marca un hito: una entrada que no se puede perder aunque la crónica se llene (el comienzo, la
// decisión, la fundación, una obra terminada, el final). Sin esto el día a día desaloja justamente lo
// que da sentido al relato: medido, una partida de 300 días acababa con las 500 entradas del tope
// siendo todas rutina y la fundación ya desaparecida. Al llenarse se descarta la entrada más antigua
// SIN marcar; si todo estuviera marcado, la más antigua a secas (el tope nunca se rebasa).
export function record(chronicle, { day, type, text, keep = false }) {
  chronicle.entries.push(keep ? { day, type, text, keep: true } : { day, type, text });
  while (chronicle.entries.length > MAX_ENTRADAS) {
    const rutinaria = chronicle.entries.findIndex((e) => !e.keep);
    chronicle.entries.splice(rutinaria === -1 ? 0 : rutinaria, 1);
  }
}

// Las n entradas más recientes, la más nueva primero. Una copia: no expone el arreglo interno.
export function recent(chronicle, n) {
  const cuantas = Math.max(0, Math.min(Math.floor(n) || 0, chronicle.entries.length));
  return chronicle.entries.slice(chronicle.entries.length - cuantas).reverse();
}
