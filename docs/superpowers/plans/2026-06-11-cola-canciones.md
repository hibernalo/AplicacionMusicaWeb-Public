# Sistema de Cola de Canciones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir una cola de reproducción manual con prioridad LIFO, persistente en localStorage, gestionable desde un panel lateral derecho y un botón de encolar en cada tarjeta.

**Architecture:** Un módulo nuevo `queue-manager.js` (singleton, estado + persistencia + eventos) integrado en los módulos existentes. `audio-player.js` consulta la cola antes de avanzar a la lista normal. `ui-manager.js` renderiza el panel y añade el botón de tarjeta. `app.js` cablea los eventos.

**Tech Stack:** Vanilla JS ES6 modules, Firebase compat v10.7.1, sin bundler ni framework. Sin test runner: la verificación es **manual en el navegador** vía `python -m http.server 8000` (ver CLAUDE.md → Setup Local). El único módulo con test aislado es `queue-manager.js` mediante un harness HTML standalone.

**Convención del proyecto:** código y UI en español; módulos ES6 con `export default` de un singleton (ver `user-likes-service.js`); eventos vía `CustomEvent` en `document`.

---

## Mapa de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `js/queue-manager.js` | Estado de la cola, LIFO, persistencia localStorage, eventos | Crear |
| `test/queue-manager.test.html` | Harness manual aislado para la lógica de la cola | Crear |
| `js/audio-player.js` | Prioridad de la cola en `playNext`/`onSongEnded`; `getUpcomingFromList` | Modificar |
| `js/ui-manager.js` | Botón "+cola" en tarjetas; render del panel derecho | Modificar |
| `index.html` | Botón de cabecera + markup del panel `<aside>` | Modificar |
| `js/app.js` | Instanciar `queueManager`, cablear eventos y toggle del panel | Modificar |
| `css/styles.css` | Estilos del panel, botón de cabecera, botón de tarjeta, botón quitar | Modificar |

> **Nota sobre orden de scripts:** los módulos se importan con `import` ES6, así que el orden de los `<script>` en `index.html` no importa para `queue-manager.js` mientras se importe donde se use. Verificar cómo se importan los servicios actuales (p. ej. `import userLikesService from './user-likes-service.js'`) y seguir el mismo patrón.

---

## Task 1: Crear `queue-manager.js` con lógica LIFO y persistencia

**Files:**
- Create: `js/queue-manager.js`
- Test: `test/queue-manager.test.html`

- [ ] **Step 1: Escribir el módulo `queue-manager.js`**

Create `js/queue-manager.js`:

```javascript
/**
 * Gestor de la cola de reproducción manual.
 * Prioridad LIFO: la última canción añadida suena primero.
 * Persiste en localStorage (por navegador).
 */
class QueueManager {
    constructor() {
        this.STORAGE_KEY = 'musicQueue';
        this.queue = []; // array de objetos canción completos
        this.restore();
    }

    /**
     * Añade una canción al PRINCIPIO de la cola (LIFO).
     * Si ya estaba en la cola, la mueve al principio.
     * @param {Object} song - Objeto canción completo (con id, audioPath, etc.)
     */
    add(song) {
        if (!song || !song.id) return;
        // Evitar duplicados: si ya está, quitarla antes de re-insertar al frente
        this.queue = this.queue.filter(s => s.id !== song.id);
        this.queue.unshift(song);
        this.persist();
        this.dispatchChange();
    }

    /**
     * Saca y devuelve la primera canción de la cola (la que suena a continuación).
     * @returns {Object|null} Canción o null si la cola está vacía
     */
    takeNext() {
        if (this.queue.length === 0) return null;
        const next = this.queue.shift();
        this.persist();
        this.dispatchChange();
        return next;
    }

    /**
     * Salta a una canción de la cola: la devuelve y descarta esa y todas las
     * anteriores a ella. El resto permanece.
     * @param {string} songId - ID de la canción objetivo
     * @returns {Object|null} Canción objetivo o null si no está en la cola
     */
    jumpTo(songId) {
        const index = this.queue.findIndex(s => s.id === songId);
        if (index === -1) return null;
        const target = this.queue[index];
        this.queue = this.queue.slice(index + 1);
        this.persist();
        this.dispatchChange();
        return target;
    }

    /**
     * Quita una canción concreta de la cola sin reproducirla.
     * @param {string} songId - ID de la canción a quitar
     */
    remove(songId) {
        const before = this.queue.length;
        this.queue = this.queue.filter(s => s.id !== songId);
        if (this.queue.length !== before) {
            this.persist();
            this.dispatchChange();
        }
    }

    /** Vacía la cola por completo. */
    clear() {
        if (this.queue.length === 0) return;
        this.queue = [];
        this.persist();
        this.dispatchChange();
    }

    /** @returns {Array} Copia del array de la cola. */
    getQueue() {
        return [...this.queue];
    }

    /** @returns {boolean} true si la cola está vacía. */
    isEmpty() {
        return this.queue.length === 0;
    }

    /** Guarda la cola en localStorage. */
    persist() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.queue));
        } catch (error) {
            console.error('QueueManager: error guardando la cola', error);
        }
    }

    /** Restaura la cola desde localStorage (tolerante a JSON corrupto). */
    restore() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                this.queue = Array.isArray(parsed) ? parsed : [];
            }
        } catch (error) {
            console.error('QueueManager: error restaurando la cola, se vacía', error);
            this.queue = [];
        }
    }

    /** Emite el evento queueChanged para que la UI se redibuje. */
    dispatchChange() {
        const event = new CustomEvent('queueChanged', { detail: { queue: this.getQueue() } });
        document.dispatchEvent(event);
    }
}

// Singleton, igual que el resto de servicios del proyecto
const queueManager = new QueueManager();
export default queueManager;
```

