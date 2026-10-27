// Ayudantes compartidos por las pruebas del navegador (Tasks 14, 15 y 16): un servidor estático sobre la raíz
// del repositorio y las operaciones de siempre sobre la página. Cada proceso de prueba levanta el suyo en un
// puerto libre; no hace falta limpiar nada, el servidor no mantiene vivo el proceso.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright vive en el NODE_PATH global y los `import` ESM no lo consultan: `require` sí.
export const { test, expect } = createRequire(import.meta.url)('playwright/test');

const RAIZ = resolve(fileURLToPath(new globalThis.URL('../..', import.meta.url)));
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const servidor = createServer(async (req, res) => {
  try {
    const ruta = decodeURIComponent(new globalThis.URL(req.url, 'http://x').pathname);
    const archivo = normalize(join(RAIZ, ruta === '/' ? 'index.html' : ruta));
    if (!archivo.startsWith(RAIZ)) { res.writeHead(403).end(); return; }
    const cuerpo = await readFile(archivo);
    res.writeHead(200, { 'content-type': TIPOS[extname(archivo)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(cuerpo);
  } catch {
    res.writeHead(404).end('no encontrado');
  }
});
await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
servidor.unref();
// `?pruebas=1` es lo que destapa el gancho de instrumentación `window.__huehuet` (Task 16, T16-c): sin ese
// parámetro el juego no lo publica, así que una página servida en producción no lo lleva. Todas las pruebas
// navegan por esta constante, de modo que no hay que recordarlo en cada spec.
export const URL = `http://127.0.0.1:${servidor.address().port}/?pruebas=1`;
export const URL_SIN_PRUEBAS = `http://127.0.0.1:${servidor.address().port}/`;

// --- Sobre la página -----------------------------------------------------------------------------

// Crea una partida y entra en ella con Continuar. Deja a la página con la partida en window.__huehuet.
// `pausar` (por defecto, sí): desde la Task 16 el juego corre el reloj solo, con el bucle de
// requestAnimationFrame. Una prueba que afirme un estado exacto tiene que empezar por pararlo, o el tiempo
// se le mueve entre que lo prepara y lo mira. Las pruebas que afirman que el tiempo CORRE pasan
// `pausar: false` o eligen su velocidad en el HUD.
// `semilla`: siembra el índice con un slot de esa semilla antes de cargar la página, en vez de dejar que
// «Nueva partida» sortee una. Sin ella la semilla es aleatoria y nada de lo que dependa del mundo (los sitios
// candidatos, por ejemplo) se puede afirmar. `ticks`: horas simuladas que se corren al entrar, con stepGame
// (exacto y sin reloj de pared), para llegar a estados que el día 0 no tiene.
export async function iniciarPartida(page, { url = URL, semilla, ticks = 0, pausar: enPausa = true } = {}) {
  if (semilla !== undefined) {
    await page.addInitScript((seed) => {
      localStorage.setItem('huehuet.saves.v1', JSON.stringify({
        version: 1,
        slots: [{ id: 'sembrada', nombre: 'Sembrada', seed, day: 0, poblacion: 0, era: 'Nómadas', settled: false, thumbnail: null, updatedAt: 1 }],
      }));
    }, semilla);
  }
  await page.goto(url);
  if (semilla === undefined) await page.getByRole('button', { name: /nueva partida/i }).click();
  await page.getByRole('button', { name: /^continuar/i }).first().click();
  await page.waitForFunction(() => window.__huehuet?.game);
  if (enPausa) await pausar(page);
  if (ticks > 0) await avanzarTicks(page, ticks);
}

// Corre `n` horas simuladas exactas y repinta. No usa el reloj de pared: `stepGame` adelanta un tick por
// iteración, así que el estado al que se llega es el mismo en cada ejecución.
export async function avanzarTicks(page, n) {
  await page.evaluate(async (ticks) => {
    const { stepGame } = await import('/src/game.js');
    stepGame(window.__huehuet.game, ticks);
    window.__huehuet.refrescar();
  }, n);
}

// Corre `dtMs` de tiempo real a la velocidad que el HUD tenga elegida (la que main.js recibió por onSpeed).
// Es el cuerpo del bucle sin el bucle: lo que se afirma es que la velocidad del HUD manda sobre el reloj.
export async function avanzarReloj(page, dtMs) {
  await page.evaluate((ms) => window.__huehuet.avanzar(ms), dtMs);
}

export const diaActual = (page) => page.evaluate(() => window.__huehuet.game.clock.day);

export const estadoCamara = (page) => page.evaluate(() => {
  const { x, y, zoom } = window.__huehuet.camera;
  return { x, y, zoom };
});

// Un dedo que va de `desde` a `hasta` (px CSS), con eventos táctiles reales por CDP: touchscreen.tap es lo único
// que Playwright ofrece de serie y un arrastre no se puede componer con él.
export async function arrastrar(page, { desde, hasta, pasos = 8 }) {
  const cdp = await page.context().newCDPSession(page);
  const punto = (x, y) => [{ x, y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: punto(desde.x, desde.y) });
  for (let i = 1; i <= pasos; i++) {
    const t = i / pasos;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: punto(desde.x + (hasta.x - desde.x) * t, desde.y + (hasta.y - desde.y) * t) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

// Toca al primer NPC vivo y espera a que pase la ventana del doble toque (300 ms + margen): hasta entonces el
// toque está aplazado a propósito. Devuelve dónde tocó.
export async function tocarPrimerNpc(page) {
  await pausar(page);
  const punto = await page.evaluate(() => {
    const { game, camera } = window.__huehuet;
    const npc = game.band.npcs.find((n) => n.alive);
    return camera.worldToScreen(npc.x + 0.5, npc.y + 0.5);
  });
  await tocar(page, punto);
  return punto;
}

// Toca un sitio candidato en el mapa. Los candidatos están donde la banda querría ir, que es LEJOS de donde
// empieza (chooseStart la pone lejos de los sitios viables), así que con el zoom de partida ninguno cabe en
// pantalla: primero se aleja con una pinza, igual que haría el jugador, y después se toca. Devuelve dónde
// tocó y qué sitio había ahí, o null si la banda no conoce ninguno.
export async function tocarPrimerSitio(page) {
  const sitio = await page.evaluate(async () => {
    const { candidateSites } = await import('/src/tribe/sitescore.js');
    const { game } = window.__huehuet;
    const [s] = candidateSites(game.discovery, { season: game.clock.season });
    return s ? { x: s.x, y: s.y } : null;
  });
  if (sitio === null) return null;
  await pausar(page);
  const { w, h } = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await pinzar(page, { centro: { x: w / 2, y: h / 2 }, desde: 240, factor: 0.1 });
  const punto = await page.evaluate((s) => window.__huehuet.camera.worldToScreen(s.x + 0.5, s.y + 0.5), sitio);
  await tocar(page, punto);
  return { ...punto, x0: sitio.x, y0: sitio.y };
}

// Para el reloj. Hace falta antes de tocar a alguien: el toque simple se aplaza 300 ms a propósito (para
// distinguirlo del doble toque) y en esos 300 ms un NPC a velocidad x1 recorre casi una celda, así que el
// dedo acabaría donde el NPC ya no está. Es una carrera de la PRUEBA, no del juego.
export async function pausar(page) {
  await page.getByRole('button', { name: 'Pausa', exact: true }).click();
}

// Un toque simple, con la espera de la ventana del doble toque ya incluida (gestures.js lo aplaza 300 ms a
// propósito para distinguirlo del doble toque: comprobar al instante sería una prueba intermitente).
export async function tocar(page, { x, y }) {
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(450);
}

// Dos toques seguidos dentro de la ventana del doble toque.
export async function tocarDoble(page, { x, y }) {
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(60);
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(350);
}

// Una pinza de dos dedos centrada en `centro`: `factor` > 1 acerca, < 1 aleja. Por CDP, igual que `arrastrar`:
// Playwright no compone gestos de dos punteros.
export async function pinzar(page, { centro, desde = 60, factor = 2, pasos = 10 }) {
  const cdp = await page.context().newCDPSession(page);
  const dedos = (sep) => [
    { x: centro.x - sep / 2, y: centro.y, id: 1 },
    { x: centro.x + sep / 2, y: centro.y, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: dedos(desde) });
  for (let i = 1; i <= pasos; i++) {
    const t = i / pasos;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: dedos(desde * (1 + (factor - 1) * t)) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

// El rectángulo del mapa que el jugador ve de verdad: lo que queda entre la franja superior y la barra del
// pulgar, con el canal lateral de 16 px. Lo que caiga fuera está tapado por el HUD, aunque esté dibujado.
export async function rectaVisible(page, gutter = 16) {
  const arriba = await page.locator('.hud-top').boundingBox();
  const abajo = await page.locator('.hud-bottom').boundingBox();
  const { w } = await page.evaluate(() => ({ w: window.innerWidth }));
  return { x0: gutter, y0: arriba.y + arriba.height, x1: w - gutter, y1: abajo.y };
}
