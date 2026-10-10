# CLAUDE.md — Aplicacion Web de Musica

Guía de referencia para trabajar en este proyecto con Claude Code.

---

## Descripción del Proyecto

Aplicación web de música tipo Spotify construida con **Vanilla JavaScript + Firebase**. Permite gestionar y reproducir una colección de música con filtros avanzados, autenticación de usuarios, favoritos y playlists personalizadas. La interfaz está en español.

---

## Stack Tecnológico

- **Frontend:** HTML5, CSS3, JavaScript ES6+ (sin frameworks, sin bundler)
- **Base de datos:** Firebase Firestore (NoSQL)
- **Almacenamiento:** Firebase Cloud Storage
- **Autenticación:** Firebase Authentication (email/contraseña)
- **Hosting:** Firebase Hosting
- **Firebase SDK:** v10.7.1 (modo compat)

No hay `package.json`, `node_modules` ni proceso de build. Es JavaScript puro con módulos ES6.

---

## Estructura de Archivos

```
/
├── index.html                    # Punto de entrada, estructura HTML y modales
├── firebase.json                 # Config Firebase Hosting
├── firestore.rules               # Reglas de seguridad Firestore
├── .firebaserc                   # Proyecto Firebase
│
├── css/
│   └── styles.css               # Estilos (tema oscuro estilo Spotify, variables CSS)
│
└── js/
    ├── app.js                   # Coordinador principal (~1100 líneas)
    ├── audio-player.js          # Control de reproducción HTML5
    ├── song-prefetcher.js       # Precarga en memoria de la siguiente canción (transición sin red)
    ├── listening-stats-service.js  # Estadísticas de escucha: lógica pura (tiempo escuchado por canción/artista/género/source)
    ├── listening-stats.js       # Singleton de estadísticas cableado a Firestore/localStorage + disparadores de volcado
    ├── stats-view.js            # Vista "Estadísticas" (pestañas 7 días / mes / total, rankings top 10)
    ├── song-upload-service.js   # Subida de canciones: lógica pura (borradores, edición en bloque, validación, documento)
    ├── audio-metadata.js        # Lee tags/portada/duración de un archivo de audio en el navegador (music-metadata vía CDN)
    ├── song-uploader.js         # Orquesta la subida: duplicados, Storage, género/source/artista, documento, playlists
    ├── upload-view.js           # Vista "Subir canciones" (lista de archivos, editor individual y en bloque, progreso)
    ├── debug-log.js             # Registro de diagnóstico persistente (visor: triple toque en el título)
    ├── auth-service.js          # Wrapper Firebase Auth
    ├── firestore-service.js     # Consultas y operaciones Firestore
    ├── storage-service.js       # Subida/borrado Firebase Storage
    ├── song-list.js             # Estado de lista de canciones y paginación
    ├── ui-manager.js            # Renderizado DOM y gestión de vistas
    ├── user-likes-service.js    # Sistema de likes por usuario
    ├── easter-egg.js            # Easter egg interactivo
    ├── migration-script.js      # Script de migración de datos (no usar en producción)
    └── firebase-config.example.js  # Plantilla de configuración Firebase
```

> `js/firebase-config.js` no está en el repositorio. Es necesario crearlo a partir de `firebase-config.example.js` con las credenciales reales.

---

## Esquema de Base de Datos (Firestore)

### Colecciones principales

**`songs`** — Lectura pública, escritura solo admin
```js
{
  title: string,
  artist: string,
  album: string,
  genre: string,
  source: string,
  year: number,
  audioPath: string,       // ruta en Firebase Storage (e.g. "Audios/cancion.mp3")
  coverPath: string,       // ruta en Firebase Storage (e.g. "Covers/cancion.jpg")
  durationMs: number,
  rand: number,            // número aleatorio para ordenar en modo shuffle
  titleMinusculas: string  // título en minúsculas para búsqueda case-insensitive
}
```

**`genres`**, **`sources`**, **`artistas`**, **`years`** — Lectura pública, escritura solo admin

**`users/{userId}`** — Solo el propio usuario + admin
```js
{
  email: string,
  isAdmin: boolean,        // puede todo; solo un admin puede ponerlo
  canUpload: boolean,      // puede subir canciones desde la web; solo un admin puede ponerlo
  // Subcolección: likes/{songTitle} → { songId, title }
}
```

