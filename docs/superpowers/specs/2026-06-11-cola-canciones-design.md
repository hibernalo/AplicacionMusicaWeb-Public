# Diseño: Sistema de cola de canciones

**Fecha:** 2026-06-11
**Proyecto:** Aplicación Web de Música (Vanilla JS + Firebase)

## Objetivo

Añadir una cola de reproducción manual con prioridad. El usuario puede encolar
canciones desde cada tarjeta y ver/gestionar la cola en un panel lateral derecho
que se abre con un botón en la cabecera.

## Decisiones tomadas (brainstorming)

1. **Posición del botón de cabecera:** a la derecha del botón ⋮ "Opciones de
   vista" (`viewModeBtn`), antes del botón de usuario.
2. **Contenido del panel:** estilo Spotify — "Reproduciendo ahora" + "En cola"
   (manual) + "A continuación" (próximas de la lista/aleatorio actual).
3. **Orden dentro de la cola:** LIFO. Cada canción añadida se coloca al
   principio; la última añadida suena primero.
4. **Persistencia:** sí, en `localStorage` (por navegador, no por usuario ni
   Firestore). Se restaura al recargar.
5. **Clic en una canción de la cola:** suena ya y se quita de la cola, junto con
   las que estaban por encima de ella.
6. **Botón de encolar en la tarjeta:** esquina superior izquierda (el `+` de
   playlist ya ocupa la superior derecha).
7. **`repeat one`:** al terminar sola, repite la canción actual (la cola espera).
   Si el usuario pulsa "siguiente" manualmente, sí consume de la cola.
8. **Panel:** overlay deslizante desde la derecha; no recoloca el contenido.

## Arquitectura

Un módulo nuevo más cambios de integración en módulos existentes.

| Archivo | Cambio |
|---|---|
| `js/queue-manager.js` | **NUEVO.** Estado de la cola, prioridad LIFO, persistencia, eventos |
| `js/audio-player.js` | `playNext()`/`onSongEnded()` consultan la cola antes de la lista; expone "próximas de la lista" |
| `js/ui-manager.js` | Botón "+cola" en cada tarjeta (arriba-izq); render del panel derecho |
| `index.html` | Botón de cola en cabecera (derecha del ⋮) + markup del panel `<aside>` |
| `js/app.js` | Instancia `queueManager`, conecta eventos y el toggle del panel |
| `css/styles.css` | Estilos del panel deslizante, botón de cabecera, botón de tarjeta, botón quitar |

## Componentes

### `queue-manager.js` (nuevo)

Clase `QueueManager`. Mantiene un array de objetos canción **completos** (necesita
`audioPath`, `coverPath`, etc. para reproducir y renderizar sin refetch).

API pública:

- `add(song)` — `unshift(song)` (LIFO: la nueva al principio). Persiste y emite
  `queueChanged`.
- `takeNext()` — `shift()` la primera y la devuelve (para reproducir). Persiste y
  emite `queueChanged`.
- `jumpTo(songId)` — devuelve la canción objetivo y descarta de la cola esa y
  todas las anteriores a ella; el resto permanece. Persiste y emite.
- `remove(songId)` — quita una canción concreta de la cola (botón `[x]`).
- `clear()` — vacía la cola.
- `getQueue()` — devuelve copia del array.
- `isEmpty()` — helper.

Persistencia:
- Clave `localStorage`: `musicQueue`.
- Guarda el array serializado en cada mutación.
- En el constructor, restaura desde `localStorage` (con `try/catch` por si el
  JSON está corrupto).

Eventos: emite `queueChanged` vía `CustomEvent` en `document` tras cada mutación.

### `audio-player.js` (cambios)

Regla central: **la cola manual siempre tiene prioridad sobre el "siguiente"
normal.**

- `playNext()`: al principio, si `queueManager` no está vacío →
  `const next = queueManager.takeNext(); this.playSong(next)` y `return`. Si está
  vacía → lógica actual (lista normal / aleatorio).
- `onSongEnded()`:
  - `repeat one` → repite la canción actual (sin tocar la cola).
  - resto de modos → delega en `playNext()` (que ya prioriza la cola).
