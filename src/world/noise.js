// Seeded 2D value noise with smooth interpolation and fractal sums. Pure: all randomness
// comes from the rng given at creation, so the same rng stream always yields the same field.

const TABLE_BITS = 8;
const TABLE_SIZE = 1 << TABLE_BITS;

function hashLattice(ix, iy) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return h & (TABLE_SIZE - 1);
}

const smooth = (t) => t * t * (3 - 2 * t);

export function createValueNoise(rng) {
  const table = Array.from({ length: TABLE_SIZE }, () => rng.next());
  const lattice = (ix, iy) => table[hashLattice(ix, iy)];

  // One octave, in 0..1.
  function sample(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const top = lattice(ix, iy) + (lattice(ix + 1, iy) - lattice(ix, iy)) * fx;
    const bottom = lattice(ix, iy + 1) + (lattice(ix + 1, iy + 1) - lattice(ix, iy + 1)) * fx;
    return top + (bottom - top) * fy;
  }

  // Octaves summed with fixed lacunarity and persistence, in 0..1.
  function fractal(x, y, { octaves = 4, lacunarity = 2, persistence = 0.5 } = {}) {
    let sum = 0;
    let amplitude = 1;
    let total = 0;
    let frequency = 1;
    for (let o = 0; o < octaves; o++) {
      sum += sample(x * frequency, y * frequency) * amplitude;
      total += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return sum / total;
  }

  return { sample, fractal };
}