- [ ] **Step 2: Crear el harness de prueba aislado**

Create `test/queue-manager.test.html`:

```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Test QueueManager</title>
</head>
<body>
    <h1>QueueManager — resultados</h1>
    <pre id="out"></pre>
    <script type="module">
        // Limpiar estado previo antes de importar (el constructor llama a restore())
        localStorage.removeItem('musicQueue');
        const queueManager = (await import('../js/queue-manager.js')).default;

        const out = document.getElementById('out');
        let passed = 0, failed = 0;
        function assert(cond, msg) {
            if (cond) { passed++; out.textContent += `PASS: ${msg}\n`; }
            else { failed++; out.textContent += `FAIL: ${msg}\n`; }
        }
        const ids = q => q.map(s => s.id).join(',');

        // add() es LIFO
        queueManager.clear();
        queueManager.add({ id: 'A', title: 'A' });
        queueManager.add({ id: 'B', title: 'B' });
        queueManager.add({ id: 'C', title: 'C' });
        assert(ids(queueManager.getQueue()) === 'C,B,A', 'add() inserta al principio (LIFO)');

        // add() duplicado mueve al frente
        queueManager.add({ id: 'A', title: 'A' });
        assert(ids(queueManager.getQueue()) === 'A,C,B', 'add() duplicado mueve al frente');

        // takeNext() saca el primero
        const first = queueManager.takeNext();
        assert(first.id === 'A', 'takeNext() devuelve el primero');
        assert(ids(queueManager.getQueue()) === 'C,B', 'takeNext() quita el primero');

        // jumpTo() descarta la objetivo y las anteriores
        queueManager.clear();
        ['B','A','C','D'].forEach(id => {}); // reset manual
        queueManager.queue = [{id:'D'},{id:'C'},{id:'A'},{id:'B'}];
        const jumped = queueManager.jumpTo('A');
        assert(jumped.id === 'A', 'jumpTo() devuelve la objetivo');
        assert(ids(queueManager.getQueue()) === 'B', 'jumpTo() descarta objetivo + anteriores, deja el resto');

        // remove() quita una concreta
        queueManager.queue = [{id:'D'},{id:'C'},{id:'A'},{id:'B'}];
        queueManager.remove('C');
        assert(ids(queueManager.getQueue()) === 'D,A,B', 'remove() quita la canción indicada');

        // clear() vacía
        queueManager.clear();
        assert(queueManager.isEmpty(), 'clear() vacía la cola');

        // persistencia: persist + nueva lectura de localStorage
        queueManager.add({ id: 'X', title: 'X' });
        const stored = JSON.parse(localStorage.getItem('musicQueue'));
        assert(stored.length === 1 && stored[0].id === 'X', 'persist() guarda en localStorage');

        out.textContent += `\nTOTAL: ${passed} passed, ${failed} failed\n`;
        document.title = failed === 0 ? 'TEST OK' : 'TEST FAIL';
    </script>
</body>
</html>
```

- [ ] **Step 3: Ejecutar el harness y verificar que pasa**

Arrancar el servidor (desde la raíz del proyecto):

```bash
python -m http.server 8000
```

Abrir `http://localhost:8000/test/queue-manager.test.html` en el navegador.
Expected: todas las líneas dicen `PASS`, el pie muestra `TOTAL: 8 passed, 0 failed`, y el título de la pestaña pasa a `TEST OK`.

- [ ] **Step 4: Commit**

```bash
git add js/queue-manager.js test/queue-manager.test.html
git commit -m "feat(cola): queue-manager con LIFO y persistencia"
```

---

