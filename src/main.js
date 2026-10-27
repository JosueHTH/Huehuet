// El ensamblado: crea el almacén, monta la pantalla de partidas y, al entrar en una, hace correr el tiempo.
//
// Lo que esta pieza aporta y no está en ningún otro módulo:
//   - el BUCLE: requestAnimationFrame entrega el delta real a advanceGame (cuyo acotado absorbe las pausas
//     largas) a la velocidad que el HUD tenga elegida, y repinta;
//   - el AUTOGUARDADO: cada DIAS_POR_AUTOGUARDADO días de juego y al ocultarse la página;
//   - los GESTOS conectados a la cámara y a los selectores de NPC y de sitio;
//   - el ENCUADRE y el DIMENSIONADO del lienzo, con la densidad del dispositivo y al girar el teléfono.
//
// El jugador es un observador: no hay una sola orden que pueda dar. Todo lo que el toque hace es ABRIR algo
// que explica lo que la banda decidió por su cuenta.
//
// El mundo se mira solo por discovery (y por sitescore, que lee por discovery): aquí no se toca la rejilla
// más allá de su tamaño, que es la escala del cuadro y no verdad del terreno. Lo vigila el escaneo
// anti-fuga de camera.test.js.
//
// Este módulo NO está bajo la prueba de pureza, porque es el único que tiene derecho al reloj de pared y al
// navegador. A cambio, no deja entrar ni azar ni tiempo real en la simulación: lo único que cruza es el
// delta en milisegundos, y el reloj de ticks lo convierte en horas enteras.
import { createStore } from './save/store.js';
import { mountSlotScreen, renderThumbnail } from './ui/slots.js';
import { createRenderer } from './render/renderer.js';
import { createCamera } from './render/camera.js';
import { createGestures } from './render/gestures.js';
import { mountHud, VELOCIDAD_INICIAL } from './ui/hud.js';
import { createSheet } from './ui/sheets.js';
import { renderBandPanel, renderChroniclePanel, renderWorldPanel, renderSiteBreakdown, renderNpcCard, decisionDeSitio } from './ui/panels.js';
import { candidateSites } from './tribe/sitescore.js';
import { advanceGame } from './game.js';

const lienzo = document.getElementById('mundo');
const raiz = document.getElementById('slots');
const raizHud = document.getElementById('hud');

const TILE = 16;
// 32 px por celda: lo que la banda tiene descubierto el día 0 (13 celdas de lado) llena el ancho del
// teléfono. A zoom 1 ocupaba 208 de 440 px y el mapa se leía como un sello en una pared gris.
const ZOOM_INICIAL = 2;
const DIAS_POR_AUTOGUARDADO = 5;
// Lo que un dedo abarca. En celdas crece al alejar el zoom: a zoom 1 una celda mide 16 px y pedir
// puntería de media celda sería pedir puntería de 8 px.
const RADIO_TOQUE_PX = 26;
const RADIO_TOQUE_MINIMO = 0.9;    // celdas: ni con el zoom al máximo se pide más puntería que esta
// Suavizado del seguimiento: a qué ritmo la cámara alcanza a la banda. Centrar de golpe en cada tick daba
// un salto de una celda por hora simulada; a x10 eso es un tirón cada 40 ms.
const MS_SEGUIMIENTO = 220;

const TITULOS = { banda: 'La banda', cronica: 'Crónica', mundo: 'El mundo' };

// El gancho de instrumentación (T16-c) solo existe si la página se abre con ?pruebas. Una página servida en
// producción no lo lleva, y hay una prueba que lo afirma. Las pruebas del navegador navegan siempre con el
// parámetro puesto, así que no hay que recordarlo en cada spec.
const PRUEBAS = (() => {
  try { return new URLSearchParams(globalThis.location?.search ?? '').has('pruebas'); } catch { return false; }
})();

// --- Estado de vida larga -----------------------------------------------------------------------
// El renderer y los gestos son de la PÁGINA, no del callback del slot: se crean una vez y sobreviven a
// cualquier partida. El renderer tira su caché de terreno y de caminantes cuando cambia el discovery (lo
// hace él, y está probado), así que reutilizarlo no arrastra el mapa de otra partida.

let renderer = null;
let gestos = null;
let partida = null;      // { slotId, game, camera, hud, hoja, capas, velocidad, seguir, diaGuardado }
let fotogramaId = 0;
let marca = 0;           // timeStamp del fotograma anterior; 0 quiere decir "vuelve a empezar"

// --- Dibujar y dimensionar ----------------------------------------------------------------------

function refrescar() {
  if (!partida) return;
  renderer.draw(partida.game, partida.camera, partida.capas);
  partida.hud.update(partida.game);
}

