// Arranque: monta la pantalla de partidas y, al entrar en una, el HUD y la hoja deslizable.
//
// Lo que NO está aquí todavía (Task 16): el bucle de requestAnimationFrame, el autoguardado por días y por
// visibilitychange, y los gestos conectados a la cámara y al selector de NPC y de sitio. Lo que sí está es
// el CUERPO de ese bucle, en `avanzar(dtMs)`: adelanta el reloj a la velocidad que el HUD tenga elegida y
// repinta. Así la velocidad y la pausa del HUD se pueden verificar hoy, de forma determinista, sin montar
// un bucle sin dueño: la Task 16 solo tendrá que llamar a `avanzar` desde el fotograma.
import { createStore } from './save/store.js';
import { mountSlotScreen, renderThumbnail } from './ui/slots.js';
import { createRenderer } from './render/renderer.js';
import { createCamera } from './render/camera.js';
import { mountHud } from './ui/hud.js';
import { createSheet } from './ui/sheets.js';
import { renderBandPanel, renderChroniclePanel, renderWorldPanel, renderSiteBreakdown, decisionDeSitio } from './ui/panels.js';
import { advanceGame } from './game.js';

const lienzo = document.getElementById('mundo');
const raiz = document.getElementById('slots');
const raizHud = document.getElementById('hud');
const TILE = 16;

const TITULOS = { banda: 'La banda', cronica: 'Crónica', mundo: 'El mundo' };

function entrar(slotId, game) {
  const w = window.innerWidth, h = window.innerHeight, dpr = window.devicePixelRatio || 1;
  const renderer = createRenderer(lienzo);
  renderer.resize(w, h, dpr);
  const camera = createCamera({ viewW: w, viewH: h, worldW: game.grid.width, worldH: game.grid.height, tile: TILE });
  camera.x = game.band.x; camera.y = game.band.y;
  camera.clampCenter();

  // Las capas que pinta el renderer. `candidates` marca en el mapa los sitios que la banda considera: es la
  // contraparte visual de la lista de la hoja de Mundo.
  const capas = { resources: null, candidates: true };
  let velocidad = 1;

  raizHud.replaceChildren();
  const hud = mountHud(raizHud, {
    onSpeed: (v) => { velocidad = v; },
    onToggleLayer: alternarCapa,
    onOpenSheet: abrirHoja,
  });
  const hoja = createSheet(raizHud, { title: '' });

  function refrescar() {
    renderer.draw(game, camera, capas);
    hud.update(game);
  }

  function alternarCapa(id) {
    capas.resources = capas.resources === id ? null : id;
    refrescar();
  }

  function guardar() {
    const r = store.writeSlot(slotId, game, { thumbnail: renderThumbnail(game, 96) });
    pantalla.refresh();
    return r.ok ? `Partida guardada en el día ${game.clock.day}.` : r.error;
  }

  function abrirSitio(site) {
    hoja.setTitle('Por qué este sitio');
    hoja.setContent(renderSiteBreakdown(site, decisionDeSitio(game, site)));
    hoja.open(0.9);
  }

  function abrirHoja(id) {
    const contenido = id === 'banda' ? renderBandPanel(game)
      : id === 'cronica' ? renderChroniclePanel(game)
        : renderWorldPanel(game, { layers: capas, onToggleLayer: alternarCapa, onSite: abrirSitio, onSave: guardar });
    hoja.setTitle(TITULOS[id] ?? '');
    hoja.setContent(contenido);
    hoja.open(0.45);
  }

  refrescar();
  window.__huehuet = {
    slotId, game, camera, renderer, hud, hoja, layers: capas,
    refrescar,
    avanzar(dtMs) { advanceGame(game, dtMs, velocidad); refrescar(); },
  };
  pantalla.hide();
}

const store = createStore();
const pantalla = mountSlotScreen(raiz, store, { onPlay: entrar });
pantalla.refresh();
