// Discovery: the cells the band has actually seen. The tribe/ modules read the world only through this.
// Known cells are kept as a Set of flat indices (y * width + x), so toJSON is a compact array of integers.

export function createDiscovery(grid) {
  const known = new Set();

  const discovery = {
    // Marks every cell within Euclidean distance `radius` of (x, y). Returns how many were newly discovered.
    reveal(x, y, radius) {
      let added = 0;
      grid.forRadius(x, y, radius, (cell) => {
        const index = cell.y * grid.width + cell.x;
        if (!known.has(index)) {
          known.add(index);
          added++;
        }
      });
      return added;
    },

    isKnown(x, y) {
      return grid.inBounds(x, y) && known.has(y * grid.width + x);
    },

    // The real cell when discovered, null otherwise. This is the only read path for tribe/ modules.
    knownCell(x, y) {
      return discovery.isKnown(x, y) ? grid.at(x, y) : null;
    },

    // Every discovered cell, in flat-index order. Makes no judgement about whether a cell is a good place to live.
    knownCells() {
      return [...known].sort((a, b) => a - b).map((index) => grid.cells[index]);
    },

    get size() {
      return known.size;
    },

    toJSON() {
      return [...known].sort((a, b) => a - b);
    },
  };

  return discovery;
}

// Rebuilds a Discovery from flat indices. Indices may come in any order. Entries that are not integers,
// fall outside the grid, or repeat an earlier entry are ignored, so a damaged save loads with less territory.
export function discoveryFromJSON(grid, indices) {
  const discovery = createDiscovery(grid);
  const total = grid.width * grid.height;
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= total) continue;
    discovery.reveal(index % grid.width, Math.floor(index / grid.width), 0);
  }
  return discovery;
}
