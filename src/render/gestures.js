// Gestos de puntero: arrastre (un dedo), pinza (dos) y toque / doble toque. Sin DOM propio: recibe el elemento.
export const TAP_THRESHOLD = 8;        // px CSS: hasta aquí es un toque, más allá es un arrastre
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 30;

// Pura. samples: [{x, y, t}] de un mismo puntero, desde que baja hasta que sube. Cuenta lo más lejos que llegó
// del punto de partida: un arrastre que vuelve al origen sigue siendo arrastre, y mantener pulsado sin moverse
// (por mucho tiempo que pase) sigue siendo un toque.
export function classifyPointer(samples) {
  if (samples.length < 2) return 'tap';
  const { x, y } = samples[0];
  let lejos = 0;
  for (const s of samples) lejos = Math.max(lejos, Math.hypot(s.x - x, s.y - y));
  return lejos > TAP_THRESHOLD ? 'drag' : 'tap';
}

export function createGestures(el, handlers) {
  const { onPan, onPinch, onTap, onDoubleTap } = handlers;
  const punteros = new Map();   // pointerId -> { x, y, samples, arrastre, ultimoX, ultimoY }
  let modo = 'libre';           // 'libre' | 'uno' | 'pinza' | 'inerte'
  let distancia = 0;
  let ultimoToque = null;       // { x, y, t }

  const origen = () => el.getBoundingClientRect?.() ?? { left: 0, top: 0 };
  const punto = (e) => { const o = origen(); return { x: e.clientX - o.left, y: e.clientY - o.top }; };
  const dosDedos = () => { const [a, b] = [...punteros.values()]; return { d: Math.hypot(b.x - a.x, b.y - a.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; };

  function abajo(e) {
    el.setPointerCapture?.(e.pointerId);
    const { x, y } = punto(e);
    punteros.set(e.pointerId, { x, y, samples: [{ x, y, t: e.timeStamp }], arrastre: false, ultimoX: x, ultimoY: y });
    if (punteros.size >= 2) { modo = 'pinza'; distancia = dosDedos().d; }
    else modo = 'uno';
  }

  function mueve(e) {
    const p = punteros.get(e.pointerId);
    if (!p) return;
    const { x, y } = punto(e);
    p.x = x; p.y = y;
    if (modo === 'pinza') {
      const { d, cx, cy } = dosDedos();
      if (distancia > 0 && d > 0) onPinch?.(d / distancia, cx, cy);
      distancia = d;
    } else if (modo === 'uno') {
      p.samples.push({ x, y, t: e.timeStamp });
      if (!p.arrastre && classifyPointer(p.samples) === 'drag') p.arrastre = true;
      if (p.arrastre) { onPan?.(x - p.ultimoX, y - p.ultimoY); p.ultimoX = x; p.ultimoY = y; }
    }
    // 'inerte': el dedo que queda no mueve nada hasta el siguiente pointerdown.
  }

  function arriba(e) {
    const p = punteros.get(e.pointerId);
    if (!p) return;
    const { x, y } = punto(e);
    punteros.delete(e.pointerId);
    if (modo === 'pinza') { modo = 'inerte'; return; }
    if (modo === 'uno') {
      p.samples.push({ x, y, t: e.timeStamp });
      if (classifyPointer(p.samples) === 'tap') toque(x, y, e.timeStamp);
      else ultimoToque = null;
    }
    if (punteros.size === 0) modo = 'libre';
  }

  function cancela(e) {
    if (!punteros.delete(e.pointerId)) return;
    modo = modo === 'pinza' ? 'inerte' : punteros.size === 0 ? 'libre' : modo;
    ultimoToque = null;
  }

  function toque(x, y, t) {
    const previo = ultimoToque;
    if (previo && t - previo.t <= DOUBLE_TAP_MS && Math.hypot(x - previo.x, y - previo.y) <= DOUBLE_TAP_PX) {
      ultimoToque = null;
      onDoubleTap?.(x, y);
    } else {
      ultimoToque = { x, y, t };
      onTap?.(x, y);
    }
  }

  if (el.style) el.style.touchAction = 'none';
  const oyentes = [['pointerdown', abajo], ['pointermove', mueve], ['pointerup', arriba], ['pointercancel', cancela]];
  for (const [tipo, fn] of oyentes) el.addEventListener(tipo, fn);

  return {
    destroy() {
      for (const [tipo, fn] of oyentes) el.removeEventListener(tipo, fn);
      punteros.clear();
    },
  };
}