## Task 2: Botón "+cola" en cada tarjeta (`ui-manager.js`)

**Files:**
- Modify: `js/ui-manager.js` (dentro de `createDefaultCard` y `createListCard`)

> Contexto: `createDefaultCard` añade ya un `addToPlaylistBtn` (clase `song-card-add-btn`, esquina superior derecha) que hace `e.stopPropagation()` y dispara `CustomEvent('addSongToPlaylist', ...)`. Replicamos ese patrón para la cola, en la esquina superior **izquierda**, disparando `addSongToQueue`. Hacemos lo mismo en `createListCard`.

- [ ] **Step 1: Añadir el botón en `createDefaultCard`**

En `js/ui-manager.js`, dentro de `createDefaultCard`, justo después del bloque que crea y añade `addToPlaylistBtn` (tras `card.appendChild(addToPlaylistBtn);`), insertar:

```javascript
        // Botón para añadir a la cola (esquina superior izquierda)
        const addToQueueBtn = document.createElement('button');
        addToQueueBtn.className = 'song-card-queue-btn';
        addToQueueBtn.title = 'Añadir a la cola';
        addToQueueBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 10h11v2H3v-2zm0-4h11v2H3V6zm0 8h7v2H3v-2zm13-1v4l4-2-4-2z"/>
            </svg>
        `;
        addToQueueBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Evitar que se active el click del card
            const event = new CustomEvent('addSongToQueue', { detail: { song } });
            document.dispatchEvent(event);
        });
        card.appendChild(addToQueueBtn);
```

- [ ] **Step 2: Añadir el botón en `createListCard`**

En `js/ui-manager.js`, dentro de `createListCard`, localizar el bloque equivalente donde se crea su `addToPlaylistBtn` (misma clase `song-card-add-btn`) y, tras añadirlo al card, insertar el mismo bloque del Step 1 (idéntico código). Repetir el código completo:

```javascript
        // Botón para añadir a la cola (esquina superior izquierda)
        const addToQueueBtn = document.createElement('button');
        addToQueueBtn.className = 'song-card-queue-btn';
        addToQueueBtn.title = 'Añadir a la cola';
        addToQueueBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 10h11v2H3v-2zm0-4h11v2H3V6zm0 8h7v2H3v-2zm13-1v4l4-2-4-2z"/>
            </svg>
        `;
        addToQueueBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const event = new CustomEvent('addSongToQueue', { detail: { song } });
            document.dispatchEvent(event);
        });
        card.appendChild(addToQueueBtn);
```

- [ ] **Step 3: Estilo mínimo del botón para poder verlo**

En `css/styles.css`, localizar la regla de `.song-card-add-btn` (botón existente arriba-derecha) y, justo debajo, añadir una regla espejo para la izquierda. Copiar las propiedades de `.song-card-add-btn` pero cambiando la posición horizontal a la izquierda:

```css
.song-card-queue-btn {
    position: absolute;
    top: 8px;
    left: 8px;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.2s, background 0.2s;
    z-index: 2;
}

.song-card:hover .song-card-queue-btn {
    opacity: 1;
}

.song-card-queue-btn:hover {
    background: var(--color-primary, #1db954);
}
```

> Nota: si los valores reales de `.song-card-add-btn` difieren (tamaño, color, variable CSS del verde), ajustar para que ambos botones se vean idénticos salvo el lado. Comprobar la regla real antes de copiar.

- [ ] **Step 4: Verificar en el navegador**

Con `python -m http.server 8000` corriendo, abrir `http://localhost:8000`.
Expected:
- Al pasar el ratón por una tarjeta aparece un botón redondo arriba a la **izquierda** (icono de lista con flecha) además del `+` de arriba a la derecha.
- Click en el botón de la izquierda NO reproduce la canción (no se dispara el click de la tarjeta).
- En consola, añadir temporalmente `document.addEventListener('addSongToQueue', e => console.log('encolar', e.detail.song.title))` desde DevTools y comprobar que al pulsar el botón se imprime el título. (Solo verificación; no commitear este listener.)

- [ ] **Step 5: Commit**

```bash
git add js/ui-manager.js css/styles.css
git commit -m "feat(cola): botón de encolar en tarjetas (grid y lista)"
```

---

## Task 3: Prioridad de la cola en `audio-player.js`

**Files:**
- Modify: `js/audio-player.js` (imports, `playNext`, `onSongEnded`, nuevo `getUpcomingFromList`)

> Contexto: `playNext()` (líneas ~907-943) decide la siguiente canción según shuffle/repeat. `onSongEnded()` (~948-973) delega según `repeatMode`/shuffle. Insertamos la cola como máxima prioridad en `playNext()`. `onSongEnded` con `repeat one` no debe tocar la cola.

