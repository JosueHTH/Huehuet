// Dibujo procedural: colores, tintes y formas simples. Sin imágenes. Nada aquí lee el mundo: el renderer
// decide qué se ve y pasa los datos ya filtrados por discovery.
import { BIOMES } from '../world/grid.js';
import { RESOURCES } from '../world/resources.js';

export const UNKNOWN_COLOR = '#2a2a2a';   // lo no descubierto: gris oscuro uniforme

export const BIOME_COLORS = Object.fromEntries(Object.values(BIOMES).map((b) => [b.id, b.color]));

// Un tinte por recurso, pensado para destacar sobre cualquier bioma.
const TINTS = { agua: '#1f6fff', caza: '#d9382b', forraje: '#e6c619', leña: '#7a4a1e', piedra: '#f2f2f2', pedernal: '#a23fd6' };
export const RESOURCE_TINTS = Object.fromEntries(Object.keys(RESOURCES).map((id) => [id, TINTS[id]]));

// --- Variación por celda ---------------------------------------------------------------------
// Un hash de (x, y): la misma celda tiene siempre el mismo tono, así que el mapa no parpadea.
export function cellHash(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const VARIANTES = 8;
const VARIACION = 0.12;   // ±6 % de brillo

function sombrear(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const c = (shift) => Math.min(255, Math.max(0, Math.round(((n >> shift) & 255) * factor)));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

const paletas = new Map();
function paleta(biomeId) {
  let p = paletas.get(biomeId);
  if (!p) {
    const base = BIOME_COLORS[biomeId] ?? UNKNOWN_COLOR;
    p = Array.from({ length: VARIANTES }, (_, i) => sombrear(base, 1 - VARIACION / 2 + (VARIACION * i) / (VARIANTES - 1)));
    paletas.set(biomeId, p);
  }
  return p;
}

export function cellColor(biomeId, x, y) {
  return paleta(biomeId)[Math.floor(cellHash(x, y) * VARIANTES)];
}

// --- NPC y edificios -------------------------------------------------------------------------
// px, py: centro en pantalla (px CSS); scale: píxeles por celda.

export function drawNpc(ctx, npc, px, py, scale) {
  const r = scale * (npc.age < 15 ? 0.2 : 0.28);
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fillStyle = npc.age >= 45 ? '#d9d2c3' : '#f4e2c0';
  ctx.fill();
  ctx.lineWidth = Math.max(1, scale * 0.06);
  ctx.strokeStyle = '#1b1b1b';
  ctx.stroke();
  // Punto de dirección: hacia donde camina (heading en radianes; sin él, mira hacia abajo).
  const a = npc.heading ?? Math.PI / 2;
  ctx.beginPath();
  ctx.arc(px + Math.cos(a) * r * 0.55, py + Math.sin(a) * r * 0.55, Math.max(1, r * 0.25), 0, Math.PI * 2);
  ctx.fillStyle = '#1b1b1b';
  ctx.fill();
}

export function drawBuilding(ctx, building, px, py, scale) {
  const s = scale;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * (building.done ? 1 : 0.4);
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.strokeStyle = '#1b1b1b';
  if (building.id === 'hoguera') {
    ctx.beginPath();
    ctx.arc(px, py, s * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = '#ff8a1f';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, py, s * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd84a';
    ctx.fill();
  } else if (building.id === 'choza') {
    ctx.beginPath();
    ctx.moveTo(px - s * 0.4, py + s * 0.3);
    ctx.lineTo(px, py - s * 0.4);
    ctx.lineTo(px + s * 0.4, py + s * 0.3);
    ctx.closePath();
    ctx.fillStyle = '#8b5a2b';
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillStyle = '#6b4a2a';
    ctx.fillRect(px - s * 0.38, py - s * 0.3, s * 0.76, s * 0.6);
    ctx.strokeRect(px - s * 0.38, py - s * 0.3, s * 0.76, s * 0.6);
  }
  ctx.globalAlpha = prev;
}
