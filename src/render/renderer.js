// El renderer dibuja el mundo tal como la banda lo conoce. Todo lo que decide el aspecto de una celda sale de
// discovery.knownCell: lo no descubierto es un gris uniforme y no se mira nada más de ello.
// La cámara aporta el tamaño del mundo (worldW/worldH), de modo que aquí no se necesita la rejilla.
import { candidateSites } from '../tribe/sitescore.js';
import { RESOURCES } from '../world/resources.js';
import { MS_POR_TICK } from '../game.js';
import { UNKNOWN_COLOR, RESOURCE_TINTS, cellColor, drawNpc, drawBuilding } from './sprites.js';

// Resolución del lienzo de terreno: fija, 8 px por celda. Se estira al componerlo (a zoom 4 una celda mide
// 64 px CSS, unos 192 px de dispositivo a dpr 3), de modo que el terreno cuesta lo mismo con cualquier dpr.
export const TERRAIN_CELL_PX = 8;
const ALFA_MAX_TINTE = 0.75;

function lienzoNuevo(canvas) {
  const doc = canvas.ownerDocument ?? globalThis.document;
  return doc.createElement('canvas');
}

// Hay que llamar a resize(cssW, cssH, dpr) antes del primer draw: hasta entonces cssW/cssH son las dimensiones
// en píxeles de dispositivo del lienzo, no las CSS.
export function createRenderer(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  const crear = opts.createCanvas ?? (() => lienzoNuevo(canvas));
  const ahora = opts.now ?? (() => globalThis.performance.now());

  let cssW = canvas.width, cssH = canvas.height, dpr = 1;
  let terreno = null, terrenoCtx = null, terrenoClave = null, terrenoDiscovery = null, sucio = true;
  let candidatos = { clave: null, sitios: [] };
  const caminantes = new Map();   // id -> { de, a, tick, desde } para interpolar entre ticks
  // Cuánto dura un tick de RELOJ REAL, medido. No es MS_POR_TICK salvo a velocidad x1: a x10 un tick dura
  // 40 ms, y interpolar sobre 400 hacía avanzar lo dibujado un 10% de lo que avanza la simulación. El
  // retraso se acumulaba hasta estabilizarse en 10 celdas (medido), que a zoom 2 son 320 px: el NPC que el
  // jugador toca no estaba donde lo veía. El renderer no conoce la velocidad del HUD y no tiene por qué:
  // la deduce del tiempo entre cambios de tick, que es justo lo que necesita.
  let ventana = MS_POR_TICK;
  let medida = false;           // la ventana ya se midió al menos una vez
  let tickVisto = null;
  let tiempoDelTick = 0;

  function claveTerreno(game, capa, cam) {
    // Las cantidades se reponen cada día: con una capa de recursos activa el terreno caduca con el día.
    return `${game.discovery.size}|${cam.worldW}x${cam.worldH}|${capa ?? ''}|${capa ? game.clock.day : ''}`;
  }

  function pintarTerreno(game, cam, capa) {
    const { worldW, worldH } = cam;
    if (!terreno) { terreno = crear(); terrenoCtx = terreno.getContext('2d'); }
    // Asignar width/height reasigna y borra el lienzo: solo si cambia el tamaño. Cada celda se sobrescribe entera.
    if (terreno.width !== worldW * TERRAIN_CELL_PX) terreno.width = worldW * TERRAIN_CELL_PX;
    if (terreno.height !== worldH * TERRAIN_CELL_PX) terreno.height = worldH * TERRAIN_CELL_PX;
    const t = terrenoCtx, P = TERRAIN_CELL_PX;
    const max = capa ? RESOURCES[capa].max : 1;
    for (let y = 0; y < worldH; y++) {
      for (let x = 0; x < worldW; x++) {
        const celda = game.discovery.knownCell(x, y);
        t.globalAlpha = 1;
        t.fillStyle = celda ? cellColor(celda.biome, x, y) : UNKNOWN_COLOR;
        t.fillRect(x * P, y * P, P, P);
        const cantidad = celda && capa ? celda.resources[capa] : 0;
        if (cantidad > 0) {
          t.globalAlpha = Math.min(1, cantidad / max) * ALFA_MAX_TINTE;
          t.fillStyle = RESOURCE_TINTS[capa];
          t.fillRect(x * P, y * P, P, P);
          t.globalAlpha = 1;
        }
      }
    }
  }

  // Media móvil del intervalo real entre ticks, acotada: nunca más que un tick a x1 (volver de una pestaña
  // oculta daría un intervalo enorme) ni menos de 8 ms (un lote de ticks en un solo fotograma).
  function medirVentana(game, t) {
    if (game.clock.tick === tickVisto) return;
    if (tickVisto !== null) {
      const bruto = (t - tiempoDelTick) / Math.max(1, game.clock.tick - tickVisto);
      // La PRIMERA medida manda entera: promediarla con el valor por defecto dejaría unos ticks de
      // transición en los que lo dibujado se va quedando atrás, que es justo lo que se quiere evitar.
      ventana = Math.min(MS_POR_TICK, Math.max(8, medida ? ventana * 0.5 + bruto * 0.5 : bruto));
      medida = true;
    }
    tickVisto = game.clock.tick;
    tiempoDelTick = t;
  }

  function posicion(npc, game, t) {
    let c = caminantes.get(npc.id);
    if (!c) { c = { de: { x: npc.x, y: npc.y }, a: { x: npc.x, y: npc.y }, tick: game.clock.tick, desde: t, heading: undefined }; caminantes.set(npc.id, c); }
    if (c.tick !== game.clock.tick) {
      const k = Math.min(1, (t - c.desde) / ventana);
      c.de = { x: c.de.x + (c.a.x - c.de.x) * k, y: c.de.y + (c.a.y - c.de.y) * k };
      c.a = { x: npc.x, y: npc.y };
      c.tick = game.clock.tick;
      c.desde = t;
      if (c.a.x !== c.de.x || c.a.y !== c.de.y) c.heading = Math.atan2(c.a.y - c.de.y, c.a.x - c.de.x);
    }
    const k = Math.min(1, (t - c.desde) / ventana);
    return { x: c.de.x + (c.a.x - c.de.x) * k, y: c.de.y + (c.a.y - c.de.y) * k, heading: c.heading };
  }

  function sitiosCandidatos(game) {
    const clave = `${game.discovery.size}|${game.clock.day}`;
    if (candidatos.clave !== clave) candidatos = { clave, sitios: candidateSites(game.discovery, { season: game.clock.season }) };
    return candidatos.sitios;
  }

  return {
    resize(w, h, ratio) {
      cssW = w; cssH = h; dpr = ratio;
      canvas.width = Math.round(w * ratio);    // asignar width reinicia el contexto, por eso la escala va después
      canvas.height = Math.round(h * ratio);
      if (canvas.style) { canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    },

    invalidateTerrain() { sucio = true; },

    draw(game, cam, layers) {
      const capa = layers?.resources ?? null;
      const clave = claveTerreno(game, capa, cam);
      // Otra partida (o una carga) trae otro discovery: ni el terreno ni los caminantes de la anterior valen.
      if (game.discovery !== terrenoDiscovery) { terrenoDiscovery = game.discovery; caminantes.clear(); candidatos = { clave: null, sitios: [] }; sucio = true; ventana = MS_POR_TICK; medida = false; tickVisto = null; }
      if (sucio || clave !== terrenoClave) { pintarTerreno(game, cam, capa); terrenoClave = clave; sucio = false; }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = UNKNOWN_COLOR;
      ctx.fillRect(0, 0, cssW, cssH);

      const o = cam.worldToScreen(0, 0);
      const s = cam.tile * cam.zoom;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(terreno, 0, 0, terreno.width, terreno.height, o.x, o.y, cam.worldW * s, cam.worldH * s);

      for (const b of game.settlement?.buildings ?? []) {
        const p = cam.worldToScreen(b.x + 0.5, b.y + 0.5);
        drawBuilding(ctx, b, p.x, p.y, s);
      }

      if (layers?.candidates) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${Math.max(10, Math.round(s * 0.5))}px sans-serif`;
        for (const sitio of sitiosCandidatos(game)) {
          const p = cam.worldToScreen(sitio.x + 0.5, sitio.y + 0.5);
          ctx.beginPath();
          ctx.arc(p.x, p.y, s * 0.45, 0, Math.PI * 2);
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.fillText(String(Math.round(sitio.total)), p.x, p.y);
        }
      }

      const t = ahora();
      medirVentana(game, t);
      const vivos = new Set();
      for (const npc of game.band.npcs) {
        if (!npc.alive) continue;
        vivos.add(npc.id);
        const pos = posicion(npc, game, t);
        const p = cam.worldToScreen(pos.x + 0.5, pos.y + 0.5);
        drawNpc(ctx, { ...npc, heading: pos.heading }, p.x, p.y, s);
      }
      for (const id of caminantes.keys()) if (!vivos.has(id)) caminantes.delete(id);
    },
  };
}
