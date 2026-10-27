// El ensamblado (Task 16) en el navegador y a 440x956 px CSS con dpr 3: el bucle que hace correr el tiempo
// solo, el autoguardado, los gestos conectados a la cámara y a los selectores, el encuadre de la banda y el
// redimensionado del lienzo.
//
// Nota sobre el tiempo: aquí sí se espera tiempo de pared, porque lo que se afirma ES que el juego corre sin
// que nadie lo empuje. Pero nunca se espera a secas: cada espera va con una velocidad elegida y se compara
// contra la MISMA espera en pausa, de modo que «el tiempo avanza» no pueda pasar por casualidad ni «el tiempo
// no avanza» por un bucle muerto.
import assert from 'node:assert/strict';
import {
  test, expect, URL, URL_SIN_PRUEBAS, iniciarPartida, avanzarTicks, diaActual, estadoCamara,
  arrastrar, tocar, tocarDoble, tocarPrimerNpc, tocarPrimerSitio, pinzar, rectaVisible,
} from './helpers.mjs';

const ANCHO = 440;
const ALTO = 956;
const SEMILLA = 1;
// La semilla 1 conoce 8 sitios candidatos a partir del tick 108 (medido en Node, reproducible).
const TICKS_HASTA_SITIOS = 108;

const tickActual = (page) => page.evaluate(() => window.__huehuet.game.clock.tick);
const indice = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('huehuet.saves.v1') ?? 'null'));

// `exact` no es un adorno: sin él «x1» es una subcadena de «x10» y el localizador encuentra dos botones.
async function elegirVelocidad(page, nombre) {
  const b = page.getByRole('button', { name: nombre, exact: true });
  const n = await b.count();
  assert.equal(n, 1, `no hay exactamente un control de velocidad «${nombre}» (hay ${n})`);
  await b.click();
}

// --- El bucle ------------------------------------------------------------------------------------

test('el bucle hace correr el tiempo sin que nadie lo empuje, y la pausa lo detiene', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA });
  const t0 = await tickActual(page);
  await elegirVelocidad(page, 'x10');
  await page.waitForTimeout(1500);
  const corriendo = await tickActual(page);
  assert.ok(corriendo > t0, `a x10 el reloj no avanzó solo: sigue en el tick ${corriendo}`);

  await elegirVelocidad(page, 'Pausa');
  await page.waitForTimeout(200);          // el fotograma en vuelo termina de aplicarse
  const enPausa = await tickActual(page);
  await page.waitForTimeout(1500);
  assert.equal(await tickActual(page), enPausa, 'en pausa el bucle siguió corriendo el reloj');
});

// El bucle corre con la velocidad que el HUD trae puesta de fábrica, sin que nadie toque nada: es la
// afirmación que no se puede hacer eligiendo antes una velocidad.
test('al entrar en una partida el tiempo ya corre, con la velocidad de fábrica', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA, pausar: false });
  const b = page.getByRole('button', { name: 'x1', exact: true });
  assert.equal(await b.getAttribute('aria-pressed'), 'true', 'el HUD no arranca en x1');
  const t0 = await tickActual(page);
  await page.waitForTimeout(2000);
  const t1 = await tickActual(page);
  assert.ok(t1 > t0, `el reloj sigue en el tick ${t1} tras 2 s sin tocar nada`);
  assert.ok(t1 - t0 <= 10, `corrieron ${t1 - t0} ticks en 2 s a x1: el bucle corre más rápido de lo que dice`);
});

test('a x10 el tiempo corre más que a x1 en la misma espera', async ({ page }) => {
  const corrido = async (velocidad) => {
    await iniciarPartida(page, { semilla: SEMILLA });
    await elegirVelocidad(page, velocidad);
    const antes = await tickActual(page);
    await page.waitForTimeout(1500);
    return await tickActual(page) - antes;
  };
  const x1 = await corrido('x1');
  const x10 = await corrido('x10');
  assert.ok(x10 > x1 * 3, `x10 corrió ${x10} ticks y x1 ${x1}: la velocidad del HUD no manda sobre el bucle`);
});

