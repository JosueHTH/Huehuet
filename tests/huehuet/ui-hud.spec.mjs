// HUD, hojas deslizables y desglose de sitio (Task 15), en el navegador y a 440x956 px CSS con dpr 3.
//
// Nota sobre el tiempo: el bucle de requestAnimationFrame es de la Task 16. Aquí el tiempo se corre a mano,
// de forma explícita y determinista: `avanzarTicks` adelanta horas exactas con stepGame y `avanzarReloj`
// corre milisegundos de tiempo real A LA VELOCIDAD QUE EL HUD TENGA ELEGIDA. Lo segundo es lo que convierte
// «con la pausa el día no avanza» en una afirmación: la MISMA llamada, con otra velocidad, sí lo avanza.
// Un waitForTimeout(2000) habría pasado también con un juego que no corre el reloj jamás.
import assert from 'node:assert/strict';
import { test, URL, iniciarPartida, avanzarTicks, avanzarReloj, arrastrar, diaActual } from './helpers.mjs';


// --- Pulsar y mirar, sin esperar -----------------------------------------------------------------
// Playwright espera 30 s a un control que no existe y muere con «waiting for locator»: eso es una espera,
// no una prueba. Aquí se AFIRMA primero que el control está (con su mensaje), y solo después se pulsa.

async function pulsar(page, nombre) {
  const b = page.getByRole('button', { name: nombre });
  const n = await b.count();
  assert.equal(n, 1, `no hay exactamente un control «${nombre}» en la pantalla (hay ${n})`);
  await b.click();
}

async function caja(page, selector) {
  const loc = page.locator(selector);
  const n = await loc.count();
  assert.ok(n >= 1, `no existe «${selector}» en la pantalla`);
  return loc.first().boundingBox();
}

async function texto(page, selector) {
  const loc = page.locator(selector);
  assert.ok(await loc.count() >= 1, `no existe «${selector}» en la pantalla`);
  return loc.first().textContent();
}

const presionado = async (page, nombre) => {
  const b = page.getByRole('button', { name: nombre });
  assert.equal(await b.count(), 1, `no hay control «${nombre}»`);
  return b.getAttribute('aria-pressed');
};

const ANCHO = 440;
const ALTO = 956;
// La semilla 1 tiene 8 sitios candidatos a partir del tick 108 (medido con stepGame en Node, reproducible).
const SEMILLA_CON_SITIOS = 1;
const TICKS_HASTA_SITIOS = 108;

// --- La franja superior --------------------------------------------------------------------------

test('la franja superior muestra día, estación y población', async ({ page }) => {
  await iniciarPartida(page);
  const franja = await texto(page, '.hud-top');
  assert.match(franja, /Día/i, 'la franja superior no dice el día');
  assert.match(franja, /primavera|verano|otoño|invierno/i, 'la franja superior no dice la estación');
  assert.match(franja, /\d+ habitantes/i, 'la franja superior no dice la población');
});

test('la franja superior dice el día y la población de la simulación, no un adorno fijo', async ({ page }) => {
  await iniciarPartida(page);
  assert.equal(await texto(page, '.hud-dia'), 'Día 0');
  await avanzarTicks(page, 24 * 7);
  const verdad = await page.evaluate(async () => {
    const { livingNpcs } = await import('/src/tribe/band.js');
    const g = window.__huehuet.game;
    return { dia: g.clock.day, estacion: g.clock.season, vivos: livingNpcs(g.band).length };
  });
  assert.equal(verdad.dia, 7, 'la simulación debería estar en el día 7');
  assert.equal(await texto(page, '.hud-dia'), `Día ${verdad.dia}`);
  assert.equal(await texto(page, '.hud-estacion'), verdad.estacion);
  assert.equal(await texto(page, '.hud-poblacion'), `${verdad.vivos} habitantes`);
});

// --- Velocidad y pausa ---------------------------------------------------------------------------

