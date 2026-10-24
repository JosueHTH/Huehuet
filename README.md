# Corazones de Aetheria

Simulador de citas ecchi de fantasía hecho en **Godot 4.3** (GDScript). Solo para mayores de edad.

Tono: pícaro y de fan service (situaciones comprometedoras, coqueteo, humor), sin contenido explícito.
Las escenas más subidas de tono cortan a negro. Todos los personajes son adultos.

## Cómo se juega
Tienes 30 días hasta la Luna de Rosas. Cada día tiene Mañana, Tarde y Noche, y en cada momento eliges:

- **Entrenar** Valor, Encanto o Magia (máx. 10). Desbloquean opciones en los eventos y dan más afecto al charlar.
- **Trabajar** en el gremio para conseguir oro (+25).
- **Visitar** a una heroína. Cada una solo está disponible en ciertos momentos del día.
  - *Charlar*: una vez al día por heroína. Sube el afecto y dispara eventos de historia en 4, 8 y 12 de afecto.
  - *Regalar* (20 de oro): +2 de afecto, una vez al día por heroína, sin gastar el momento.
- Si pasas 4 días sin hablar con alguien que ya conoces, su afecto baja.
- Día 10 (noche): Festival de las Linternas. Día 20 (mañana): las Termas.

Finales: uno por heroína (afecto 12+ y haber visto su tercer evento), final de amigos y final en solitario.

| Heroína | Aparece | Le gusta |
|---|---|---|
| Lyra, arquera élfica | Mañana y Tarde | Valor |
| Seraphine, sacerdotisa | Mañana y Noche | Encanto |
| Mira, hechicera kitsune | Tarde y Noche | Magia |

## Ejecutar
```
godot --path .          # abre y juega (Godot 4.3+)
```
Desde el editor de Godot: importa la carpeta y pulsa F5.

## Estructura
- `scripts/game_state.gd`: estado global y guardado (autoload `GS`).
- `scripts/data.gd`: heroínas, textos de acciones y finales.
- `scripts/events.gd`: guion y eventos. Para añadir diálogos edita este archivo.
- `scripts/main.gd`: interfaz, motor de diálogo y bucle de juego (la UI se crea por código).
- `scripts/portrait.gd`: retratos dibujados por código. Se pueden sustituir por arte propio.
- `tests/shots.gd`: capturas de pantalla para revisar la UI.

## Pruebas
```
godot --headless --path . -- --autoplay      # juega una partida completa al azar y muestra el resumen
```
