# Huehuet — Simulación de civilización 2D (Etapa 1)

Fecha: 2026-10-26
Estado: aprobado para planificación

## 1. Propósito

Un simulador 2D donde un grupo de NPCs autónomos empieza como banda nómada,
explora el territorio, evalúa lo que encuentra y decide por su cuenta dónde
asentarse. El jugador observa; no da órdenes.

El objetivo de diseño es que la decisión de asentarse sea **legible desde
fuera**. El jugador debe poder entender por qué la banda eligió ese valle y
no el anterior, con los mismos datos que tenía la banda.

### Para quién y qué cuenta como éxito

Es un juego de una sola persona, jugado en un iPhone 17 Pro Max en vertical,
en sesiones cortas o largas. Tiene éxito cuando el jugador puede narrar lo
que pasó: "se fueron del norte porque el invierno mató a dos, y aceptaron un
sitio peor junto al río". Fracasa si las decisiones de los NPCs parecen
aleatorias o si la interfaz obliga a usar dos manos.

### Decisiones tomadas con el usuario

- Tecnología: HTML5 + Canvas2D, módulos ES nativos, sin dependencias ni build.
- Rol del jugador: observador puro (god-game), sin capacidad de ordenar.
- Arco: largo, por eras — entregado en etapas. Este spec cubre la Etapa 1.
- Estética: prehistórico neolítico genérico (tundra, bosque, río, mamuts),
  paleta verde-gris fría.
- Guardado: varios slots en almacenamiento local, con crear, continuar,
  renombrar y borrar.
- Idioma de la interfaz: español.

### Supuestos

- Sin cuentas, sin servidor, sin red. Todo vive en el dispositivo.
- Un jugador, una partida activa a la vez.

## 2. Alcance

### Dentro de la Etapa 1

- Generación determinista del mundo a partir de una semilla.
- Banda nómada de NPCs con necesidades, rasgos y decisiones por utilidad.
- Descubrimiento del territorio: la banda solo conoce lo que ha visto.
- Evaluación de sitios candidatos y decisión de asentamiento por consenso.
- Construcción de la primera aldea: hogueras, chozas, almacén.
- Crónica de eventos narrada en español.
- Slots de guardado con autoguardado y guardado manual.
- Interfaz vertical para iPhone 17 Pro Max.

### Fuera de la Etapa 1 (etapas posteriores)

| Etapa | Contenido |
|---|---|
| 2 | Oficios, crecimiento poblacional, estaciones con escasez, almacén activo |
| 3 | Agricultura y domesticación, era del bronce |
| 4 | Escritura, aldeas satélite, crónica histórica |

La arquitectura debe permitir que una era nueva **añada** acciones, recursos y
edificios a los catálogos existentes, sin modificar el núcleo de decisión.

### No objetivos

- Multijugador, red, cuentas.
- Combate entre tribus.
- Assets de imagen externos: todos los gráficos son procedurales.
- Instalación nativa o App Store.

## 3. Arquitectura

Módulos ES nativos servidos como archivos estáticos. Sin empaquetador.

```
index.html
src/
  main.js              ensamblado y bucle principal
  core/
    rng.js             PRNG con semilla (mulberry32)
    clock.js           tick de tamaño fijo, velocidades y pausa
  world/
    worldgen.js        altura, humedad, temperatura -> biomas y recursos
    grid.js            rejilla de celdas y consultas por radio
    resources.js       catálogo de recursos y regeneración
    discovery.js       qué celdas conoce la banda
  agents/
    needs.js           hambre, sed, frío, fatiga, moral
    utility.js         evaluador genérico de acciones
    actions.js         catálogo de acciones
    npc.js             estado, nombre, edad, rasgos
  tribe/
    band.js            inventario compartido, moral, migración
    sitescore.js       puntuación de sitios candidatos
    settlement.js      construcción y edificios
  chronicle.js         registro de eventos narrados
  render/
    camera.js          desplazamiento y zoom
    renderer.js        dibujo por capas
    sprites.js         gráficos procedurales
  ui/
    hud.js             franja superior y barra inferior
    sheets.js          hojas deslizables desde abajo
    slots.js           pantalla de inicio con slots
  save/
    store.js           lectura y escritura en almacenamiento local
    schema.js          versión del esquema y migraciones
tests/
```

### La regla que mantiene esto sano

`core/`, `world/`, `agents/` y `tribe/` son funciones puras sobre estado. No
referencian `canvas`, `window`, `document` ni `Date.now()`. El tiempo entra
como argumento. La aleatoriedad entra como instancia de `rng`.

