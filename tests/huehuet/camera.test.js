import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCamera } from '../../src/render/camera.js';
import { classifyPointer, createGestures, TAP_THRESHOLD } from '../../src/render/gestures.js';
import { BIOME_COLORS, RESOURCE_TINTS, UNKNOWN_COLOR, cellColor } from '../../src/render/sprites.js';
import { createRenderer, TERRAIN_CELL_PX } from '../../src/render/renderer.js';
import { BIOMES, createGrid } from '../../src/world/grid.js';
import { RESOURCES } from '../../src/world/resources.js';
import { createDiscovery } from '../../src/world/discovery.js';
import { codeOnly } from './purity.js';

const cerca = (a, b, eps = 0.001) => Math.abs(a - b) < eps;
const nueva = (o = {}) => createCamera({ viewW: 400, viewH: 800, worldW: 96, worldH: 96, tile: 16, ...o });

// --- Cámara ---------------------------------------------------------------------------------

test('screenToWorld y worldToScreen son inversas', () => {
  const cam = nueva();
  cam.centerOn(40, 40); cam.zoomAt(1.5, 200, 400);
  const p = cam.worldToScreen(40, 40);
  const w = cam.screenToWorld(p.x, p.y);
  assert.ok(cerca(w.x, 40) && cerca(w.y, 40));
});

test('las conversiones son inversas en muchos estados y puntos, en los dos sentidos', () => {
  const cam = nueva();
  const pasos = [[50, 50, 1.3], [20, 70, 0.7], [90, 10, 2.5], [48, 48, 0.4], [3, 3, 3]];
  for (const [cx, cy, f] of pasos) {
    cam.centerOn(cx, cy); cam.zoomAt(f, 130, 610);
    for (const [sx, sy] of [[0, 0], [400, 800], [123, 456], [399, 1]]) {
      const w = cam.screenToWorld(sx, sy);
      const s = cam.worldToScreen(w.x, w.y);
      assert.ok(cerca(s.x, sx) && cerca(s.y, sy), 'pantalla -> mundo -> pantalla');
    }
    for (const [wx, wy] of [[0, 0], [10.5, 77.25], [95, 95]]) {
      const s = cam.worldToScreen(wx, wy);
      const w = cam.screenToWorld(s.x, s.y);
      assert.ok(cerca(w.x, wx) && cerca(w.y, wy), 'mundo -> pantalla -> mundo');
    }
  }
});

test('el centro de la vista es el centro de la cámara y la escala es tile * zoom', () => {
  const cam = nueva();
  cam.centerOn(40, 50);
  const c = cam.screenToWorld(200, 400);
  assert.ok(cerca(c.x, cam.x) && cerca(c.y, cam.y));
  const a = cam.worldToScreen(41, 50);
  const b = cam.worldToScreen(40, 50);
  assert.ok(cerca(a.x - b.x, 16 * cam.zoom));
});

test('zoomAt se acota a minZoom y maxZoom', () => {
  const cam = nueva();
  for (let i = 0; i < 50; i++) cam.zoomAt(2, 200, 400);
  assert.equal(cam.zoom, cam.maxZoom);
  for (let i = 0; i < 100; i++) cam.zoomAt(0.5, 200, 400);
  assert.equal(cam.zoom, cam.minZoom);
  assert.ok(cam.minZoom > 0 && cam.minZoom < cam.maxZoom);
});

test('zoomAt mantiene fijo el punto de pantalla indicado', () => {
  const cam = nueva();
  cam.centerOn(48, 48);
  const antes = cam.screenToWorld(120, 300);
  cam.zoomAt(1.4, 120, 300);
  const despues = cam.screenToWorld(120, 300);
  assert.ok(cerca(antes.x, despues.x, 0.01) && cerca(antes.y, despues.y, 0.01));
  assert.ok(cam.zoom > 1.39, 'el zoom sí cambió');
});

test('zoomAt mantiene el ancla también al alejar y con anclas distintas', () => {
  for (const [sx, sy, f] of [[50, 700, 0.8], [350, 100, 1.2], [200, 400, 2], [10, 10, 1.1]]) {
    const cam = nueva();
    cam.centerOn(48, 48); cam.zoomAt(1.5, 200, 400);
    const antes = cam.screenToWorld(sx, sy);
    cam.zoomAt(f, sx, sy);
    const despues = cam.screenToWorld(sx, sy);
    assert.ok(cerca(antes.x, despues.x, 0.01) && cerca(antes.y, despues.y, 0.01), `ancla ${sx},${sy} x${f}`);
  }
});

test('pan arrastra el mundo con el dedo y no permite salir del mundo', () => {
  const cam = nueva();
  cam.centerOn(48, 48);
  const antes = cam.screenToWorld(200, 400);
  cam.pan(32, 0); // el dedo se mueve a la derecha: el mundo se desplaza a la derecha, la cámara a la izquierda
  assert.ok(cam.screenToWorld(200, 400).x < antes.x - 1.9);
  for (let i = 0; i < 500; i++) cam.pan(-999, -999);
  const esquina = cam.screenToWorld(0, 0);
  const lejos = cam.screenToWorld(400, 800);
  assert.ok(lejos.x <= 97 && lejos.y <= 97);
  assert.ok(lejos.x >= 95 && lejos.y >= 95, 'llega al borde pero no más');
  for (let i = 0; i < 500; i++) cam.pan(999, 999);
  const otra = cam.screenToWorld(0, 0);
  assert.ok(otra.x >= -1 && otra.y >= -1 && otra.x <= 1 && otra.y <= 1);
  assert.ok(esquina.x > 0);
});