- Nuevo método `getUpcomingFromList(limite = 20)`: devuelve las próximas canciones
  de la lista para la sección "A continuación" del panel.
  - En aleatorio: las primeras `limite` de `shuffleQueue`.
  - En normal: tramo de `songList` tras `currentIndex` (respetando `repeat all`
    para dar la vuelta si procede).

El `queueManager` se inyecta/importa donde sea necesario (import del singleton,
igual que `userLikesService`).

### `ui-manager.js` (cambios)

1. Botón **encolar** en `createDefaultCard` y `createListCard`:
   - Clase `song-card-queue-btn`, posición esquina superior izquierda.
   - `click` → `e.stopPropagation()` + `CustomEvent('addSongToQueue', { detail: { song } })`.
   - No abre el panel automáticamente.

2. Render del panel derecho. Método `renderQueuePanel({ currentSong, queue, upcoming })`:
   - Sección "Reproduciendo ahora": canción actual (o vacío).
   - Sección "En cola": lista numerada; cada fila con clic (reproducir+consumir)
     y botón `[x]` (quitar). Botón "Limpiar" en la cabecera de la sección.
   - Sección "A continuación (de la lista)": solo lectura.
   - Estado vacío: "La cola está vacía".
   - Métodos `openQueuePanel()` / `closeQueuePanel()` / `toggleQueuePanel()`.

### `index.html` (cambios)

1. Botón de cabecera tras `view-mode-container`:
   ```
   [contador] [🔇 vol] [⋮ vista] [≡ COLA] [👤 usuario]
   ```
   `<button id="queueToggleBtn" title="Cola de reproducción">` con icono de lista.

2. `<aside id="queuePanel">` (oculto por defecto) con la estructura de secciones
   descrita arriba y un botón de cerrar.

### `app.js` (cambios)

- Importar e instanciar `queueManager` (singleton).
- `addSongToQueue` → `queueManager.add(song)`.
- `queueToggleBtn` click → `uiManager.toggleQueuePanel()`.
- `queueChanged` → recoger `currentSong` + `queue` + `audioPlayer.getUpcomingFromList()`
  y llamar a `uiManager.renderQueuePanel(...)`.
- También re-render al cambiar de canción (`songChanged`) para refrescar
  "Reproduciendo ahora" y "A continuación".
- Delegación de eventos del panel: clic en fila de cola → `queueManager.jumpTo` +
  `audioPlayer.playSong`; clic en `[x]` → `queueManager.remove`; "Limpiar" →
  `queueManager.clear`; cerrar → `uiManager.closeQueuePanel`.

### `css/styles.css` (cambios)

- `#queuePanel`: panel fijo a la derecha, `transform: translateX(100%)` oculto →
  `translateX(0)` visible, con `transition`. Ancho fijo (~320px), tema oscuro
  coherente con el resto.
- `.song-card-queue-btn`: esquina superior izquierda de la tarjeta, mismo estilo
  visual que `.song-card-add-btn`.
- Estilos de filas de cola, botón `[x]`, botón "Limpiar", secciones.

## Flujo de datos

```
Tarjeta [+cola] ──addSongToQueue──> app.js ──> queueManager.add()
                                                     │
                                                queueChanged
                                                     │
                                          app.js recoge estado
                                                     │
                                    uiManager.renderQueuePanel()

Fin de canción / botón siguiente ──> audioPlayer.playNext()
                                          │
                                  ¿cola no vacía?
                                   sí │        │ no
                          takeNext()  │        │ lógica lista/aleatorio
                                playSong(next)
```

## Casos límite

- **Canción en cola inexistente:** al fallar la carga del audio se avisa (como ya
  hace `playSong`) y se continúa.
- **Sin canción sonando:** el panel se abre igual; "Reproduciendo ahora" vacío.
- **`localStorage` corrupto:** `try/catch` en la restauración → cola vacía.
- **Cola por navegador:** independiente de login; no se sincroniza con Firestore.
- **Aleatorio + cola:** la cola gana; al vaciarse se retoma `shuffleQueue`.

## Fuera de alcance (YAGNI)

- Reordenar la cola por arrastre.
- Sincronizar la cola entre dispositivos / Firestore.
- Encolar álbumes/playlists completos de una vez.