test('los controles de velocidad cambian la velocidad activa', async ({ page }) => {
  await iniciarPartida(page);
  await pulsar(page, /^x10$/);
  assert.equal(await presionado(page, /^x10$/), 'true', 'x10 no quedó marcada como la velocidad activa');
  assert.equal(await presionado(page, /^x1$/), 'false', 'x1 sigue marcada a la vez que x10');
  await pulsar(page, /pausa/i);
  assert.equal(await presionado(page, /pausa/i), 'true', 'la pausa no quedó marcada');
  assert.equal(await presionado(page, /^x10$/), 'false', 'x10 sigue marcada con la pausa activa');
});

test('la velocidad elegida es la que corre el reloj, y con la pausa no corre', async ({ page }) => {
  await iniciarPartida(page);
  // x1: 400 ms de tiempo real son un tick; 4800 ms son 12 ticks, medio día.
  await pulsar(page, /^x1$/);
  await avanzarReloj(page, 4800);
  const aX1 = await page.evaluate(() => window.__huehuet.game.clock.tick);
  assert.equal(aX1, 12, `a x1, 4800 ms deberían ser 12 horas, no ${aX1}`);

  // x10 corre más que x1 con el mismo tiempo real (el reloj acota a 24 ticks por llamada).
  await pulsar(page, /^x10$/);
  await avanzarReloj(page, 4800);
  const aX10 = await page.evaluate(() => window.__huehuet.game.clock.tick);
  assert.ok(aX10 - aX1 > 12, `x10 debería correr más que x1 (corrió ${aX10 - aX1} horas)`);

  // Y con la pausa, el mismo tiempo real no mueve nada: ni el reloj ni lo que pinta el HUD.
  await pulsar(page, /pausa/i);
  const franja = await texto(page, '.hud-top');
  await avanzarReloj(page, 4800);
  assert.equal(await page.evaluate(() => window.__huehuet.game.clock.tick), aX10, 'la pausa no detuvo el reloj');
  assert.equal(await texto(page, '.hud-top'), franja, 'la franja cambió con la pausa activa');
});

// --- Las hojas -----------------------------------------------------------------------------------

test('cada botón abre su hoja y la hoja se cierra', async ({ page }) => {
  await iniciarPartida(page);
  for (const nombre of [/^banda$/i, /^crónica$/i, /^mundo$/i]) {
    await pulsar(page, nombre);
    assert.equal(await page.locator('.sheet.open').count(), 1, `«${nombre}» no abrió ninguna hoja`);
    assert.ok(await page.locator('.sheet.open').isVisible(), `la hoja de «${nombre}» no se ve`);
    await pulsar(page, /cerrar/i);
    assert.equal(await page.locator('.sheet.open').count(), 0, `la hoja de «${nombre}» no se cerró`);
  }
});

test('la hoja de la banda lista a los NPCs con sus necesidades', async ({ page }) => {
  await iniciarPartida(page);
  await pulsar(page, /^banda$/i);
  const filas = await page.locator('.npc-row').count();
  assert.ok(filas > 0, 'la hoja de la banda no lista a nadie');
  assert.match(await texto(page, '.sheet.open'), /hambre/i, 'la hoja de la banda no dice las necesidades');
  const vivos = await page.evaluate(async () => {
    const { livingNpcs } = await import('/src/tribe/band.js');
    return livingNpcs(window.__huehuet.game.band).length;
  });
  assert.equal(filas, vivos, `${filas} fichas para ${vivos} vivos`);
});

