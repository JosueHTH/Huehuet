import assert from 'node:assert/strict';
import { test, expect, URL, diaActual, estadoCamara } from './helpers.mjs';

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
    if (box) {
      assert.ok(box.height >= 44 && box.width >= 44, `botón de ${box.width}x${box.height}`);
      assert.ok(box.x >= 0 && box.x + box.width <= 440, 'botón dentro del ancho de 440 px');
    }
  }
  const desborda = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(desborda, false, 'la página no desborda a los lados');
});

test('la pantalla de slots respeta las áreas seguras del iPhone 17 Pro Max', async ({ page }) => {
  await page.goto(URL);
  const top = await page.locator('.slots-header').boundingBox();
  assert.ok(top.y >= 54, `cabecera a ${top.y} px, bajo la Dynamic Island`);
  // Chromium declara 0 en env(safe-area-inset-*): este es el suelo de 54 px. En el teléfono manda env() (~59 px).
  const pie = await page.locator('.slots-footer .btn').boundingBox();
  assert.ok(pie.y + pie.height <= 956 - 34, 'el botón principal queda sobre la barra de gestos');
});

// --- Más allá de las cuatro del encargo ---

// Siembra el almacén antes de que la página arranque: así se prueban los estados que la interfaz no crea sola.
async function sembrar(page, slots, partidas = {}) {
  await page.addInitScript(({ slots, partidas }) => {
    if (localStorage.getItem('huehuet.saves.v1')) return;
    localStorage.setItem('huehuet.saves.v1', JSON.stringify({ version: 1, slots }));
    for (const [id, texto] of Object.entries(partidas)) localStorage.setItem(`huehuet.save.${id}`, texto);
  }, { slots, partidas });
}
const slotBase = { seed: 5, day: 12, poblacion: 7, era: 'Aldea', settled: true, thumbnail: null, updatedAt: 1 };

test('un slot dañado avisa y solo ofrece Borrar', async ({ page }) => {
  await sembrar(page, [{ ...slotBase, id: 'a', nombre: 'Rota', damaged: true }]);
  await page.goto(URL);
  const slot = page.locator('.slot');
  await expect(slot.getByText(/dañada/i)).toBeVisible();
  await expect(slot.getByRole('button')).toHaveCount(1);
  await expect(slot.getByRole('button', { name: /borrar/i })).toBeVisible();
  await expect(slot.getByRole('button', { name: /continuar/i })).toHaveCount(0);
});

test('un slot muestra nombre, día, era y población', async ({ page }) => {
  await sembrar(page, [{ ...slotBase, id: 'a', nombre: 'Valle Alto' }]);
  await page.goto(URL);
  await expect(page.locator('.slot-nombre')).toHaveText('Valle Alto');
  await expect(page.locator('.slot-datos')).toHaveText('Día 12 · Aldea · 7 habitantes');
});

test('renombrar cambia el nombre y persiste', async ({ page }) => {
  await page.goto(URL);
  await page.getByRole('button', { name: /nueva partida/i }).click();
  await page.getByRole('button', { name: /renombrar/i }).click();
  await page.getByRole('textbox').fill('Colinas');
  await page.getByRole('button', { name: /guardar/i }).click();
  await page.reload();
  await expect(page.locator('.slot-nombre')).toHaveText('Colinas');
});

test('Nueva partida se queda en la pantalla y no entra en el juego', async ({ page }) => {
  await page.goto(URL);
  await page.getByRole('button', { name: /nueva partida/i }).click();
  await expect(page.locator('.slots-screen')).toBeVisible();
  assert.equal(await page.evaluate(() => window.__huehuet), undefined);
});

test('Continuar entra en la partida y oculta la pantalla de slots', async ({ page }) => {
  await page.goto(URL);
  await page.getByRole('button', { name: /nueva partida/i }).click();
  await page.getByRole('button', { name: /^continuar/i }).first().click();
  // Lo que se afirma es el producto, no el gancho de instrumentación: Continuar no da error, la pantalla se
  // va y el lienzo tiene mundo pintado. Esperar a window.__huehuet era esperar, no afirmar: si entrar() no
  // llegaba a correr la prueba se quedaba sin reloj en vez de decir qué falló.
  const visto = await page.evaluate(() => {
    const lienzo = document.getElementById('mundo');
    const d = lienzo.getContext('2d').getImageData(0, 0, lienzo.width, lienzo.height).data;
    const colores = new Set();
    for (let i = 0; i < d.length; i += 4 * 997) colores.add(`${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]}`);
    return {
      oculta: document.querySelector('.slots-screen').hidden,
      error: document.querySelector('.slot .aviso')?.textContent ?? null,
      colores: colores.size,
      ancho: lienzo.width,
    };
  });
  assert.equal(visto.error, null, 'Continuar no pudo abrir la partida');
  assert.equal(visto.oculta, true, 'la pantalla de slots sigue a la vista tras Continuar');
  assert.ok(visto.ancho > 0, `el lienzo no se dimensionó (ancho ${visto.ancho})`);
  assert.ok(visto.colores > 1, `el lienzo quedó de un solo color: no se pintó el mundo`);

  assert.equal(await diaActual(page), 0);
  const cam = await estadoCamara(page);
  assert.ok(cam.zoom >= 1 && Number.isFinite(cam.x), 'la cámara existe');
});

