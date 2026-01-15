# Aplicacion Web de Musica

Una aplicacion web moderna para gestionar y reproducir tu coleccion de musica personal, construida con JavaScript vanilla y Firebase.

## Vista Previa

<!-- INSERTAR CAPTURA: Vista general de la aplicacion mostrando la interfaz principal -->
![Vista General](screenshots/vista-general.png)

---

## Caracteristicas Principales

### Reproductor de Audio Completo
- Controles de reproduccion (play, pausa, anterior, siguiente)
- Barra de progreso interactiva
- Control de volumen con persistencia
- Modos de reproduccion: aleatorio (shuffle) y repeticion (off, all, one)

<!-- INSERTAR CAPTURA: Reproductor de audio en la parte inferior -->
![Reproductor](screenshots/reproductor.png)

---

### Sistema de Filtros Avanzado
- **Favoritas** - Canciones marcadas como liked
- **Generos** - Filtra por genero musical
- **Artistas** - Explora por artista
- **Albumes** - Navega por album
- **Anos** - Filtra por ano de lanzamiento
- **Sources** - Organizacion por fuente/origen con submenus
- **Playlists** - Listas de reproduccion personalizadas
- **Anadidos Recientemente** - Ultimas canciones agregadas

<!-- INSERTAR CAPTURA: Sidebar con los filtros desplegados -->
![Filtros](screenshots/filtros.png)

---

### Gestion de Playlists
- Crear playlists personalizadas
- Anadir y quitar canciones facilmente
- Subir imagenes de portada personalizadas

<!-- INSERTAR CAPTURA: Modal de playlists o vista de una playlist -->
![Playlists](screenshots/playlists.png)

---

### Busqueda en Tiempo Real
- Busqueda instantanea de canciones
- Busqueda contextual segun el filtro activo

<!-- INSERTAR CAPTURA: Barra de busqueda mostrando resultados -->
![Busqueda](screenshots/busqueda.png)

---

### Modos de Vista
- Vista por defecto (grid con portadas)
- Vista de lista compacta

<!-- INSERTAR CAPTURA: Comparacion de ambas vistas o la vista de lista -->
![Vistas](screenshots/vistas.png)

---

## Tecnologias Utilizadas

| Categoria | Tecnologia |
|-----------|------------|
| Frontend | HTML5, CSS3, JavaScript ES6+ |
| Base de Datos | Firebase Firestore |
| Almacenamiento | Firebase Storage |
| Hosting | Firebase Hosting |

---

## Estructura del Proyecto

```
AplicacionMusicaWeb/
├── index.html              # Pagina principal
├── firebase.json           # Configuracion de Firebase Hosting
├── css/
│   └── styles.css          # Estilos de la aplicacion
├── js/
│   ├── app.js              # Coordinador principal
│   ├── firebase-config.js  # Configuracion de Firebase
│   ├── firestore-service.js# Servicio de base de datos
│   ├── storage-service.js  # Servicio de almacenamiento
│   ├── audio-player.js     # Controlador del reproductor
│   ├── song-list.js        # Gestor de lista de canciones
│   ├── ui-manager.js       # Gestor de interfaz
│   └── easter-egg.js       # Sorpresa oculta
└── images/
    └── logo.png            # Logo de la aplicacion
```

---

## Instalacion

### Requisitos Previos
- Navegador moderno con soporte ES6
- Proyecto de Firebase configurado con Firestore y Storage

### Pasos

1. **Clonar el repositorio**
   ```bash
   git clone https://github.com/tu-usuario/AplicacionMusicaWeb.git
   cd AplicacionMusicaWeb
   ```

2. **Configurar Firebase**

   Edita `js/firebase-config.js` con tus credenciales:
   ```javascript
   const firebaseConfig = {
       apiKey: "TU_API_KEY",
       authDomain: "TU_AUTH_DOMAIN",
       projectId: "TU_PROJECT_ID",
       storageBucket: "TU_STORAGE_BUCKET",
       messagingSenderId: "TU_MESSAGING_SENDER_ID",
       appId: "TU_APP_ID"
   };
   ```

3. **Ejecutar localmente**
   ```bash
   # Opcion 1: Abrir index.html directamente en el navegador

   # Opcion 2: Usar un servidor local
   python -m http.server 8000
   ```

4. **Desplegar en Firebase** (opcional)
   ```bash
   firebase login
   firebase deploy
   ```

---

## Estructura de Datos en Firebase

### Coleccion `songs`
```javascript
{
    title: "Nombre de la cancion",
    artist: "Artista",
    album: "Album",
    genre: "Genero",
    source: "Fuente/Origen",
    year: 2024,
    audioPath: "Audios/cancion.mp3",
    coverPath: "Covers/cancion.jpg",
    durationMs: 210000,
    liked: false,
    rand: 0.123456789,
    titleMinusculas: "nombre de la cancion"
}
```

### Firebase Storage
- `Audios/` - Archivos de audio MP3
- `Covers/` - Portadas de canciones
- `CoverArtistas/` - Portadas de artistas
- `CoverGenres/` - Portadas de generos
- `CoverSources/` - Portadas de sources
- `CoverPlaylists/` - Portadas de playlists

---

## Capturas Adicionales

### Vista de Artistas/Generos

<!-- INSERTAR CAPTURA: Vista mostrando artistas o generos con sus portadas -->
![Artistas](screenshots/artistas.png)

---

### Gestion de Portadas

<!-- INSERTAR CAPTURA: Modal para subir portadas personalizadas -->
![Portadas](screenshots/portadas.png)

---

### Vista Responsive / Movil

<!-- INSERTAR CAPTURA: La aplicacion en un dispositivo movil o ventana pequena -->
![Movil](screenshots/movil.png)

---

## Caracteristicas Tecnicas

- **Paginacion eficiente** - Carga de 50 canciones por pagina
- **Lazy loading** - Carga de imagenes bajo demanda usando Intersection Observer
- **Cache inteligente** - Reduccion de consultas a la base de datos
- **Arquitectura modular** - Separacion clara de responsabilidades con ES6 Modules
- **Diseno responsive** - Adaptable a diferentes tamanos de pantalla
- **Tema oscuro** - Interfaz moderna estilo Spotify

---

## Uso

1. Abre la aplicacion en tu navegador
2. Las canciones se cargaran automaticamente
3. Usa el sidebar para filtrar por genero, artista, album, etc.
4. Haz clic en una cancion para reproducirla
5. Usa los controles del reproductor en la parte inferior
6. Crea playlists personalizadas desde el menu lateral

---

## Licencia

Proyecto de uso personal.

---

<!-- INSERTAR CAPTURA: Cualquier otra captura que quieras destacar -->
![Extra](screenshots/extra.png)