test('el inventario de la banda se redondea: nada de 3.7000000000000002', async ({ page }) => {
  // Se corre medio mes para que la banda haya recogido cantidades fraccionarias de verdad.
  await iniciarPartida(page, { semilla: SEMILLA_CON_SITIOS, ticks: 24 * 15 });
  await pulsar(page, /^banda$/i);
  const inv = page.locator('.inventario');
  const pintado = await texto(page, '.inventario');
  const crudo = await page.evaluate(() => window.__huehuet.game.band.inventory);
  const fraccionario = Object.entries(crudo).find(([, v]) => v > 0 && Math.abs(v - Math.round(v)) > 1e-9);
  assert.ok(fraccionario, `el inventario no tiene cantidades fraccionarias que redondear: ${JSON.stringify(crudo)}`);
  assert.doesNotMatch(pintado, /\d\.\d\d+/, `el inventario muestra decimales sin redondear: ${pintado}`);
  // Y lo que muestra es el valor redondeado a un decimal, no un cero de relleno.
  const [id, valor] = fraccionario;
  const esperado = String(Math.round(valor * 10) / 10);
  const celda = inv.locator(`[data-recurso="${id}"] .inv-valor`);
  assert.equal(await celda.count(), 1, `no hay fila de inventario para ${id}`);
  assert.equal(await celda.textContent(), esperado, `la fila de ${id} no muestra ${esperado}`);
});

test('la hoja engancha al 45% y al 90% de la altura', async ({ page }) => {
  await iniciarPartida(page);
  await pulsar(page, /^crónica$/i);
  const hoja = page.locator('.sheet.open');
  const medio = await caja(page, '.sheet.open');
  // Abre al 45%: lo visible es el 45% del alto de la pantalla, con holgura de un par de px.
  assert.ok(Math.abs((ALTO - medio.y) - ALTO * 0.45) < 4,
    `al abrir se ve ${ALTO - medio.y} px, no el 45% (${ALTO * 0.45})`);

  // Un dedo que sube desde el asa la lleva al 90%.
  const asa = await caja(page, '.sheet.open .sheet-grab');
  await arrastrar(page, { desde: { x: ANCHO / 2, y: asa.y + asa.height / 2 }, hasta: { x: ANCHO / 2, y: asa.y + asa.height / 2 - 320 } });
  const alto = await caja(page, '.sheet.open');
  assert.ok(Math.abs((ALTO - alto.y) - ALTO * 0.9) < 4,
    `tras subirla se ve ${ALTO - alto.y} px, no el 90% (${ALTO * 0.9})`);

  // Y bajando vuelve al 45%, no se queda donde el dedo la dejó.
  const asa2 = await caja(page, '.sheet.open .sheet-grab');
  await arrastrar(page, { desde: { x: ANCHO / 2, y: asa2.y + asa2.height / 2 }, hasta: { x: ANCHO / 2, y: asa2.y + asa2.height / 2 + 250 } });
  const medio2 = await caja(page, '.sheet.open');
  assert.ok(Math.abs((ALTO - medio2.y) - ALTO * 0.45) < 4,
    `tras bajarla se ve ${ALTO - medio2.y} px, no el 45% (${ALTO * 0.45})`);
});

test('arrastrar la hoja hacia abajo la cierra', async ({ page }) => {
  await iniciarPartida(page);
  await pulsar(page, /^crónica$/i);
  assert.equal(await page.locator('.sheet.open').count(), 1, 'la hoja de la crónica no se abrió');
  const asa = await caja(page, '.sheet.open .sheet-grab');
  await arrastrar(page, { desde: { x: ANCHO / 2, y: asa.y + asa.height / 2 }, hasta: { x: ANCHO / 2, y: asa.y + asa.height / 2 + 420 } });
  assert.equal(await page.locator('.sheet.open').count(), 0, 'bajar la hoja con el dedo no la cerró');
});

// --- El desglose de sitio: la pantalla que hace legible el sistema -------------------------------

test('el desglose de un sitio muestra todos los factores y el umbral', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA_CON_SITIOS, ticks: TICKS_HASTA_SITIOS });
  await pulsar(page, /^mundo$/i);
  assert.ok(await page.locator('.candidate').count() > 0, 'la hoja de Mundo no lista ningún sitio candidato');
  await page.locator('.candidate').first().click();
  const hoja = await texto(page, '.sheet.open');
  assert.match(hoja, /agua/i, 'el desglose no nombra el agua');
  assert.match(hoja, /caza/i, 'el desglose no nombra la caza');
  assert.match(hoja, /hacen falta|umbral/i, 'el desglose no dice cuántos puntos hacen falta');
  assert.equal(await page.locator('.sheet.open .factor-row').count(), 9, 'el desglose no tiene los nueve factores');
});