test('con el almacenamiento bloqueado avisa y deja jugar igualmente', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new Error('bloqueado'); };
  });
  await page.goto(URL);
  await expect(page.getByText(/no se puede guardar/i)).toBeVisible();
  await page.getByRole('button', { name: /nueva partida/i }).click();
  await page.getByRole('button', { name: /^continuar/i }).click();
  // Igual que en la prueba de Continuar: se afirma que se entró en el juego, no que exista el global.
  assert.equal(await page.evaluate(() => document.querySelector('.slots-screen').hidden), true,
    'con el almacenamiento bloqueado Continuar no entró en la partida');
});

test('mientras se está en la pantalla se calienta la memoria de lineaBase, no en el primer fotograma', async ({ page }) => {
  // Retiene las tareas ociosas: hasta que el test las suelte, el calentado no puede haber corrido.
  await page.addInitScript(() => {
    window.__ociosas = [];
    window.requestIdleCallback = (f) => window.__ociosas.push(f);
    window.cancelIdleCallback = () => {};
  });
  await sembrar(page, [{ ...slotBase, id: 'a', nombre: 'Uno', seed: 11, updatedAt: 2 }, { ...slotBase, id: 'b', nombre: 'Dos', seed: 12, updatedAt: 1 }]);
  await page.goto(URL);
  await expect(page.locator('.slot')).toHaveCount(2);
  const tamano = () => page.evaluate(async () => (await import('/src/save/schema.js')).lineaBase.tamano());
  assert.equal(await tamano(), 0, 'nada se serializa ni se calienta en el primer fotograma');
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__ociosas.shift()?.());
  assert.equal(await tamano(), 2, 'tras el tiempo libre, los dos slots están en memoria');
});

// --- R2: la ficha no miente ----------------------------------------------------------------------
// Lo que estas pruebas de contenido afirman no es el FORMATEO, sino la PROCEDENCIA: lo pintado se compara
// contra la simulación de la misma semilla, no contra una constante sembrada.

test('un slot recién creado no miente sobre su población', async ({ page }) => {
  await page.goto(URL);
  await page.getByRole('button', { name: /nueva partida/i }).click();
  const datos = await page.locator('.slot-datos').textContent();
  const vivos = await page.evaluate(async () => {
    const { createGame } = await import('/src/game.js');
    const { livingNpcs } = await import('/src/tribe/band.js');
    const { createStore } = await import('/src/save/store.js');
    return livingNpcs(createGame(createStore().listSlots()[0].seed).band).length;
  });
  assert.ok(vivos > 0, 'la banda de esa semilla tiene gente viva');
  assert.ok(!/\b0 habitantes\b/.test(datos),
    `la ficha dice 0 habitantes pero la banda tiene ${vivos}`);
  assert.equal(datos, 'Sin comenzar', 'la ficha no inventa cifras de una partida que no existe');
});

// --- R3: la miniatura vacía se ve vacía ----------------------------------------------------------

test('la miniatura de un slot sin mapa no se confunde con un mapa todo gris', async ({ page }) => {
  await page.goto(URL);
  await page.getByRole('button', { name: /nueva partida/i }).click();
  const vacia = page.locator('.slot-thumb-vacia');
  await expect(vacia).toHaveCount(1);
  const e = await vacia.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      imagen: cs.backgroundImage,
      fondo: cs.backgroundColor,
      borde: cs.borderTopStyle,
      ancho: el.getBoundingClientRect().width,
    };
  });
  assert.equal(e.ancho, 96, 'ocupa el mismo hueco que una miniatura real');
  assert.notEqual(e.imagen, 'none', 'tiene una trama propia, no es un color plano');
  assert.notEqual(e.fondo, 'rgb(42, 42, 42)', 'no reusa el gris de relleno de .slot-thumb');
  assert.equal(e.borde, 'dashed', 'el borde discontinuo dice «aún no hay mapa»');
});