test('el bucle dibuja de verdad: los NPCs se mueven en pantalla con el tiempo', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA });
  const huella = () => page.evaluate(() => {
    const c = document.getElementById('mundo');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let suma = 0;
    for (let i = 0; i < d.length; i += 4 * 331) suma = (suma + d[i] * 7 + d[i + 1] * 13 + d[i + 2]) % 1e9;
    return suma;
  });
  await elegirVelocidad(page, 'x10');
  const antes = await huella();
  await page.waitForTimeout(2000);
  assert.notEqual(await huella(), antes, 'el lienzo no cambió en 2 s a x10: el bucle no repinta');
});

// --- El encuadre de la banda ---------------------------------------------------------------------
// El defecto que esta tarea hereda: la banda empieza LEJOS de los sitios viables (chooseStart lo busca así),
// y en un mundo de 96x96 eso cae muchas veces a tres celdas del borde. Con el acotado del borde y el zoom 1
// la banda terminaba en la esquina de la pantalla, detrás de la barra del pulgar: dibujada y no vista.

test('el encuadre inicial deja a la banda dentro del mapa que se ve, no bajo el HUD', async ({ page }) => {
  for (const semilla of [1, 7, 23]) {
    await iniciarPartida(page, { semilla });
    const r = await rectaVisible(page);
    const { punto, banda, mundo } = await page.evaluate(() => {
      const { camera, game } = window.__huehuet;
      return {
        punto: camera.worldToScreen(game.band.x + 0.5, game.band.y + 0.5),
        banda: { x: game.band.x, y: game.band.y },
        mundo: { w: camera.worldW, h: camera.worldH },
      };
    });
    const margen = 44;    // lo mínimo para que además se pueda tocar
    assert.ok(punto.x >= r.x0 + margen && punto.x <= r.x1 - margen,
      `semilla ${semilla}: la banda (${banda.x}, ${banda.y}) cae en x=${Math.round(punto.x)}, fuera de [${r.x0 + margen}, ${r.x1 - margen}]`);
    assert.ok(punto.y >= r.y0 + margen && punto.y <= r.y1 - margen,
      `semilla ${semilla}: la banda (${banda.x}, ${banda.y}) cae en y=${Math.round(punto.y)}, fuera de [${Math.round(r.y0 + margen)}, ${Math.round(r.y1 - margen)}]`);
    assert.equal(mundo.w, 96);
  }
});

test('el encuadre inicial acerca lo bastante para que se lea el terreno', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA });
  const cam = await estadoCamara(page);
  assert.ok(cam.zoom >= 2, `el zoom inicial es ${cam.zoom}: a 16 px por celda lo descubierto no llena ni media pantalla`);
});

test('el mundo cubre el mapa visible: la cámara sigue acotada al borde', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA });
  const r = await rectaVisible(page);
  const esquinas = await page.evaluate(() => {
    const { camera } = window.__huehuet;
    return { a: camera.worldToScreen(0, 0), b: camera.worldToScreen(camera.worldW, camera.worldH) };
  });
  assert.ok(esquinas.a.x <= r.x0 + 0.5 && esquinas.a.y <= r.y0 + 0.5,
    `la esquina (0,0) del mundo entra en el mapa visible (${Math.round(esquinas.a.x)}, ${Math.round(esquinas.a.y)}): la cámara se salió del mundo`);
  assert.ok(esquinas.b.x >= r.x1 - 0.5 && esquinas.b.y >= r.y1 - 0.5,
    `la esquina lejana del mundo entra en el mapa visible (${Math.round(esquinas.b.x)}, ${Math.round(esquinas.b.y)}): la cámara se salió del mundo`);
});

// --- El lienzo: dpr y redimensionado -------------------------------------------------------------

test('el lienzo se dimensiona con la densidad del dispositivo', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA });
  const c = await page.evaluate(() => {
    const el = document.getElementById('mundo');
    return { w: el.width, h: el.height, sw: el.style.width, sh: el.style.height, dpr: window.devicePixelRatio };
  });
  assert.equal(c.dpr, 3, 'el contexto de prueba no está a dpr 3');
  assert.equal(c.w, ANCHO * 3, `el lienzo tiene ${c.w} px de ancho y no ${ANCHO * 3}: se dimensionó sin dpr y el mapa saldría borroso`);
  assert.equal(c.h, ALTO * 3, `el lienzo tiene ${c.h} px de alto y no ${ALTO * 3}`);
  assert.equal(c.sw, `${ANCHO}px`);
  assert.equal(c.sh, `${ALTO}px`);
});