test('cada columna del desglose dice la verdad de la puntuación', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA_CON_SITIOS, ticks: TICKS_HASTA_SITIOS });
  await pulsar(page, /^mundo$/i);
  assert.ok(await page.locator('.candidate').count() > 0, 'la hoja de Mundo no lista ningún sitio candidato');
  await page.locator('.candidate').first().click();
  assert.equal(await page.locator('.site-breakdown').count(), 1, 'pulsar un candidato no abrió su desglose');

  const pintado = await page.locator('.sheet.open .factor-row').evaluateAll((filas) => filas.map((f) => ({
    id: f.dataset.factor,
    valor: f.querySelector('.factor-valor').textContent,
    peso: f.querySelector('.factor-peso').textContent,
    aporta: f.querySelector('.factor-aporta').textContent,
  })));
  // La verdad se recalcula aparte, desde el modelo, para el sitio que la hoja dice estar explicando.
  const verdad = await page.evaluate(async () => {
    const { scoreSite } = await import('/src/tribe/sitescore.js');
    const el = document.querySelector('.site-breakdown');
    const g = window.__huehuet.game;
    const s = scoreSite(g.discovery, Number(el.dataset.x), Number(el.dataset.y), { season: g.clock.season });
    return { total: s.total, factores: s.factors };
  });

  assert.equal(pintado.length, 9);
  for (const [i, f] of verdad.factores.entries()) {
    const fila = pintado[i];
    assert.equal(fila.id, f.id, `la fila ${i} no es ${f.id}`);
    assert.equal(fila.valor, `${Math.round(f.value * 100)}%`,
      `el valor de ${f.id} debería ser ${Math.round(f.value * 100)}% y pone ${fila.valor}`);
    assert.equal(fila.peso, String(Math.round(f.effectiveWeight * 10) / 10),
      `el peso de ${f.id} debería ser ${f.effectiveWeight} y pone ${fila.peso}`);
    const aporta = Math.round(f.contribution * 10) / 10;
    assert.equal(fila.aporta, `${aporta > 0 ? '+' : ''}${aporta}`,
      `la aportación de ${f.id} debería ser ${aporta} y pone ${fila.aporta}`);
  }
  // Lo que suma y lo que resta, en la cabecera: las dos penalizaciones son las dos últimas filas y el
  // jugador no las ve sin desplazarse. Una captura mostró que sin esta línea no sabe que existen.
  const positivo = verdad.factores.reduce((a, f) => a + Math.max(0, f.contribution), 0);
  const negativo = -verdad.factores.reduce((a, f) => a + Math.min(0, f.contribution), 0);
  assert.equal(await texto(page, '.site-suma'), String(Math.round(positivo * 10) / 10), 'el balance no dice lo que suma');
  assert.equal(await texto(page, '.site-resta'), String(Math.round(negativo * 10) / 10), 'el balance no dice lo que resta');
  assert.ok(negativo > 0, 'este sitio no tiene penalizaciones que mostrar: la prueba no afirma nada');

  // El total pintado es la suma de lo pintado: si una columna miente, el jugador puede verlo.
  const suma = pintado.reduce((a, f) => a + Number(f.aporta), 0);
  assert.ok(Math.abs(suma - verdad.total) < 0.6, `las aportaciones suman ${suma.toFixed(1)} y el total es ${verdad.total.toFixed(1)}`);
  assert.equal(await texto(page, '.site-total'), String(Math.round(verdad.total)), 'el total pintado no es el del modelo');
});