- [ ] **Step 1: Importar el queueManager**

En `js/audio-player.js`, junto a los imports existentes del inicio del archivo (`import userLikesService from './user-likes-service.js';`), añadir:

```javascript
import queueManager from './queue-manager.js';
```

- [ ] **Step 2: Dar prioridad a la cola en `playNext()`**

En `js/audio-player.js`, al inicio del método `playNext()`, antes de `if (this.songList.length === 0) return;`, insertar:

```javascript
        // La cola manual tiene prioridad sobre la lista/aleatorio
        if (!queueManager.isEmpty()) {
            const nextFromQueue = queueManager.takeNext();
            if (nextFromQueue) {
                const idx = this.songList.findIndex(s => s.id === nextFromQueue.id);
                this.playSong(nextFromQueue, idx >= 0 ? idx : this.currentIndex);
                return;
            }
        }
```

- [ ] **Step 3: Verificar que `onSongEnded` respeta la prioridad**

Revisar `onSongEnded()` en `js/audio-player.js`. No requiere cambios de código: en `repeat one` repite la canción actual (correcto, la cola espera); en el resto de ramas (`repeat all`, shuffle, normal) acaba llamando a `this.playNext()`, que ahora ya prioriza la cola. Confirmar leyendo el método que todas las ramas no-`one` desembocan en `playNext()`. Si alguna rama del modo normal reproduce directamente sin pasar por `playNext()` (p. ej. el caso "volver a la primera canción" al final de la lista), anteponer también ahí la comprobación de cola:

```javascript
            } else if (this.isShuffle) {
                this.playNext();
            } else {
                // Modo normal sin repeat
                if (!queueManager.isEmpty()) {
                    this.playNext(); // playNext consumirá la cola
                } else if (this.currentIndex < this.songList.length - 1) {
                    this.playNext();
                } else {
                    this.currentIndex = 0;
                    const firstSong = this.songList[0];
                    if (firstSong) {
                        this.playSong(firstSong, 0);
                    }
                }
            }
```

> Sustituir la rama `else` final actual de `onSongEnded` por este bloque (mantiene el comportamiento existente y añade la comprobación de cola al inicio).

- [ ] **Step 4: Añadir `getUpcomingFromList()`**

En `js/audio-player.js`, añadir un método nuevo a la clase (p. ej. justo después de `getCurrentIndex()`):

```javascript
    /**
     * Devuelve las próximas canciones de la lista (no de la cola manual),
     * para mostrarlas en la sección "A continuación" del panel.
     * @param {number} limite - Máximo de canciones a devolver
     * @returns {Array} Próximas canciones de la lista
     */
    getUpcomingFromList(limite = 20) {
        if (this.isShuffle) {
            return this.shuffleQueue.slice(0, limite);
        }
        if (this.songList.length === 0) return [];
        const upcoming = [];
        for (let i = this.currentIndex + 1; i < this.songList.length && upcoming.length < limite; i++) {
            upcoming.push(this.songList[i]);
        }
        // En repeat all, dar la vuelta desde el principio hasta la canción actual
        if (this.repeatMode === 'all' && upcoming.length < limite) {
            for (let i = 0; i < this.currentIndex && upcoming.length < limite; i++) {
                upcoming.push(this.songList[i]);
            }
        }
        return upcoming;
    }
```

- [ ] **Step 5: Verificar prioridad de cola en el navegador**

Con el servidor corriendo y `http://localhost:8000` abierto:
1. Reproducir cualquier canción.
2. En DevTools console: `const qm = (await import('/js/queue-manager.js')).default;` y `const ap = window.app?.audioPlayer || null;` — si `app` no está expuesto, usar el botón de tarjeta del Task 2 para encolar 2 canciones distintas (las llamaremos D y C, añadidas en ese orden → cola [C, D] no; recordar LIFO: añadir D luego C → [C, D]).
3. Pulsar el botón "siguiente" (`nextBtn`) del reproductor.
Expected: empieza a sonar la primera de la cola (la última añadida) y desaparece de la cola. Pulsar "siguiente" otra vez → suena la segunda de la cola. Tras agotar la cola, "siguiente" vuelve a la lista normal.

> Si `window.app` no expone nada útil, basta con verificar el comportamiento audible: encolar con los botones y pulsar siguiente. La verificación del panel completa llega en Task 5.

- [ ] **Step 6: Commit**

```bash
git add js/audio-player.js
git commit -m "feat(cola): prioridad de la cola al avanzar de canción"
```

---

## Task 4: Botón de cabecera y markup del panel (`index.html`)

**Files:**
- Modify: `index.html` (cabecera + nuevo `<aside>`)
- Modify: `css/styles.css` (estilos del panel y del botón de cabecera)

