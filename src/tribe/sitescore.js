// Puntuación de sitios: la decisión de dónde asentarse. Cada factor se calcula solo con celdas que la banda
// ha visto (discovery.knownCell) y se devuelve con valor, peso y aportación para que la interfaz explique
// la decisión, también cuando el sitio no es viable.
// Pura y determinista: sin azar, sin reloj; el orden de los resultados es un orden total.
import { BIOMES } from '../world/grid.js';

// Pesos: los positivos suman 93 y los de penalización restan hasta 17. Cifras de balance (a afinar jugando).
export const SITE_FACTORS = [
  { id: 'agua', label: 'Agua dulce', weight: 15, radius: 3, eliminatory: true },
  { id: 'caza', label: 'Caza', weight: 20, radius: 6 },
  { id: 'forraje', label: 'Forraje', weight: 20, radius: 4 },
  { id: 'leña', label: 'Leña', weight: 12, radius: 5 },
  { id: 'piedra', label: 'Piedra', weight: 10, radius: 8 },
  { id: 'defensa', label: 'Defensa', weight: 8, radius: 3 },
  { id: 'refugio', label: 'Refugio', weight: 8, radius: 3 },
  { id: 'inundacion', label: 'Riesgo de inundación', weight: -10, radius: 2 },
  { id: 'depredadores', label: 'Depredadores', weight: -7, radius: 4 },
];

// Semisaturación k de v / (v + k): con esa cantidad acumulada en el radio el factor vale 0.5.
// Aproximadamente la mitad de lo que daría una zona rica (celdas en el radio × máximo del recurso × ~0.3).
const SEMISATURACION = { caza: 60, forraje: 80, leña: 120, piedra: 150 };
const K_DEFENSA = 0.1;  // desnivel medio (en elevación 0..1) con el que la defensa vale 0.5

// La leña pesa más según se acerca el invierno; el resto no cambia con la estación.
const MODIFICADOR_ESTACIONAL = {
  leña: { primavera: 1, verano: 0.8, otoño: 1.5, invierno: 1.5 },
};

const esAnegable = (celda) => celda.river || celda.biome === 'rio' || celda.biome === 'agua' || celda.biome === 'pantano';
const esAguaDulce = (celda) => celda.river === true || celda.biome === 'rio';

// Visita las celdas conocidas a distancia <= radio de (x, y). El descubrimiento ya descarta lo que cae fuera de la rejilla.
function paraConocidas(discovery, x, y, radio, fn) {
  const r = Math.floor(radio);
  for (let cy = y - r; cy <= y + r; cy++) {
    for (let cx = x - r; cx <= x + r; cx++) {
      const dx = cx - x;
      const dy = cy - y;
      if (dx * dx + dy * dy > radio * radio) continue;
      const celda = discovery.knownCell(cx, cy);
      if (celda) fn(celda, Math.sqrt(dx * dx + dy * dy));
    }
  }
}

const saturar = (v, k) => (v <= 0 ? 0 : v / (v + k));
const media = (suma, n) => (n === 0 ? 0 : suma / n);

// Valor 0..1 de cada factor, con el sitio ya conocido.
const VALOR = {
  agua(discovery, x, y, radio) {
    let cerca = Infinity;
    paraConocidas(discovery, x, y, radio, (celda, d) => { if (esAguaDulce(celda) && d < cerca) cerca = d; });
    return cerca === Infinity ? 0 : 1 - cerca / (radio + 1);
  },
  defensa(discovery, x, y, radio, sitio) {
    let suma = 0; let n = 0;
    paraConocidas(discovery, x, y, radio, (celda) => { suma += Math.max(0, sitio.elevation - celda.elevation); n++; });
    return saturar(media(suma, n), K_DEFENSA);
  },
  refugio(discovery, x, y, radio) {
    let suma = 0; let n = 0;
    paraConocidas(discovery, x, y, radio, (celda) => { suma += BIOMES[celda.biome]?.shelter ?? 0; n++; });
    return media(suma, n);
  },
  inundacion(discovery, x, y, radio) {
    let suma = 0; let n = 0;
    paraConocidas(discovery, x, y, radio, (celda) => { suma += esAnegable(celda) ? 1 : 0; n++; });
    return media(suma, n);
  },
  depredadores(discovery, x, y, radio) {
    let suma = 0; let n = 0;
    paraConocidas(discovery, x, y, radio, (celda) => { suma += BIOMES[celda.biome]?.predators ?? 0; n++; });
    return media(suma, n);
  },
};