// En primavera ningún factor cambia de peso con la estación, así que la columna «peso» no puede distinguir
// ahí el peso de catálogo del efectivo. Se pide el mismo sitio en invierno, donde la leña pesa 1,5 veces más:
// es la única forma de que una columna que mintiera (pintando f.weight) muera.
test('el peso que muestra el desglose es el de la estación, no el del catálogo', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA_CON_SITIOS, ticks: TICKS_HASTA_SITIOS });
  const r = await page.evaluate(async () => {
    const { scoreSite, SITE_FACTORS, candidateSites } = await import('/src/tribe/sitescore.js');
    const { renderSiteBreakdown, decisionDeSitio } = await import('/src/ui/panels.js');
    const g = window.__huehuet.game;
    const [mejor] = candidateSites(g.discovery, { season: g.clock.season });
    const s = scoreSite(g.discovery, mejor.x, mejor.y, { season: 'invierno' });
    const fila = renderSiteBreakdown(s, decisionDeSitio(g, s)).querySelector('[data-factor="leña"]');
    return {
      pintado: fila.querySelector('.factor-peso').textContent,
      catalogo: SITE_FACTORS.find((f) => f.id === 'leña').weight,
      efectivo: s.factors.find((f) => f.id === 'leña').effectiveWeight,
    };
  });
  assert.notEqual(r.efectivo, r.catalogo, 'en invierno la leña debería pesar más que en el catálogo');
  assert.equal(r.pintado, String(Math.round(r.efectivo * 10) / 10),
    `el desglose pinta ${r.pintado} y el peso de invierno es ${r.efectivo}`);
});

test('el desglose nombra el umbral vigente y el motivo de la decisión', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA_CON_SITIOS, ticks: TICKS_HASTA_SITIOS });
  await pulsar(page, /^mundo$/i);
  assert.ok(await page.locator('.candidate').count() > 0, 'la hoja de Mundo no lista ningún sitio candidato');
  await page.locator('.candidate').first().click();

  const verdad = await page.evaluate(async () => {
    const { acceptanceThreshold } = await import('/src/tribe/sitescore.js');
    const { bandPressure } = await import('/src/tribe/band.js');
    const g = window.__huehuet.game;
    const presion = bandPressure(g.band, { season: g.clock.season });
    return { umbral: acceptanceThreshold(presion), presion, motivo: g.lastDecision?.reason ?? null };
  });
  assert.ok(verdad.motivo, 'la partida debería tener una decisión con motivo a estas alturas');
  // El umbral no es la constante de calma: se mueve con la presión y lo pintado tiene que moverse con él.
  assert.equal(await texto(page, '.site-umbral'), String(Math.round(verdad.umbral)), 'el umbral pintado no es el vigente');
  assert.match(await texto(page, '.site-presion'), new RegExp(`\\b${Math.round(verdad.presion * 100)}\\b`), 'el desglose no dice el apremio real');
  assert.equal(await texto(page, '.site-motivo'), verdad.motivo, 'el desglose no cita el motivo de la banda');
  // Y lo fecha: la última decisión puede ser de hace días y hablar de otro sitio. Sin el día, leída junto a
  // un sitio de 71 puntos, «aún no conocen ningún lugar» parece una mentira de la interfaz.
  const dicho = await page.evaluate(() => Math.floor((window.__huehuet.game.band.lastEvaluation ?? 0) / 24));
  assert.match(await texto(page, '.site-ultima .sheet-sub'), new RegExp(`día ${dicho}\\b`),
    `el desglose no fecha el motivo en el día ${dicho}`);
});

// --- Geometría en el teléfono --------------------------------------------------------------------

test('la hoja abierta deja el contenido por encima de la barra de gestos', async ({ page }) => {
  await iniciarPartida(page);
  await pulsar(page, /^crónica$/i);
  const box = await caja(page, '.sheet.open .sheet-body');
  assert.ok(box.y + box.height <= ALTO - 20, `el contenido invade la barra de gestos: acaba en ${box.y + box.height}`);
});