test('centerOn acota a los límites del mundo', () => {
  const cam = nueva();
  cam.centerOn(-500, 9999);
  assert.ok(Number.isFinite(cam.x) && Number.isFinite(cam.y));
  assert.ok(cam.screenToWorld(0, 0).x >= -1);
  assert.ok(cam.screenToWorld(400, 800).y <= 97);
  assert.ok(cam.screenToWorld(400, 800).y >= 95);
});

test('un mundo menor que la vista se centra en vez de pegarse a un borde', () => {
  const cam = nueva({ worldW: 10, worldH: 10 }); // 160 px en una vista de 400x800
  for (const mover of [() => cam.pan(-999, -999), () => cam.pan(999, 999), () => cam.centerOn(0, 0), () => cam.centerOn(10, 10)]) {
    mover();
    assert.ok(cerca(cam.x, 5) && cerca(cam.y, 5), 'centrado');
    const izq = cam.worldToScreen(0, 0);
    const der = cam.worldToScreen(10, 10);
    assert.ok(cerca(izq.x, 400 - der.x), 'margen igual a ambos lados en x');
    assert.ok(cerca(izq.y, 800 - der.y), 'margen igual arriba y abajo');
  }
});

test('un mundo mayor en un eje y menor en el otro se centra solo en el eje que sobra', () => {
  const cam = nueva({ worldW: 10, worldH: 400 });
  for (let i = 0; i < 20; i++) cam.pan(999, 999);
  assert.ok(cerca(cam.x, 5));
  assert.ok(cerca(cam.y, 25), 'en y sí se desplaza hasta el borde (25 = mitad de las 50 celdas visibles)');
});

test('resize de la cámara reacota y mantiene las conversiones', () => {
  const cam = nueva();
  cam.centerOn(90, 90);
  cam.resize(800, 400);
  assert.equal(cam.viewW, 800);
  const p = cam.worldToScreen(50, 50);
  const w = cam.screenToWorld(p.x, p.y);
  assert.ok(cerca(w.x, 50) && cerca(w.y, 50));
  assert.ok(cam.screenToWorld(800, 400).x <= 97);
});

// --- classifyPointer ------------------------------------------------------------------------

const par = (dx, dy, t = 100) => [{ x: 100, y: 100, t: 0 }, { x: 100 + dx, y: 100 + dy, t }];

test('un movimiento menor que el umbral es un toque', () => {
  assert.equal(classifyPointer([{ x: 100, y: 100, t: 0 }, { x: 103, y: 101, t: 90 }]), 'tap');
});

test('un movimiento mayor que el umbral es un arrastre, no un toque', () => {
  assert.equal(classifyPointer([{ x: 100, y: 100, t: 0 }, { x: 140, y: 100, t: 120 }]), 'drag');
});

test('un toque largo sin movimiento sigue siendo toque', () => {
  assert.equal(classifyPointer([{ x: 100, y: 100, t: 0 }, { x: 101, y: 100, t: 2000 }]), 'tap');
});

test('el umbral es exactamente 8 px: 8 es toque, justo por encima es arrastre', () => {
  assert.equal(TAP_THRESHOLD, 8);
  assert.equal(classifyPointer(par(8, 0)), 'tap');
  assert.equal(classifyPointer(par(0, -8)), 'tap');
  assert.equal(classifyPointer(par(8.01, 0)), 'drag');
  assert.equal(classifyPointer(par(0, 8.01)), 'drag');
  assert.equal(classifyPointer(par(-9, 0)), 'drag');
});

test('la distancia es euclídea, no por ejes', () => {
  assert.equal(classifyPointer(par(5, 5)), 'tap');     // 7.07
  assert.equal(classifyPointer(par(6, 6)), 'drag');    // 8.49
});

test('un arrastre lento que pasa el umbral es arrastre, y volver al origen no lo deshace', () => {
  const lento = Array.from({ length: 40 }, (_, i) => ({ x: 100 + i * 0.5, y: 100, t: i * 100 }));
  assert.equal(classifyPointer(lento), 'drag');
  assert.equal(classifyPointer([{ x: 100, y: 100, t: 0 }, { x: 120, y: 100, t: 50 }, { x: 100, y: 100, t: 100 }]), 'drag');
});

test('classifyPointer con una sola muestra o ninguna es un toque', () => {
  assert.equal(classifyPointer([{ x: 1, y: 1, t: 0 }]), 'tap');
  assert.equal(classifyPointer([]), 'tap');
});

// --- createGestures -------------------------------------------------------------------------

function banco(opts = {}) {
  const timers = [];
  const el = new EventTarget();
  el.captured = [];
  el.setPointerCapture = (id) => el.captured.push(id);
  el.style = {};
  const calls = { pan: [], pinch: [], tap: [], doubleTap: [] };
  const g = createGestures(el, {
    onPan: (dx, dy) => calls.pan.push([dx, dy]),
    onPinch: (f, cx, cy) => calls.pinch.push([f, cx, cy]),
    onTap: (x, y) => calls.tap.push([x, y]),
    onDoubleTap: (x, y) => calls.doubleTap.push([x, y]),
  }, {
    ...opts,
    setTimer: (fn, ms) => { timers.push({ fn, ms, vivo: true }); return timers.length - 1; },
    clearTimer: (id) => { if (timers[id]) timers[id].vivo = false; },
  });
  // Dispara el temporizador pendiente (el que quede vivo) como si hubiera vencido el plazo.
  const vence = () => { for (const t of timers) if (t.vivo) { t.vivo = false; t.fn(); } };
  const send = (type, id, x, y, t) => {
    const e = new Event(type);
    Object.defineProperty(e, 'pointerId', { value: id });
    Object.defineProperty(e, 'clientX', { value: x });
    Object.defineProperty(e, 'clientY', { value: y });
    Object.defineProperty(e, 'timeStamp', { value: t });
    el.dispatchEvent(e);
  };
  return { el, g, calls, send, timers, vence };
}