- [ ] **Step 1: Añadir el botón de cola en la cabecera**

En `index.html`, localizar el cierre de `<div class="view-mode-container"> ... </div>` (el que contiene `viewModeBtn` y `viewModeDropdown`, termina justo antes de `<!-- User Auth Button -->`). Inmediatamente después de ese `</div>` de cierre y antes del comentario `<!-- User Auth Button -->`, insertar:

```html
                    <!-- Queue Button -->
                    <button class="control-btn" id="queueToggleBtn" title="Cola de reproducción">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M3 10h11v2H3v-2zm0-4h11v2H3V6zm0 8h7v2H3v-2zm13-1v4l4-2-4-2z"/>
                        </svg>
                    </button>
```

- [ ] **Step 2: Añadir el markup del panel**

En `index.html`, localizar el cierre de `<main class="main-content"> ... </main>`. Inmediatamente después de `</main>`, insertar el panel:

```html
            <!-- Panel de Cola de Reproducción -->
            <aside class="queue-panel" id="queuePanel">
                <div class="queue-panel-header">
                    <h2>Cola de reproducción</h2>
                    <button class="queue-panel-close" id="queuePanelClose" title="Cerrar">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                    </button>
                </div>
                <div class="queue-panel-body" id="queuePanelBody">
                    <!-- Renderizado dinámico por ui-manager.renderQueuePanel() -->
                </div>
            </aside>
```

- [ ] **Step 3: Estilos del botón de cabecera y del panel**

En `css/styles.css`, al final del archivo, añadir:

```css
/* Botón de cola en cabecera: usa el estilo de .control-btn ya existente */

/* Panel de cola deslizante */
.queue-panel {
    position: fixed;
    top: 0;
    right: 0;
    width: 340px;
    max-width: 90vw;
    height: 100%;
    background: var(--color-bg-elevated, #181818);
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.5);
    transform: translateX(100%);
    transition: transform 0.25s ease;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.queue-panel.open {
    transform: translateX(0);
}

.queue-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.queue-panel-header h2 {
    font-size: 1.1rem;
    margin: 0;
    color: #fff;
}

.queue-panel-close {
    background: none;
    border: none;
    color: #b3b3b3;
    cursor: pointer;
    padding: 4px;
    display: flex;
}

.queue-panel-close:hover {
    color: #fff;
}

.queue-panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
}

.queue-section-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #b3b3b3;
    margin: 16px 0 8px;
}

.queue-clear-btn {
    background: none;
    border: none;
    color: #b3b3b3;
    cursor: pointer;
    font-size: 0.75rem;
    text-transform: none;
    letter-spacing: 0;
}

.queue-clear-btn:hover {
    color: #fff;
    text-decoration: underline;
}

.queue-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 4px;
    border-radius: 4px;
}

.queue-row.clickable {
    cursor: pointer;
}

.queue-row.clickable:hover {
    background: rgba(255, 255, 255, 0.08);
}

.queue-row-cover {
    width: 40px;
    height: 40px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.1);
}

.queue-row-info {
    flex: 1;
    min-width: 0;
}

.queue-row-title {
    font-size: 0.9rem;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.queue-row-artist {
    font-size: 0.8rem;
    color: #b3b3b3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.queue-row.now-playing .queue-row-title {
    color: var(--color-primary, #1db954);
}

.queue-row.upcoming {
    opacity: 0.7;
}

.queue-remove-btn {
    background: none;
    border: none;
    color: #b3b3b3;
    cursor: pointer;
    padding: 4px;
    display: flex;
    flex-shrink: 0;
}

.queue-remove-btn:hover {
    color: #fff;
}

.queue-empty {
    color: #b3b3b3;
    font-size: 0.9rem;
    padding: 8px 4px;
}
```

> Nota: si el proyecto no define las variables `--color-bg-elevated` ni `--color-primary`, los fallbacks (`#181818`, `#1db954`) bastan. Comprobar en `:root` de `styles.css` qué variables existen y usarlas si están.

- [ ] **Step 4: Verificar markup y estilos (sin lógica todavía)**

Con el servidor corriendo, abrir `http://localhost:8000`.
Expected:
- En la cabecera aparece el nuevo botón de cola entre el ⋮ de vista y el de usuario.
- El panel no es visible (está fuera de pantalla a la derecha).
- En DevTools console, ejecutar `document.getElementById('queuePanel').classList.add('open')` → el panel se desliza desde la derecha y se ve la cabecera "Cola de reproducción" con su botón de cerrar. Ejecutar `...remove('open')` → se oculta. (Solo verificación visual; la lógica llega en Task 5.)

- [ ] **Step 5: Commit**