**`users/{userId}/listeningStats/{docId}`** — Solo el propio usuario. `docId` = `total` | `YYYY-MM` | `YYYY-MM-DD`
```js
{
  totalMs: number,                 // ms escuchados en el periodo
  songs:   { [songId]: number },   // ms por canción (clave: id del documento en songs)
  artists: { [artist]: number },   // ms por artista ("Desconocido" si falta)
  genres:  { [genre]: number },
  sources: { [source]: number }
}
```

**`playlists/{playlistId}`** — Lectura pública, creación autenticada, edición solo dueño/admin
```js
{
  name: string,
  ownerId: string,
  coverPath: string,
  songs: string[],         // array de títulos de canciones
  songCount: number,
  createdAt: timestamp
}
```

---

## Arquitectura de Módulos JS

| Módulo | Responsabilidad |
|--------|----------------|
| `app.js` | Inicialización, navegación, coordinación entre módulos, eventos globales |
| `audio-player.js` | Estado de reproducción, controles (play/pause/next/prev), shuffle/repeat, barra de progreso |
| `song-prefetcher.js` | Descarga entera (fetch → Blob) la canción que sonará después, para que el cambio de canción no dependa de la red |
| `listening-stats-service.js` | Tiempo escuchado por usuario: acumula ms por canción/artista/género/source, los persiste en `localStorage` y los vuelca a Firestore con `increment` (lógica pura, con test) |
| `listening-stats.js` | Construye el singleton anterior con Firestore/`localStorage`/`debug-log` y engancha los disparadores de volcado (cambio de canción, pausa, página oculta, red) |
| `stats-view.js` | Vista "Estadísticas": pestañas últimos 7 días / mes / total, flechas de mes y rankings top 10 |
| `song-upload-service.js` | Subida de canciones, lógica pura: deducir título/artista del nombre de archivo, borradores, edición en bloque, validación, rutas de Storage y documento `songs` (sin imports, con test) |
| `audio-metadata.js` | Lee título/artista/álbum/año/género/duración/portada de un archivo de audio en el navegador (carga `music-metadata` desde CDN bajo demanda) |
| `song-uploader.js` | Orquesta la subida de un borrador: comprueba duplicados, sube audio+portada, garantiza docs de género/source/artista, crea la canción; añade títulos a playlists |
| `upload-view.js` | Vista "Subir canciones": zona de arrastre, lista de archivos con selección, editor individual y en bloque (modal), progreso por archivo, resumen |
| `debug-log.js` | Caja negra: registro persistente en localStorage de eventos de reproducción/red/ciclo de vida; se abre con triple toque en el título del reproductor |
| `firestore-service.js` | Toda la lógica de consultas: paginación cursor-based, filtros, búsqueda, operaciones CRUD |
| `ui-manager.js` | Renderizado de DOM: tarjetas de canciones, vistas grid/lista, modales, estados de carga |
| `song-list.js` | Estado de la lista actual, caché, lógica de paginación (50 canciones/página) |
| `auth-service.js` | Registro, login, logout, listener de estado de autenticación |
| `user-likes-service.js` | Likes por usuario: guardar, eliminar, listar favoritos |
| `storage-service.js` | Subida y borrado de imágenes de portadas en Storage |

---

## Funcionalidades Principales

- **Reproductor de audio** completo (progress bar, volumen, shuffle, repeat one/all/off)
- **Filtros** por: favoritos, géneros, artistas, álbumes, años, fuentes (con submenús), playlists, recientes
- **Búsqueda** en tiempo real (context-aware: busca en el filtro activo o en canciones)
- **Autenticación** email/contraseña con persistencia de sesión
- **Sistema de likes** por usuario
- **Playlists** personalizadas con cover personalizable
- **Vistas** grid y lista
- **Paginación** cursor-based (50 canciones/página) con lazy loading de imágenes
- **Gestión de portadas** para canciones, artistas, géneros, fuentes y playlists
- **Easter egg** oculto al hacer clic en el logo
- **Estadísticas de escucha** por usuario: tiempo escuchado por canción, artista, género y source (total, por mes y últimos 7 días)
- **Subida de canciones desde la web** (solo usuarios con permiso): varios archivos a la vez, lectura de tags, edición individual y en bloque, playlists y portadas

---

## Reglas de Acceso (Firestore)

- **Lectura pública:** canciones, géneros, artistas, fuentes, años, playlists
- **Crear canciones/géneros/sources/artistas:** admin o usuario con `canUpload: true` (uploader)
- **Modificar/borrar canciones, géneros, sources, artistas y años:** solo admin
- **Likes:** solo el propio usuario
- **Playlists:** crear (autenticado), modificar (dueño o admin)
- **Estadísticas de escucha:** solo el propio usuario (`users/{uid}/listeningStats`)
- **Admin:** usuarios con `isAdmin: true` en su documento de Firestore
- **Permisos:** los campos `isAdmin` y `canUpload` de `users/{uid}` solo los puede crear/modificar un admin (el propio usuario no puede dárselos)

