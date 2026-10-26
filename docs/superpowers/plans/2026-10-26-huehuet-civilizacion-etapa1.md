# Huehuet — Civilización 2D (Etapa 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un simulador 2D jugable en Safari móvil donde una banda de NPCs autónomos recorre un mundo generado, descubre recursos y decide por consenso dónde asentarse, con varios slots de guardado local.

**Architecture:** La simulación (`core/`, `world/`, `agents/`, `tribe/`) son módulos de funciones puras sobre estado, sin acceso a `window`, `document`, `Date.now()` ni `Math.random()`: el tiempo entra como argumento y la aleatoriedad como instancia de `rng`. `render/` y `ui/` leen ese estado y nunca lo escriben. Esa frontera es lo que permite testear todo en Node sin navegador y garantizar que una semilla reproduzca el mismo mundo.

**Tech Stack:** HTML5, Canvas2D, módulos ES nativos, cero dependencias, cero build. Pruebas con `node:test` y `node:assert/strict`. Verificación de interfaz con Playwright (ya instalado en el entorno).

**Spec:** `docs/superpowers/specs/2026-10-26-huehuet-civilizacion-design.md`

## Global Constraints

- Cero dependencias de runtime y cero empaquetador. `package.json` solo declara `"type": "module"` y el script de pruebas.
- Módulos ES nativos (`import`/`export`), servidos como archivos estáticos.
- Los módulos bajo `src/core/`, `src/world/`, `src/agents/`, `src/tribe/` y `src/save/schema.js` no pueden referenciar `window`, `document`, `canvas`, `localStorage`, `Date.now()` ni `Math.random()`.
- Toda aleatoriedad pasa por una instancia de `rng` creada con `createRng(seed)`.
- Las cinco necesidades viven en el rango 0-100 inclusive, siempre.
- Idioma de toda la interfaz y de la crónica: español.
- Objetivo de pantalla: 1320x2868 px, vertical. Altura con `100dvh`, rellenos con `env(safe-area-inset-*)`.
- Objetivos táctiles de 44 px CSS como mínimo. Sin dependencia de `:hover`.
- Sin assets de imagen externos: todo gráfico es procedural.
- No se modifica ni se borra nada del proyecto Godot existente (`project.godot`, `scenes/`, `scripts/`, `tests/shots.gd`).
- Pruebas nuevas bajo `tests/huehuet/`.

## Review Focus

Cinco clases de entrada que el spec implica y que conviene fijar con una prueba, de más a menos probable:

1. **Pestaña en segundo plano.** El jugador cambia de app diez minutos; `requestAnimationFrame` se detiene y al volver el acumulador del reloj pide miles de ticks de golpe y congela la página. El reloj debe acotar los ticks por llamada. → Prueba en Task 1.
2. **Almacenamiento bloqueado o lleno.** Safari en navegación privada lanza al escribir. El juego debe avisar una vez y seguir en memoria sin perder la sesión. → Prueba en Task 12.
3. **Partida corrupta o de versión superior.** Un JSON truncado o una `version` mayor que la actual no puede romper la lista de slots ni la pantalla de inicio. → Prueba en Task 12.
4. **Toque que en realidad es arrastre.** Un dedo que se mueve 3 px antes de levantarse no debe abrir la ficha de un NPC, y un segundo dedo que se levanta antes que el primero no debe hacer saltar la cámara. → Prueba en Task 13.
5. **Viewport inesperado.** Horizontal, o una ventana de 1320x600, no debe dejar el HUD tapando el mapa ni desbordar la página. → Prueba en Task 16.

---

### Task 1: Núcleo determinista — RNG y reloj

**Files:**
- Create: `package.json`, `src/core/rng.js`, `src/core/clock.js`
- Test: `tests/huehuet/core.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `createRng(seed: number) -> Rng` con `Rng = { next(): number /* [0,1) */, int(min: number, max: number): number /* inclusivo */, pick<T>(items: T[]): T, chance(p: number): boolean, fork(label: string): Rng }`
  - `createClock(opts?: { ticksPerDay?: number, msPerTick?: number, maxTicksPerAdvance?: number }) -> Clock` con `Clock = { advance(dtMs: number, speed: number): number, tick: number, day: number, hour: number, season: 'primavera'|'verano'|'otoño'|'invierno' }`. Valores por defecto: `ticksPerDay: 24`, `msPerTick: 400`, `maxTicksPerAdvance: 24`. Las estaciones duran 30 días cada una.

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
test('createRng es determinista para la misma semilla', () => {
  const a = createRng(12345), b = createRng(12345);
  const seqA = Array.from({ length: 50 }, () => a.next());
  const seqB = Array.from({ length: 50 }, () => b.next());
  assert.deepEqual(seqA, seqB);
});

test('createRng produce secuencias distintas para semillas distintas', () => {
  assert.notDeepEqual(createRng(1).next(), createRng(2).next());
});

test('next se mantiene en [0,1)', () => {
  const rng = createRng(7);
  for (let i = 0; i < 1000; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1, `fuera de rango: ${v}`);
  }
});

test('int respeta los límites inclusivos', () => {
  const rng = createRng(9);
  for (let i = 0; i < 500; i++) {
    const v = rng.int(3, 5);
    assert.ok(v === 3 || v === 4 || v === 5, `fuera de rango: ${v}`);
  }
});

test('fork con la misma etiqueta da la misma subsecuencia', () => {
  const a = createRng(42).fork('mundo'), b = createRng(42).fork('mundo');
  assert.equal(a.next(), b.next());
});

test('fork con etiquetas distintas no comparte secuencia', () => {
  const base = createRng(42);
  assert.notEqual(base.fork('mundo').next(), base.fork('npcs').next());
});

test('advance acumula tiempo parcial hasta completar un tick', () => {
  const clock = createClock();
  assert.equal(clock.advance(200, 1), 0);
  assert.equal(clock.advance(200, 1), 1);
  assert.equal(clock.tick, 1);
});

test('la velocidad multiplica los ticks, no los altera', () => {
  const uno = createClock(), diez = createClock();
  uno.advance(4000, 1);
  diez.advance(400, 10);
  assert.equal(uno.tick, diez.tick);
});

// Review Focus 1
test('advance acota los ticks tras una pausa larga en segundo plano', () => {
  const clock = createClock();
  const ticks = clock.advance(600000, 10);
  assert.equal(ticks, 24, 'debe acotarse a maxTicksPerAdvance');
  assert.equal(clock.tick, 24);
});

test('advance con velocidad 0 no avanza', () => {
  const clock = createClock();
  assert.equal(clock.advance(10000, 0), 0);
  assert.equal(clock.tick, 0);
});

test('day, hour y season derivan del tick', () => {
  const clock = createClock();
  clock.advance(400 * 24 * 31, 1);
  assert.equal(clock.day, 31);
  assert.equal(clock.hour, 0);
  assert.equal(clock.season, 'verano');
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `node --test tests/huehuet/core.test.js`
Esperado: FAIL, módulos no encontrados.

- [ ] **Step 3: Crear `package.json`**

Campos: `"name": "huehuet"`, `"private": true`, `"type": "module"`, `"scripts": { "test": "node --test tests/huehuet/*.test.js" }`, de modo que `npm test` nunca intente ejecutar los `.spec.mjs` de Playwright. Sin `dependencies` ni `devDependencies`.

- [ ] **Step 4: Implementar `createRng` en `src/core/rng.js`**

Algoritmo mulberry32, porque es de 32 bits, sin dependencias y reproducible entre ejecuciones:

```js
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

`fork(label)` deriva una semilla mezclando la semilla base con un hash de la etiqueta (por ejemplo FNV-1a de 32 bits), de forma que el `fork` no consuma la secuencia del padre.

- [ ] **Step 5: Implementar `createClock` en `src/core/clock.js`**

Acumula `dtMs * speed` en un acumulador interno; cuenta los ticks completos, los acota a `maxTicksPerAdvance` y, al acotar, **descarta el acumulador sobrante** en vez de arrastrarlo — si no, la congelación solo se aplaza al siguiente fotograma. `day`, `hour` y `season` son getters derivados de `tick`.

- [ ] **Step 6: Ejecutar las pruebas**

Run: `npm test`
Esperado: PASS, 11 pruebas.

- [ ] **Step 7: Commit**

```bash
git add package.json src/core tests/huehuet/core.test.js
git commit -m "feat(core): RNG con semilla y reloj de tick fijo acotado"
```

---

### Task 2: Rejilla y catálogo de recursos

**Files:**
- Create: `src/world/grid.js`, `src/world/resources.js`
- Test: `tests/huehuet/grid.test.js`

**Interfaces:**
- Consumes: `createRng` (Task 1).
- Produces:
  - `createGrid(width: number, height: number) -> Grid` con `Grid = { width, height, at(x,y): Cell|null, inBounds(x,y): boolean, forRadius(x, y, r, fn: (cell: Cell, dist: number) => void): void, cells: Cell[] }`
  - `Cell = { x, y, elevation: number /* 0..1 */, moisture: number /* 0..1 */, temperature: number /* 0..1 */, biome: BiomeId, river: boolean, resources: Record<ResourceId, number> }`
  - `BIOMES: Record<BiomeId, { id, label, color, shelter: number, predators: number }>` con `BiomeId` en `'agua' | 'rio' | 'pantano' | 'pradera' | 'bosque' | 'colina' | 'montaña' | 'tundra'`
  - `RESOURCES: Record<ResourceId, { id, label, max: number, regenPerDay: number }>` con `ResourceId` en `'agua' | 'caza' | 'forraje' | 'leña' | 'piedra' | 'pedernal'`
  - `regenerateResources(grid: Grid, ticks: number): void`
  - `consume(cell: Cell, resourceId: ResourceId, amount: number): number /* lo realmente obtenido */`

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
test('forRadius visita las celdas dentro del radio euclídeo y ninguna más', () => {
  const grid = createGrid(20, 20);
  const vistas = [];
  grid.forRadius(10, 10, 2, (c, d) => vistas.push([c.x, c.y, d]));
  assert.ok(vistas.every(([, , d]) => d <= 2));
  assert.ok(vistas.some(([x, y]) => x === 10 && y === 10));
  assert.ok(!vistas.some(([x, y]) => x === 13 && y === 10));
});

test('forRadius recorta en los bordes sin salirse', () => {
  const grid = createGrid(10, 10);
  let fuera = 0;
  grid.forRadius(0, 0, 3, (c) => { if (!grid.inBounds(c.x, c.y)) fuera++; });
  assert.equal(fuera, 0);
});

test('at devuelve null fuera de la rejilla', () => {
  const grid = createGrid(5, 5);
  assert.equal(grid.at(-1, 0), null);
  assert.equal(grid.at(5, 0), null);
});

test('consume nunca deja un recurso negativo y devuelve lo obtenido', () => {
  const grid = createGrid(3, 3);
  const cell = grid.at(1, 1);
  cell.resources.caza = 2;
  assert.equal(consume(cell, 'caza', 5), 2);
  assert.equal(cell.resources.caza, 0);
});