test('todos los controles del HUD miden 44 px o más y caen en el área segura', async ({ page }) => {
  await iniciarPartida(page);
  const controles = await page.locator('.hud-bottom button').all();
  assert.ok(controles.length >= 7, `el HUD inferior tiene ${controles.length} controles`);
  for (const b of controles) {
    const box = await b.boundingBox();
    assert.ok(box.height >= 44 && box.width >= 44, `control de ${box.width}x${box.height}`);
    assert.ok(box.y + box.height <= ALTO - 20, 'control bajo la barra de gestos');
    assert.ok(box.x >= 0 && box.x + box.width <= ANCHO, `control fuera del ancho: ${box.x}..${box.x + box.width}`);
  }
  const arriba = await caja(page, '.hud-top .hud-linea');
  assert.ok(arriba.y >= 54, `el texto de la franja superior a ${arriba.y} px, bajo la Dynamic Island`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false,
    'el HUD desborda a los lados');
});

test('el HUD y las hojas ceden ante un inset de área segura mayor que el suelo', async ({ page }) => {
  await iniciarPartida(page);
  const cdp = await page.context().newCDPSession(page);
  const arriba = await caja(page, '.hud-top .hud-linea');
  assert.ok(arriba.y >= 54, `con inset 0 la franja debería apoyarse en el suelo de 54 px, y está en ${arriba.y}`);

  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 100, bottom: 60 } });
  const conInset = await caja(page, '.hud-top .hud-linea');
  assert.equal(conInset.y - arriba.y, 100 - 54,
    `la franja no cedió el inset real: bajó ${conInset.y - arriba.y} px en vez de ${100 - 54}. --safe-top no es un max(env, 54px).`);

  await pulsar(page, /^crónica$/i);
  const cuerpo = await caja(page, '.sheet.open .sheet-body');
  assert.ok(cuerpo.y + cuerpo.height <= ALTO - 60, `la hoja invade la barra de gestos real: acaba en ${cuerpo.y + cuerpo.height}`);
  const botones = page.locator('.hud-bottom button');
  assert.ok(await botones.count() > 0, 'el HUD inferior no tiene controles');
  const ultimo = await botones.last().boundingBox();
  assert.ok(ultimo.y + ultimo.height <= ALTO - 60, `un control del HUD queda bajo la barra real: acaba en ${ultimo.y + ultimo.height}`);
  await cdp.detach();
});

// --- Capas ---------------------------------------------------------------------------------------

test('la capa de recursos se activa y desactiva', async ({ page }) => {
  await iniciarPartida(page);
  await pulsar(page, /^mundo$/i);
  assert.equal(await presionado(page, /^caza$/i), 'false', 'la capa de caza empieza encendida');
  await pulsar(page, /^caza$/i);
  assert.equal(await presionado(page, /^caza$/i), 'true', 'la capa de caza no se encendió');
  assert.equal(await page.evaluate(() => window.__huehuet.layers.resources), 'caza',
    'el conmutador no llegó a la capa que pinta el renderer');
  await pulsar(page, /^caza$/i);
  assert.equal(await presionado(page, /^caza$/i), 'false', 'la capa de caza no se apagó');
  assert.equal(await page.evaluate(() => window.__huehuet.layers.resources), null);
});

test('guardar desde la hoja de Mundo escribe la partida en el slot', async ({ page }) => {
  await iniciarPartida(page, { semilla: SEMILLA_CON_SITIOS, ticks: 48 });
  await pulsar(page, /^mundo$/i);
  await pulsar(page, /guardar/i);
  assert.match(await texto(page, '.world-aviso'), /guardad/i, 'guardar no dijo nada al jugador');
  const guardado = await page.evaluate(() => localStorage.getItem('huehuet.save.sembrada'));
  assert.ok(guardado, 'no se escribió la clave de la partida');
  const dia = await page.evaluate(() => JSON.parse(localStorage.getItem('huehuet.saves.v1')).slots[0].day);
  assert.equal(dia, await diaActual(page), 'el índice no quedó con el día de la partida guardada');
});