---

## Convenciones y Patrones

- El código y la UI están en **español** (variables, funciones, comentarios).
- Se usan **módulos ES6** (`import`/`export`), requiere servidor HTTP (no funciona con `file://`).
- No hay proceso de build. Los cambios en JS/CSS se reflejan directamente.
- Las rutas de audio/imagen en Firestore son **rutas relativas en Storage**, no URLs completas.
- `titleMinusculas` en songs es un campo auxiliar para hacer búsquedas case-insensitive.
- `rand` en songs es un número aleatorio entre 0 y 1 para paginación aleatoria eficiente.

---

## Setup Local

1. Copiar `js/firebase-config.example.js` → `js/firebase-config.js`
2. Añadir las credenciales del proyecto Firebase real
3. Servir con servidor HTTP (no abrir directamente el HTML):
   ```bash
   python -m http.server 8000
   # o
   firebase serve
   ```
4. Abrir `http://localhost:8000`

## Deploy

```bash
firebase deploy
```

El hosting sirve HTML/JS/CSS con `Cache-Control: no-cache` (definido en `firebase.json`): tras un deploy basta una recarga normal en el cliente para ver la nueva versión (el navegador revalida con ETag). No quitar esas cabeceras: sin ellas el móvil puede ejecutar JS viejo hasta 1 hora tras desplegar.

Las reglas de Firestore se despliegan con el mismo comando (o solo ellas con `firebase deploy --only firestore:rules`). Si se cambia `firestore.rules` y no se despliega, la web sigue con las reglas antiguas.

---

## Reproducción en segundo plano (móvil)

Con la pantalla apagada, el móvil corta la red y el JS de la pestaña en cuanto deja de sonar audio (Android retira el servicio de reproducción de Chrome; iOS suspende la página). Por eso el cambio de canción **no puede depender de la red**:

- `song-prefetcher.js` descarga entera la siguiente canción mientras suena la actual y la guarda como `Blob`.
- En el evento `ended`, `audio-player.js` hace `src = blob:` + `play()` de forma **síncrona** (sin `await` ni peticiones). Si no hay blob listo, cae a la vía normal (URL de Storage).
- Requiere que el bucket de Storage permita CORS para `GET` (por defecto la descarga `?alt=media` no envía `Access-Control-Allow-Origin`). Se configura con `node scripts/set-storage-cors.js` (`--show` para consultar, `--clear` para revertir).
- No introducir `await` entre `ended` y `play()` en la vía rápida de `playSong()`.
- Con la página oculta (`document.hidden`) no hacer lecturas de Firestore ni `alert()` en rutas automáticas del cambio de canción: la sincronización de los combos género/source se pospone (`pendingComboSync`) hasta el `visibilitychange`. Un `alert()` en segundo plano bloquea el JS y corta la cadena de reproducción.

Si una transición automática falla en segundo plano (sin red y sin blob), `playSong()` deja `pendingResume` y se reintenta sola en `visibilitychange`/`online`. Para diagnosticar en el móvil: triple toque en el título de la canción → panel de registro (`debug-log.js`) → Copiar.

Test del módulo: `node test/song-prefetcher.test.js`.

---

## Estadísticas de escucha

Cada usuario acumula el **tiempo real escuchado** (ms) por canción, artista, género y source. No hay contador de "veces": solo tiempo. Sin sesión no se cuenta nada.