test('regenerateResources no supera el máximo del recurso', () => {
  const grid = createGrid(3, 3);
  const cell = grid.at(1, 1);
  cell.biome = 'bosque';
  cell.resources.leña = RESOURCES.leña.max - 1;
  regenerateResources(grid, 24 * 100);
  assert.equal(cell.resources.leña, RESOURCES.leña.max);
});

test('cada bioma del catálogo declara refugio y depredadores', () => {
  for (const b of Object.values(BIOMES)) {
    assert.equal(typeof b.shelter, 'number');
    assert.equal(typeof b.predators, 'number');
  }
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `node --test tests/huehuet/grid.test.js`
Esperado: FAIL, módulos no encontrados.

- [ ] **Step 3: Implementar `src/world/resources.js`**

Define `RESOURCES`, `regenerateResources` y `consume`. La regeneración por celda depende del bioma: `leña` solo crece en `bosque`, `caza` en `pradera`/`bosque`/`tundra`, `forraje` en `pradera`/`bosque`/`pantano`. `agua` no se agota.

- [ ] **Step 4: Implementar `src/world/grid.js`**

`cells` es un array plano de longitud `width * height`, indexado `y * width + x`, con las celdas inicializadas a `elevation: 0, moisture: 0, temperature: 0, biome: 'pradera', river: false` y todos los recursos a 0. `forRadius` itera solo el cuadrado delimitador y filtra por distancia euclídea.

- [ ] **Step 5: Ejecutar las pruebas**

Run: `npm test`
Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/world tests/huehuet/grid.test.js
git commit -m "feat(world): rejilla de celdas y catálogo de recursos"
```

---

### Task 3: Generación determinista del mundo

**Files:**
- Create: `src/world/worldgen.js`
- Test: `tests/huehuet/worldgen.test.js`

**Interfaces:**
- Consumes: `createRng` (Task 1), `createGrid`, `BIOMES`, `RESOURCES` (Task 2).
- Produces: `generateWorld(seed: number, opts?: { width?: number, height?: number }) -> World` con `World = { seed, grid: Grid, start: { x, y }, viableSites: Array<{x,y}> }`. Por defecto `width: 96`, `height: 96`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
test('la misma semilla produce un mundo idéntico', () => {
  const a = generateWorld(2024), b = generateWorld(2024);
  assert.deepEqual(a.grid.cells, b.grid.cells);
  assert.deepEqual(a.start, b.start);
});

test('semillas distintas producen mundos distintos', () => {
  assert.notDeepEqual(generateWorld(1).grid.cells, generateWorld(2).grid.cells);
});

// invariante del spec: la generación garantiza al menos un sitio viable
test('todo mundo generado contiene al menos un sitio viable', () => {
  for (let seed = 0; seed < 40; seed++) {
    const w = generateWorld(seed);
    assert.ok(w.viableSites.length > 0, `semilla ${seed} sin sitio viable`);
  }
});

test('un sitio viable tiene agua dulce a 3 celdas o menos', () => {
  const w = generateWorld(77);
  for (const site of w.viableSites) {
    let agua = false;
    w.grid.forRadius(site.x, site.y, 3, (c) => {
      if (c.biome === 'rio' || c.river) agua = true;
    });
    assert.ok(agua, `sitio ${site.x},${site.y} sin agua dulce`);
  }
});

test('la celda inicial es transitable y no es agua', () => {
  for (let seed = 0; seed < 20; seed++) {
    const w = generateWorld(seed);
    assert.notEqual(w.grid.at(w.start.x, w.start.y).biome, 'agua');
  }
});

test('el mundo contiene al menos cuatro biomas distintos', () => {
  const w = generateWorld(5);
  const biomas = new Set(w.grid.cells.map((c) => c.biome));
  assert.ok(biomas.size >= 4, `solo ${biomas.size} biomas`);
});

test('generateWorld no usa Math.random', () => {
  const real = Math.random;
  Math.random = () => { throw new Error('generateWorld usó Math.random'); };
  try { generateWorld(3); } finally { Math.random = real; }
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `node --test tests/huehuet/worldgen.test.js`
Esperado: FAIL.

- [ ] **Step 3: Implementar `generateWorld` en `src/world/worldgen.js`**

Orden de generación, cada etapa con su propio `rng.fork(etiqueta)` para que tocar una no desplace las demás:

1. **Elevación:** ruido de valor con interpolación suave sumado en 4 octavas (lacunaridad 2, persistencia 0.5), normalizado a 0..1. La rejilla de gradientes se siembra desde `rng.fork('elevacion')`.
2. **Humedad y temperatura:** dos campos de ruido independientes; la temperatura además baja con la elevación y con la latitud (distancia al centro vertical del mapa).
3. **Ríos:** elige los N puntos de mayor elevación y desciende por el vecino de menor elevación hasta llegar a `agua` o al borde, marcando `river: true` y `biome: 'rio'`. Esto garantiza agua dulce continua en el interior.
4. **Biomas:** tabla de decisión sobre `(elevation, moisture, temperature)` según el catálogo de Task 2.
5. **Recursos:** por celda, cantidad inicial según bioma, con dispersión del `rng`.
6. **Sitios viables y celda inicial:** recorre la rejilla, marca como viable toda celda no acuática con agua dulce a distancia ≤3, y elige `start` lejos del primer sitio viable (al menos a 20 celdas) para que la banda tenga que caminar.

**Garantía del invariante:** si tras la etapa 6 `viableSites` queda vacío, vuelve a trazar un río que pase por el centro del mapa y recalcula. La función no retorna un mundo sin sitios viables.

- [ ] **Step 4: Ejecutar las pruebas**

Run: `npm test`
Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/world/worldgen.js tests/huehuet/worldgen.test.js
git commit -m "feat(world): generación determinista con ríos y sitios viables garantizados"
```

---

### Task 4: Descubrimiento del territorio

**Files:**
- Create: `src/world/discovery.js`
- Test: `tests/huehuet/discovery.test.js`

**Interfaces:**
- Consumes: `createGrid` (Task 2), `generateWorld` (Task 3).
- Produces: `createDiscovery(grid: Grid) -> Discovery` con `Discovery = { reveal(x, y, radius: number): number /* celdas nuevas */, isKnown(x, y): boolean, knownCell(x, y): Cell|null, knownSites(): Array<{x,y}>, size: number, toJSON(): number[], }` y `discoveryFromJSON(grid: Grid, indices: number[]) -> Discovery`.

`knownCell` devuelve la celda real cuando es conocida y `null` cuando no. Es la única vía por la que `tribe/` lee el mundo: así la banda no puede puntuar lo que no ha visto.

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
test('nada es conocido al empezar', () => {
  const d = createDiscovery(createGrid(10, 10));
  assert.equal(d.size, 0);
  assert.equal(d.isKnown(5, 5), false);
  assert.equal(d.knownCell(5, 5), null);
});

test('reveal marca el radio y devuelve el número de celdas nuevas', () => {
  const d = createDiscovery(createGrid(20, 20));
  const nuevas = d.reveal(10, 10, 2);
  assert.ok(nuevas > 0);
  assert.ok(d.isKnown(10, 10));
  assert.ok(d.isKnown(11, 10));
  assert.equal(d.isKnown(15, 10), false);
  assert.equal(d.reveal(10, 10, 2), 0, 'revelar lo mismo no cuenta celdas nuevas');
});

test('knownCell devuelve la celda real una vez conocida', () => {
  const grid = createGrid(10, 10);
  const d = createDiscovery(grid);
  d.reveal(3, 3, 1);
  assert.equal(d.knownCell(3, 3), grid.at(3, 3));
});

test('knownSites solo incluye celdas conocidas', () => {
  const w = generateWorld(11);
  const d = createDiscovery(w.grid);
  d.reveal(w.start.x, w.start.y, 4);
  for (const s of d.knownSites()) assert.ok(d.isKnown(s.x, s.y));
});

test('toJSON y discoveryFromJSON reproducen el conjunto conocido', () => {
  const grid = createGrid(16, 16);
  const d = createDiscovery(grid);
  d.reveal(8, 8, 3);
  const r = discoveryFromJSON(grid, d.toJSON());
  assert.equal(r.size, d.size);
  assert.ok(r.isKnown(8, 8));
  assert.equal(r.isKnown(0, 0), false);
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `node --test tests/huehuet/discovery.test.js`
Esperado: FAIL.

- [ ] **Step 3: Implementar `src/world/discovery.js`**

El conjunto conocido es un `Set` de índices planos (`y * width + x`), para que `toJSON` sea un array de enteros y el guardado quede compacto.

- [ ] **Step 4: Ejecutar las pruebas**

Run: `npm test`
Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/world/discovery.js tests/huehuet/discovery.test.js
git commit -m "feat(world): descubrimiento del territorio con serialización compacta"
```

---

### Task 5: Necesidades y NPCs

**Files:**
- Create: `src/agents/needs.js`, `src/agents/npc.js`
- Test: `tests/huehuet/needs.test.js`

**Interfaces:**
- Consumes: `createRng` (Task 1), `BIOMES` (Task 2).
- Produces:
  - `NEEDS: Array<{ id, label }>` con ids `'hambre' | 'sed' | 'frio' | 'fatiga' | 'moral'`
  - `createNeeds(overrides?: Partial<Needs>) -> Needs` con `Needs = { hambre, sed, frio, fatiga, moral }`, por defecto `{ hambre: 20, sed: 20, frio: 10, fatiga: 10, moral: 70 }`
  - `tickNeeds(needs: Needs, ctx: NeedCtx) -> Needs` (nueva instancia, siempre acotada a 0..100) con `NeedCtx = { hour: number, season: string, biome: BiomeId, walking: boolean, working: boolean, nearFire: boolean, sheltered: boolean }`
  - `applyNeed(needs: Needs, id: NeedId, delta: number) -> Needs` (acotado)
  - `createNpc(rng: Rng, opts?: { age?: number, x?: number, y?: number }) -> Npc` con `Npc = { id: string, nombre: string, age: number, traits: { cautela, audacia, sabiduria } /* 0..1 */, needs: Needs, x, y, action: string|null, alive: boolean }`
  - `NOMBRES: string[]` (al menos 40 nombres, en español neutro de sonoridad prehistórica)
  - `isElder(npc: Npc): boolean` (edad ≥ 45), `isAdult(npc: Npc): boolean` (edad ≥ 15)

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
test('las necesidades nunca salen de 0..100 bajo cualquier secuencia', () => {
  const rng = createRng(1);
  let needs = createNeeds();
  const biomas = Object.keys(BIOMES);
  for (let i = 0; i < 20000; i++) {
    needs = tickNeeds(needs, {
      hour: i % 24, season: 'invierno', biome: rng.pick(biomas),
      walking: rng.chance(0.5), working: rng.chance(0.5),
      nearFire: rng.chance(0.3), sheltered: rng.chance(0.3),
    });
    for (const { id } of NEEDS) {
      assert.ok(needs[id] >= 0 && needs[id] <= 100, `${id} = ${needs[id]}`);
    }
  }
});

test('applyNeed acota por ambos extremos', () => {
  assert.equal(applyNeed(createNeeds({ sed: 95 }), 'sed', 50).sed, 100);
  assert.equal(applyNeed(createNeeds({ sed: 5 }), 'sed', -50).sed, 0);
});

test('tickNeeds no muta la instancia recibida', () => {
  const needs = createNeeds();
  const copia = { ...needs };
  tickNeeds(needs, { hour: 2, season: 'invierno', biome: 'tundra', walking: true, working: false, nearFire: false, sheltered: false });
  assert.deepEqual(needs, copia);
});

test('el frío sube de noche en invierno sin fuego y baja junto al fuego', () => {
  const ctx = { hour: 2, season: 'invierno', biome: 'tundra', walking: false, working: false, sheltered: false };
  const sinFuego = tickNeeds(createNeeds({ frio: 40 }), { ...ctx, nearFire: false });
  const conFuego = tickNeeds(createNeeds({ frio: 40 }), { ...ctx, nearFire: true });
  assert.ok(sinFuego.frio > 40);
  assert.ok(conFuego.frio < 40);
});

test('caminar cansa más que estar quieto', () => {
  const base = { hour: 12, season: 'verano', biome: 'pradera', working: false, nearFire: false, sheltered: false };
  const andando = tickNeeds(createNeeds(), { ...base, walking: true });
  const quieto = tickNeeds(createNeeds(), { ...base, walking: false });
  assert.ok(andando.fatiga > quieto.fatiga);
});

test('dormir de noche reduce la fatiga', () => {
  const dormido = tickNeeds(createNeeds({ fatiga: 80 }), { hour: 1, season: 'verano', biome: 'pradera', walking: false, working: false, nearFire: true, sheltered: true });
  assert.ok(dormido.fatiga < 80);
});

test('createNpc es determinista y produce rasgos en 0..1', () => {
  const a = createNpc(createRng(5)), b = createNpc(createRng(5));
  assert.deepEqual(a, b);
  for (const v of Object.values(a.traits)) assert.ok(v >= 0 && v <= 1);
});

test('createNpc asigna nombre del catálogo e id único', () => {
  const rng = createRng(8);
  const ids = new Set();
  for (let i = 0; i < 50; i++) {
    const npc = createNpc(rng);
    assert.ok(NOMBRES.includes(npc.nombre));
    assert.equal(ids.has(npc.id), false);
    ids.add(npc.id);
  }
});

test('isElder e isAdult usan los umbrales de edad', () => {
  assert.equal(isElder(createNpc(createRng(1), { age: 45 })), true);
  assert.equal(isElder(createNpc(createRng(1), { age: 44 })), false);
  assert.equal(isAdult(createNpc(createRng(1), { age: 15 })), true);
  assert.equal(isAdult(createNpc(createRng(1), { age: 14 })), false);
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `node --test tests/huehuet/needs.test.js`
Esperado: FAIL.

- [ ] **Step 3: Implementar `src/agents/needs.js`**

`tickNeeds` construye un objeto nuevo y pasa cada valor por el acotado antes de devolverlo. El frío combina hora (noche entre 20 y 6), estación, `BIOMES[biome].shelter`, `nearFire` y `sheltered`. Dormir es `hour` nocturna con `sheltered`.

- [ ] **Step 4: Implementar `src/agents/npc.js`**

Los `id` son `npc-<n>` con un contador que arranca del valor derivado del `rng`, para que sean deterministas y únicos dentro de una partida. Los nombres se eligen con `rng.pick(NOMBRES)`; repetir nombre está permitido, repetir `id` no.

- [ ] **Step 5: Ejecutar las pruebas**

Run: `npm test`
Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agents tests/huehuet/needs.test.js
git commit -m "feat(agents): necesidades acotadas y NPCs con rasgos deterministas"
```

---

### Task 6: Utilidad y catálogo de acciones

**Files:**
- Create: `src/agents/actions.js`, `src/agents/utility.js`
- Test: `tests/huehuet/utility.test.js`

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces:
  - `ACTIONS: Action[]` con `Action = { id, label, score(npc: Npc, band: Band, ctx: ActionCtx): number, apply(npc: Npc, band: Band, ctx: ActionCtx, rng: Rng): string|null /* texto para la crónica, o null */ }`
  - `ActionCtx = { grid: Grid, discovery: Discovery, clock: Clock }`
  - `chooseAction(npc: Npc, band: Band, ctx: ActionCtx, actions?: Action[]) -> Action` — mayor puntuación; empate resuelto por el orden del catálogo, para que sea determinista.
  - Ids de acción de la Etapa 1: `'beber' | 'forrajear' | 'cazar' | 'talar' | 'recoger_piedra' | 'descansar' | 'explorar' | 'seguir' | 'construir'`

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
test('un NPC sediento junto al agua elige beber', () => {
  const { npc, band, ctx } = escenaJunto('rio', { sed: 95 });
  assert.equal(chooseAction(npc, band, ctx).id, 'beber');
});

test('un NPC hambriento sin sed elige buscar comida', () => {
  const { npc, band, ctx } = escenaJunto('bosque', { hambre: 95, sed: 5 });
  assert.ok(['cazar', 'forrajear'].includes(chooseAction(npc, band, ctx).id));
});

test('un NPC agotado de noche elige descansar', () => {
  const { npc, band, ctx } = escenaJunto('bosque', { fatiga: 98, hambre: 10, sed: 10 }, { hour: 2 });
  assert.equal(chooseAction(npc, band, ctx).id, 'descansar');
});

test('un NPC audaz sin necesidades urgentes explora más que uno cauto', () => {
  const { band, ctx } = escenaJunto('pradera', {});
  const audaz = npcCon({ audacia: 1, cautela: 0 });
  const cauto = npcCon({ audacia: 0, cautela: 1 });
  const explorar = ACTIONS.find((a) => a.id === 'explorar');
  assert.ok(explorar.score(audaz, band, ctx) > explorar.score(cauto, band, ctx));
});

test('toda acción devuelve una puntuación numérica finita y no negativa', () => {
  const { npc, band, ctx } = escenaJunto('tundra', { hambre: 50, sed: 50, frio: 50, fatiga: 50 });
  for (const a of ACTIONS) {
    const s = a.score(npc, band, ctx);
    assert.ok(Number.isFinite(s) && s >= 0, `${a.id} -> ${s}`);
  }
});

test('chooseAction es determinista ante empates', () => {
  const { npc, band, ctx } = escenaJunto('pradera', {});
  const a = chooseAction(npc, band, ctx).id;
  for (let i = 0; i < 10; i++) assert.equal(chooseAction(npc, band, ctx).id, a);
});

test('beber reduce la sed y no agota el río', () => {
  const { npc, band, ctx } = escenaJunto('rio', { sed: 90 });
  ACTIONS.find((a) => a.id === 'beber').apply(npc, band, ctx, createRng(1));
  assert.ok(npc.needs.sed < 90);
});

test('talar añade leña al inventario de la banda y la descuenta de la celda', () => {
  const { npc, band, ctx } = escenaJunto('bosque', {});
  const celda = ctx.grid.at(npc.x, npc.y);
  celda.resources.leña = 10;
  const antes = band.inventory.leña ?? 0;
  ACTIONS.find((a) => a.id === 'talar').apply(npc, band, ctx, createRng(1));
  assert.ok(band.inventory.leña > antes);
  assert.ok(celda.resources.leña < 10);
});

test('explorar revela celdas nuevas', () => {
  const { npc, band, ctx } = escenaJunto('pradera', {});
  const antes = ctx.discovery.size;
  ACTIONS.find((a) => a.id === 'explorar').apply(npc, band, ctx, createRng(1));
  assert.ok(ctx.discovery.size > antes);
});
```

Los ayudantes `escenaJunto(biome, needsOverrides, clockOverrides)` y `npcCon(traits)` se definen en el propio archivo de prueba: construyen una rejilla de 32x32 con la celda central del bioma pedido, un `Discovery` que revela radio 5 alrededor del NPC, y una banda de un solo miembro.

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `node --test tests/huehuet/utility.test.js`
Esperado: FAIL.

- [ ] **Step 3: Implementar `src/agents/actions.js`**

Cada `score` tiene la misma forma: una necesidad elevada al cuadrado y normalizada (para que la urgencia crezca más rápido que linealmente), multiplicada por la disponibilidad del recurso en las celdas conocidas del entorno, modulada por los rasgos. Devuelve 0 cuando la acción es imposible (sin agua cerca no se puede beber). Nada de ramas anidadas: una expresión por acción.

`apply` modifica NPC, celda y `band.inventory`, y devuelve el texto de crónica solo para lo digno de mención (una cacería exitosa, un descubrimiento), o `null`.

- [ ] **Step 4: Implementar `chooseAction` en `src/agents/utility.js`**

Recorre el catálogo, guarda el máximo y conserva el primero en caso de empate.

- [ ] **Step 5: Ejecutar las pruebas**

Run: `npm test`
Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agents/actions.js src/agents/utility.js tests/huehuet/utility.test.js
git commit -m "feat(agents): catálogo de acciones y decisión por utilidad"
```

---

### Task 7: La banda — inventario, migración y extinción

**Files:**
- Create: `src/tribe/band.js`
- Test: `tests/huehuet/band.test.js`

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces:
  - `createBand(rng: Rng, start: {x,y}, opts?: { size?: number }) -> Band` con `Band = { npcs: Npc[], inventory: Record<ResourceId, number>, x, y, settled: boolean, site: {x,y}|null, lastEvaluation: number }`. Tamaño por defecto 7.
  - `tickBand(band: Band, ctx: ActionCtx, rng: Rng) -> string[] /* textos de crónica */` — aplica necesidades, elige y aplica una acción por NPC, mueve la banda y consume del inventario.
  - `bandPressure(band: Band, opts: { season: string }) -> number /* 0..1 */` — combina moral media baja, hambre y sed medias, frío medio, muertes recientes y proximidad del invierno. Toma solo la estación, no el `ActionCtx` completo, para que `SiteCtx` (Task 8) sirva de argumento tal cual.
  - `isExtinct(band: Band) -> boolean`
  - `livingNpcs(band: Band) -> Npc[]`

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
test('createBand es determinista e incluye al menos un anciano y un adulto', () => {
  const a = createBand(createRng(3), { x: 5, y: 5 });
  const b = createBand(createRng(3), { x: 5, y: 5 });
  assert.deepEqual(a, b);
  assert.ok(a.npcs.some(isElder));
  assert.ok(a.npcs.filter(isAdult).length >= 2);
});

test('bandPressure está en 0..1 y sube con el hambre', () => {
  const { band } = escenaBanda();
  const baja = bandPressure(band, { season: 'verano' });
  for (const n of livingNpcs(band)) n.needs.hambre = 95;
  const alta = bandPressure(band, { season: 'verano' });
  assert.ok(baja >= 0 && alta <= 1);
  assert.ok(alta > baja);
});

test('bandPressure sube al acercarse el invierno', () => {
  const { band } = escenaBanda();
  const verano = bandPressure(band, { season: 'verano' });
  const otoño = bandPressure(band, { season: 'otoño' });
  assert.ok(otoño > verano);
});

test('un NPC con hambre sostenida en 100 muere', () => {
  const { band, ctx } = escenaBanda();
  const victima = livingNpcs(band)[0];
  for (let i = 0; i < 2000 && victima.alive; i++) {
    victima.needs.hambre = 100;
    tickBand(band, ctx, createRng(i));
  }
  assert.equal(victima.alive, false);
});

test('isExtinct solo es verdadero sin NPCs vivos', () => {
  const { band } = escenaBanda();
  assert.equal(isExtinct(band), false);
  for (const n of band.npcs) n.alive = false;
  assert.equal(isExtinct(band), true);
});

test('tickBand sobre una banda extinta no lanza y no produce crónica', () => {
  const { band, ctx } = escenaBanda();
  for (const n of band.npcs) n.alive = false;
  assert.deepEqual(tickBand(band, ctx, createRng(1)), []);
});

test('una banda nómada se mueve con el tiempo; una asentada no', () => {
  const { band, ctx } = escenaBanda();
  const origen = { x: band.x, y: band.y };
  for (let i = 0; i < 200; i++) tickBand(band, ctx, createRng(i));
  assert.ok(band.x !== origen.x || band.y !== origen.y);

  const { band: fija, ctx: ctx2 } = escenaBanda();
  fija.settled = true; fija.site = { x: fija.x, y: fija.y };
  const quieta = { x: fija.x, y: fija.y };
  for (let i = 0; i < 200; i++) tickBand(fija, ctx2, createRng(i));
  assert.deepEqual({ x: fija.x, y: fija.y }, quieta);
});

test('la banda nunca sale de la rejilla ni entra en agua profunda', () => {
  const { band, ctx } = escenaBanda();
  for (let i = 0; i < 1000; i++) {
    tickBand(band, ctx, createRng(i));
    assert.ok(ctx.grid.inBounds(band.x, band.y));
    assert.notEqual(ctx.grid.at(band.x, band.y).biome, 'agua');
  }
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `node --test tests/huehuet/band.test.js`
Esperado: FAIL.

- [ ] **Step 3: Implementar `src/tribe/band.js`**

La banda tiene una posición propia; los NPCs orbitan alrededor dentro de un radio corto. Mientras `settled` es falso, la banda se desplaza una celda cada N ticks hacia la frontera de lo descubierto: el vecino conocido más cercano a una celda sin descubrir, filtrando `biome: 'agua'` y lo que caiga fuera de la rejilla. No consulta la puntuación de sitios — eso llega en Task 8 y lo integra Task 11 — salvo que `band.site` ya esté fijado, en cuyo caso se dirige allí. La muerte ocurre cuando una necesidad vital (`hambre`, `sed` o `frio`) se mantiene en 100 durante más de un umbral de ticks acumulados, registrado por NPC.

- [ ] **Step 4: Ejecutar las pruebas**

Run: `npm test`
Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tribe/band.js tests/huehuet/band.test.js
git commit -m "feat(tribe): banda nómada con presión, migración y mortalidad"
```

---

### Task 8: Puntuación de sitios — el corazón del juego

**Files:**
- Create: `src/tribe/sitescore.js`
- Test: `tests/huehuet/sitescore.test.js`

**Interfaces:**
- Consumes: Tasks 2-7.
- Produces:
  - `SITE_FACTORS: Array<{ id, label, weight: number, radius: number, eliminatory?: boolean }>` con ids `'agua' | 'caza' | 'forraje' | 'leña' | 'piedra' | 'defensa' | 'refugio' | 'inundacion' | 'depredadores'` y los pesos y radios del spec (agua eliminatorio radio 3; caza alto radio 6; forraje alto radio 4; leña medio radio 5; piedra medio radio 8; defensa medio; refugio medio; inundación y depredadores como penalización).
  - `scoreSite(discovery: Discovery, x: number, y: number, ctx: SiteCtx) -> SiteScore` con `SiteCtx = { grid: Grid, season: string }` y `SiteScore = { x, y, total: number /* 0..100 */, viable: boolean, factors: Array<{ id, label, value: number, weight: number, contribution: number }> }`
  - `acceptanceThreshold(pressure: number) -> number /* 0..100 */` — decreciente en `pressure`.
  - `candidateSites(discovery: Discovery, ctx: SiteCtx, opts?: { limit?: number }) -> SiteScore[]` ordenados de mayor a menor `total`. Por defecto `limit: 8`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
test('un sitio sin agua dulce conocida puntúa cero y no es viable', () => {
  const { discovery, ctx, pos } = sitio({ agua: false, caza: 10, forraje: 10, leña: 10, piedra: 10 });
  const s = scoreSite(discovery, pos.x, pos.y, ctx);
  assert.equal(s.total, 0);
  assert.equal(s.viable, false);
});

test('con todo igual, un sitio con agua gana a uno sin agua', () => {
  const conAgua = scoreSite(...sitioArgs({ agua: true, caza: 5 }));
  const sinAgua = scoreSite(...sitioArgs({ agua: false, caza: 5 }));
  assert.ok(conAgua.total > sinAgua.total);
});

test('más caza nunca baja la puntuación', () => {
  let previa = -1;
  for (const caza of [0, 2, 5, 10, 20]) {
    const s = scoreSite(...sitioArgs({ agua: true, caza }));
    assert.ok(s.total >= previa, `caza ${caza} bajó la puntuación`);
    previa = s.total;
  }
});

test('la puntuación se mantiene en 0..100 con recursos extremos', () => {
  const s = scoreSite(...sitioArgs({ agua: true, caza: 1e6, forraje: 1e6, leña: 1e6, piedra: 1e6 }));
  assert.ok(s.total >= 0 && s.total <= 100, `total = ${s.total}`);
});

test('las aportaciones de los factores suman el total', () => {
  const s = scoreSite(...sitioArgs({ agua: true, caza: 6, forraje: 4, leña: 3 }));
  const suma = s.factors.reduce((a, f) => a + f.contribution, 0);
  assert.ok(Math.abs(suma - s.total) < 0.01);
});

test('scoreSite expone un factor por cada entrada de SITE_FACTORS', () => {
  const s = scoreSite(...sitioArgs({ agua: true }));
  assert.deepEqual(s.factors.map((f) => f.id), SITE_FACTORS.map((f) => f.id));
});

test('la leña pesa más cuando se acerca el invierno', () => {
  const otoño = scoreSite(...sitioArgs({ agua: true, leña: 20 }, 'otoño'));
  const verano = scoreSite(...sitioArgs({ agua: true, leña: 20 }, 'verano'));
  assert.ok(otoño.factors.find((f) => f.id === 'leña').contribution >
            verano.factors.find((f) => f.id === 'leña').contribution);
});

test('scoreSite solo usa celdas conocidas', () => {
  const { discovery, ctx, pos } = sitio({ agua: true, caza: 20 }, 'verano', { revealRadius: 0 });
  assert.equal(scoreSite(discovery, pos.x, pos.y, ctx).total, 0);
});

test('acceptanceThreshold baja al subir la presión', () => {
  assert.ok(acceptanceThreshold(0) > acceptanceThreshold(0.5));
  assert.ok(acceptanceThreshold(0.5) > acceptanceThreshold(1));
});

test('acceptanceThreshold se mantiene en 0..100', () => {
  for (const p of [-1, 0, 0.5, 1, 2]) {
    const t = acceptanceThreshold(p);
    assert.ok(t >= 0 && t <= 100, `presión ${p} -> ${t}`);
  }
});

test('candidateSites devuelve sitios ordenados y respeta el límite', () => {
  const { discovery, ctx } = escenaDescubierta(generateWorld(21));
  const sitios = candidateSites(discovery, ctx, { limit: 5 });
  assert.ok(sitios.length <= 5);
  for (let i = 1; i < sitios.length; i++) {
    assert.ok(sitios[i - 1].total >= sitios[i].total);
  }
});

test('candidateSites descarta los no viables', () => {
  const { discovery, ctx } = escenaDescubierta(generateWorld(22));
  for (const s of candidateSites(discovery, ctx)) assert.equal(s.viable, true);
});
```

Los ayudantes `sitio(resources, season?, opts?)`, `sitioArgs(...)` y `escenaDescubierta(world)` viven en el archivo de prueba y construyen rejillas sintéticas con los recursos pedidos alrededor de una celda central.

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `node --test tests/huehuet/sitescore.test.js`
Esperado: FAIL.

- [ ] **Step 3: Implementar `src/tribe/sitescore.js`**

Cada factor tiene una función que acumula su recurso sobre `discovery.knownCell` dentro de su radio y lo normaliza a 0..1 con una curva de saturación (`v / (v + k)`), que es lo que mantiene el total acotado con recursos extremos y además hace monótona la respuesta. `contribution = value * weight * modificadorEstacional`, y `total` es la suma reescalada a 0..100 dividiendo por la suma de pesos. Si el factor eliminatorio da 0, el total es 0 y `viable` es falso — pero `factors` se devuelve completo igualmente, porque la interfaz lo muestra.

`acceptanceThreshold` interpola linealmente entre 70 sin presión y 25 con presión máxima, acotando la entrada a 0..1 antes de interpolar.

- [ ] **Step 4: Ejecutar las pruebas**

Run: `npm test`
Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tribe/sitescore.js tests/huehuet/sitescore.test.js
git commit -m "feat(tribe): puntuación de sitios con agua eliminatoria y umbral móvil"
```

---

### Task 9: Consenso y decisión de asentamiento

**Files:**
- Create: `src/tribe/consensus.js`
- Test: `tests/huehuet/consensus.test.js`

**Interfaces:**
- Consumes: Tasks 5-8.
- Produces:
  - `npcSiteScore(npc: Npc, site: SiteScore) -> number` — repondera los factores según los rasgos: la cautela sube `defensa`, `refugio` e `inundacion`; la audacia sube `caza` y `piedra`; la sabiduría acerca el resultado al total objetivo.
  - `evaluateConsensus(band: Band, site: SiteScore) -> Consensus` con `Consensus = { average: number, votes: Array<{ npcId, nombre, score, elder: boolean, weight: number }>, dissenters: Array<{ npcId, nombre, score, delta: number }> }`. Solo votan los adultos vivos; los ancianos pesan el doble. Disidente es quien se desvía más de 20 puntos de la media.
  - `decideSettlement(band: Band, discovery: Discovery, ctx: SiteCtx) -> Decision` con `Decision = { settle: boolean, site: SiteScore|null, consensus: Consensus|null, threshold: number, pressure: number, reason: string }`

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
test('solo votan los adultos vivos', () => {
  const band = bandaCon([{ age: 50 }, { age: 30 }, { age: 8 }, { age: 30, alive: false }]);
  const c = evaluateConsensus(band, sitioBueno());
  assert.equal(c.votes.length, 2);
});

test('el voto de un anciano pesa el doble', () => {
  const c = evaluateConsensus(bandaCon([{ age: 50 }, { age: 30 }]), sitioBueno());
  const anciano = c.votes.find((v) => v.elder);
  const joven = c.votes.find((v) => !v.elder);
  assert.equal(anciano.weight, joven.weight * 2);
});

test('la media ponderada se inclina hacia los ancianos', () => {
  const band = bandaCon([{ age: 50, traits: { cautela: 1, audacia: 0, sabiduria: 1 } },
                         { age: 20, traits: { cautela: 0, audacia: 1, sabiduria: 0 } }]);
  const c = evaluateConsensus(band, sitioRiesgoso());
  const anciano = c.votes.find((v) => v.elder);
  const joven = c.votes.find((v) => !v.elder);
  assert.ok(Math.abs(c.average - anciano.score) < Math.abs(c.average - joven.score));
});

test('un NPC que se desvía más de 20 puntos queda registrado como disidente', () => {
  const c = evaluateConsensus(bandaPolarizada(), sitioRiesgoso());
  assert.ok(c.dissenters.length > 0);
  assert.ok(c.dissenters.every((d) => Math.abs(d.delta) > 20));
  assert.ok(c.dissenters.every((d) => typeof d.nombre === 'string' && d.nombre.length > 0));
});

test('una banda cómoda rechaza un sitio mediocre', () => {
  const d = decideSettlement(bandaComoda(), descubrimientoMediocre(), ctxVerano());
  assert.equal(d.settle, false);
  assert.ok(d.threshold > (d.site?.total ?? 0));
});

// el sistema central del spec: el mismo sitio, dos bandas, dos resultados
test('una banda desesperada acepta el mismo sitio que una cómoda rechaza', () => {
  const disc = descubrimientoMediocre(), ctx = ctxVerano();
  const comoda = decideSettlement(bandaComoda(), disc, ctx);
  const desesperada = decideSettlement(bandaDesesperada(), disc, ctx);
  assert.equal(comoda.settle, false);
  assert.equal(desesperada.settle, true);
  assert.ok(desesperada.threshold < comoda.threshold);
});

test('nunca se asienta en un sitio no viable, ni con presión máxima', () => {
  const d = decideSettlement(bandaDesesperada(), descubrimientoSinAgua(), ctxVerano());
  assert.equal(d.settle, false);
});

test('sin sitios conocidos la decisión es negativa y explica por qué', () => {
  const d = decideSettlement(bandaComoda(), descubrimientoVacio(), ctxVerano());
  assert.equal(d.settle, false);
  assert.equal(d.site, null);
  assert.ok(d.reason.length > 0);
});

test('una banda ya asentada no vuelve a decidir', () => {
  const band = bandaComoda();
  band.settled = true;
  assert.equal(decideSettlement(band, descubrimientoMediocre(), ctxVerano()).settle, false);
});

test('decideSettlement es determinista', () => {
  const band = bandaComoda(), disc = descubrimientoMediocre(), ctx = ctxVerano();
  assert.deepEqual(decideSettlement(band, disc, ctx), decideSettlement(band, disc, ctx));
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `node --test tests/huehuet/consensus.test.js`
Esperado: FAIL.

- [ ] **Step 3: Implementar `src/tribe/consensus.js`**

`decideSettlement` devuelve temprano con `settle: false` si la banda ya está asentada o si `candidateSites` viene vacío. Si no, toma el mejor sitio, calcula el consenso, obtiene `pressure` con `bandPressure` y `threshold` con `acceptanceThreshold(pressure)`, y decide `settle = consensus.average >= threshold && site.viable`. `reason` es una frase en español apta para la crónica, que nombra el factor decisivo o el motivo del rechazo.

- [ ] **Step 4: Ejecutar las pruebas**

Run: `npm test`
Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tribe/consensus.js tests/huehuet/consensus.test.js
git commit -m "feat(tribe): consenso ponderado por edad y decisión de asentamiento"
```

---

### Task 10: Construcción de la aldea y crónica

**Files:**
- Create: `src/tribe/settlement.js`, `src/chronicle.js`
- Test: `tests/huehuet/settlement.test.js`

**Interfaces:**
- Consumes: Tasks 1-9.
- Produces:
  - `BUILDINGS: Array<{ id, label, cost: Partial<Record<ResourceId, number>>, work: number, order: number }>` con ids `'hoguera' | 'choza' | 'almacen'` en ese orden de prioridad.
  - `foundSettlement(band: Band, site: SiteScore, day: number) -> Settlement` — además marca `band.settled = true` y fija `band.site`. con `Settlement = { x, y, foundedDay: number, buildings: Array<{ id, x, y, progress: number, done: boolean }>, queue: string[] }`
  - `tickConstruction(settlement: Settlement, band: Band, rng: Rng) -> string[] /* crónica */`
  - `createChronicle() -> Chronicle` con `Chronicle = { entries: Array<{ day: number, type: string, text: string }> }`
  - `record(chronicle: Chronicle, entry: { day, type, text }): void` — conserva como máximo 500 entradas, descartando las más antiguas.
  - `recent(chronicle: Chronicle, n: number) -> Entry[]` — las más recientes primero.

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
test('foundSettlement fija el sitio y encola la hoguera primero', () => {
  const band = bandaComoda();
  const s = foundSettlement(band, sitioBueno(), 12);
  assert.equal(s.foundedDay, 12);
  assert.equal(s.queue[0], 'hoguera');
  assert.equal(band.settled, true);
  assert.deepEqual(band.site, { x: s.x, y: s.y });
});

test('la construcción no avanza sin materiales', () => {
  const band = bandaComoda(); band.inventory = {};
  const s = foundSettlement(band, sitioBueno(), 1);
  for (let i = 0; i < 100; i++) tickConstruction(s, band, createRng(i));
  assert.equal(s.buildings.filter((b) => b.done).length, 0);
});

test('con materiales suficientes la hoguera se completa y lo cuenta', () => {
  const band = bandaComoda(); band.inventory = { leña: 999, piedra: 999 };
  const s = foundSettlement(band, sitioBueno(), 1);
  let textos = [];
  for (let i = 0; i < 500; i++) textos = textos.concat(tickConstruction(s, band, createRng(i)));
  assert.ok(s.buildings.some((b) => b.id === 'hoguera' && b.done));
  assert.ok(textos.some((t) => t.includes('hoguera')));
});

test('los edificios se completan en el orden de la cola', () => {
  const band = bandaComoda(); band.inventory = { leña: 9999, piedra: 9999 };
  const s = foundSettlement(band, sitioBueno(), 1);
  for (let i = 0; i < 3000; i++) tickConstruction(s, band, createRng(i));
  const hechos = s.buildings.filter((b) => b.done).map((b) => b.id);
  assert.equal(hechos[0], 'hoguera');
});

test('construir descuenta del inventario', () => {
  const band = bandaComoda(); band.inventory = { leña: 50, piedra: 50 };
  const s = foundSettlement(band, sitioBueno(), 1);
  for (let i = 0; i < 500; i++) tickConstruction(s, band, createRng(i));
  assert.ok(band.inventory.leña < 50);
});

test('el progreso nunca es negativo ni pasa de 1', () => {
  const band = bandaComoda(); band.inventory = { leña: 9999, piedra: 9999 };
  const s = foundSettlement(band, sitioBueno(), 1);
  for (let i = 0; i < 2000; i++) {
    tickConstruction(s, band, createRng(i));
    for (const b of s.buildings) assert.ok(b.progress >= 0 && b.progress <= 1);
  }
});

test('record conserva orden y recent devuelve las más nuevas primero', () => {
  const c = createChronicle();
  record(c, { day: 1, type: 'migracion', text: 'uno' });
  record(c, { day: 2, type: 'migracion', text: 'dos' });
  assert.deepEqual(recent(c, 1).map((e) => e.text), ['dos']);
});

test('la crónica se recorta a 500 entradas descartando las antiguas', () => {
  const c = createChronicle();
  for (let i = 0; i < 600; i++) record(c, { day: i, type: 'x', text: `e${i}` });
  assert.equal(c.entries.length, 500);
  assert.equal(c.entries[0].text, 'e100');
});

test('recent acepta n mayor que el número de entradas', () => {
  const c = createChronicle();
  record(c, { day: 1, type: 'x', text: 'solo' });
  assert.equal(recent(c, 50).length, 1);
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `node --test tests/huehuet/settlement.test.js`
Esperado: FAIL.

- [ ] **Step 3: Implementar `src/chronicle.js`**

- [ ] **Step 4: Implementar `src/tribe/settlement.js`**

`tickConstruction` toma el primer edificio pendiente de la cola; si el inventario cubre el coste restante, descuenta la parte proporcional al trabajo del tick y avanza `progress`; si no, no avanza. Al llegar a `progress >= 1` marca `done`, emite el texto de crónica y pasa al siguiente. Las posiciones de los edificios se reparten en anillo alrededor del centro del asentamiento.

- [ ] **Step 5: Ejecutar las pruebas**

Run: `npm test`
Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tribe/settlement.js src/chronicle.js tests/huehuet/settlement.test.js
git commit -m "feat(tribe): fundación de la aldea, construcción por cola y crónica"
```

---

### Task 11: Estado de partida y simulación integrada

**Files:**
- Create: `src/game.js`
- Test: `tests/huehuet/game.test.js`

**Interfaces:**
- Consumes: Tasks 1-10.
- Produces:
  - `createGame(seed: number, opts?: { width?: number, height?: number }) -> Game` con `Game = { seed, world: World, grid: Grid, discovery: Discovery, band: Band, clock: Clock, chronicle: Chronicle, settlement: Settlement|null, rng: Rng, over: boolean, lastDecision: Decision|null }`
  - `stepGame(game: Game, ticks: number): void` — ejecuta `ticks` pasos de simulación completos (mundo, NPCs, banda, decisión, construcción, crónica).
  - `advanceGame(game: Game, dtMs: number, speed: number): number /* ticks ejecutados */` — único punto por el que la interfaz hace avanzar el tiempo.

Esta es la fachada que consumen `main.js` y el guardado: ni el renderizado ni la interfaz tocan los módulos de simulación directamente.

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
test('createGame con la misma semilla produce el mismo estado inicial', () => {
  assert.deepEqual(createGame(99), createGame(99));
});

test('tras N pasos, la misma semilla da el mismo estado', () => {
  const a = createGame(99), b = createGame(99);
  stepGame(a, 2000); stepGame(b, 2000);
  assert.deepEqual(a.band, b.band);
  assert.deepEqual(a.discovery.toJSON(), b.discovery.toJSON());
  assert.deepEqual(a.chronicle.entries, b.chronicle.entries);
});

test('la banda descubre territorio con el tiempo', () => {
  const g = createGame(31);
  const antes = g.discovery.size;
  stepGame(g, 500);
  assert.ok(g.discovery.size > antes);
});

// el arco completo del spec, sin intervención del jugador
test('la banda acaba asentándose por su cuenta', () => {
  let asentadas = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const g = createGame(seed);
    stepGame(g, 24 * 400);
    if (g.band.settled) asentadas++;
  }
  assert.ok(asentadas >= 4, `solo ${asentadas} de 5 se asentaron`);
});

test('al asentarse se crea el asentamiento y queda en la crónica', () => {
  const g = createGame(1);
  for (let i = 0; i < 24 * 400 && !g.band.settled; i++) stepGame(g, 1);
  assert.ok(g.band.settled);
  assert.notEqual(g.settlement, null);
  assert.ok(g.chronicle.entries.some((e) => e.type === 'asentamiento'));
});

test('la extinción termina la partida y la registra', () => {
  const g = createGame(1);
  for (const n of g.band.npcs) { n.needs.hambre = 100; n.needs.sed = 100; }
  stepGame(g, 24 * 60);
  assert.equal(g.over, true);
  assert.ok(g.chronicle.entries.some((e) => e.type === 'fin'));
});

test('stepGame sobre una partida terminada no cambia nada', () => {
  const g = createGame(1);
  g.over = true;
  const antes = structuredClone({ tick: g.clock.tick, entries: g.chronicle.entries.length });
  stepGame(g, 100);
  assert.equal(g.clock.tick, antes.tick);
  assert.equal(g.chronicle.entries.length, antes.entries);
});

test('advanceGame respeta el acotado del reloj', () => {
  const g = createGame(4);
  assert.ok(advanceGame(g, 600000, 10) <= 24);
});

test('stepGame no usa Math.random', () => {
  const real = Math.random;
  Math.random = () => { throw new Error('la simulación usó Math.random'); };
  try { stepGame(createGame(6), 500); } finally { Math.random = real; }
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `node --test tests/huehuet/game.test.js`
Esperado: FAIL.

- [ ] **Step 3: Implementar `src/game.js`**

`stepGame` recorre el orden del spec: regenerar recursos, `tickBand`, evaluar la decisión de asentamiento cada `band.lastEvaluation + intervalo` ticks o cuando la presión cruza un umbral, fundar si procede, `tickConstruction` si hay asentamiento, y volcar todos los textos devueltos a la crónica con el día del reloj. Al detectar `isExtinct` pone `over: true`, registra la entrada `'fin'` y retorna.

Si las pruebas del arco completo no llegan a asentarse, ajustar el intervalo de evaluación y la velocidad de descubrimiento — no bajar el umbral del Task 8, que está fijado por sus propias pruebas.

- [ ] **Step 4: Ejecutar las pruebas**

Run: `npm test`
Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game.js tests/huehuet/game.test.js
git commit -m "feat(game): fachada de simulación con arco nómada a asentamiento"
```

---

### Task 12: Guardado — esquema, migración y slots

**Files:**
- Create: `src/save/schema.js`, `src/save/store.js`
- Test: `tests/huehuet/save.test.js`

**Interfaces:**
- Consumes: Tasks 1-11.
- Produces:
  - `SCHEMA_VERSION = 1`
  - `serialize(game: Game) -> object` — guarda `version`, `seed`, `tick`, NPCs, inventario, `discovery.toJSON()`, diferencias de recursos por celda, asentamiento y crónica. **No** guarda la rejilla generada.
  - `deserialize(data: object) -> Game` — reconstruye el mundo desde la semilla y aplica las diferencias.
  - `migrate(data: object) -> object` — cadena de migraciones hasta `SCHEMA_VERSION`; lanza `UnsupportedVersionError` si `data.version > SCHEMA_VERSION`.
  - `createStore(storage?: Storage) -> Store` con `Store = { available: boolean, listSlots(): Slot[], createSlot(nombre: string, seed: number): Slot, writeSlot(id: string, game: Game): { ok: boolean, error?: string }, readSlot(id: string): { ok: boolean, game?: Game, error?: string, damaged?: boolean }, renameSlot(id, nombre): void, deleteSlot(id): void }`
  - `Slot = { id, nombre, day, poblacion, era: string, settled: boolean, thumbnail: string|null, updatedAt: number, damaged?: boolean }`

`createStore` recibe el almacenamiento por parámetro (por defecto `globalThis.localStorage`), que es lo que permite probarlo en Node con dobles.

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
test('serialize y deserialize reproducen el estado de la simulación', () => {
  const g = createGame(55); stepGame(g, 1500);
  const r = deserialize(serialize(g));
  assert.equal(r.clock.tick, g.clock.tick);
  assert.deepEqual(r.band, g.band);
  assert.deepEqual(r.discovery.toJSON(), g.discovery.toJSON());
  assert.deepEqual(r.chronicle.entries, g.chronicle.entries);
});

test('tras recargar, la simulación sigue igual que sin recargar', () => {
  const a = createGame(56); stepGame(a, 800);
  const b = deserialize(serialize(a));
  stepGame(a, 400); stepGame(b, 400);
  assert.deepEqual(b.band, a.band);
});

test('el guardado no incluye la rejilla generada', () => {
  const g = createGame(57); stepGame(g, 300);
  const json = JSON.stringify(serialize(g));
  assert.ok(!json.includes('"elevation"'), 'la rejilla se está guardando');
});

test('los recursos consumidos sobreviven a la ida y vuelta', () => {
  const g = createGame(58); stepGame(g, 1500);
  const r = deserialize(serialize(g));
  for (const c of g.grid.cells) {
    assert.deepEqual(r.grid.at(c.x, c.y).resources, c.resources);
  }
});

test('migrate lleva una partida sin version a la versión actual', () => {
  const data = serialize(createGame(59));
  delete data.version;
  assert.equal(migrate(data).version, SCHEMA_VERSION);
});

// Review Focus 3
test('migrate rechaza una versión superior a la soportada', () => {
  const data = serialize(createGame(60));
  data.version = SCHEMA_VERSION + 1;
  assert.throws(() => migrate(data), /version/i);
});

test('createSlot, listSlots y deleteSlot gestionan el índice', () => {
  const store = createStore(memoria());
  const slot = store.createSlot('Primera', 7);
  assert.equal(store.listSlots().length, 1);
  store.deleteSlot(slot.id);
  assert.deepEqual(store.listSlots(), []);
});

test('writeSlot actualiza los metadatos del índice', () => {
  const store = createStore(memoria());
  const slot = store.createSlot('Partida', 8);
  const g = createGame(8); stepGame(g, 24 * 10);
  store.writeSlot(slot.id, g);
  const leido = store.listSlots().find((s) => s.id === slot.id);
  assert.equal(leido.day, g.clock.day);
  assert.equal(leido.poblacion, livingNpcs(g.band).length);
});

test('renameSlot cambia el nombre y conserva la partida', () => {
  const store = createStore(memoria());
  const slot = store.createSlot('Vieja', 9);
  store.writeSlot(slot.id, createGame(9));
  store.renameSlot(slot.id, 'Nueva');
  assert.equal(store.listSlots()[0].nombre, 'Nueva');
  assert.equal(store.readSlot(slot.id).ok, true);
});

test('deleteSlot borra solo su partida', () => {
  const store = createStore(memoria());
  const a = store.createSlot('A', 1), b = store.createSlot('B', 2);
  store.writeSlot(a.id, createGame(1)); store.writeSlot(b.id, createGame(2));
  store.deleteSlot(a.id);
  assert.equal(store.readSlot(b.id).ok, true);
});

// Review Focus 2
test('writeSlot informa del fallo sin lanzar cuando el almacenamiento está lleno', () => {
  const store = createStore(memoriaQueFalla());
  const slot = store.createSlot('X', 1);
  const r = store.writeSlot(slot.id, createGame(1));
  assert.equal(r.ok, false);
  assert.ok(r.error.length > 0);
});

// Review Focus 2
test('un almacenamiento inaccesible deja available en falso sin lanzar', () => {
  const store = createStore(memoriaInaccesible());
  assert.equal(store.available, false);
  assert.deepEqual(store.listSlots(), []);
});

// Review Focus 3
test('una partida con JSON corrupto se marca como dañada sin romper la lista', () => {
  const mem = memoria();
  const store = createStore(mem);
  const slot = store.createSlot('Rota', 1);
  store.writeSlot(slot.id, createGame(1));
  mem.setItem(`huehuet.save.${slot.id}`, '{esto no es json');
  const r = store.readSlot(slot.id);
  assert.equal(r.ok, false);
  assert.equal(r.damaged, true);
  assert.equal(store.listSlots().length, 1);
  assert.equal(store.listSlots()[0].damaged, true);
});

// Review Focus 3
test('un índice corrupto no impide arrancar', () => {
  const mem = memoria();
  mem.setItem('huehuet.saves.v1', 'basura');
  assert.deepEqual(createStore(mem).listSlots(), []);
});
```

Los dobles `memoria()`, `memoriaQueFalla()` (su `setItem` lanza `QuotaExceededError`) y `memoriaInaccesible()` (todo acceso lanza, como Safari privado) se definen en el archivo de prueba y cumplen la interfaz de `Storage`.

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `node --test tests/huehuet/save.test.js`
Esperado: FAIL.

- [ ] **Step 3: Implementar `src/save/schema.js`**

Las diferencias de recursos se guardan como `[indicePlano, resourceId, cantidad][]`, comparando contra una rejilla recién generada con la misma semilla. `migrate` es un array de funciones indexado por versión de origen.

- [ ] **Step 4: Implementar `src/save/store.js`**

Toda lectura y escritura va envuelta en `try/catch`. El constructor prueba una escritura y borrado de sondeo para fijar `available`. Claves: `huehuet.saves.v1` para el índice, `huehuet.save.<id>` para cada partida. Un índice ilegible se trata como vacío; una partida ilegible marca `damaged: true` en su entrada del índice y la deja borrable.

- [ ] **Step 5: Ejecutar las pruebas**

Run: `npm test`
Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/save tests/huehuet/save.test.js
git commit -m "feat(save): slots con esquema versionado y degradación ante fallos de almacenamiento"
```

---

### Task 13: Cámara, gestos y renderizado

**Files:**
- Create: `src/render/camera.js`, `src/render/gestures.js`, `src/render/sprites.js`, `src/render/renderer.js`
- Test: `tests/huehuet/camera.test.js`

**Interfaces:**
- Consumes: Tasks 2-12.
- Produces:
  - `createCamera(opts: { viewW, viewH, worldW, worldH, tile: number }) -> Camera` con `Camera = { x, y, zoom, minZoom, maxZoom, pan(dx, dy): void, zoomAt(factor: number, sx: number, sy: number): void, centerOn(wx, wy): void, screenToWorld(sx, sy): {x, y}, worldToScreen(wx, wy): {x, y} }`. `pan` y `zoomAt` acotan siempre: el zoom a `[minZoom, maxZoom]` y el centro a los límites del mundo.
  - `createGestures(el: EventTarget, handlers: { onPan(dx, dy), onPinch(factor, cx, cy), onTap(sx, sy), onDoubleTap(sx, sy) }) -> { destroy(): void }` — reconoce con un umbral de movimiento de 8 px CSS: por debajo de ese umbral al levantar el dedo es un toque, por encima es arrastre. Con dos o más dedos solo pinza, y al levantar uno de los dos no se emite `onPan` hasta el siguiente `pointerdown`.
  - `classifyPointer(samples: Array<{x, y, t}>) -> 'tap' | 'drag'` — función pura extraída para poder probar el umbral sin DOM.
  - `BIOME_COLORS: Record<BiomeId, string>`, `drawNpc(ctx, npc, px, py, scale)`, `drawBuilding(ctx, building, px, py, scale)`, `RESOURCE_TINTS: Record<ResourceId, string>`
  - `createRenderer(canvas: HTMLCanvasElement) -> Renderer` con `Renderer = { resize(cssW, cssH, dpr): void, invalidateTerrain(): void, draw(game: Game, camera: Camera, layers: { resources: ResourceId|null, candidates: boolean }): void }`

El terreno se dibuja una vez en un lienzo fuera de pantalla y se recompone por desplazamiento; `invalidateTerrain` lo marca sucio cuando cambia el descubrimiento o la capa activa.

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
test('screenToWorld y worldToScreen son inversas', () => {
  const cam = createCamera({ viewW: 400, viewH: 800, worldW: 96, worldH: 96, tile: 16 });
  cam.centerOn(40, 40); cam.zoomAt(1.5, 200, 400);
  const p = cam.worldToScreen(40, 40);
  const w = cam.screenToWorld(p.x, p.y);
  assert.ok(Math.abs(w.x - 40) < 0.001 && Math.abs(w.y - 40) < 0.001);
});

test('zoomAt se acota a minZoom y maxZoom', () => {
  const cam = createCamera({ viewW: 400, viewH: 800, worldW: 96, worldH: 96, tile: 16 });
  for (let i = 0; i < 50; i++) cam.zoomAt(2, 200, 400);
  assert.equal(cam.zoom, cam.maxZoom);
  for (let i = 0; i < 100; i++) cam.zoomAt(0.5, 200, 400);
  assert.equal(cam.zoom, cam.minZoom);
});

test('zoomAt mantiene fijo el punto de pantalla indicado', () => {
  const cam = createCamera({ viewW: 400, viewH: 800, worldW: 96, worldH: 96, tile: 16 });
  cam.centerOn(48, 48);
  const antes = cam.screenToWorld(120, 300);
  cam.zoomAt(1.4, 120, 300);
  const despues = cam.screenToWorld(120, 300);
  assert.ok(Math.abs(antes.x - despues.x) < 0.01 && Math.abs(antes.y - despues.y) < 0.01);
});

test('pan no permite salir del mundo', () => {
  const cam = createCamera({ viewW: 400, viewH: 800, worldW: 96, worldH: 96, tile: 16 });
  for (let i = 0; i < 500; i++) cam.pan(-999, -999);
  const esquina = cam.screenToWorld(0, 0);
  assert.ok(esquina.x >= -1 && esquina.y >= -1);
  for (let i = 0; i < 500; i++) cam.pan(999, 999);
  const otra = cam.screenToWorld(400, 800);
  assert.ok(otra.x <= 97 && otra.y <= 97);
});

test('centerOn acota a los límites del mundo', () => {
  const cam = createCamera({ viewW: 400, viewH: 800, worldW: 96, worldH: 96, tile: 16 });
  cam.centerOn(-500, 9999);
  assert.ok(Number.isFinite(cam.x) && Number.isFinite(cam.y));
  assert.ok(cam.screenToWorld(0, 0).x >= -1);
});

// Review Focus 4
test('un movimiento menor que el umbral es un toque', () => {
  assert.equal(classifyPointer([{ x: 100, y: 100, t: 0 }, { x: 103, y: 101, t: 90 }]), 'tap');
});

// Review Focus 4
test('un movimiento mayor que el umbral es un arrastre, no un toque', () => {
  assert.equal(classifyPointer([{ x: 100, y: 100, t: 0 }, { x: 140, y: 100, t: 120 }]), 'drag');
});

// Review Focus 4
test('un toque largo sin movimiento sigue siendo toque', () => {
  assert.equal(classifyPointer([{ x: 100, y: 100, t: 0 }, { x: 101, y: 100, t: 2000 }]), 'tap');
});

test('BIOME_COLORS cubre todos los biomas y RESOURCE_TINTS todos los recursos', () => {
  for (const id of Object.keys(BIOMES)) assert.ok(BIOME_COLORS[id], `falta color de ${id}`);
  for (const id of Object.keys(RESOURCES)) assert.ok(RESOURCE_TINTS[id], `falta tinte de ${id}`);
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `node --test tests/huehuet/camera.test.js`
Esperado: FAIL.

- [ ] **Step 3: Implementar `src/render/camera.js`**

`zoomAt` convierte el punto de pantalla a mundo antes de cambiar el zoom y vuelve a centrar después para que ese punto no se mueva. El acotado del centro usa el tamaño visible en celdas, de modo que con el mundo más pequeño que la vista quede centrado en vez de pegado a un borde.

- [ ] **Step 4: Implementar `src/render/gestures.js`**

`classifyPointer` es pura y exportada. `createGestures` usa eventos de puntero (`pointerdown`/`move`/`up`/`cancel`) con `setPointerCapture`, mantiene un mapa de punteros activos y pasa a modo pinza en cuanto hay dos. Al bajar de dos a uno queda en un estado inerte hasta el siguiente `pointerdown`, que es lo que evita el salto de cámara. El doble toque son dos toques en menos de 300 ms y a menos de 30 px.

- [ ] **Step 5: Implementar `src/render/sprites.js` y `src/render/renderer.js`**

Gráficos procedurales: celdas como rectángulos con el color del bioma y una variación de brillo derivada de la celda (no aleatoria por fotograma, o el mapa parpadea); NPCs como círculos con un punto de dirección; edificios como formas simples por tipo. Las celdas no descubiertas se dibujan en un gris oscuro uniforme. La capa de recursos superpone `RESOURCE_TINTS` con alfa proporcional a la cantidad **conocida**. La capa de candidatos marca los sitios de `candidateSites` con su puntuación.

- [ ] **Step 6: Ejecutar las pruebas**

Run: `npm test`
Esperado: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/render tests/huehuet/camera.test.js
git commit -m "feat(render): cámara acotada, gestos táctiles y dibujo procedural por capas"
```

---

### Task 14: Pantalla de slots

**Files:**
- Create: `index.html`, `src/ui/styles.css`, `src/ui/slots.js`, `playwright.config.mjs`, `tests/huehuet/helpers.mjs`
- Test: `tests/huehuet/ui-slots.spec.mjs` (Playwright)

**Interfaces:**
- Consumes: Task 12 (`createStore`), Task 13 (`BIOME_COLORS`).
- Produces:
  - `mountSlotScreen(root: HTMLElement, store: Store, handlers: { onPlay(slotId: string, game: Game): void }) -> { refresh(): void, show(): void, hide(): void }`
  - `renderThumbnail(game: Game, size: number) -> string /* data URL */` — miniatura del mundo conocido, guardada en el slot.
  - `index.html` con `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no">`, el lienzo, los contenedores del HUD y la pantalla de slots.
  - `src/ui/styles.css` con las variables de la paleta verde-gris, `100dvh`, `env(safe-area-inset-*)`, `touch-action: none` en el lienzo, `overscroll-behavior: none`, `-webkit-user-select: none` y la regla `min-height: 44px; min-width: 44px` para `.btn`.

- [ ] **Step 1: Escribir los ayudantes compartidos y la prueba que falla**

Crear primero `tests/huehuet/helpers.mjs`, que usan también las Tasks 15 y 16: levanta un servidor estático sobre la raíz del repositorio y exporta `URL`, `iniciarPartida(page, opts?)`, `diaActual(page)`, `tocarPrimerNpc(page)`, `arrastrar(page, {desde, hasta})` y `estadoCamara(page)`. La configuración de Playwright fija `viewport: { width: 1320, height: 2868 }`, `deviceScaleFactor: 3`, `isMobile: true` y `hasTouch: true`.

Playwright a 1320x2868 con `deviceScaleFactor: 3` y servidor estático local:

```js
test('la pantalla de slots permite crear, continuar y borrar una partida', async ({ page }) => {
  await page.goto(URL);
  await expect(page.getByRole('heading', { name: /huehuet/i })).toBeVisible();
  await expect(page.getByText(/sin partidas/i)).toBeVisible();

  await page.getByRole('button', { name: /nueva partida/i }).click();
  await expect(page.locator('.slot')).toHaveCount(1);

  await page.reload();
  await expect(page.locator('.slot')).toHaveCount(1, 'el slot debe persistir tras recargar');

  await page.getByRole('button', { name: /borrar/i }).click();
  await page.getByRole('button', { name: /confirmar/i }).click();
  await expect(page.locator('.slot')).toHaveCount(0);
});

test('borrar pide confirmación y se puede cancelar', async ({ page }) => {
  await page.goto(URL);
  await page.getByRole('button', { name: /nueva partida/i }).click();
  await page.getByRole('button', { name: /borrar/i }).click();
  await page.getByRole('button', { name: /cancelar/i }).click();
  await expect(page.locator('.slot')).toHaveCount(1);
});

test('todos los botones de la pantalla de slots miden 44 px o más', async ({ page }) => {
  await page.goto(URL);
  await page.getByRole('button', { name: /nueva partida/i }).click();
  for (const b of await page.getByRole('button').all()) {
    const box = await b.boundingBox();
    if (box) assert.ok(box.height >= 44 && box.width >= 44, `botón de ${box.width}x${box.height}`);
  }
});

test('la pantalla de slots respeta las áreas seguras del iPhone 17 Pro Max', async ({ page }) => {
  await page.goto(URL);
  const top = await page.locator('.slots-header').boundingBox();
  assert.ok(top.y >= 54, `cabecera a ${top.y} px, bajo la Dynamic Island`);
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npx playwright test tests/huehuet/ui-slots.spec.mjs`
Esperado: FAIL, no hay `index.html`.

- [ ] **Step 3: Crear `index.html` y `src/ui/styles.css`**

- [ ] **Step 4: Implementar `mountSlotScreen` y `renderThumbnail` en `src/ui/slots.js`**

Cada slot muestra nombre, día, era, población y miniatura. Botones por slot: Continuar, Renombrar, Borrar. Borrar abre una confirmación en línea con Confirmar y Cancelar, no un `confirm()` nativo. Un slot `damaged` se muestra con el aviso correspondiente y solo ofrece Borrar. Si `store.available` es falso, un aviso explica que la partida no se podrá guardar y permite jugar igualmente.

- [ ] **Step 5: Ejecutar las pruebas**

Run: `npx playwright test tests/huehuet/ui-slots.spec.mjs`
Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html src/ui tests/huehuet/helpers.mjs tests/huehuet/ui-slots.spec.mjs
git commit -m "feat(ui): pantalla de slots con crear, continuar, renombrar y borrar"
```

---

### Task 15: HUD, hojas deslizables y desglose de sitio

**Files:**
- Create: `src/ui/sheets.js`, `src/ui/hud.js`, `src/ui/panels.js`
- Modify: `src/ui/styles.css`
- Test: `tests/huehuet/ui-hud.spec.mjs` (Playwright)

**Interfaces:**
- Consumes: Tasks 8, 9, 11, 13.
- Produces:
  - `createSheet(root: HTMLElement, opts: { title: string }) -> Sheet` con `Sheet = { open(snap?: 0.45|0.9): void, close(): void, setContent(node: Node): void, isOpen: boolean }` — arrastrable por su asa, con enganche al 45% y 90% de la altura y cierre al arrastrar hacia abajo.
  - `mountHud(root: HTMLElement, handlers: { onSpeed(speed: number), onToggleLayer(id), onOpenSheet(id: 'banda'|'cronica'|'mundo'), onSave() }) -> { update(game: Game): void }`
  - `renderBandPanel(game) -> Node`, `renderChroniclePanel(game) -> Node`, `renderWorldPanel(game, handlers) -> Node`, `renderNpcCard(npc) -> Node`
  - `renderSiteBreakdown(site: SiteScore, decision: Decision) -> Node` — tabla con cada factor, su valor, su peso y su aportación, más el umbral vigente y el motivo. Es la pantalla que hace legible el sistema del Task 8.

- [ ] **Step 1: Escribir la prueba que falla**

```js
test('la franja superior muestra día, estación y población', async ({ page }) => {
  await iniciarPartida(page);
  await expect(page.locator('.hud-top')).toContainText(/Día/i);
  await expect(page.locator('.hud-top')).toContainText(/primavera|verano|otoño|invierno/i);
  await expect(page.locator('.hud-top')).toContainText(/\d+/);
});

test('los controles de velocidad cambian la velocidad activa', async ({ page }) => {
  await iniciarPartida(page);
  await page.getByRole('button', { name: 'x10' }).click();
  await expect(page.getByRole('button', { name: 'x10' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /pausa/i }).click();
  await expect(page.getByRole('button', { name: /pausa/i })).toHaveAttribute('aria-pressed', 'true');
});

test('con la pausa activa el día no avanza', async ({ page }) => {
  await iniciarPartida(page);
  await page.getByRole('button', { name: /pausa/i }).click();
  const antes = await page.locator('.hud-top').textContent();
  await page.waitForTimeout(2000);
  assert.equal(await page.locator('.hud-top').textContent(), antes);
});

test('cada botón abre su hoja y la hoja se cierra', async ({ page }) => {
  await iniciarPartida(page);
  for (const nombre of [/banda/i, /crónica/i, /mundo/i]) {
    await page.getByRole('button', { name: nombre }).click();
    await expect(page.locator('.sheet.open')).toBeVisible();
    await page.getByRole('button', { name: /cerrar/i }).click();
    await expect(page.locator('.sheet.open')).toHaveCount(0);
  }
});

test('la hoja de la banda lista a los NPCs con sus necesidades', async ({ page }) => {
  await iniciarPartida(page);
  await page.getByRole('button', { name: /banda/i }).click();
  await expect(page.locator('.npc-row')).not.toHaveCount(0);
  await expect(page.locator('.sheet.open')).toContainText(/hambre/i);
});

test('el desglose de un sitio muestra todos los factores y el umbral', async ({ page }) => {
  await iniciarPartida(page, { speed: 10, esperarCandidatos: true });
  await page.locator('.candidate').first().click();
  const hoja = page.locator('.sheet.open');
  await expect(hoja).toContainText(/agua/i);
  await expect(hoja).toContainText(/caza/i);
  await expect(hoja).toContainText(/umbral/i);
  await expect(hoja.locator('.factor-row')).toHaveCount(9);
});

test('la hoja abierta deja el contenido por encima de la barra de gestos', async ({ page }) => {
  await iniciarPartida(page);
  await page.getByRole('button', { name: /crónica/i }).click();
  const box = await page.locator('.sheet.open .sheet-body').boundingBox();
  const alto = page.viewportSize().height;
  assert.ok(box.y + box.height <= alto - 20, 'el contenido invade la barra de gestos');
});

test('todos los controles del HUD miden 44 px o más y caen en el área segura', async ({ page }) => {
  await iniciarPartida(page);
  const alto = page.viewportSize().height;
  for (const b of await page.locator('.hud-bottom button').all()) {
    const box = await b.boundingBox();
    assert.ok(box.height >= 44 && box.width >= 44, `control de ${box.width}x${box.height}`);
    assert.ok(box.y + box.height <= alto - 20, 'control bajo la barra de gestos');
  }
});

test('la capa de recursos se activa y desactiva', async ({ page }) => {
  await iniciarPartida(page);
  await page.getByRole('button', { name: /mundo/i }).click();
  await page.getByRole('button', { name: /caza/i }).click();
  await expect(page.getByRole('button', { name: /caza/i })).toHaveAttribute('aria-pressed', 'true');
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npx playwright test tests/huehuet/ui-hud.spec.mjs`
Esperado: FAIL.

- [ ] **Step 3: Implementar `createSheet` en `src/ui/sheets.js`**

La hoja se posiciona con `translateY` y se arrastra con eventos de puntero sobre el asa. Al soltar, engancha al punto más cercano entre 45%, 90% y cerrada. El cuerpo lleva `padding-bottom: env(safe-area-inset-bottom)` y `overflow-y: auto` con `overscroll-behavior: contain`, para que el desplazamiento interno no arrastre la página.

- [ ] **Step 4: Implementar `src/ui/panels.js`**

- [ ] **Step 5: Implementar `mountHud` en `src/ui/hud.js`**

La franja superior queda bajo `env(safe-area-inset-top)`; la barra inferior, sobre `env(safe-area-inset-bottom)`. Los botones de velocidad y los conmutadores de capa usan `aria-pressed`. `update` solo reescribe los nodos de texto cuyos valores han cambiado, para no reconstruir el HUD en cada fotograma.

- [ ] **Step 6: Ejecutar las pruebas**

Run: `npx playwright test tests/huehuet/ui-hud.spec.mjs`
Esperado: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/sheets.js src/ui/hud.js src/ui/panels.js src/ui/styles.css tests/huehuet/ui-hud.spec.mjs
git commit -m "feat(ui): HUD de pulgar, hojas deslizables y desglose de decisión"
```

---

### Task 16: Ensamblado, autoguardado y verificación en el dispositivo objetivo

**Files:**
- Create: `src/main.js`, `tests/huehuet/ui-game.spec.mjs`
- Modify: `index.html`
- Test: `tests/huehuet/ui-game.spec.mjs` (Playwright)

**Interfaces:**
- Consumes: todas las tareas anteriores.
- Produces: el punto de entrada. Crea el `store`, monta la pantalla de slots, y al empezar o continuar una partida arranca el bucle de `requestAnimationFrame` que llama a `advanceGame`, `renderer.draw` y `hud.update`. Conecta los gestos a la cámara y al selector de NPC y de sitio. Autoguarda al slot activo cada 5 días de juego y al ocultarse la página (`visibilitychange`).

- [ ] **Step 1: Escribir la prueba que falla**

```js
test('una partida nueva arranca, avanza el tiempo y dibuja el mundo', async ({ page }) => {
  await page.goto(URL);
  await page.getByRole('button', { name: /nueva partida/i }).click();
  await page.getByRole('button', { name: /jugar|continuar/i }).click();
  await expect(page.locator('canvas')).toBeVisible();
  const dia1 = await diaActual(page);
  await page.getByRole('button', { name: 'x10' }).click();
  await page.waitForTimeout(3000);
  assert.ok(await diaActual(page) > dia1, 'el día no avanzó');
});

test('la partida se reanuda en el mismo día tras recargar', async ({ page }) => {
  await iniciarPartida(page, { speed: 10 });
  await page.waitForTimeout(4000);
  const dia = await diaActual(page);
  await page.reload();
  await page.getByRole('button', { name: /continuar/i }).click();
  assert.ok(Math.abs(await diaActual(page) - dia) <= 5, 'el autoguardado perdió más de 5 días');
});

test('un toque sobre un NPC abre su ficha', async ({ page }) => {
  await iniciarPartida(page);
  await tocarPrimerNpc(page);
  await expect(page.locator('.sheet.open')).toContainText(/hambre/i);
});

// Review Focus 4
test('arrastrar mueve la cámara y no abre ninguna ficha', async ({ page }) => {
  await iniciarPartida(page);
  const antes = await estadoCamara(page);
  await arrastrar(page, { desde: [660, 1400], hasta: [300, 1000] });
  assert.notDeepEqual(await estadoCamara(page), antes);
  await expect(page.locator('.sheet.open')).toHaveCount(0);
});

test('la página no hace scroll ni desborda a 1320x2868', async ({ page }) => {
  await iniciarPartida(page);
  await arrastrar(page, { desde: [660, 1400], hasta: [660, 2600] });
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
});

// Review Focus 1
test('volver tras tener la pestaña oculta no congela la página', async ({ page }) => {
  await iniciarPartida(page, { speed: 10 });
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(3000);
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const t0 = Date.now();
  await expect(page.locator('.hud-top')).toBeVisible({ timeout: 3000 });
  assert.ok(Date.now() - t0 < 3000, 'la página se congeló al volver');
});

// Review Focus 5
test('en horizontal y en ventanas cortas el HUD no tapa el mapa ni desborda', async ({ page }) => {
  await iniciarPartida(page);
  for (const vp of [{ width: 2868, height: 1320 }, { width: 1320, height: 600 }]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(300);
    const top = await page.locator('.hud-top').boundingBox();
    const bottom = await page.locator('.hud-bottom').boundingBox();
    assert.ok(top.y + top.height < bottom.y, `HUD superpuesto en ${vp.width}x${vp.height}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1), true);
  }
});

test('la banda llega a asentarse jugando a x10 y la crónica lo cuenta', async ({ page }) => {
  await iniciarPartida(page, { speed: 10 });
  await expect(page.locator('.hud-top')).toContainText(/aldea|asentad/i, { timeout: 120000 });
  await page.getByRole('button', { name: /crónica/i }).click();
  await expect(page.locator('.sheet.open')).toContainText(/asentar|aldea/i);
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npx playwright test tests/huehuet/ui-game.spec.mjs`
Esperado: FAIL.

- [ ] **Step 3: Implementar `src/main.js`**

El bucle de `requestAnimationFrame` pasa el delta real a `advanceGame`, cuyo acotado ya absorbe las pausas largas. En `visibilitychange` a oculto: guarda y detiene el bucle; a visible: reinicia la marca de tiempo antes de reanudar, para no inyectar el tiempo transcurrido.

- [ ] **Step 4: Ejecutar las pruebas completas**

Run: `npm test && npx playwright test tests/huehuet/`
Esperado: PASS en ambos.

- [ ] **Step 5: Capturar la pantalla a 1320x2868 y revisarla**

Run: Playwright con `viewport: { width: 1320, height: 2868 }`, `deviceScaleFactor: 3`, captura de la pantalla de slots y de la partida en curso. Revisar las imágenes: nada bajo la Dynamic Island, nada bajo la barra de gestos, controles alcanzables con el pulgar, mapa legible.

- [ ] **Step 6: Commit**

```bash
git add src/main.js index.html tests/huehuet/ui-game.spec.mjs
git commit -m "feat: ensamblado del juego con autoguardado y verificación en iPhone 17 Pro Max"
```

---

## Notas de cobertura

Correspondencia entre las secciones del spec y las tareas:

| Sección del spec | Tareas |
|---|---|
| 3. Arquitectura y pureza de la simulación | 1-11 (verificada en 3 y 11 con la prueba de `Math.random`) |
| 4. Flujo de datos y tick fijo | 1, 11 |
| 5. Necesidades y utilidad | 5, 6 |
| 6. Decisión de asentarse: descubrimiento, factores, umbral móvil, consenso, transparencia | 4, 8, 9, 15 |
| 7. Interfaz para iPhone 17 Pro Max | 13, 14, 15, 16 |
| 8. Guardados: formato, slots, versionado, autoguardado | 12, 14, 16 |
| 9. Manejo de errores | 12 (almacenamiento, corrupción, versión), 3 (sitio viable garantizado), 11 (extinción) |
| 10. Pruebas | todas |
