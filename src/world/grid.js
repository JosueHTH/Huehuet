// Cell grid for the world. Cells are stored flat, indexed y * width + x.
import { RESOURCES } from './resources.js';

export const BIOMES = {
  agua: { id: 'agua', label: 'Agua', color: '#2f6f9f', shelter: 0, predators: 0.1 },
  rio: { id: 'rio', label: 'Río', color: '#4f9fd0', shelter: 0, predators: 0.2 },
  pantano: { id: 'pantano', label: 'Pantano', color: '#5f7f4f', shelter: 0.2, predators: 0.5 },
  pradera: { id: 'pradera', label: 'Pradera', color: '#9fbf6f', shelter: 0.1, predators: 0.3 },
  bosque: { id: 'bosque', label: 'Bosque', color: '#3f7f3f', shelter: 0.7, predators: 0.6 },
  colina: { id: 'colina', label: 'Colina', color: '#b5a86f', shelter: 0.4, predators: 0.3 },
  montaña: { id: 'montaña', label: 'Montaña', color: '#8a8a8a', shelter: 0.8, predators: 0.2 },
  tundra: { id: 'tundra', label: 'Tundra', color: '#c9d6df', shelter: 0.3, predators: 0.4 },
};

function emptyResources() {
  return Object.fromEntries(Object.keys(RESOURCES).map((id) => [id, 0]));
}

export function createGrid(width, height) {
  const cells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      cells.push({
        x,
        y,
        elevation: 0,
        moisture: 0,
        temperature: 0,
        biome: 'pradera',
        river: false,
        resources: emptyResources(),
      });
    }
  }

  const inBounds = (x, y) =>
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;

  return {
    width,
    height,
    cells,
    inBounds,
    at(x, y) {
      return inBounds(x, y) ? cells[y * width + x] : null;
    },
    // Visits cells whose centre lies within Euclidean distance r of (x, y).
    // Only the clipped bounding square is scanned, so fn never sees an out-of-bounds cell.
    forRadius(x, y, r, fn) {
      const x0 = Math.max(0, Math.ceil(x - r));
      const x1 = Math.min(width - 1, Math.floor(x + r));
      const y0 = Math.max(0, Math.ceil(y - r));
      const y1 = Math.min(height - 1, Math.floor(y + r));
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const dx = cx - x;
          const dy = cy - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r * r) fn(cells[cy * width + cx], Math.sqrt(d2));
        }
      }
    },
  };
}