test('un toque sin movimiento llama a onTap y a nada más; captura el puntero', () => {
  const { el, calls, send } = banco({ doubleTapDelay: 0 });
  send('pointerdown', 1, 50, 60, 0);
  send('pointerup', 1, 50, 60, 80);
  assert.deepEqual(calls.tap, [[50, 60]]);
  assert.equal(calls.pan.length, 0);
  assert.deepEqual(el.captured, [1]);
  assert.equal(el.style.touchAction, 'none');
});

test('un temblor menor de 8 px sigue siendo toque y no mueve la cámara', () => {
  const { calls, send } = banco({ doubleTapDelay: 0 });
  send('pointerdown', 1, 50, 60, 0);
  send('pointermove', 1, 55, 63, 20);
  send('pointerup', 1, 55, 63, 900);
  assert.equal(calls.pan.length, 0);
  assert.equal(calls.tap.length, 1);
});

test('pasado el umbral es arrastre: onPan acumula todo el recorrido y no hay toque', () => {
  const { calls, send } = banco();
  send('pointerdown', 1, 100, 100, 0);
  send('pointermove', 1, 104, 100, 10);   // aún bajo el umbral: nada
  assert.equal(calls.pan.length, 0);
  send('pointermove', 1, 120, 110, 20);
  send('pointermove', 1, 130, 140, 30);
  send('pointerup', 1, 130, 140, 40);
  const suma = calls.pan.reduce(([a, b], [dx, dy]) => [a + dx, b + dy], [0, 0]);
  assert.deepEqual(suma, [30, 40]);
  assert.equal(calls.tap.length, 0);
});

test('dos dedos solo pinzan: onPinch con el factor y el centro, sin onPan', () => {
  const { calls, send } = banco();
  send('pointerdown', 1, 100, 200, 0);
  send('pointerdown', 2, 200, 200, 5);
  send('pointermove', 2, 300, 200, 10);   // distancia 100 -> 200
  assert.equal(calls.pan.length, 0);
  assert.equal(calls.pinch.length, 1);
  const [f, cx, cy] = calls.pinch[0];
  assert.ok(cerca(f, 2) && cerca(cx, 200) && cerca(cy, 200));
  send('pointermove', 1, 50, 200, 20);    // distancia 250: factor 1.25
  assert.ok(cerca(calls.pinch[1][0], 1.25));
  assert.equal(calls.pan.length, 0);
  assert.equal(calls.tap.length, 0);
});

test('al levantar uno de dos dedos el otro queda inerte hasta el siguiente pointerdown', () => {
  const { calls, send } = banco();
  send('pointerdown', 1, 100, 200, 0);
  send('pointerdown', 2, 200, 200, 5);
  send('pointermove', 2, 220, 200, 10);
  const pinzas = calls.pinch.length;
  send('pointerup', 1, 100, 200, 20);
  send('pointermove', 2, 300, 500, 30);
  send('pointermove', 2, 340, 540, 40);
  assert.equal(calls.pan.length, 0, 'sin salto de cámara');
  assert.equal(calls.pinch.length, pinzas);
  send('pointerup', 2, 340, 540, 50);
  assert.equal(calls.tap.length, 0, 'ni siquiera un toque al terminar el gesto');
  assert.equal(calls.pan.length, 0);
});

test('tras quedar inerte, un nuevo pointerdown vuelve a funcionar (pinza o arrastre)', () => {
  const a = banco();
  a.send('pointerdown', 1, 100, 200, 0);
  a.send('pointerdown', 2, 200, 200, 5);
  a.send('pointerup', 1, 100, 200, 10);
  a.send('pointerdown', 3, 100, 200, 20);    // con el 2 aún abajo: pinza otra vez
  a.send('pointermove', 3, 0, 200, 30);
  assert.equal(a.calls.pinch.length, 1);
  assert.ok(cerca(a.calls.pinch[0][0], 2));

  const b = banco();
  b.send('pointerdown', 1, 100, 200, 0);
  b.send('pointerdown', 2, 200, 200, 5);
  b.send('pointerup', 1, 100, 200, 10);
  b.send('pointerup', 2, 200, 200, 15);
  b.send('pointerdown', 4, 10, 10, 500);
  b.send('pointermove', 4, 60, 10, 510);
  assert.ok(b.calls.pan.length > 0, 'un dedo nuevo arrastra');
});

test('pointercancel no produce toque', () => {
  const { calls, send } = banco();
  send('pointerdown', 1, 50, 50, 0);
  send('pointercancel', 1, 50, 50, 10);
  assert.equal(calls.tap.length, 0);
});

test('con retardo, el toque espera al plazo y entonces se entrega una sola vez', () => {
  const { calls, send, timers, vence } = banco();
  send('pointerdown', 1, 100, 100, 0); send('pointerup', 1, 100, 100, 50);
  assert.equal(calls.tap.length, 0, 'aún no: podría ser el primero de un doble toque');
  assert.equal(timers.filter((t) => t.vivo).length, 1);
  assert.equal(timers[0].ms, 300);
  vence();
  assert.deepEqual(calls.tap, [[100, 100]]);
  assert.equal(calls.doubleTap.length, 0);
});