test('al girar el teléfono el lienzo y la cámara se redimensionan', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA });
  await page.setViewportSize({ width: ALTO, height: ANCHO });
  await page.waitForTimeout(250);
  const v = await page.evaluate(() => {
    const el = document.getElementById('mundo');
    return { w: el.width, h: el.height, sw: el.style.width, camW: window.__huehuet.camera.viewW, camH: window.__huehuet.camera.viewH };
  });
  assert.equal(v.sw, `${ALTO}px`, `el lienzo quedó congelado en ${v.sw}: nadie escucha resize`);
  assert.equal(v.w, ALTO * 3, `el lienzo horizontal tiene ${v.w} px y no ${ALTO * 3}`);
  assert.equal(v.h, ANCHO * 3);
  assert.equal(v.camW, ALTO, `la cámara sigue creyendo que la vista mide ${v.camW} px de ancho`);
  assert.equal(v.camH, ANCHO);
});

test('tras girar, la banda sigue dentro del mapa que se ve', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA });
  await page.setViewportSize({ width: ALTO, height: ANCHO });
  await page.waitForTimeout(250);
  const r = await rectaVisible(page);
  const punto = await page.evaluate(() => {
    const { camera, game } = window.__huehuet;
    return camera.worldToScreen(game.band.x + 0.5, game.band.y + 0.5);
  });
  assert.ok(punto.x >= r.x0 && punto.x <= r.x1 && punto.y >= r.y0 && punto.y <= r.y1,
    `en horizontal la banda cae en (${Math.round(punto.x)}, ${Math.round(punto.y)}), fuera del mapa visible`);
});

// --- Gestos --------------------------------------------------------------------------------------

test('un toque sobre un NPC abre su ficha', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA });
  const punto = await tocarPrimerNpc(page);
  const abiertas = await page.locator('.sheet.open').count();
  assert.equal(abiertas, 1, `tocar al NPC en (${Math.round(punto.x)}, ${Math.round(punto.y)}) no abrió ninguna hoja`);
  assert.equal(await page.locator('.npc-card').count(), 1, 'la hoja abierta no es la ficha de un NPC');
  await expect(page.locator('.sheet.open')).toContainText(/hambre/i);
});

test('un toque sobre un sitio candidato abre su desglose', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA, ticks: TICKS_HASTA_SITIOS });
  const punto = await tocarPrimerSitio(page);
  assert.ok(punto !== null, 'la banda no conoce ningún sitio candidato que tocar');
  assert.equal(await page.locator('.site-breakdown').count(), 1,
    `tocar el mapa sobre el sitio (${punto.x0}, ${punto.y0}) en (${Math.round(punto.x)}, ${Math.round(punto.y)}) no abrió ningún desglose`);
  assert.equal(await page.locator('.sheet.open').getAttribute('data-snap'), '0.9', 'el desglose no abrió a pantalla casi entera');
});

test('un toque en terreno vacío no abre nada', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA });
  // Una celda sin descubrir, lejos de la banda y de cualquier candidato.
  const punto = await page.evaluate(() => {
    const { camera, game } = window.__huehuet;
    const lejos = { x: game.band.x > 48 ? game.band.x - 20 : game.band.x + 20, y: game.band.y > 48 ? game.band.y - 20 : game.band.y + 20 };
    return camera.worldToScreen(lejos.x, lejos.y);
  });
  await tocar(page, punto);
  assert.equal(await page.locator('.sheet.open').count(), 0, 'un toque en el vacío abrió una hoja');
});

test('arrastrar mueve la cámara y no abre ninguna ficha', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA });
  const antes = await estadoCamara(page);
  await arrastrar(page, { desde: { x: 220, y: 500 }, hasta: { x: 100, y: 330 } });
  const despues = await estadoCamara(page);
  assert.notDeepEqual(despues, antes, 'arrastrar no movió la cámara');
  assert.equal(despues.zoom, antes.zoom, 'arrastrar cambió el zoom');
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.sheet.open').count(), 0, 'arrastrar abrió una hoja: el arrastre se tomó por un toque');
});

