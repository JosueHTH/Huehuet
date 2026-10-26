// Las partidas guardadas del jugador: varios slots en el almacenamiento del navegador.
// Este es el único módulo que toca el almacenamiento, y lo recibe por parámetro: así se prueba en Node con
// dobles, y así también un almacenamiento bloqueado o lleno degrada en vez de romper la pantalla.
//
// Dos claves por razón: `huehuet.saves.v1` es el índice (lo que la lista muestra) y `huehuet.save.<id>` es
// cada partida. Separadas, una partida corrupta no se lleva la lista por delante.
//
// Regla de oro: NADA de lo que hace el almacenamiento llega al jugador como excepción. Cada lectura y cada
// escritura va en try/catch y el fallo vuelve como valor ({ ok: false, error }), con un único aviso por sesión.
import { SCHEMA_VERSION, UnsupportedVersionError, serialize, deserialize, migrate, describe } from './schema.js';

export const CLAVE_INDICE = 'huehuet.saves.v1';
export const CLAVE_PARTIDA = (id) => `huehuet.save.${id}`;
const CLAVE_SONDEO = 'huehuet.probe';
const NOMBRE_MAXIMO = 60;
const NOMBRE_POR_DEFECTO = 'Mi aldea';

const AVISO = 'No se puede guardar en este navegador (el almacenamiento está bloqueado o lleno). La partida sigue en memoria, pero se perderá al cerrar.';

// En Safari privado incluso nombrar localStorage puede lanzar; un valor por defecto que lanzase rompería el arranque.
function almacenamientoDelNavegador() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

const mensajeDe = (e) => (e && typeof e.message === 'string' && e.message ? e.message : 'error desconocido');
const limpiarNombre = (nombre) => {
  const limpio = String(nombre ?? '').trim().slice(0, NOMBRE_MAXIMO).trim();
  return limpio || NOMBRE_POR_DEFECTO;
};
const numero = (v, porDefecto) => (Number.isFinite(v) ? v : porDefecto);

// Una entrada del índice, o null si no hay forma de salvarla (sin id no se puede ni borrar).
function entradaValida(e) {
  if (e === null || typeof e !== 'object' || typeof e.id !== 'string' || e.id === '') return null;
  const slot = {
    id: e.id,
    nombre: limpiarNombre(e.nombre),
    seed: numero(e.seed, 0),
    day: numero(e.day, 0),
    poblacion: numero(e.poblacion, 0),
    era: typeof e.era === 'string' ? e.era : 'Nómadas',
    settled: e.settled === true,
    thumbnail: typeof e.thumbnail === 'string' ? e.thumbnail : null,
    updatedAt: numero(e.updatedAt, 0),
  };
  if (e.damaged === true) slot.damaged = true;
  return slot;
}