test('doble toque: el segundo toque (300 ms, 30 px) cancela el pendiente y solo dispara onDoubleTap', () => {
  const { calls, send, timers, vence } = banco();
  send('pointerdown', 1, 100, 100, 0); send('pointerup', 1, 100, 100, 50);
  send('pointerdown', 1, 110, 105, 200); send('pointerup', 1, 110, 105, 250);
  assert.deepEqual(calls.doubleTap, [[110, 105]]);
  assert.equal(calls.tap.length, 0, 'ni ahora ni después hay onTap');
  assert.equal(timers.filter((t) => t.vivo).length, 0, 'temporizador cancelado');
  vence();
  assert.equal(calls.tap.length, 0);
  // el tercero no se empareja con el segundo
  send('pointerdown', 1, 110, 105, 300); send('pointerup', 1, 110, 105, 340);
  assert.equal(calls.doubleTap.length, 1);
  vence();
  assert.equal(calls.tap.length, 1);
});

test('no es doble toque si pasan más de 300 ms: el primero se entrega y el segundo queda pendiente', () => {
  const { calls, send, vence } = banco();
  send('pointerdown', 1, 100, 100, 0); send('pointerup', 1, 100, 100, 50);
  send('pointerdown', 1, 100, 100, 351); send('pointerup', 1, 100, 100, 380);
  assert.equal(calls.doubleTap.length, 0);
  assert.equal(calls.tap.length, 1, 'el primero salió al llegar el segundo');
  vence();
  assert.equal(calls.tap.length, 2);
});

test('el segundo toque tiene que acabar a 30 px o menos del primero, no solo empezar cerca', () => {
  const { calls, send, vence } = banco();
  send('pointerdown', 1, 100, 100, 0); send('pointerup', 1, 100, 100, 50);
  send('pointerdown', 1, 125, 100, 100); send('pointerup', 1, 132, 100, 150);   // baja a 25 px, sube a 32 px
  assert.equal(calls.doubleTap.length, 0);
  assert.deepEqual(calls.tap, [[100, 100]]);
  vence();
  assert.equal(calls.tap.length, 2);
});

test('un segundo toque lejano (>30 px) vacía el pendiente en el pointerdown, antes de su propio toque', () => {
  const { calls, send, vence } = banco();
  send('pointerdown', 1, 100, 100, 0); send('pointerup', 1, 100, 100, 50);
  send('pointerdown', 1, 140, 100, 100);
  assert.deepEqual(calls.tap, [[100, 100]], 'el primero se entrega ya, en el pointerdown lejano');
  send('pointerup', 1, 140, 100, 150);
  assert.equal(calls.doubleTap.length, 0);
  vence();
  assert.deepEqual(calls.tap, [[100, 100], [140, 100]]);
});

test('un arrastre tras un toque vacía el pendiente al empezar el arrastre, no después', () => {
  const { calls, send, vence } = banco();
  send('pointerdown', 1, 100, 100, 0); send('pointerup', 1, 100, 100, 40);
  send('pointerdown', 1, 100, 100, 80);
  assert.equal(calls.tap.length, 0, 'un pointerdown cercano aún puede ser el segundo toque');
  send('pointermove', 1, 130, 100, 90);
  assert.deepEqual(calls.tap, [[100, 100]], 'el toque sale cuando empieza el arrastre');
  assert.ok(calls.pan.length > 0);
  send('pointerup', 1, 160, 100, 100);
  assert.equal(calls.doubleTap.length, 0);
  vence();
  assert.equal(calls.tap.length, 1, 'no se entrega dos veces');
});

test('empezar una pinza vacía el pendiente', () => {
  const { calls, send, vence } = banco();
  send('pointerdown', 1, 100, 100, 0); send('pointerup', 1, 100, 100, 40);
  send('pointerdown', 1, 100, 100, 80);
  send('pointerdown', 2, 110, 100, 85);       // cerca del pendiente, pero es un segundo dedo: pinza
  assert.deepEqual(calls.tap, [[100, 100]]);
  vence();
  assert.equal(calls.tap.length, 1);
});

test('destroy vacía el toque pendiente en vez de perderlo o entregarlo tarde', () => {
  const { g, calls, send, vence } = banco();
  send('pointerdown', 1, 100, 100, 0); send('pointerup', 1, 100, 100, 40);
  g.destroy();
  assert.deepEqual(calls.tap, [[100, 100]]);
  vence();
  assert.equal(calls.tap.length, 1);
});

test('doubleTapDelay 0 desactiva el doble toque y entrega cada toque al instante', () => {
  const { calls, send, timers } = banco({ doubleTapDelay: 0 });
  send('pointerdown', 1, 100, 100, 0); send('pointerup', 1, 100, 100, 50);
  send('pointerdown', 1, 100, 100, 100); send('pointerup', 1, 100, 100, 150);
  assert.equal(calls.tap.length, 2);
  assert.equal(calls.doubleTap.length, 0);
  assert.equal(timers.length, 0);
});

test('destroy quita los oyentes', () => {
  const { g, calls, send } = banco();
  g.destroy();
  send('pointerdown', 1, 50, 60, 0);
  send('pointerup', 1, 50, 60, 80);
  assert.equal(calls.tap.length, 0);
});

// --- sprites --------------------------------------------------------------------------------

test('BIOME_COLORS cubre todos los biomas y RESOURCE_TINTS todos los recursos', () => {
  for (const id of Object.keys(BIOMES)) assert.ok(BIOME_COLORS[id], `falta color de ${id}`);
  for (const id of Object.keys(RESOURCES)) assert.ok(RESOURCE_TINTS[id], `falta tinte de ${id}`);
});