test('un arrastre que empieza sobre un NPC tampoco abre su ficha', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA });
  const npc = await page.evaluate(() => {
    const { game, camera } = window.__huehuet;
    const n = game.band.npcs.find((p) => p.alive);
    return camera.worldToScreen(n.x + 0.5, n.y + 0.5);
  });
  await arrastrar(page, { desde: npc, hasta: { x: npc.x - 120, y: npc.y - 120 } });
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.sheet.open').count(), 0, 'arrastrar desde un NPC abrió su ficha');
});

test('la pinza acerca y aleja la cámara sin pasarse de los topes', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA });
  const inicial = await estadoCamara(page);
  await pinzar(page, { centro: { x: 220, y: 480 }, factor: 2.2 });
  const cerca = await estadoCamara(page);
  assert.ok(cerca.zoom > inicial.zoom, `la pinza no acercó: el zoom sigue en ${cerca.zoom}`);
  await pinzar(page, { centro: { x: 220, y: 480 }, desde: 200, factor: 0.25 });
  const lejos = await estadoCamara(page);
  assert.ok(lejos.zoom < cerca.zoom, `la pinza no alejó: el zoom sigue en ${lejos.zoom}`);
  assert.ok(lejos.zoom <= 4 && cerca.zoom <= 4, 'la pinza se pasó del zoom máximo');
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.sheet.open').count(), 0, 'la pinza abrió una hoja');
});

test('el doble toque vuelve a la banda después de haberse ido lejos', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA });
  for (let i = 0; i < 6; i++) await arrastrar(page, { desde: { x: 220, y: 300 }, hasta: { x: 220, y: 800 } });
  const r = await rectaVisible(page);
  const fuera = await page.evaluate(() => {
    const { camera, game } = window.__huehuet;
    return camera.worldToScreen(game.band.x + 0.5, game.band.y + 0.5);
  });
  assert.ok(fuera.y < r.y0 || fuera.y > r.y1, `el arrastre no llegó a sacar a la banda de la vista (y=${Math.round(fuera.y)})`);
  await tocarDoble(page, { x: 220, y: 480 });
  const vuelta = await page.evaluate(() => {
    const { camera, game } = window.__huehuet;
    return camera.worldToScreen(game.band.x + 0.5, game.band.y + 0.5);
  });
  assert.ok(vuelta.y >= r.y0 && vuelta.y <= r.y1,
    `el doble toque no devolvió la vista a la banda (y=${Math.round(vuelta.y)}, mapa visible [${Math.round(r.y0)}, ${Math.round(r.y1)}])`);
  assert.equal(await page.locator('.sheet.open').count(), 0, 'el doble toque abrió una hoja');
});

// --- Autoguardado --------------------------------------------------------------------------------

test('el juego se autoguarda cada pocos días de juego, con su miniatura', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA });
  assert.equal((await indice(page)).slots[0].day, 0, 'el slot sembrado no empieza en el día 0');
  await elegirVelocidad(page, 'x10');
  await expect.poll(async () => (await indice(page)).slots[0].day, { timeout: 30000, message: 'el autoguardado no escribió nunca' })
    .toBeGreaterThan(0);
  const slot = (await indice(page)).slots[0];
  assert.ok(slot.day >= 5, `el autoguardado escribió el día ${slot.day}: la cadencia no es la de 5 días`);
  assert.ok(typeof slot.thumbnail === 'string' && slot.thumbnail.startsWith('data:image/png'),
    'el autoguardado no dejó miniatura: la tarjeta del slot seguiría con la trama vacía');
  assert.ok(slot.poblacion > 0, 'el autoguardado no dejó población en el índice');
});

test('al ocultarse la página el juego se guarda y el reloj se detiene', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA, ticks: 24 * 2 });
  await elegirVelocidad(page, 'x10');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const guardado = await indice(page);
  assert.ok(guardado.slots[0].day >= 2, `al ocultarse no se guardó (el índice sigue en el día ${guardado.slots[0].day})`);
  const detenido = await tickActual(page);
  await page.waitForTimeout(1200);
  assert.equal(await tickActual(page), detenido, 'con la página oculta el reloj siguió corriendo');
});