export function createStore(storage = almacenamientoDelNavegador(), opts = {}) {
  const avisar = opts.warn ?? ((mensaje) => console.warn(mensaje));
  const ahora = opts.now ?? (() => Date.now());

  let avisado = false;
  const avisarUnaVez = () => { if (!avisado) { avisado = true; try { avisar(AVISO); } catch { /* el aviso nunca rompe */ } } };

  // Sondeo: escribir y borrar de verdad. Nunca se supone que localStorage funciona.
  let sondeoOk = false;
  try {
    storage.setItem(CLAVE_SONDEO, '1');
    storage.removeItem(CLAVE_SONDEO);
    sondeoOk = true;
  } catch { sondeoOk = false; }
  if (!sondeoOk) avisarUnaVez();

  let ultimaEscrituraFallo = false;
  // Copia de la sesión: manda cuando el almacenamiento no se puede leer o la última escritura del índice falló.
  let enMemoria = [];
  let indiceAlDia = true;

  const leer = (clave) => storage.getItem(clave);   // los llamadores lo envuelven: aquí puede lanzar
  const escribir = (clave, valor) => {
    try {
      storage.setItem(clave, valor);
      ultimaEscrituraFallo = false;
      return null;
    } catch (e) {
      ultimaEscrituraFallo = true;
      avisarUnaVez();
      return mensajeDe(e);
    }
  };

  function leerIndice() {
    if (!sondeoOk || !indiceAlDia) return enMemoria;
    let lista = [];
    try {
      const crudo = leer(CLAVE_INDICE);
      if (crudo !== null) {
        const dato = JSON.parse(crudo);
        const entradas = Array.isArray(dato) ? dato : dato?.slots;
        if (Array.isArray(entradas)) {
          const vistos = new Set();
          for (const e of entradas) {
            const slot = entradaValida(e);
            if (slot && !vistos.has(slot.id)) { vistos.add(slot.id); lista.push(slot); }
          }
        }
      }
    } catch {
      lista = [];   // índice ilegible: vacío, y la sesión arranca igual
    }
    enMemoria = lista;
    return lista;
  }

  function escribirIndice(lista) {
    enMemoria = lista;
    if (!sondeoOk) return false;
    const error = escribir(CLAVE_INDICE, JSON.stringify({ version: SCHEMA_VERSION, slots: lista }));
    indiceAlDia = error === null;
    return indiceAlDia;
  }

  const buscar = (lista, id) => lista.find((s) => s.id === id);
  const copia = (s) => ({ ...s });

  let contador = 0;   // no baja nunca en la sesión: un id borrado no vuelve a salir
  function idNuevo(lista) {
    const base = ahora().toString(36);
    for (;;) {
      const id = `${base}-${(contador++).toString(36)}`;
      if (buscar(lista, id)) continue;
      let ocupado = false;
      try { ocupado = sondeoOk && leer(CLAVE_PARTIDA(id)) !== null; } catch { ocupado = false; }
      if (!ocupado) return id;
    }
  }

  function marcarDanada(id) {
    const lista = leerIndice();
    const slot = buscar(lista, id);
    if (slot && !slot.damaged) { slot.damaged = true; escribirIndice(lista); }
  }

  return {
    // Falso si no se puede acceder al almacenamiento o si la última escritura falló: la interfaz lo usa para avisar.
    get available() { return sondeoOk && !ultimaEscrituraFallo; },

    listSlots() {
      return leerIndice().map(copia);
    },

    createSlot(nombre, seed) {
      const lista = leerIndice().slice();
      const slot = {
        id: idNuevo(lista),
        nombre: limpiarNombre(nombre),
        seed: numero(seed, 0),
        day: 0,
        poblacion: 0,
        era: 'Nómadas',
        settled: false,
        thumbnail: null,
        updatedAt: ahora(),
      };
      lista.push(slot);
      escribirIndice(lista);
      return copia(slot);
    },

    writeSlot(id, game, extra = {}) {
      const lista = leerIndice().slice();
      const slot = buscar(lista, id);
      if (!slot) return { ok: false, error: 'Esa partida ya no existe.' };
      let texto;
      try {
        texto = JSON.stringify(serialize(game));
      } catch (e) {
        return { ok: false, error: `No se pudo preparar la partida para guardarla: ${mensajeDe(e)}` };
      }
      if (!sondeoOk) return { ok: false, error: 'El almacenamiento no está disponible: la partida sigue solo en memoria.' };
      const error = escribir(CLAVE_PARTIDA(id), texto);
      if (error !== null) return { ok: false, error: `No se pudo guardar la partida (¿almacenamiento lleno?): ${error}` };
      Object.assign(slot, describe(game), { updatedAt: ahora() });
      if (typeof extra.thumbnail === 'string') slot.thumbnail = extra.thumbnail;
      delete slot.damaged;
      escribirIndice(lista);
      return { ok: true };
    },

    readSlot(id) {
      const slot = buscar(leerIndice(), id);
      if (!slot) return { ok: false, error: 'Esa partida ya no existe.' };
      if (!sondeoOk) return { ok: false, error: 'El almacenamiento no está disponible.' };
      let crudo;
      try {
        crudo = leer(CLAVE_PARTIDA(id));
      } catch (e) {
        return { ok: false, error: `No se pudo leer la partida: ${mensajeDe(e)}` };   // fallo de acceso, no de datos: no se marca dañada
      }
      if (crudo === null) return { ok: false, error: 'Esta partida todavía no se ha guardado.' };
      try {
        const datos = migrate(JSON.parse(crudo));
        const game = deserialize(datos);
        if (slot.damaged) {
          const lista = leerIndice().slice();
          delete buscar(lista, id).damaged;
          escribirIndice(lista);
        }
        return { ok: true, game };
      } catch (e) {
        // Una versión más nueva no es un daño: el dato está bien y otra versión del juego lo abrirá. No se toca.
        if (e instanceof UnsupportedVersionError) return { ok: false, unsupported: true, error: e.message };
        marcarDanada(id);
        return { ok: false, damaged: true, error: `La partida está dañada y no se puede abrir (${mensajeDe(e)}). Puedes borrarla.` };
      }
    },

    renameSlot(id, nombre) {
      const lista = leerIndice().slice();
      const slot = buscar(lista, id);
      if (!slot) return;
      slot.nombre = limpiarNombre(nombre);
      escribirIndice(lista);
    },

    deleteSlot(id) {
      const lista = leerIndice();
      if (!buscar(lista, id)) return;
      if (sondeoOk) {
        try { storage.removeItem(CLAVE_PARTIDA(id)); } catch { avisarUnaVez(); }
      }
      escribirIndice(lista.filter((s) => s.id !== id));
    },
  };
}