test('cellColor depende solo de la celda, varía entre celdas y no es el gris de lo desconocido', () => {
  const vistos = new Set();
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    const c = cellColor('pradera', x, y);
    assert.equal(c, cellColor('pradera', x, y), 'estable');
    assert.notEqual(c, UNKNOWN_COLOR);
    vistos.add(c);
  }
  assert.ok(vistos.size > 1, 'hay variación entre celdas');
  assert.ok(vistos.size <= 16, 'pocas variantes');
});

// --- renderer con contexto falso ------------------------------------------------------------

function ctxFalso() {
  const log = [];
  const ctx = { fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1, font: '', textAlign: '', textBaseline: '', imageSmoothingEnabled: true };
  for (const n of ['fillRect', 'clearRect', 'drawImage', 'setTransform', 'scale', 'save', 'restore', 'beginPath', 'arc', 'fill', 'stroke', 'moveTo', 'lineTo', 'closePath', 'rect', 'fillText', 'strokeRect', 'translate', 'ellipse']) {
    ctx[n] = (...args) => log.push({ n, args, fillStyle: ctx.fillStyle, strokeStyle: ctx.strokeStyle, alpha: ctx.globalAlpha, smoothing: ctx.imageSmoothingEnabled });
  }
  ctx.log = log;
  return ctx;
}
const lienzoFalso = () => { const ctx = ctxFalso(); return { width: 0, height: 0, style: {}, ctx, getContext: () => ctx }; };

const GRIS = UNKNOWN_COLOR;
const W = 10;

// Mundo de 10x10: pradera, con bosque en (3,3) y río en (4,3). Descubierto: radio 1 alrededor de (3,3).
function escena({ leña = 6, leñaVecina = 3 } = {}) {
  const grid = createGrid(W, W);
  grid.at(3, 3).biome = 'bosque';
  grid.at(3, 3).resources.leña = leña;
  grid.at(4, 3).biome = 'rio';
  grid.at(2, 3).resources.leña = leñaVecina;
  grid.at(8, 8).biome = 'montaña';
  grid.at(8, 8).resources.leña = 10; // jamás descubierta
  const discovery = createDiscovery(grid);
  discovery.reveal(3, 3, 1);
  const opaca = { get width() { throw new Error('grid.width'); }, at() { throw new Error('grid.at'); }, get cells() { throw new Error('grid.cells'); }, forRadius() { throw new Error('forRadius'); }, inBounds() { throw new Error('inBounds'); } };
  const game = {
    grid: opaca, world: { grid: opaca }, discovery, over: false, settlement: null, lastDecision: null,
    clock: { tick: 0, day: 0, season: 'verano' },
    band: { x: 3, y: 3, npcs: [{ id: 'n1', nombre: 'Ana', age: 30, x: 3, y: 3, alive: true, action: null }] },
  };
  return { grid, discovery, game };
}

function montaje(opts) {
  const canvas = lienzoFalso();
  const offs = [];
  const r = createRenderer(canvas, { createCanvas: () => { const c = lienzoFalso(); offs.push(c); return c; }, now: () => 0 });
  const cam = createCamera({ viewW: 440, viewH: 956, worldW: W, worldH: W, tile: 16 });
  r.resize(440, 956, 3);
  const s = escena(opts);
  return { r, cam, canvas, offs, ...s, terreno: () => offs[0].ctx.log };
}
const rectCelda = (log, x, y) => log.filter((c) => c.n === 'fillRect' && c.args[0] === x * TERRAIN_CELL_PX && c.args[1] === y * TERRAIN_CELL_PX && c.args[2] === TERRAIN_CELL_PX);
const capas = { resources: null, candidates: false };

test('resize pone el almacén en cssW*dpr x cssH*dpr, el tamaño CSS en cssW x cssH y escala el contexto (dpr 3)', () => {
  const m = montaje();
  assert.equal(m.canvas.width, 1320);
  assert.equal(m.canvas.height, 2868);
  assert.equal(m.canvas.style.width, '440px');
  assert.equal(m.canvas.style.height, '956px');
  const t = m.canvas.ctx.log.filter((c) => c.n === 'setTransform').at(-1);
  assert.deepEqual(t.args, [3, 0, 0, 3, 0, 0]);
});

test('resize con dpr 1: almacén y CSS coinciden', () => {
  const m = montaje();
  m.r.resize(390, 844, 1);
  assert.equal(m.canvas.width, 390);
  assert.equal(m.canvas.height, 844);
  assert.equal(m.canvas.style.width, '390px');
  assert.deepEqual(m.canvas.ctx.log.filter((c) => c.n === 'setTransform').at(-1).args, [1, 0, 0, 1, 0, 0]);
});

test('draw mantiene la escala del dpr tras redimensionar (el contexto se reinicia al cambiar width)', () => {
  const m = montaje();
  m.canvas.ctx.log.length = 0;
  m.r.draw(m.game, m.cam, capas);
  const primero = m.canvas.ctx.log.find((c) => c.n === 'setTransform');
  assert.deepEqual(primero.args, [3, 0, 0, 3, 0, 0]);
});

test('las celdas no descubiertas se dibujan en el gris uniforme, aunque el mundo real tenga algo', () => {
  const m = montaje();
  m.r.draw(m.game, m.cam, capas);
  for (const [x, y] of [[0, 0], [8, 8], [5, 5], [9, 0]]) {
    const rs = rectCelda(m.terreno(), x, y);
    assert.equal(rs.length, 1, `celda ${x},${y}`);
    assert.equal(rs[0].fillStyle, GRIS);
  }
});

