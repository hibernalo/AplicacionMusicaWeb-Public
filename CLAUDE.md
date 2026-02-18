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
  isAdmin: boolean,
  // Subcolección: likes/{songTitle} → { songId, title }
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

---

## Reglas de Acceso (Firestore)

- **Lectura pública:** canciones, géneros, artistas, fuentes, años, playlists
- **Escritura admin:** canciones, géneros, artistas, fuentes, años
- **Likes:** solo el propio usuario
- **Playlists:** crear (autenticado), modificar (dueño o admin)
- **Admin:** usuarios con `isAdmin: true` en su documento de Firestore

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

---

## Archivos a NO modificar sin revisión

- `firestore.rules` — Cambios pueden exponer datos o romper acceso
- `migration-script.js` — Solo para migraciones puntuales de datos
- `firebase-config.js` — No subir al repo (está en `.gitignore`)