function valorRecurso(id, discovery, x, y, radio) {
  let suma = 0;
  paraConocidas(discovery, x, y, radio, (celda) => { suma += celda.resources?.[id] ?? 0; });
  return saturar(suma, SEMISATURACION[id]);
}

const modificador = (id, season) => MODIFICADOR_ESTACIONAL[id]?.[season] ?? 1;

// SiteScore = { x, y, total 0..100, viable, factors: [{ id, label, value 0..1, weight, contribution }] }.
// total = suma de aportaciones; cada aportación es valor × peso × modificador, repartida de modo que lo
// máximo posible sume 100. Las penalizaciones nunca superan lo que suman los demás factores (total >= 0).
// Un sitio no descubierto, en un lago o sin agua dulce conocida a 3 celdas no es viable: total 0 y aportaciones 0,
// pero los valores se calculan igualmente.
export function scoreSite(discovery, x, y, ctx) {
  const sitio = discovery.knownCell(x, y);
  const valores = SITE_FACTORS.map((f) => {
    let valor = 0;
    if (sitio) {
      if (f.id in SEMISATURACION) valor = valorRecurso(f.id, discovery, x, y, f.radius);
      else valor = VALOR[f.id](discovery, x, y, f.radius, sitio);
    }
    return Math.min(1, Math.max(0, valor));
  });
  const pesos = SITE_FACTORS.map((f) => f.weight * modificador(f.id, ctx.season));
  const maximo = pesos.reduce((a, p) => a + Math.max(0, p), 0);
  const viable = sitio !== null && sitio.biome !== 'agua' && valores[SITE_FACTORS.findIndex((f) => f.eliminatory)] > 0;

  let contribuciones = pesos.map((p, i) => (viable ? (valores[i] * p / maximo) * 100 : 0));
  const positivo = contribuciones.reduce((a, c) => a + Math.max(0, c), 0);
  const negativo = -contribuciones.reduce((a, c) => a + Math.min(0, c), 0);
  if (negativo > positivo) contribuciones = contribuciones.map((c) => (c < 0 ? c * positivo / negativo : c));
  const total = Math.min(100, Math.max(0, contribuciones.reduce((a, c) => a + c, 0)));

  return {
    x,
    y,
    total,
    viable,
    factors: SITE_FACTORS.map((f, i) => ({
      id: f.id, label: f.label, value: valores[i], weight: f.weight, contribution: contribuciones[i],
    })),
  };
}

// 70 sin presión hasta 25 con presión máxima. Una banda cómoda rechaza un valle mediocre; una desesperada se asienta en él.
const UMBRAL_SIN_PRESION = 70;
const UMBRAL_PRESION_MAXIMA = 25;
export function acceptanceThreshold(pressure) {
  const p = Math.min(1, Math.max(0, pressure));
  return UMBRAL_SIN_PRESION + (UMBRAL_PRESION_MAXIMA - UMBRAL_SIN_PRESION) * p;
}

// --- Candidatos --------------------------------------------------------------------------------

const LIMITE_POR_DEFECTO = 8;
const RADIO_AGUA = SITE_FACTORS.find((f) => f.eliminatory).radius;

// knownCells() copia y ordena el conjunto en cada llamada, pero medido en 96x96 completo cuesta ~0.4 ms
// frente a ~60 ms de puntuar: no se guarda en caché.

// Prueba de agua dulce, hecha aquí con lo que la banda ha visto: no se usa la lista de sitios del generador.
function veAguaDulce(discovery, x, y) {
  let hay = false;
  paraConocidas(discovery, x, y, RADIO_AGUA, (celda) => { if (esAguaDulce(celda)) hay = true; });
  return hay;
}

// Hasta `limit` sitios viables, de mayor a menor total; empata por y y luego por x (orden total, reproducible).
// opts.exclude: colección de {x, y} que no se proponen (p. ej. sitios que la banda ya abandonó por inalcanzables).
export function candidateSites(discovery, ctx, opts = {}) {
  const limit = opts.limit ?? LIMITE_POR_DEFECTO;
  const excluidos = new Set([...(opts.exclude ?? [])].map((s) => `${s.x},${s.y}`));
  const sitios = [];
  for (const celda of discovery.knownCells()) {
    if (excluidos.has(`${celda.x},${celda.y}`)) continue;
    if (!veAguaDulce(discovery, celda.x, celda.y)) continue;
    const puntuacion = scoreSite(discovery, celda.x, celda.y, ctx);
    if (puntuacion.viable) sitios.push(puntuacion);
  }
  sitios.sort((a, b) => b.total - a.total || a.y - b.y || a.x - b.x);
  return sitios.slice(0, limit);
}