test('una celda descubierta toma el color de su bioma (con la variación derivada de la celda)', () => {
  const m = montaje();
  m.r.draw(m.game, m.cam, capas);
  assert.equal(rectCelda(m.terreno(), 3, 3)[0].fillStyle, cellColor('bosque', 3, 3));
  assert.equal(rectCelda(m.terreno(), 4, 3)[0].fillStyle, cellColor('rio', 4, 3));
  assert.equal(rectCelda(m.terreno(), 3, 2)[0].fillStyle, cellColor('pradera', 3, 2));
  assert.notEqual(rectCelda(m.terreno(), 3, 3)[0].fillStyle, GRIS);
});

test('el renderer no toca grid: el juego falso lanza al leerla y draw no falla', () => {
  const m = montaje();
  assert.doesNotThrow(() => m.r.draw(m.game, m.cam, { resources: 'leña', candidates: true }));
});

test('la capa de recursos tiñe con alfa proporcional a lo conocido y no tiñe lo desconocido', () => {
  const m = montaje({ leña: 6, leñaVecina: 3 });
  m.r.draw(m.game, m.cam, { resources: 'leña', candidates: false });
  const tinte = (x, y) => rectCelda(m.terreno(), x, y).filter((c) => c.fillStyle === RESOURCE_TINTS.leña);
  const a = tinte(3, 3), b = tinte(2, 3);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.ok(a[0].alpha > 0 && a[0].alpha <= 1);
  assert.ok(cerca(a[0].alpha / b[0].alpha, 2, 1e-6), 'doble de leña, doble de alfa');
  assert.equal(tinte(8, 8).length, 0, 'lo no descubierto no se tiñe, tenga lo que tenga');
  assert.equal(tinte(5, 5).length, 0, 'celda sin leña conocida (y desconocida) sin tinte');
  assert.equal(tinte(3, 2).length, 0, 'celda conocida sin leña: sin tinte');
});

test('el alfa del tinte crece con la cantidad conocida (tope en el máximo del recurso)', () => {
  const alfa = (leña) => {
    const m = montaje({ leña });
    m.r.draw(m.game, m.cam, { resources: 'leña', candidates: false });
    return rectCelda(m.terreno(), 3, 3).find((c) => c.fillStyle === RESOURCE_TINTS.leña)?.alpha ?? 0;
  };
  assert.equal(alfa(0), 0);
  assert.ok(alfa(2) < alfa(5) && alfa(5) < alfa(10));
  assert.equal(alfa(RESOURCES.leña.max * 5), alfa(RESOURCES.leña.max));
});

test('sin capa de recursos no hay ningún tinte', () => {
  const m = montaje();
  m.r.draw(m.game, m.cam, capas);
  assert.equal(m.terreno().filter((c) => c.n === 'fillRect' && Object.values(RESOURCE_TINTS).includes(c.fillStyle)).length, 0);
});

test('un fotograma sin cambios no repinta el terreno; invalidateTerrain sí', () => {
  const m = montaje();
  m.r.draw(m.game, m.cam, capas);
  const n = m.terreno().length;
  assert.ok(n >= W * W);
  m.r.draw(m.game, m.cam, capas);
  m.cam.pan(5, 5);
  m.r.draw(m.game, m.cam, capas);
  assert.equal(m.terreno().length, n, 'sin repintado');
  m.r.invalidateTerrain();
  m.r.draw(m.game, m.cam, capas);
  assert.ok(m.terreno().length >= 2 * n, 'repintado');
  const n2 = m.terreno().length;
  m.r.draw(m.game, m.cam, capas);
  assert.equal(m.terreno().length, n2, 'y vuelve a quedar limpio');
});

test('cambiar de capa o descubrir terreno repinta el terreno sin que nadie lo pida', () => {
  const m = montaje();
  m.r.draw(m.game, m.cam, capas);
  const n = m.terreno().length;
  m.r.draw(m.game, m.cam, { resources: 'leña', candidates: false });
  assert.ok(m.terreno().length > n, 'cambio de capa');
  const n2 = m.terreno().length;
  m.discovery.reveal(8, 8, 1);
  m.r.draw(m.game, m.cam, { resources: 'leña', candidates: false });
  assert.ok(m.terreno().length > n2, 'descubrimiento');
  assert.equal(rectCelda(m.terreno(), 8, 8).filter((c) => c.fillStyle !== RESOURCE_TINTS.leña).at(-1).fillStyle, cellColor('montaña', 8, 8));
});

test('el terreno se compone con drawImage sin suavizado, en el desplazamiento de la cámara', () => {
  const m = montaje();
  m.r.draw(m.game, m.cam, capas);
  const d = m.canvas.ctx.log.filter((c) => c.n === 'drawImage').at(-1);
  assert.ok(d, 'se compone con drawImage');
  assert.equal(d.args[0], m.offs[0]);
  assert.equal(d.smoothing, false);
  const o = m.cam.worldToScreen(0, 0);
  const args = d.args;
  const [dx, dy, dw, dh] = args.slice(-4);
  assert.ok(cerca(dx, o.x) && cerca(dy, o.y));
  const f = m.cam.worldToScreen(W, W);
  assert.ok(cerca(dx + dw, f.x) && cerca(dy + dh, f.y));
  m.cam.pan(-10, -10);
  m.canvas.ctx.log.length = 0;
  m.r.draw(m.game, m.cam, capas);
  const d2 = m.canvas.ctx.log.filter((c) => c.n === 'drawImage').at(-1);
  assert.ok(cerca(d2.args.at(-4), m.cam.worldToScreen(0, 0).x));
});