- `listening-stats-service.js` es la lógica pura (sin imports, con test); `listening-stats.js` construye el singleton con Firestore, `localStorage` y `debug-log`, y engancha los disparadores de volcado.
- **Captura:** `audio-player.js` llama a `listeningStats.beginSong(song)` en `playSong()` y a `listeningStats.onTimeUpdate(currentTime)` en cada `timeupdate`. Solo se suma la diferencia entre posiciones consecutivas si es positiva y ≤ 2 s (una pausa no genera `timeupdate`; un salto en la barra se descarta). Ambas llamadas son síncronas y sin red: no rompen la vía rápida `ended → play()`.
- **Almacenamiento:** `users/{uid}/listeningStats/{total | YYYY-MM | YYYY-MM-DD}` con mapas `songs` (por id), `artists`, `genres`, `sources` y `totalMs`, escritos con `set(merge)` + `FieldValue.increment` en un solo `batch` (día + mes + total). Nunca se lee antes de escribir.
- **Volcado (`flush()`):** al cambiar de canción, al pausar, al ocultarse la página, al volver la red y como máximo cada 2 min mientras suena. Lo pendiente vive en memoria y en `localStorage` (`listeningStatsPending`). Mientras hay un volcado en vuelo no se lanza otro; si falla, se conserva y se reintenta; si la pestaña muere, se reenvía al volver a entrar el mismo usuario (el pendiente de otro usuario se descarta).
- **Lectura:** `getPeriodStats({ period: '7d' | 'month' | 'total', month })` devuelve rankings ordenados. Superpone solo lo pendiente **no entregado** al SDK: Firestore ya incluye por compensación de latencia lo que está en vuelo, y sumarlo otra vez lo contaría doble.
- **Vista:** `stats-view.js` pinta dentro de `#songList` (tres pestañas, flechas de mes, top 10 por bloque, cada fila con miniatura: `coverPath` de la canción, o la portada del artista/género/source vía `getPreviousCoverPath`, con caché por sesión). Pulsar una canción la reproduce; pulsar un artista/género/source abre su filtro (`App.openFilterFromStats`). En esta vista el buscador no hace nada (`currentNavMenu === 'stats'`).

Test del módulo: `node test/listening-stats-service.test.js`.

---

## Subir canciones desde la web

Menú "⬆️ Subir canciones" (`#navUploadItem`), visible solo para usuarios con `isAdmin: true` o `canUpload: true` en `users/{uid}` (`authService.getPermissions()`, cacheado por sesión). Las reglas de Firestore son la barrera real: sin permiso, la creación en `songs` falla aunque se fuerce la UI.

- **Dar permiso:** `node scripts/set-upload-permission.js correo@ejemplo.com` (`--revoke` para quitarlo, `--list` para ver quién lo tiene). Usa la cuenta de servicio porque solo un admin puede tocar `canUpload`.
- **Flujo:** el usuario arrastra o elige uno o varios audios → `audio-metadata.js` lee tags, duración y portada embebida (si no hay tags, se deduce "Artista - Título" del nombre de archivo, quitando ids de YouTube y marcas tipo "(Official Video)", igual que `scripts/upload-songs.js`) → cada archivo es un **borrador** en la lista → pulsar una fila abre el editor individual; marcar varias y "Editar N a la vez" abre el editor en bloque (lo vacío/"sin cambios" se conserva en cada canción; las casillas de playlist son tri-estado: marcar añade a todas, desmarcar quita de todas) → "Subir" sube una por una con progreso.
- **Por canción (`song-uploader.uploadDraft`):** 1) `findSongByTitle` (titleMinusculas) → si existe, error "Ya existe…" y no se sube; 2) rutas `Audios/<título>.<ext>` y `Covers/<título>.<ext>` (si el audio ya existe en Storage se añade " (2)"); 3) sube audio y portada con `storageService.uploadFile` (progreso); 4) `ensureGenre` / `ensureSource(name, genre)` / `ensureArtist` crean los docs auxiliares si faltan (sin ellos no aparecerían en los menús); 5) `createSong` con `createdAt` de servidor. Si falla el documento, se borran los archivos subidos.
- **Playlists:** al terminar el lote, `addSongsToPlaylist(id, títulos)` con `arrayUnion`. Solo se ofrecen las playlists que el usuario puede modificar (las suyas, o todas si es admin).
- **Tags:** `music-metadata` se carga bajo demanda desde jsdelivr (respaldo: esm.sh) solo al entrar en la vista; si no carga, se usa el nombre del archivo y la duración se saca con un `<audio>`.
- El estado (borradores, selección, subida en curso) vive en la instancia `UploadView`: cambiar de menú no lo pierde y una subida en marcha continúa. Mientras sube, `beforeunload` avisa al cerrar la pestaña. En esta vista no actúan ni el buscador ni el scroll infinito (`currentNavMenu === 'upload'`).
- Las reglas de Storage desplegadas permiten escritura a cualquiera (no están en el repo): la subida de audio no necesita cambios ahí.

Test del módulo puro: `node test/song-upload-service.test.js`.

---
## Archivos a NO modificar sin revisión

- `firestore.rules` — Cambios pueden exponer datos o romper acceso
- `migration-script.js` — Solo para migraciones puntuales de datos
- `firebase-config.js` — No subir al repo (está en `.gitignore`)
