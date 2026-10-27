import assert from 'node:assert/strict';
import { test, expect, URL, iniciarPartida, diaActual, estadoCamara } from './helpers.mjs';

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
  await iniciarPartida(page);
  await expect(page.locator('.slots-screen')).toBeHidden();
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
  await page.waitForFunction(() => window.__huehuet?.game);
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

// El tamaño real de un iPhone 17 Pro Max en CSS px: la configuración del encargo (1320x2868) es su resolución
// de dispositivo, y a ese ancho una columna pensada para el pulgar se ve diminuta. Aquí se comprueba el real.
test.describe('a 440x956 CSS px, el tamaño real del teléfono', () => {
  test.use({ viewport: { width: 440, height: 956 } });

  test('cabecera bajo la Isla, botones de 44 px y sin desbordar a los lados', async ({ page }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: /nueva partida/i }).click();
    await page.getByRole('button', { name: /nueva partida/i }).click();
    const top = await page.locator('.slots-header').boundingBox();
    assert.ok(top.y >= 54, `cabecera a ${top.y} px`);
    for (const b of await page.getByRole('button').all()) {
      const box = await b.boundingBox();
      assert.ok(box.height >= 44 && box.width >= 44, `botón de ${box.width}x${box.height}`);
      assert.ok(box.x >= 0 && box.x + box.width <= 440, 'botón dentro del ancho');
    }
    const desborda = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(desborda, false);
    const pie = await page.locator('.slots-footer .btn').boundingBox();
    assert.ok(pie.y + pie.height <= 956 - 34, 'el botón principal queda sobre la barra de gestos');
  });
});