test('la variación por celda no depende del fotograma: dos repintados dan la misma secuencia', () => {
  const m = montaje();
  m.r.draw(m.game, m.cam, capas);
  const primera = m.terreno().filter((c) => c.n === 'fillRect').map((c) => c.fillStyle);
  const n = primera.length;
  m.r.invalidateTerrain();
  m.r.draw(m.game, m.cam, capas);
  m.r.invalidateTerrain();
  m.r.draw(m.game, m.cam, capas);
  const todas = m.terreno().filter((c) => c.n === 'fillRect').map((c) => c.fillStyle);
  assert.deepEqual(todas.slice(n, 2 * n), primera);
  assert.deepEqual(todas.slice(2 * n, 3 * n), primera);
});

test('los NPC se dibujan en la posición de pantalla de su celda', () => {
  const m = montaje();
  m.r.draw(m.game, m.cam, capas);
  const p = m.cam.worldToScreen(3.5, 3.5);
  const arcos = m.canvas.ctx.log.filter((c) => c.n === 'arc');
  assert.ok(arcos.some((c) => cerca(c.args[0], p.x) && cerca(c.args[1], p.y)), 'círculo del NPC centrado en la celda');
});

test('los NPC se interpolan entre ticks: a medio tick están a medio camino', () => {
  let t = 0;
  const canvas = lienzoFalso();
  const r = createRenderer(canvas, { createCanvas: lienzoFalso, now: () => t });
  const cam = createCamera({ viewW: 440, viewH: 956, worldW: W, worldH: W, tile: 16 });
  r.resize(440, 956, 1);
  const { game } = escena();
  r.draw(game, cam, capas);
  game.clock.tick = 1; game.band.npcs[0].x = 4;
  t = 200;
  r.draw(game, cam, capas);       // aquí se nota el cambio de tick: el tramo empieza
  t = 400;
  canvas.ctx.log.length = 0;
  r.draw(game, cam, capas);
  const mitad = cam.worldToScreen(4, 3.5);
  assert.ok(canvas.ctx.log.some((c) => c.n === 'arc' && cerca(c.args[0], mitad.x, 0.5)), 'a medio camino entre 3.5 y 4.5');
  t = 1000;
  canvas.ctx.log.length = 0;
  r.draw(game, cam, capas);
  const fin = cam.worldToScreen(4.5, 3.5);
  assert.ok(canvas.ctx.log.some((c) => c.n === 'arc' && cerca(c.args[0], fin.x, 0.5)), 'llega a su celda');
});

test('los edificios se dibujan en su celda y no hay etiquetas de candidatos con la capa apagada', () => {
  const m = montaje();
  m.game.settlement = { x: 3, y: 3, buildings: [{ id: 'hoguera', x: 3, y: 3, done: true, progress: 1 }, { id: 'choza', x: 5, y: 3, done: false, progress: 0.2 }] };
  m.canvas.ctx.log.length = 0;
  m.r.draw(m.game, m.cam, capas);
  const log = m.canvas.ctx.log;
  const hoguera = m.cam.worldToScreen(3.5, 3.5);
  const choza = m.cam.worldToScreen(5.5, 3.5);
  const s = 16 * m.cam.zoom;
  // la hoguera son dos círculos concéntricos en el centro de su celda, del color del fuego
  const fuego = log.filter((c) => c.n === 'arc' && cerca(c.args[0], hoguera.x) && cerca(c.args[1], hoguera.y) && (cerca(c.args[2], s * 0.32) || cerca(c.args[2], s * 0.16)));
  assert.equal(fuego.length, 2, 'hoguera');
  // la choza (sin terminar) es un triángulo con el pico sobre el centro de su celda
  assert.ok(log.some((c) => c.n === 'moveTo' && cerca(c.args[0], choza.x - s * 0.4)), 'choza: arranca a la izquierda del centro');
  assert.ok(log.some((c) => c.n === 'lineTo' && cerca(c.args[0], choza.x) && cerca(c.args[1], choza.y - s * 0.4)), 'choza: pico sobre su celda');
  assert.ok(!log.some((c) => c.n === 'lineTo' && cerca(c.args[0], hoguera.x) && cerca(c.args[1], hoguera.y - s * 0.4)), 'no hay choza sobre la hoguera');
  const relleno = log.find((c) => c.n === 'fill' && c.fillStyle === '#8b5a2b');
  assert.ok(relleno && cerca(relleno.alpha, 0.4), 'obra sin terminar a media opacidad');
  assert.equal(log.filter((c) => c.n === 'fillText').length, 0, 'sin etiquetas con candidates: false');
});

test('la capa de candidatos marca sitios viables con su puntuación', () => {
  const grid = createGrid(30, 30);
  for (const c of grid.cells) { c.biome = 'pradera'; c.resources.caza = 4; c.resources.forraje = 4; c.resources.leña = 6; c.resources.piedra = 6; }
  grid.at(12, 10).biome = 'rio'; grid.at(12, 10).river = true; grid.at(12, 10).resources.agua = 10;
  const discovery = createDiscovery(grid);
  discovery.reveal(10, 10, 8);
  const game = { discovery, over: false, settlement: null, clock: { tick: 0, day: 0, season: 'verano' }, band: { x: 10, y: 10, npcs: [] } };
  const canvas = lienzoFalso();
  const r = createRenderer(canvas, { createCanvas: lienzoFalso, now: () => 0 });
  const cam = createCamera({ viewW: 440, viewH: 956, worldW: 30, worldH: 30, tile: 16 });
  r.resize(440, 956, 1);
  r.draw(game, cam, { resources: null, candidates: false });
  assert.equal(canvas.ctx.log.filter((c) => c.n === 'fillText').length, 0);
  canvas.ctx.log.length = 0;
  r.draw(game, cam, { resources: null, candidates: true });
  assert.ok(canvas.ctx.log.filter((c) => c.n === 'fillText').length > 0, 'etiquetas de puntuación');
});

