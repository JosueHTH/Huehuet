// Cámara 2D. Las coordenadas del mundo son celdas (la celda (x, y) ocupa [x, x+1) × [y, y+1)); la pantalla
// son píxeles CSS. (x, y) es la celda que está en el centro del MAPA VISIBLE y la escala es tile * zoom px
// por celda. Pura: no toca el DOM ni el mundo, solo su tamaño.
//
// Márgenes (setInsets): el HUD flota sobre el lienzo y tapa unos 250 px de los 956 del iPhone. Sin saberlo,
// la cámara centraba en el centro del lienzo —que cae detrás de la barra del pulgar— y el acotado del borde
// empujaba a la banda hasta la esquina: con la banda a tres celdas del borde sur (lo normal, porque
// chooseStart la pone lejos de los sitios viables) terminaba dibujada y no vista. Los márgenes dicen cuál es
// el rectángulo que el jugador ve de verdad; con márgenes a cero la cámara es exactamente la de antes.
export const MAX_ZOOM = 4;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createCamera({ viewW, viewH, worldW, worldH, tile, insets }) {
  // Con el mundo más pequeño que la vista no hay rango que acotar: se centra, no se pega a un borde.
  const acotar = (centro, visible, mundo) =>
    visible >= mundo ? mundo / 2 : clamp(centro, visible / 2, mundo - visible / 2);

  // El mapa visible: lo que queda del lienzo tras descontar los márgenes del HUD. Un margen absurdo (más
  // grande que el lienzo) dejaría el ancho en cero y envenenaría el acotado: se sostiene en 1 px.
  const anchoVisible = () => Math.max(1, viewW - cam.insets.left - cam.insets.right);
  const altoVisible = () => Math.max(1, viewH - cam.insets.top - cam.insets.bottom);
  const centroX = () => (cam.insets.left + viewW - cam.insets.right) / 2;
  const centroY = () => (cam.insets.top + viewH - cam.insets.bottom) / 2;

  const cam = {
    viewW, viewH, worldW, worldH, tile,
    x: worldW / 2, y: worldH / 2, zoom: 1, minZoom: 1, maxZoom: MAX_ZOOM,
    insets: { top: insets?.top ?? 0, right: insets?.right ?? 0, bottom: insets?.bottom ?? 0, left: insets?.left ?? 0 },

    // Cambia los márgenes y reacota: el zoom mínimo y el centro dependen del mapa visible.
    setInsets(i = {}) {
      cam.insets = { top: i.top ?? 0, right: i.right ?? 0, bottom: i.bottom ?? 0, left: i.left ?? 0 };
      cam.resize(cam.viewW, cam.viewH);
    },

    get visibleW() { return anchoVisible(); },
    get visibleH() { return altoVisible(); },

    screenToWorld(sx, sy) {
      const s = tile * cam.zoom;
      return { x: cam.x + (sx - centroX()) / s, y: cam.y + (sy - centroY()) / s };
    },
    worldToScreen(wx, wy) {
      const s = tile * cam.zoom;
      return { x: (wx - cam.x) * s + centroX(), y: (wy - cam.y) * s + centroY() };
    },

    // Deja el centro dentro de los límites para el zoom y la vista actuales.
    clampCenter() {
      const s = tile * cam.zoom;
      cam.x = acotar(cam.x, anchoVisible() / s, cam.worldW);
      cam.y = acotar(cam.y, altoVisible() / s, cam.worldH);
    },

    // dx, dy: lo que se ha movido el dedo, en px. El mundo sigue al dedo, así que la cámara va al revés.
    pan(dx, dy) {
      const s = tile * cam.zoom;
      cam.x -= dx / s;
      cam.y -= dy / s;
      cam.clampCenter();
    },

    // El punto de pantalla (sx, sy) se queda sobre el mismo punto del mundo. Primero se convierte a mundo
    // con el zoom viejo, y solo después se cambia el zoom y se recoloca el centro.
    zoomAt(factor, sx, sy) {
      const ancla = cam.screenToWorld(sx, sy);
      cam.zoom = clamp(cam.zoom * factor, cam.minZoom, cam.maxZoom);
      const s = tile * cam.zoom;
      cam.x = ancla.x - (sx - centroX()) / s;
      cam.y = ancla.y - (sy - centroY()) / s;
      cam.clampCenter();
    },

    centerOn(wx, wy) {
      cam.x = wx;
      cam.y = wy;
      cam.clampCenter();
    },

    // La vista cambió de tamaño (giro, barra del navegador): el zoom mínimo es el que deja ver el mundo entero.
    resize(w, h) {
      cam.viewW = w;
      cam.viewH = h;
      viewW = w;
      viewH = h;
      cam.minZoom = Math.min(1, anchoVisible() / (worldW * tile), altoVisible() / (worldH * tile));
      cam.zoom = clamp(cam.zoom, cam.minZoom, cam.maxZoom);
      cam.clampCenter();
    },
  };

  cam.resize(viewW, viewH);
  return cam;
}