// El lienzo tiene dos tamaños: el CSS (lo que mide en la pantalla) y el de mapa de bits (ese por la
// densidad del dispositivo). Sin el segundo, en un iPhone a dpr 3 se dibujaría un tercio de los píxeles y
// se estiraría: el mapa saldría borroso y nada lo delataría.
function dimensionar() {
  if (!partida) return;
  const w = globalThis.innerWidth;
  const h = globalThis.innerHeight;
  const dpr = globalThis.devicePixelRatio || 1;
  renderer.resize(w, h, dpr);
  partida.camera.resize(w, h);
  // Los márgenes se leen DESPUÉS de dimensionar: el HUD se reacomoda con el ancho de la ventana (en
  // horizontal la franja superior cabe en menos alto) y setInsets reacota con ellos.
  partida.camera.setInsets(partida.hud.insets);
  if (partida.seguir) encuadrar();
  else partida.camera.clampCenter();
}

// Pone a la banda en el centro del mapa visible, con el zoom de partida.
function encuadrar() {
  const { camera, game } = partida;
  camera.zoom = Math.min(camera.maxZoom, Math.max(camera.minZoom, ZOOM_INICIAL));
  camera.centerOn(game.band.x + 0.5, game.band.y + 0.5);
}

// Alcanza a la banda sin saltos: se acerca una fracción del camino por fotograma.
function seguirBanda(dtMs) {
  const { camera, game } = partida;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / MS_SEGUIMIENTO);
  const ox = game.band.x + 0.5;
  const oy = game.band.y + 0.5;
  camera.centerOn(camera.x + (ox - camera.x) * k, camera.y + (oy - camera.y) * k);
}

// --- El bucle -----------------------------------------------------------------------------------

// El cuerpo del fotograma, sin el fotograma: adelanta el reloj a la velocidad elegida y repinta. Las
// pruebas lo llaman con un delta exacto; el bucle, con el real.
function avanzar(dtMs) {
  if (!partida) return 0;
  const ticks = advanceGame(partida.game, dtMs, partida.velocidad);
  if (partida.seguir) seguirBanda(dtMs);
  autoguardarSiToca();
  refrescar();
  return ticks;
}

function fotograma(t) {
  fotogramaId = globalThis.requestAnimationFrame(fotograma);
  // Primer fotograma tras arrancar o tras volver de una pestaña oculta: se remarca el reloj y no se inyecta
  // el tiempo transcurrido. Sin esto, volver tras un minuto fuera entregaría 60 000 ms de golpe.
  if (marca === 0) { marca = t; refrescar(); return; }
  const dt = t - marca;
  marca = t;
  avanzar(dt);
}

function arrancarBucle() {
  if (fotogramaId !== 0) return;
  marca = 0;
  fotogramaId = globalThis.requestAnimationFrame(fotograma);
}

function pararBucle() {
  if (fotogramaId === 0) return;
  globalThis.cancelAnimationFrame(fotogramaId);
  fotogramaId = 0;
  marca = 0;
}

// --- Guardar ------------------------------------------------------------------------------------

// Devuelve el mensaje que la hoja de Mundo enseña, o null. La miniatura va en cada guardado, también en el
// automático: cuesta 1-2 ms y es lo único que distingue una tarjeta de slot de un rectángulo vacío.
function guardar() {
  if (!partida) return null;
  const r = store.writeSlot(partida.slotId, partida.game, { thumbnail: renderThumbnail(partida.game, 96) });
  partida.diaGuardado = partida.game.clock.day;
  pantalla.refresh();
  return r.ok ? `Partida guardada en el día ${partida.game.clock.day}.` : r.error;
}

function autoguardarSiToca() {
  if (partida.game.clock.day - partida.diaGuardado >= DIAS_POR_AUTOGUARDADO) guardar();
}

// --- Las hojas ----------------------------------------------------------------------------------

function alternarCapa(id) {
  partida.capas.resources = partida.capas.resources === id ? null : id;
  refrescar();
}

function abrirSitio(site) {
  partida.hoja.setTitle('Por qué este sitio');
  partida.hoja.setContent(renderSiteBreakdown(site, decisionDeSitio(partida.game, site)));
  partida.hoja.open(0.9);
}

function abrirNpc(npc) {
  partida.hoja.setTitle(npc.nombre);
  partida.hoja.setContent(renderNpcCard(npc));
  partida.hoja.open(0.45);
}

function abrirHoja(id) {
  const { game, capas, hoja } = partida;
  const contenido = id === 'banda' ? renderBandPanel(game)
    : id === 'cronica' ? renderChroniclePanel(game)
      : renderWorldPanel(game, { layers: capas, onToggleLayer: alternarCapa, onSite: abrirSitio, onSave: guardar });
  hoja.setTitle(TITULOS[id] ?? '');
  hoja.setContent(contenido);
  hoja.open(0.45);
}

// --- Los gestos ---------------------------------------------------------------------------------

// Celdas que abarca el dedo con el zoom de ahora.
const radioToque = () => Math.max(RADIO_TOQUE_MINIMO, RADIO_TOQUE_PX / (TILE * partida.camera.zoom));

