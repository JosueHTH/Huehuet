// La crónica: el relato de la banda, en orden, con las más recientes al final.
// Guarda como máximo MAX_ENTRADAS; al pasarse descarta las más antiguas. Pura: sin reloj ni azar.
export const MAX_ENTRADAS = 500;

export function createChronicle() {
  return { entries: [] };
}

export function record(chronicle, { day, type, text }) {
  chronicle.entries.push({ day, type, text });
  if (chronicle.entries.length > MAX_ENTRADAS) chronicle.entries.splice(0, chronicle.entries.length - MAX_ENTRADAS);
}

// Las n entradas más recientes, la más nueva primero. Una copia: no expone el arreglo interno.
export function recent(chronicle, n) {
  const cuantas = Math.max(0, Math.min(Math.floor(n) || 0, chronicle.entries.length));
  return chronicle.entries.slice(chronicle.entries.length - cuantas).reverse();
}