```bash
git add index.html css/styles.css
git commit -m "feat(cola): botón de cabecera y panel lateral (markup + estilos)"
```

---

## Task 5: Render del panel en `ui-manager.js`

**Files:**
- Modify: `js/ui-manager.js` (nuevos métodos de panel)

> Contexto: `ui-manager.js` ya usa `storageService.getCoverUrl(coverPath)` para portadas (ver `updateSongInfo` en audio-player y la carga lazy en ui-manager). Para el panel usamos portadas simples; si `coverPath` falta, dejamos el fondo gris del `.queue-row-cover`. Para no complicar con carga asíncrona de cada portada, en v1 mostramos las portadas con un `<img>` cuyo `src` se resuelve con `storageService.getCoverUrl` de forma perezosa por fila (sin bloquear el render).

- [ ] **Step 1: Añadir import de storageService si no está**

En `js/ui-manager.js`, comprobar los imports del inicio. Si no existe ya, añadir:

```javascript
import storageService from './storage-service.js';
```

> Si ya está importado, no duplicar.

- [ ] **Step 2: Añadir los métodos de panel a la clase UIManager**

En `js/ui-manager.js`, dentro de la clase `UIManager`, añadir estos métodos (p. ej. al final de la clase, antes del cierre):

```javascript
    /** Abre el panel de la cola. */
    openQueuePanel() {
        const panel = document.getElementById('queuePanel');
        if (panel) panel.classList.add('open');
    }

    /** Cierra el panel de la cola. */
    closeQueuePanel() {
        const panel = document.getElementById('queuePanel');
        if (panel) panel.classList.remove('open');
    }

    /** Alterna la visibilidad del panel de la cola. */
    toggleQueuePanel() {
        const panel = document.getElementById('queuePanel');
        if (panel) panel.classList.toggle('open');
    }

    /**
     * Renderiza el contenido del panel de la cola.
     * @param {Object} data
     * @param {Object|null} data.currentSong - Canción en reproducción
     * @param {Array} data.queue - Cola manual (objetos canción)
     * @param {Array} data.upcoming - Próximas de la lista (objetos canción)
     */
    renderQueuePanel({ currentSong, queue, upcoming }) {
        const body = document.getElementById('queuePanelBody');
        if (!body) return;
        body.innerHTML = '';

        // Reproduciendo ahora
        if (currentSong) {
            const title = document.createElement('div');
            title.className = 'queue-section-title';
            title.innerHTML = '<span>Reproduciendo ahora</span>';
            body.appendChild(title);
            body.appendChild(this.buildQueueRow(currentSong, { variant: 'now-playing' }));
        }

        // En cola (manual)
        const queueTitle = document.createElement('div');
        queueTitle.className = 'queue-section-title';
        queueTitle.innerHTML = '<span>En cola</span>';
        if (queue.length > 0) {
            const clearBtn = document.createElement('button');
            clearBtn.className = 'queue-clear-btn';
            clearBtn.id = 'queueClearBtn';
            clearBtn.textContent = 'Limpiar';
            queueTitle.appendChild(clearBtn);
        }
        body.appendChild(queueTitle);

        if (queue.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'queue-empty';
            empty.textContent = 'La cola está vacía';
            body.appendChild(empty);
        } else {
            queue.forEach(song => {
                body.appendChild(this.buildQueueRow(song, { variant: 'queued', removable: true, clickable: true }));
            });
        }

        // A continuación (de la lista)
        if (upcoming && upcoming.length > 0) {
            const upTitle = document.createElement('div');
            upTitle.className = 'queue-section-title';
            upTitle.innerHTML = '<span>A continuación</span>';
            body.appendChild(upTitle);
            upcoming.forEach(song => {
                body.appendChild(this.buildQueueRow(song, { variant: 'upcoming' }));
            });
        }
    }

    /**
     * Construye una fila del panel de la cola.
     * @param {Object} song
     * @param {Object} opts - { variant, removable, clickable }
     * @returns {HTMLElement}
     */
    buildQueueRow(song, opts = {}) {
        const row = document.createElement('div');
        row.className = 'queue-row';
        if (opts.variant) row.classList.add(opts.variant);
        if (opts.clickable) row.classList.add('clickable');
        row.dataset.songId = song.id;

        const cover = document.createElement('img');
        cover.className = 'queue-row-cover';
        cover.alt = song.title || '';
        if (song.coverPath) {
            storageService.getCoverUrl(song.coverPath)
                .then(url => { cover.src = url; })
                .catch(() => {});
        }

        const info = document.createElement('div');
        info.className = 'queue-row-info';
        const t = document.createElement('div');
        t.className = 'queue-row-title';
        t.textContent = song.title || 'Sin título';
        const a = document.createElement('div');
        a.className = 'queue-row-artist';
        a.textContent = song.artist || 'Artista desconocido';
        info.appendChild(t);
        info.appendChild(a);

        row.appendChild(cover);
        row.appendChild(info);

        if (opts.clickable) {
            row.addEventListener('click', () => {
                const event = new CustomEvent('queueRowClick', { detail: { songId: song.id } });
                document.dispatchEvent(event);
            });
        }

        if (opts.removable) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'queue-remove-btn';
            removeBtn.title = 'Quitar de la cola';
            removeBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
            `;
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const event = new CustomEvent('queueRowRemove', { detail: { songId: song.id } });
                document.dispatchEvent(event);
            });
            row.appendChild(removeBtn);
        }

        return row;
    }
