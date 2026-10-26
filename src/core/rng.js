// Seeded PRNG (mulberry32) with labelled forks. No ambient randomness.

// Devuelve el generador y dos accesos al único entero de 32 bits que es todo su estado: así una partida
// guardada puede seguir el flujo de azar exactamente donde se quedó.
function mulberry32(a) {
  const next = function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, getState: () => a >>> 0, setState: (s) => { a = s | 0; } };
}

// FNV-1a, 32 bits.
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed) {
  const base = seed >>> 0;
  const { next, getState, setState } = mulberry32(base);
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    getState,   // para guardar: el estado del flujo, un entero de 32 bits
    setState,   // para cargar: reanuda el flujo en ese punto
    int,
    pick(items) {
      return items[int(0, items.length - 1)];
    },
    chance(p) {
      return next() < p;
    },
    // Derives from the base seed, not the stream state, so forking never consumes the parent.
    fork(label) {
      return createRng((base ^ fnv1a(label)) >>> 0);
    },
  };
}