Consecuencias: la simulación se testea en Node sin navegador, y un mundo con
la misma semilla sale idéntico siempre. Esta separación es la que permitiría
migrar a un ECS más adelante sin reescribir la lógica de decisión.

`render/` y `ui/` leen el estado y nunca lo modifican. La única vía para
cambiar la simulación son los comandos del reloj (pausa y velocidad), que no
alteran decisiones, solo cuántos ticks se procesan.

## 4. Flujo de datos

Un tick de simulación es una hora de juego. El reloj acumula tiempo real y
dispara ticks de tamaño fijo, así que cambiar la velocidad no cambia el
resultado, solo la rapidez con que se alcanza.

Cada tick, en este orden:

1. El mundo avanza: clima, hora del día, regeneración de recursos.
2. Cada NPC actualiza sus necesidades.
3. Cada NPC elige una acción puntuando el catálogo con su estado actual.
4. Las acciones se resuelven y modifican mundo, NPC e inventario de la banda.
5. La banda evalúa si debe migrar o asentarse.
6. Los eventos dignos de mención entran en la crónica.

El renderizado corre en `requestAnimationFrame`, desacoplado del tick, e
interpola la posición de los NPCs entre ticks para que el movimiento no se
vea a saltos.

## 5. Decisión de los NPCs: utilidad

Cada acción del catálogo expone una función que recibe el NPC, la banda y el
mundo conocido, y devuelve una puntuación. El NPC ejecuta la de mayor
puntuación. No hay árbol ni máquina de estados.

Necesidades, todas en el rango 0-100 y nunca fuera de él:

| Necesidad | Sube con | Baja con |
|---|---|---|
| Hambre | el tiempo | comer |
| Sed | el tiempo, más rápido en calor | beber |
| Frío | noche, invierno, altitud | hoguera, refugio, abrigo |
| Fatiga | caminar, trabajar | dormir, descansar |
| Moral | éxito, comida abundante | muertes, hambre, fracasos |

Acciones de la Etapa 1: beber, forrajear, cazar, talar, recoger piedra,
descansar, explorar, seguir a la banda, construir.

Los rasgos del NPC modulan los pesos. Un NPC cauto puntúa más alto la
seguridad; uno audaz, la exploración. Los rasgos son estables y visibles en
su ficha, para que el jugador pueda predecir su comportamiento.

## 6. Decisión de asentarse

El sistema central del juego.

### Descubrimiento

La banda solo puntúa celdas que ha visto. `discovery.js` mantiene el conjunto
de celdas conocidas y, por cada una, lo que la banda *cree* que contiene —
que puede estar incompleto. El jugador ve el mapa con esta misma limitación
cuando activa la capa de recursos.

### Cuándo se evalúa

Periódicamente, y además cuando sube la presión: llega el invierno, nace un
niño, muere alguien, el hambre colectiva pasa un umbral.

### Factores

| Factor | Peso | Nota |
|---|---|---|
| Agua dulce a 3 celdas o menos | Eliminatorio | Sin agua el sitio puntúa cero |
| Densidad de caza, radio 6 | Alto | |
| Forraje y bayas, radio 4 | Alto | |
| Leña, radio 5 | Medio | Sube con el invierno cerca |
| Piedra y pedernal, radio 8 | Medio | Necesario para avanzar de era |
| Defensa: elevación, espalda protegida | Medio | |
| Refugio climático | Medio | Penaliza tundra expuesta |
| Riesgo de inundación | Penalización | Cercanía al río en cota baja |
| Depredadores | Penalización | |

La puntuación resultante va de 0 a 100.

### Umbral móvil

El umbral de aceptación **baja con la desesperación** de la banda (moral
baja, muertes recientes, hambre, invierno encima). Una banda cómoda rechaza
un valle mediocre y sigue caminando; una banda castigada acepta ese mismo
valle.

Esto es intencional y es la fuente principal de narrativa: la misma máquina
produce "eligieron bien" y "se conformaron".

### Consenso

Cada NPC adulto puntúa el sitio con sus propios pesos, modulados por sus
rasgos. Los ancianos pesan más. La decisión se toma con la media ponderada.
Cuando un NPC discrepa por encima de un margen, su desacuerdo se registra en
la crónica con su nombre, y queda disponible para contrastar después.

### Transparencia

Al tocar un sitio candidato se abre el desglose completo: cada factor, su
valor, su peso y su aportación, más el umbral vigente y por qué está donde
está. Esta pantalla no es un extra de depuración: es el modo en que el juego
comunica su sistema.

## 7. Interfaz: iPhone 17 Pro Max