test('volver de una pestaña oculta no congela la página ni salta el tiempo', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA });
  await elegirVelocidad(page, 'x10');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(2500);
  const dormido = await tickActual(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(100);
  const alVolver = await tickActual(page);
  // El reloj se remarca al volver: los 2,5 s dormidos (60 ticks a x10) no se inyectan de golpe.
  assert.ok(alVolver - dormido <= 24, `al volver se inyectaron ${alVolver - dormido} ticks de una vez`);
  await page.waitForTimeout(1200);
  assert.ok(await tickActual(page) > alVolver, 'al volver el bucle no se reanudó: la página quedó congelada');
  await expect(page.locator('.hud-top')).toBeVisible();
});

test('la partida se reanuda en el mismo día tras recargar', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA });
  await elegirVelocidad(page, 'x10');
  await expect.poll(async () => (await indice(page)).slots[0].day, { timeout: 30000 }).toBeGreaterThan(0);
  const guardado = (await indice(page)).slots[0].day;
  await page.reload();
  await page.getByRole('button', { name: /^continuar/i }).first().click();
  await page.waitForFunction(() => window.__huehuet?.game);
  const dia = await diaActual(page);
  assert.ok(Math.abs(dia - guardado) <= 5, `se reanudó en el día ${dia} y se había guardado el ${guardado}`);
});

// --- La pantalla ---------------------------------------------------------------------------------

test('la página no hace scroll ni desborda, ni arrastrando hacia abajo', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA });
  await arrastrar(page, { desde: { x: 220, y: 300 }, hasta: { x: 220, y: 940 } });
  const v = await page.evaluate(() => ({
    y: window.scrollY,
    x: window.scrollX,
    ancho: document.documentElement.scrollWidth <= window.innerWidth,
    alto: document.documentElement.scrollHeight <= window.innerHeight + 1,
  }));
  assert.equal(v.y, 0, 'la página se desplazó en vertical');
  assert.equal(v.x, 0, 'la página se desplazó en horizontal');
  assert.equal(v.ancho, true, 'la página desborda a lo ancho');
  assert.equal(v.alto, true, 'la página desborda a lo alto');
});

test('en horizontal y en ventanas cortas el HUD no se superpone ni desborda', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA });
  for (const vp of [{ width: ALTO, height: ANCHO }, { width: ANCHO, height: 600 }]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(250);
    const arriba = await page.locator('.hud-top').boundingBox();
    const abajo = await page.locator('.hud-bottom').boundingBox();
    assert.ok(arriba.y + arriba.height < abajo.y, `HUD superpuesto en ${vp.width}x${vp.height}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1), true,
      `la página desborda a lo alto en ${vp.width}x${vp.height}`);
  }
});

// --- El gancho de instrumentación (T16-c) --------------------------------------------------------

test('sin ?pruebas el juego no publica su gancho de instrumentación', async ({ page }) => {
  // Sin iniciarPartida: ese ayudante ESPERA al gancho, y aquí lo que se afirma es que no está. Se entra a
  // mano, y la prueba de que se entró es el HUD, no el gancho.
  await page.addInitScript(() => {
    localStorage.setItem('huehuet.saves.v1', JSON.stringify({
      version: 1,
      slots: [{ id: 'sembrada', nombre: 'Sembrada', seed: 1, day: 0, poblacion: 0, era: 'Nómadas', settled: false, thumbnail: null, updatedAt: 1 }],
    }));
  });
  await page.goto(URL_SIN_PRUEBAS);
  await page.getByRole('button', { name: /^continuar/i }).first().click();
  // La partida tiene que estar corriendo igualmente: lo que no debe existir es el gancho.
  await expect(page.locator('.hud-bottom')).toBeVisible();
  assert.equal(await page.evaluate(() => window.__huehuet), undefined,
    'el gancho de pruebas sigue publicado en una página sin ?pruebas: sobreviviría a una release');
});

// --- El arco completo, jugando ------------------------------------------------------------------

test('la banda llega a asentarse jugando a x10 y la crónica lo cuenta', async ({ page }) => {
  test.setTimeout(180000);
  await iniciarPartida(page, { semilla: SEMILLA });
  await elegirVelocidad(page, 'x10');
  await expect(page.locator('.hud-era')).toHaveText(/aldea/i, { timeout: 120000 });
  await page.getByRole('button', { name: /^crónica$/i }).click();
  await expect(page.locator('.sheet.open')).toContainText(/levantará su aldea|asentarse/i);
});