```

- [ ] **Step 3: Verificar el render aislado**

Con el servidor corriendo y `http://localhost:8000` abierto, en DevTools console:

```javascript
const ui = (await import('/js/ui-manager.js')).default; // si exporta singleton; si no, usar la instancia global de app
ui.renderQueuePanel({
  currentSong: { id: '1', title: 'Actual', artist: 'Artista' },
  queue: [ { id: '2', title: 'Cola D', artist: 'X' }, { id: '3', title: 'Cola C', artist: 'Y' } ],
  upcoming: [ { id: '4', title: 'Lista X', artist: 'Z' } ]
});
document.getElementById('queuePanel').classList.add('open');
```

Expected: el panel muestra las tres secciones ("Reproduciendo ahora", "En cola" con botón "Limpiar" y filas con `[x]`, "A continuación"). Las filas de "En cola" reaccionan al hover (cursor pointer).

> Si `ui-manager.js` no exporta un singleton importable, usar la instancia que `app.js` cree (verificar cómo se instancia: si es `export default new UIManager()` o `export default UIManager`). Ajustar la verificación en consecuencia. Esto se confirma al leer el final de `ui-manager.js`.

- [ ] **Step 4: Commit**

```bash
git add js/ui-manager.js
git commit -m "feat(cola): render del panel de cola en ui-manager"
```

---

## Task 6: Cablear todo en `app.js`

**Files:**
- Modify: `js/app.js` (imports, instanciación, listeners de eventos)

> Contexto: `app.js` es el coordinador. Importa los servicios/managers, instancia `audioPlayer` y `uiManager`, y suscribe listeners a eventos de `document` (p. ej. `addSongToPlaylist`, `songChanged`, `songsLoaded`). Seguimos el mismo patrón. Antes de editar, leer cómo `app.js` referencia `audioPlayer` y `uiManager` (propiedades `this.audioPlayer` / `this.uiManager` o variables) y usar la misma forma.

- [ ] **Step 1: Importar el queueManager**

En `js/app.js`, junto a los imports de los demás módulos (`audio-player.js`, `ui-manager.js`, etc.), añadir:

```javascript
import queueManager from './queue-manager.js';
```

- [ ] **Step 2: Añadir un método que recoja el estado y repinte el panel**

En `js/app.js`, dentro de la clase principal, añadir un método helper (ajustar `this.audioPlayer` / `this.uiManager` a como se llamen realmente en el archivo):

```javascript
    /** Recoge el estado actual y repinta el panel de la cola. */
    refreshQueuePanel() {
        const currentSong = this.audioPlayer.getCurrentSong();
        const queue = queueManager.getQueue();
        const upcoming = this.audioPlayer.getUpcomingFromList(20);
        this.uiManager.renderQueuePanel({ currentSong, queue, upcoming });
    }
```

- [ ] **Step 3: Suscribir los listeners de la cola**

En `js/app.js`, en el lugar donde se registran los demás `document.addEventListener(...)` (junto a `addSongToPlaylist`, `songChanged`, etc.), añadir:

```javascript
        // Encolar una canción desde una tarjeta
        document.addEventListener('addSongToQueue', (e) => {
            queueManager.add(e.detail.song);
        });

        // La cola cambió: repintar el panel
        document.addEventListener('queueChanged', () => {
            this.refreshQueuePanel();
        });

        // Cambió la canción en reproducción: repintar "ahora" y "a continuación"
        document.addEventListener('songChanged', () => {
            this.refreshQueuePanel();
        });

        // Toggle del panel desde el botón de cabecera
        const queueToggleBtn = document.getElementById('queueToggleBtn');
        if (queueToggleBtn) {
            queueToggleBtn.addEventListener('click', () => {
                this.uiManager.toggleQueuePanel();
                this.refreshQueuePanel();
            });
        }

        // Cerrar el panel
        const queuePanelClose = document.getElementById('queuePanelClose');
        if (queuePanelClose) {
            queuePanelClose.addEventListener('click', () => {
                this.uiManager.closeQueuePanel();
            });
        }

        // Clic en una fila de la cola: saltar a esa canción y consumir la cola
        document.addEventListener('queueRowClick', (e) => {
            const song = queueManager.jumpTo(e.detail.songId);
            if (song) {
                const idx = this.audioPlayer.songList
                    ? this.audioPlayer.songList.findIndex(s => s.id === song.id)
                    : -1;
                this.audioPlayer.playSong(song, idx);
            }
        });

        // Quitar una fila de la cola
        document.addEventListener('queueRowRemove', (e) => {
            queueManager.remove(e.detail.songId);
        });

        // Limpiar la cola (delegación: el botón se recrea en cada render)
        document.addEventListener('click', (e) => {
            if (e.target && e.target.id === 'queueClearBtn') {
                queueManager.clear();
            }
        });
```

