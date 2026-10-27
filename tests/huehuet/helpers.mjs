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
export const URL = `http://127.0.0.1:${servidor.address().port}/`;

// --- Sobre la página -----------------------------------------------------------------------------

// Crea una partida y entra en ella con Continuar. Deja a la página con la partida en window.__huehuet.
export async function iniciarPartida(page, { url = URL } = {}) {
  await page.goto(url);
  await page.getByRole('button', { name: /nueva partida/i }).click();
  await page.getByRole('button', { name: /^continuar/i }).first().click();
  await page.waitForFunction(() => window.__huehuet?.game);
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
  const punto = await page.evaluate(() => {
    const { game, camera } = window.__huehuet;
    const npc = game.band.npcs.find((n) => n.alive);
    return camera.worldToScreen(npc.x + 0.5, npc.y + 0.5);
  });
  await page.touchscreen.tap(punto.x, punto.y);
  await page.waitForTimeout(350);
  return punto;
}