Objetivo: 1320x2868 px, 6.9 pulgadas, vertical, con Dynamic Island arriba y
barra de gestos abajo. Manejable con un pulgar.

- El mapa ocupa toda la pantalla. El HUD flota translúcido encima.
- Altura con `100dvh` y relleno con `env(safe-area-inset-*)`, de modo que
  ningún control quede bajo la isla ni bajo la barra de gestos.
- Franja superior compacta: día, estación, clima, población.
- Barra inferior al alcance del pulgar: pausa y velocidad (x1, x3, x10), y
  tres botones — Banda, Crónica, Mundo — que abren hojas deslizables desde
  abajo con enganche al 45% y al 90% de la altura.
- Todo contenido profundo vive en el tercio inferior de la pantalla.
- Gestos: arrastrar mueve la cámara, pinza hace zoom, un toque sobre un NPC
  abre su ficha, doble toque acerca.
- Objetivos táctiles de 44 pt como mínimo. Sin dependencia de `hover`.
  `touch-action: none` sobre el lienzo, sin rebote de scroll, sin selección
  de texto accidental.
- Capa de recursos conmutable, que tiñe el mapa según lo que la banda conoce.

## 8. Guardados

### Formato en almacenamiento local

- `huehuet.saves.v1` — índice: lista de slots con id, nombre, día, era,
  población, miniatura y fecha de última escritura.
- `huehuet.save.<id>` — una clave por partida.

Un slot corrupto no puede arrastrar a los demás, porque el índice y los datos
están separados y cada partida vive en su propia clave.

### Qué se guarda

La semilla y las diferencias, no el mundo generado. Como la generación es
determinista, el terreno se reconstruye al cargar. Se guardan explícitamente:
semilla, número de tick, estado de los NPCs, inventario de la banda, celdas
descubiertas, recursos consumidos, edificios construidos y la crónica.

### Pantalla de inicio

Lista de slots con sus datos y miniatura. Acciones: Nueva partida, Continuar,
Renombrar, Borrar con confirmación. Es la primera pantalla del juego.

### Versionado

`schema.js` guarda un número de versión en cada partida y aplica migraciones
en cadena al cargar. Una partida de la Etapa 1 debe poder abrirse en la
Etapa 2.

### Autoguardado

Cada cierto número de días de juego al slot activo, más guardado manual desde
la hoja de Mundo.

## 9. Manejo de errores

| Fallo | Respuesta |
|---|---|
| Almacenamiento lleno o bloqueado (Safari privado) | Avisar una vez y seguir en memoria; la sesión no se interrumpe |
| Partida corrupta o ilegible | Marcar el slot como dañado en la lista, sin romper los demás; ofrecer borrarlo |
| Versión de esquema desconocida | Marcar el slot como de versión superior y no abrirlo |
| Generación sin ningún sitio viable | La generación valida y regenera antes de entregar el mundo: siempre hay al menos un sitio con agua |
| Banda extinta | Fin de partida con resumen de la crónica; el slot se conserva como lectura |

## 10. Pruebas

Runner integrado de Node (`node:test`), sin dependencias.

Lógica de simulación:

- Determinismo: la misma semilla produce el mismo mundo y, tras N ticks sin
  entrada, el mismo estado.
- `sitescore`: un sitio con agua siempre gana a uno sin agua; un sitio sin
  agua puntúa cero; subir la caza sube la puntuación de forma monótona.
- Umbral: con la misma lista de sitios, una banda desesperada acepta uno que
  una banda cómoda rechaza.
- Necesidades: nunca salen del rango 0-100 bajo ninguna secuencia de acciones.
- Guardado: ida y vuelta completa reproduce el estado; migración de una
  versión anterior produce un estado válido.
- Generación: todo mundo generado contiene al menos un sitio viable.

Interfaz, en navegador real a 1320x2868:

- Ningún control queda fuera de las áreas seguras.
- Los botones de la barra inferior miden 44 pt o más.
- La pantalla de slots permite crear, continuar y borrar una partida.
- El lienzo no provoca scroll ni rebote de la página.

## 11. Relación con el contenido existente del repositorio

El repositorio contiene hoy un proyecto Godot sin relación con este juego
("Corazones de Aetheria": `project.godot`, `scenes/`, `scripts/`, `tests/`).

Este proyecto es independiente y vive bajo `index.html`, `src/` y
`tests/huehuet/`. No se borra ni se modifica nada del proyecto Godot
existente; conviven en el mismo repositorio. Si más adelante se decide
retirarlo, será una tarea aparte con su propia aprobación.