// --- R5: las cinco propiedades que sólo importan en el teléfono ----------------------------------
// Sin touch-action el lienzo recupera el scroll y el zoom nativos y el juego es injugable al primer arrastre;
// sin viewport-fit=cover, env(safe-area-inset-*) vale 0 en el dispositivo y todo el trabajo de áreas seguras
// queda inerte; 100vh en vez de 100dvh es justo el bug que dvh existe para evitar.

test('las propiedades que sólo importan en el teléfono están puestas', async ({ page }) => {
  await page.goto(URL);
  const m = await page.evaluate(async () => {
    const cs = (sel, p) => getComputedStyle(document.querySelector(sel)).getPropertyValue(p);
    // Dos de las cinco no se ven en el estilo calculado: Chromium resuelve dvh y vh al mismo px porque en
    // headless no hay barra que se retraiga, y alias -webkit-user-select a user-select. De esas dos, lo
    // observable es la declaración que el navegador sí parseó, que el CSSOM sí distingue.
    const regla = (sel) => [...document.styleSheets].flatMap((h) => [...h.cssRules])
      .find((r) => r.selectorText === sel)?.style;
    const cuerpo = regla('html, body');
    return {
      touch: cs('#mundo', 'touch-action'),
      overscroll: cs('body', 'overscroll-behavior-y'),
      select: cs('body', '-webkit-user-select'),
      // -webkit-user-select no es observable de ninguna otra forma: Chromium lo alias a user-select en el
      // estilo calculado Y en el CSSOM, y lo borra del cssText serializado. Lo que importa es que el byte que
      // llega a iOS Safari lleve el prefijo, así que se mira la hoja tal como se sirve.
      hoja: await fetch(document.querySelector('link[rel=stylesheet]').href).then((r) => r.text()),
      altoDeclarado: cuerpo?.height,
      meta: document.querySelector('meta[name=viewport]').content,
      alto: document.documentElement.clientHeight,
    };
  });
  assert.equal(m.touch, 'none', 'sin touch-action el teléfono devuelve el scroll y el zoom nativos al lienzo');
  assert.equal(m.overscroll, 'none');
  assert.equal(m.select, 'none');
  assert.match(m.hoja, /-webkit-user-select:\s*none/, 'iOS Safari necesita la forma -webkit-');
  assert.match(m.meta, /viewport-fit=cover/, 'sin \u00e9l env(safe-area-inset-*) vale 0 en el dispositivo real');
  assert.equal(m.altoDeclarado, '100dvh', '100vh deja un hueco bajo la barra del navegador en el teléfono');
  assert.equal(m.alto, 956, 'el alto declarado ocupa el viewport completo');
});

// --- R6: el suelo de área segura es un suelo, no una constante ----------------------------------
// El `max(env(...), 54px)` existe porque Chromium declara 0 en env(safe-area-inset-*) y la cabecera se metería
// bajo la Dynamic Island. Pero tiene que ser un SUELO: en el teléfono manda el inset real (~59 px), y en un
// dispositivo con más muesca, más. Un 54px fijo pasaría las pruebas de geometría y recortaría el teléfono.
// Nota: el gateo (hover:none)+(pointer:coarse) se deja como está a propósito (diferido, ver T14/R6).

test('el suelo de área segura cede ante un inset real mayor', async ({ page }) => {
  await page.goto(URL);
  const cdp = await page.context().newCDPSession(page);
  const cabecera = () => page.locator('.slots-header').boundingBox();

  // Sin inset (lo que declara Chromium) actúa el suelo.
  assert.equal((await cabecera()).y, 54, 'con inset 0 la cabecera se apoya en el suelo de 54 px');

  // Con un inset real mayor que el suelo, manda el inset: el suelo queda inerte.
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 100, bottom: 60 } });
  const conInset = await cabecera();
  assert.notEqual(conInset.y, 54, 'la cabecera se quedó clavada en el suelo: --safe-top no es un max(env, ...)');
  assert.equal(conInset.y, 100, 'la cabecera baja hasta el inset real del dispositivo');

  const pie = await page.locator('.slots-footer .btn').boundingBox();
  assert.ok(pie.y + pie.height <= 956 - 60, 'el botón principal queda sobre la barra de gestos real');
  await cdp.detach();
});
