// Cámara 2D. Las coordenadas del mundo son celdas (la celda (x, y) ocupa [x, x+1) × [y, y+1)); la pantalla
// son píxeles CSS. (x, y) es la celda que está en el centro de la vista y la escala es tile * zoom px por celda.
// Pura: no toca el DOM ni el mundo, solo su tamaño.
export const MAX_ZOOM = 4;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createCamera({ viewW, viewH, worldW, worldH, tile }) {
  // Con el mundo más pequeño que la vista no hay rango que acotar: se centra, no se pega a un borde.
  const acotar = (centro, visible, mundo) =>
    visible >= mundo ? mundo / 2 : clamp(centro, visible / 2, mundo - visible / 2);

  const cam = {
    viewW, viewH, worldW, worldH, tile,
    x: worldW / 2, y: worldH / 2, zoom: 1, minZoom: 1, maxZoom: MAX_ZOOM,

    screenToWorld(sx, sy) {
      const s = tile * cam.zoom;
      return { x: cam.x + (sx - cam.viewW / 2) / s, y: cam.y + (sy - cam.viewH / 2) / s };
    },
    worldToScreen(wx, wy) {
      const s = tile * cam.zoom;
      return { x: (wx - cam.x) * s + cam.viewW / 2, y: (wy - cam.y) * s + cam.viewH / 2 };
    },

    // Deja el centro dentro de los límites para el zoom y la vista actuales.
    clampCenter() {
      const s = tile * cam.zoom;
      cam.x = acotar(cam.x, cam.viewW / s, cam.worldW);
      cam.y = acotar(cam.y, cam.viewH / s, cam.worldH);
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
      cam.x = ancla.x - (sx - cam.viewW / 2) / s;
      cam.y = ancla.y - (sy - cam.viewH / 2) / s;
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
      cam.minZoom = Math.min(1, w / (worldW * tile), h / (worldH * tile));
      cam.zoom = clamp(cam.zoom, cam.minZoom, cam.maxZoom);
      cam.clampCenter();
    },
  };

  cam.resize(viewW, viewH);
  return cam;
}