test('otra partida en el mismo renderer, con igual nº de celdas descubiertas y día, no dibuja el terreno de la anterior', () => {
  const m = montaje();
  m.r.draw(m.game, m.cam, capas);
  assert.equal(rectCelda(m.terreno(), 3, 3).at(-1).fillStyle, cellColor('bosque', 3, 3));
  const otra = escena();
  otra.grid.at(3, 3).biome = 'montaña';          // otra semilla: mismo radio inicial, otro mundo
  assert.equal(otra.discovery.size, m.discovery.size);
  m.r.draw(otra.game, m.cam, capas);
  assert.equal(rectCelda(m.terreno(), 3, 3).at(-1).fillStyle, cellColor('montaña', 3, 3));
});

test('el terreno no se reasigna (ni se borra) en cada repintado: el tamaño se fija una vez', () => {
  const canvas = lienzoFalso();
  let asignaciones = 0;
  const r = createRenderer(canvas, {
    now: () => 0,
    createCanvas: () => {
      const c = lienzoFalso();
      let w = 0, h = 0;
      Object.defineProperty(c, 'width', { get: () => w, set: (v) => { asignaciones++; w = v; } });
      Object.defineProperty(c, 'height', { get: () => h, set: (v) => { asignaciones++; h = v; } });
      return c;
    },
  });
  const cam = createCamera({ viewW: 440, viewH: 956, worldW: W, worldH: W, tile: 16 });
  r.resize(440, 956, 1);
  const { game } = escena();
  r.draw(game, cam, capas);
  const primeras = asignaciones;
  assert.equal(primeras, 2);
  r.invalidateTerrain(); r.draw(game, cam, capas);
  r.draw(game, cam, { resources: 'leña', candidates: false });
  assert.equal(asignaciones, primeras);
});

test('un NPC que muere y cuyo id reaparece en otro sitio no se desliza desde su posición vieja', () => {
  let t = 0;
  const canvas = lienzoFalso();
  const r = createRenderer(canvas, { createCanvas: lienzoFalso, now: () => t });
  const cam = createCamera({ viewW: 440, viewH: 956, worldW: W, worldH: W, tile: 16 });
  r.resize(440, 956, 1);
  const { game } = escena();
  r.draw(game, cam, capas);
  game.band.npcs[0].alive = false;
  r.draw(game, cam, capas);
  game.band.npcs[0].alive = true; game.band.npcs[0].x = 8; game.clock.tick = 7;
  t = 100;
  canvas.ctx.log.length = 0;
  r.draw(game, cam, capas);
  const destino = cam.worldToScreen(8.5, 3.5);
  assert.ok(canvas.ctx.log.some((c) => c.n === 'arc' && cerca(c.args[0], destino.x, 0.5)), 'aparece ya en su sitio');
});

test('una partida nueva con ids repetidos no hace deslizar a los NPC desde la anterior', () => {
  let t = 0;
  const canvas = lienzoFalso();
  const r = createRenderer(canvas, { createCanvas: lienzoFalso, now: () => t });
  const cam = createCamera({ viewW: 440, viewH: 956, worldW: W, worldH: W, tile: 16 });
  r.resize(440, 956, 1);
  const a = escena();
  a.game.clock.tick = 3;
  r.draw(a.game, cam, capas);
  const b = escena();
  b.game.band.npcs[0].x = 8; b.game.clock.tick = 0;
  t = 100;
  canvas.ctx.log.length = 0;
  r.draw(b.game, cam, capas);
  const destino = cam.worldToScreen(8.5, 3.5);
  assert.ok(canvas.ctx.log.some((c) => c.n === 'arc' && cerca(c.args[0], destino.x, 0.5)));
});

// --- anti-fuga: lo que el renderer decide pintar sale solo de discovery ----------------------

test('el código de render no toca la rejilla ni el generador', () => {
  for (const f of ['renderer.js', 'sprites.js']) {
    const codigo = codeOnly(readFileSync(new URL(`../../src/render/${f}`, import.meta.url), 'utf8'));
    assert.ok(!/\.at\(/.test(codigo), `${f} usa .at(`);
    assert.ok(!/\bcells\b/.test(codigo), `${f} usa cells`);
    assert.ok(!/viableSites/.test(codigo), `${f} usa viableSites`);
    assert.ok(!/\bforRadius\b/.test(codigo), `${f} usa forRadius`);
    assert.deepEqual(codigo.match(/\bgrid\b(?!\.inBounds)/g) ?? [], [], `${f} usa grid más allá de grid.inBounds`);
  }
});

test('el código de render no usa azar ni lee la hora por su cuenta salvo now inyectable', () => {
  for (const f of ['renderer.js', 'sprites.js', 'camera.js', 'gestures.js']) {
    const codigo = codeOnly(readFileSync(new URL(`../../src/render/${f}`, import.meta.url), 'utf8'));
    assert.ok(!/Math\.random|Math\['random'\]/.test(codigo), `${f} usa Math.random`);
  }
});
