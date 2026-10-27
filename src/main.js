// Arranque: monta la pantalla de partidas. El bucle de juego, los gestos y el HUD llegan después; por ahora,
// elegir una partida la deja en window.__huehuet (lo que leen los ayudantes de las pruebas del navegador) y
// pinta un fotograma.
import { createStore } from './save/store.js';
import { mountSlotScreen } from './ui/slots.js';
import { createRenderer } from './render/renderer.js';
import { createCamera } from './render/camera.js';

const lienzo = document.getElementById('mundo');
const raiz = document.getElementById('slots');
const TILE = 16;

function entrar(slotId, game) {
  const w = window.innerWidth, h = window.innerHeight, dpr = window.devicePixelRatio || 1;
  const renderer = createRenderer(lienzo);
  renderer.resize(w, h, dpr);
  const camera = createCamera({ viewW: w, viewH: h, worldW: game.grid.width, worldH: game.grid.height, tile: TILE });
  camera.x = game.band.x; camera.y = game.band.y;
  camera.clampCenter();
  renderer.draw(game, camera, {});
  window.__huehuet = { slotId, game, camera, renderer };
  pantalla.hide();
}

const store = createStore();
const pantalla = mountSlotScreen(raiz, store, { onPlay: entrar });
pantalla.refresh();