// Qué hay bajo el dedo: la gente y los sitios candidatos compiten, y gana el MÁS CERCANO al toque, no la
// gente por decreto. Medido: alejada la vista al mínimo, el explorador que descubrió un sitio está a tres
// celdas de él, que son 15 px en pantalla; con «la gente primero» era imposible abrir el desglose de un
// sitio sin acercarse antes, aunque el dedo estuviera justo encima de la marca. Los empates sí los gana la
// gente: con el dedo a la misma distancia de los dos, quien tiene nombre interesa más.
//
// Los sitios se piden a sitescore con lo que la banda ha visto, igual que la hoja de Mundo: cuesta 40-60 ms
// y esto corre una vez por toque, no por fotograma.
function objetivoTocado(mundo) {
  const r = radioToque();
  let cerca = r * r;
  let mejor = null;
  const distancia = (x, y) => (x + 0.5 - mundo.x) ** 2 + (y + 0.5 - mundo.y) ** 2;

  for (const npc of partida.game.band.npcs) {
    if (!npc.alive) continue;
    const d = distancia(npc.x, npc.y);
    if (d <= cerca) { cerca = d; mejor = { npc }; }
  }
  for (const sitio of candidateSites(partida.game.discovery, { season: partida.game.clock.season })) {
    const d = distancia(sitio.x, sitio.y);
    if (d < cerca) { cerca = d; mejor = { sitio }; }
  }
  return mejor;
}

// Un toque sobre el mapa abre lo que haya debajo. Si no hay nada no pasa nada: un toque en el vacío no debe
// cerrar ni abrir hojas por su cuenta.
function tocarMapa(sx, sy) {
  if (!partida) return;
  const objetivo = objetivoTocado(partida.camera.screenToWorld(sx, sy));
  if (!objetivo) return;
  if (objetivo.npc) abrirNpc(objetivo.npc);
  else abrirSitio(objetivo.sitio);
}

// Volver a la banda: es la única forma de deshacer un arrastre largo, y la razón de ser del doble toque en
// un juego de observador (acercar y alejar ya los lleva la pinza).
function volverALaBanda() {
  if (!partida) return;
  partida.seguir = true;
  encuadrar();
  refrescar();
}

function montarGestos() {
  if (gestos) return;
  gestos = createGestures(lienzo, {
    onPan(dx, dy) {
      if (!partida) return;
      partida.seguir = false;      // el jugador ha decidido mirar a otro sitio: la cámara deja de insistir
      partida.camera.pan(dx, dy);
      refrescar();
    },
    onPinch(factor, cx, cy) {
      if (!partida) return;
      partida.seguir = false;
      partida.camera.zoomAt(factor, cx, cy);
      refrescar();
    },
    onTap: tocarMapa,
    onDoubleTap: volverALaBanda,
  });
}

// --- Entrar en una partida ----------------------------------------------------------------------

function entrar(slotId, game) {
  if (!renderer) renderer = createRenderer(lienzo);
  pararBucle();
  partida?.hud.destroy();
  partida?.hoja.destroy();
  raizHud.replaceChildren();

  const capas = { resources: null, candidates: true };
  const hud = mountHud(raizHud, {
    onSpeed: (v) => { partida.velocidad = v; },
    onToggleLayer: alternarCapa,
    onOpenSheet: abrirHoja,
  });
  const hoja = createSheet(raizHud, { title: '' });
  const camera = createCamera({
    viewW: globalThis.innerWidth, viewH: globalThis.innerHeight,
    worldW: game.grid.width, worldH: game.grid.height, tile: TILE,
  });

  partida = {
    slotId, game, camera, hud, hoja, capas,
    velocidad: VELOCIDAD_INICIAL,
    seguir: true,
    diaGuardado: game.clock.day,
  };

  dimensionar();
  refrescar();
  montarGestos();
  arrancarBucle();

  if (PRUEBAS) {
    globalThis.__huehuet = {
      get slotId() { return partida.slotId; },
      get game() { return partida.game; },
      get camera() { return partida.camera; },
      get hud() { return partida.hud; },
      get hoja() { return partida.hoja; },
      get layers() { return partida.capas; },
      renderer,
      refrescar,
      avanzar,
      guardar,
      encuadrar: volverALaBanda,
    };
  }
  pantalla.hide();
}

// --- Oyentes de la página -----------------------------------------------------------------------

const alRedimensionar = () => { dimensionar(); refrescar(); };
globalThis.addEventListener('resize', alRedimensionar);
globalThis.addEventListener('orientationchange', alRedimensionar);

// Oculta: se guarda y se para el bucle, que si no seguiría acumulando tiempo que el jugador no ve.
// Visible: se remarca el reloj ANTES de reanudar (marca = 0 en arrancarBucle), para no inyectar de golpe el
// tiempo que la pestaña estuvo fuera. El acotado del reloj descarta el acumulador sobrante por diseño.
document.addEventListener('visibilitychange', () => {
  if (!partida) return;
  if (document.visibilityState === 'hidden') { pararBucle(); guardar(); }
  else arrancarBucle();
});

const store = createStore();
const pantalla = mountSlotScreen(raiz, store, { onPlay: entrar });
pantalla.refresh();
