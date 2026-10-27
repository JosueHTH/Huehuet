import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../../src/game.js';
import { BIOME_COLORS } from '../../src/render/sprites.js';
import { renderThumbnail, accionesDeSlot, nombreNuevo, ticksParaCalentar, slotsACalentar, sinComenzar, datosDeSlot } from '../../src/ui/slots.js';

// Un lienzo falso: apunta cada rectángulo y devuelve una "URL de datos" que lo resume.
function lienzoFalso() {
  const dibujos = [];
  const lienzo = {
    width: 0, height: 0, dibujos,
    getContext: () => ({
      set fillStyle(v) { this._f = v; },
      get fillStyle() { return this._f; },
      fillRect(x, y, w, h) { dibujos.push({ x, y, w, h, color: this._f }); },
    }),
    toDataURL: (tipo) => `data:${tipo ?? 'image/png'};base64,FALSO`,
  };
  return lienzo;
}

test('renderThumbnail devuelve una URL de datos del tamaño pedido', () => {
  const game = createGame(7);
  const lienzo = lienzoFalso();
  const url = renderThumbnail(game, 64, () => lienzo);
  assert.match(url, /^data:image\//);
  assert.equal(lienzo.width, 64);
  assert.equal(lienzo.height, 64);
});

test('renderThumbnail solo pinta lo descubierto; el resto es gris desconocido', () => {
  const game = createGame(7);
  const lienzo = lienzoFalso();
  renderThumbnail(game, 96, () => lienzo);
  const colores = new Set(lienzo.dibujos.map((d) => d.color));
  const conocidas = game.discovery.size;
  assert.ok(conocidas > 0 && conocidas < game.grid.width * game.grid.height);
  // Un fondo completo + exactamente una celda por cada celda descubierta.
  assert.equal(lienzo.dibujos.length, 1 + conocidas, 'un fondo y una celda por cada celda conocida');
  assert.equal(lienzo.dibujos[0].w, 96);
  assert.ok(colores.has('#2a2a2a'), 'lo no descubierto se ve gris');
  const biomasConocidos = new Set(game.discovery.knownCells().map((c) => BIOME_COLORS[c.biome]));
  for (const c of biomasConocidos) assert.ok(colores.has(c), `falta el color de bioma ${c}`);
});

test('renderThumbnail cambia cuando se descubre más mundo', () => {
  const game = createGame(7);
  const a = lienzoFalso(); renderThumbnail(game, 96, () => a);
  game.discovery.reveal(10, 10, 5);
  const b = lienzoFalso(); renderThumbnail(game, 96, () => b);
  assert.ok(b.dibujos.length > a.dibujos.length);
});

test('un slot dañado solo ofrece Borrar', () => {
  assert.deepEqual(accionesDeSlot({ damaged: true }), ['borrar']);
});

test('un slot sano ofrece Continuar, Renombrar y Borrar, en ese orden', () => {
  assert.deepEqual(accionesDeSlot({ id: 'a' }), ['continuar', 'renombrar', 'borrar']);
});

test('nombreNuevo numera sin repetir nombres existentes', () => {
  assert.equal(nombreNuevo([]), 'Partida 1');
  assert.equal(nombreNuevo([{ nombre: 'Partida 1' }]), 'Partida 2');
  assert.equal(nombreNuevo([{ nombre: 'Partida 2' }, { nombre: 'Partida 1' }, { nombre: 'Partida 3' }]), 'Partida 4');
  assert.equal(nombreNuevo([{ nombre: 'Partida 1' }, { nombre: 'Otra' }, { nombre: 'Partida 3' }]), 'Partida 2');
});

test('se calientan como mucho 3 slots, los más recientes, sin los dañados', () => {
  const slots = [
    { id: 'a', updatedAt: 1 }, { id: 'b', updatedAt: 5 }, { id: 'c', updatedAt: 3, damaged: true },
    { id: 'd', updatedAt: 4 }, { id: 'e', updatedAt: 2 },
  ];
  assert.deepEqual(slotsACalentar(slots).map((s) => s.id), ['b', 'd', 'e']);
});

test('el tick con el que se calienta nunca supera el del día guardado', () => {
  assert.equal(ticksParaCalentar({ day: 0 }), 0);
  assert.equal(ticksParaCalentar({ day: 10 }), 240);
});

// --- R1: la ficha no inventa cifras --------------------------------------------------------------

test('sinComenzar reconoce el slot creado y nunca escrito, y solo ese', () => {
  assert.equal(sinComenzar({ day: 0, thumbnail: null }), true);
  assert.equal(sinComenzar({ day: 0, thumbnail: 'data:image/png;base64,X' }), false, 'con miniatura ya se jugó');
  assert.equal(sinComenzar({ day: 3, thumbnail: null }), false, 'con días ya se jugó');
  assert.equal(sinComenzar({ day: 3, thumbnail: 'data:image/png;base64,X' }), false);
});

test('datosDeSlot dice «Sin comenzar» en vez de ceros, y resume la partida escrita', () => {
  assert.equal(datosDeSlot({ day: 0, thumbnail: null, era: 'Nómadas', poblacion: 0 }), 'Sin comenzar');
  assert.equal(datosDeSlot({ day: 12, thumbnail: null, era: 'Aldea', poblacion: 7 }), 'Día 12 · Aldea · 7 habitantes');
  assert.equal(datosDeSlot({ day: 1, thumbnail: null, era: 'Nómadas', poblacion: 1 }), 'Día 1 · Nómadas · 1 habitante');
});