> Importante sobre el botón "Limpiar": se recrea en cada `renderQueuePanel`, por eso se usa **delegación** en `document` en lugar de un listener directo (que se perdería al repintar). Los botones `queueToggleBtn` y `queuePanelClose` son estáticos (existen en `index.html`), así que se les puede poner listener directo una sola vez.

- [ ] **Step 4: Verificación end-to-end en el navegador**

Con el servidor corriendo, abrir `http://localhost:8000` y probar el flujo completo:

1. **Encolar:** pasar el ratón por dos tarjetas distintas y pulsar su botón de cola (arriba-izq), primero en la canción D y luego en la C.
2. **Abrir panel:** pulsar el botón de cola de la cabecera. Expected: el panel se abre y muestra "En cola" con **C arriba y D debajo** (LIFO: la última añadida, C, primero).
3. **Prioridad:** reproducir una canción cualquiera y pulsar "siguiente". Expected: suena C (la primera de la cola) y desaparece de la cola en el panel.
4. **Clic en cola:** con la cola con varias, hacer clic en una fila inferior. Expected: empieza a sonar esa y desaparecen del panel ella y las de encima.
5. **Quitar:** pulsar `[x]` en una fila. Expected: esa fila desaparece, las demás permanecen.
6. **Limpiar:** pulsar "Limpiar". Expected: la sección "En cola" pasa a "La cola está vacía".
7. **Persistencia:** encolar 2 canciones, recargar con F5, abrir el panel. Expected: la cola sigue ahí.
8. **A continuación:** con una canción sonando y la cola vacía, el panel muestra la sección "A continuación" con las siguientes de la lista.

- [ ] **Step 5: Commit**

```bash
git add js/app.js
git commit -m "feat(cola): cableado de eventos de la cola en app.js"
```

---

## Task 7: Limpieza y verificación final

**Files:**
- Modify: ninguno nuevo (revisión)

- [ ] **Step 1: Revisar que no quedan listeners de depuración**

Buscar en el diff cualquier `console.log` temporal añadido durante la verificación y quitarlo. El harness `test/queue-manager.test.html` se queda (es útil), pero confirmar que no rompe el deploy (es un archivo estático aislado, no se importa desde la app).

- [ ] **Step 2: Repaso visual responsive**

Con el servidor corriendo, estrechar la ventana del navegador. Expected: el panel respeta `max-width: 90vw` y no rompe la cabecera. Si la cabecera se desborda en móvil, anotarlo como mejora futura (fuera de alcance de este plan).

- [ ] **Step 3: Verificación de regresión**

Comprobar que las funciones existentes siguen bien: reproducir/pausar, shuffle, repeat (off/all/one), filtros, búsqueda, añadir a playlist (botón `+` arriba-derecha sigue funcionando y es independiente del botón de cola arriba-izq).

- [ ] **Step 4: Commit final (si hubo limpieza)**

```bash
git add -A
git commit -m "chore(cola): limpieza y verificación final del sistema de cola"
```

---

## Resumen de cobertura del spec

- Botón de cabecera a la derecha del ⋮ → Task 4.
- Panel estilo Spotify (ahora / en cola / a continuación) → Tasks 4, 5.
- Orden LIFO → Task 1 (`add` con `unshift`), verificado en Task 6.
- Persistencia en localStorage → Task 1.
- Clic en cola = suena y se consume (junto con anteriores) → Task 1 (`jumpTo`) + Task 6.
- Botón de encolar arriba-izq en tarjetas → Task 2.
- `repeat one` no toca la cola → Task 3.
- Panel overlay deslizante → Task 4 (CSS).
- Quitar de la cola (`[x]`) y "Limpiar" → Tasks 5, 6.
- Casos límite (JSON corrupto, sin canción, canción inexistente) → Task 1 (`restore` try/catch), Task 5 (panel sin currentSong), comportamiento de `playSong` existente.
