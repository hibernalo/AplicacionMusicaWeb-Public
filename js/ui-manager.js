import storageService from './storage-service.js';
import firestoreService from './firestore-service.js';
import userLikesService from './user-likes-service.js';

/**
 * Gestor de UI y renderizado
 */
class UIManager {
    constructor() {
        this.songListContainer = document.getElementById('songList');
        this.loadingIndicator = document.getElementById('loadingIndicator');
        this.loadMoreIndicator = document.getElementById('loadMoreIndicator');
        this.searchInput = document.getElementById('searchInput');
        this.searchClear = document.getElementById('searchClear');
        this.songCounter = document.getElementById('songCounter');
        this.intersectionObserver = null;
        this.imageLoadPromises = new Map();
        this.renderedSongs = new Set();
        this.currentPlayingId = null;
        this.searchTimeout = null;
        this.viewMode = 'default'; // 'default' o 'list'
        this.totalSongsCount = 0; // Total de canciones disponibles
        this.currentContext = 'all'; // 'all', 'recent', 'filtered', 'search'
        this.currentFilterType = null; // Tipo de filtro actual ('playlist', 'genre', etc.)
        this.currentFilterValue = null; // Valor del filtro actual (nombre de playlist, etc.)
        this.currentPlaylistId = null; // ID del documento de la playlist actual (para operaciones CRUD)

        this.initializeIntersectionObserver();
        this.attachEventListeners();
        this.initializeViewMode();
        this.loadTotalSongsCount();
    }

    /**
     * Inicializa el Intersection Observer para lazy loading de imágenes
     */
    initializeIntersectionObserver() {
        const options = {
            root: null,
            rootMargin: '100px', // Cargar antes de que sean completamente visibles
            threshold: 0.01 // Mínimo para detectar cuando entran al viewport
        };

        this.intersectionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const container = entry.target;
                    const img = container.querySelector('.song-cover');
                    
                    if (img && img.dataset.loaded === 'false') {
                        const coverPath = img.dataset.coverPath;
                        
                        if (coverPath) {
                            this.loadCoverImage(img, container, coverPath);
                        }
                        
                        // Dejar de observar una vez que se empieza a cargar
                        this.intersectionObserver.unobserve(container);
                    }
                }
            });
        }, options);
    }

    /**
     * Adjunta event listeners globales
     */
    attachEventListeners() {
        // Escuchar cuando se cargan canciones
        document.addEventListener('songsLoaded', (e) => {
            console.log(`songsLoaded evento recibido: ${e.detail.songs.length} canciones, isInitial: ${e.detail.isInitial}`);

            // Guardar el filtro actual para saber si estamos en una playlist
            this.currentFilterType = e.detail.filterType || null;
            this.currentFilterValue = e.detail.filterValue || null;
            this.currentPlaylistId = e.detail.playlistId || null;

            // IMPORTANTE: Verificar si estamos mostrando items de filtro (artistas, sources, etc.)
            // Si el contenedor tiene cards de filtro Y estamos cargando canciones iniciales,
            // limpiar primero las cards de filtro antes de renderizar
            const hasFilterCards = this.songListContainer.querySelector('.filter-item-card') !== null;
            const hasGenreSelector = this.songListContainer.querySelector('.source-genre-selector-container') !== null;
            
            if (hasFilterCards || hasGenreSelector) {
                if (e.detail.isInitial) {
                    // Si estamos cargando canciones iniciales y hay cards de filtro,
                    // limpiarlas primero para que las canciones se rendericen correctamente
                    console.log('songsLoaded: Detectadas cards de filtro, limpiando antes de renderizar canciones iniciales');
                    const filterCards = this.songListContainer.querySelectorAll('.filter-item-card');
                    filterCards.forEach(card => card.remove());
                    if (hasGenreSelector) {
                        const genreSelector = this.songListContainer.querySelector('.source-genre-selector-container');
                        if (genreSelector) genreSelector.remove();
                    }
                } else {
                    // Si no es carga inicial, no renderizar si hay cards de filtro
                    // (probablemente estamos en modo de mostrar filtros)
                    console.log('songsLoaded: Detectadas cards de filtro, NO renderizar canciones (no es carga inicial)');
                    return;
                }
            }
            
            if (e.detail.isInitial) {
                this.renderSongs(e.detail.songs);
                // Ocultar loading después de renderizar
                this.hideLoading();
                // Actualizar contador de canciones
                // Si totalSongs está definido (contexto filtrado), usarlo; si no, usar el total general
                if (e.detail.totalSongs !== undefined && e.detail.totalSongs !== null) {
                    this.updateSongCounter(e.detail.totalSongs);
                } else {
                    // Si no hay totalSongs, es el contexto general (inicio), usar el total general
                    this.updateSongCounter(this.totalSongsCount || e.detail.songs.length);
                }
            } else {
                this.appendSongs(e.detail.songs);
                // Actualizar contador de canciones con el total acumulado
                // Para cargas adicionales, mantener el total actual (ya establecido en la carga inicial)
                // No actualizar el contador para no perder el contexto
            }
        });

        // Escuchar cuando cambia la canción que se está reproduciendo
        document.addEventListener('songChanged', (e) => {
            this.updatePlayingSong(e.detail.song.id);
        });

        // Detectar scroll para cargar más canciones
        const songListContainer = document.querySelector('.song-list-container');
        if (songListContainer) {
            songListContainer.addEventListener('scroll', () => {
                this.handleScroll();
            });
        }

        // Búsqueda
        if (this.searchInput) {
            this.searchInput.addEventListener('input', (e) => {
                this.handleSearch(e.target.value);
            });

            this.searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.clearSearch();
                }
            });
        }

        if (this.searchClear) {
            this.searchClear.addEventListener('click', () => {
                this.clearSearch();
            });
        }

        // Escuchar evento de búsqueda
        document.addEventListener('searchPerformed', (e) => {
            this.renderSongs(e.detail.songs);
            // Actualizar contador de canciones
            this.updateSongCounter(e.detail.songs.length);
        });
    }

    /**
     * Carga el total de canciones disponibles
     */
    async loadTotalSongsCount() {
        try {
            this.totalSongsCount = await firestoreService.getTotalSongsCount();
            this.updateSongCounterDisplay();
        } catch (error) {
            console.error('Error cargando total de canciones:', error);
        }
    }

    /**
     * Actualiza el contador de canciones
     * @param {number} count - Número de canciones disponibles en el contexto actual
     */
    updateSongCounter(count) {
        if (count !== undefined && count !== null) {
            this.totalSongsCount = count;
        }
        this.updateSongCounterDisplay();
    }

    /**
     * Actualiza la visualización del contador con el total de canciones disponibles
     */
    updateSongCounterDisplay() {
        if (this.songCounter) {
            const span = this.songCounter.querySelector('span');
            if (span) {
                span.textContent = `${this.totalSongsCount} canción${this.totalSongsCount !== 1 ? 'es' : ''}`;
            }
        }
    }

    /**
     * Inicializa el modo de vista desde localStorage
     */
    initializeViewMode() {
        const savedViewMode = localStorage.getItem('songViewMode');
        if (savedViewMode === 'list' || savedViewMode === 'default') {
            this.viewMode = savedViewMode;
        } else {
            this.viewMode = 'default';
        }
        
        // Configurar listeners del botón de vista
        const viewModeBtn = document.getElementById('viewModeBtn');
        const viewModeDropdown = document.getElementById('viewModeDropdown');
        const viewModeOptions = document.querySelectorAll('.view-mode-option');
        
        if (viewModeBtn && viewModeDropdown) {
            // Toggle del menú desplegable
            viewModeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = viewModeDropdown.style.display !== 'none';
                viewModeDropdown.style.display = isOpen ? 'none' : 'block';
            });
            
            // Cerrar el menú al hacer click fuera
            document.addEventListener('click', (e) => {
                if (!viewModeBtn.contains(e.target) && !viewModeDropdown.contains(e.target)) {
                    viewModeDropdown.style.display = 'none';
                }
            });
            
            // Manejar selección de opción
            viewModeOptions.forEach(option => {
                option.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const selectedView = option.dataset.view;
                    this.setViewMode(selectedView);
                    viewModeDropdown.style.display = 'none';
                });
            });
        }
        
        // Aplicar la vista inicial (solo actualizar opciones del menú, no el contenedor)
        this.applyViewMode(false);
    }

    /**
     * Establece el modo de vista
     * @param {string} viewMode - Modo de vista ('default' o 'list')
     */
    setViewMode(viewMode) {
        if (viewMode !== 'default' && viewMode !== 'list') {
            return;
        }
        
        this.viewMode = viewMode;
        localStorage.setItem('songViewMode', viewMode);
        // Solo actualizar opciones del menú, no el contenedor (se aplicará cuando se rendericen canciones)
        this.applyViewMode(false);
        
        // Disparar evento para que se vuelvan a renderizar las canciones
        const event = new CustomEvent('viewModeChanged', {
            detail: { viewMode }
        });
        document.dispatchEvent(event);
    }

    /**
     * Aplica el modo de vista actual (solo para canciones, no para filtros)
     * @param {boolean} applyToContainer - Si es true, aplica la clase al contenedor (para canciones)
     */
    applyViewMode(applyToContainer = true) {
        // Actualizar clases del contenedor solo si se está mostrando canciones
        if (applyToContainer) {
            if (this.viewMode === 'list') {
                this.songListContainer.classList.add('list-view');
            } else {
                this.songListContainer.classList.remove('list-view');
            }
        } else {
            // Si se están mostrando filtros, siempre remover la clase
            this.songListContainer.classList.remove('list-view');
        }
        
        // Actualizar opciones del menú
        const viewModeOptions = document.querySelectorAll('.view-mode-option');
        viewModeOptions.forEach(option => {
            if (option.dataset.view === this.viewMode) {
                option.classList.add('active');
            } else {
                option.classList.remove('active');
            }
        });
    }

    /**
     * Re-renderiza las canciones con el modo de vista actual
     * @param {Array} songs - Array de canciones a renderizar
     */
    rerenderSongs(songs) {
        if (!songs || songs.length === 0) {
            return;
        }
        this.renderSongs(songs);
    }

    /**
     * Maneja la búsqueda de canciones
     * @param {string} query - Texto de búsqueda
     */
    handleSearch(query) {
        // Limpiar timeout anterior
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }

        // Mostrar/ocultar botón de limpiar
        if (this.searchClear) {
            this.searchClear.style.display = query.trim() ? 'flex' : 'none';
        }

        // Debounce: esperar 300ms después de que el usuario deje de escribir
        this.searchTimeout = setTimeout(() => {
            const event = new CustomEvent('searchRequested', { 
                detail: { query: query.trim() } 
            });
            document.dispatchEvent(event);
        }, 300);
    }

    /**
     * Limpia la búsqueda
     */
    clearSearch() {
        if (this.searchInput) {
            this.searchInput.value = '';
            this.searchInput.focus();
            if (this.searchClear) {
                this.searchClear.style.display = 'none';
            }
            const event = new CustomEvent('searchRequested', { 
                detail: { query: '' } 
            });
            document.dispatchEvent(event);
        }
    }

    /**
     * Renderiza una lista de canciones
     * @param {Array} songs - Array de canciones
     */
    renderSongs(songs) {
        this.songListContainer.innerHTML = '';
        this.renderedSongs.clear();
        
        // Aplicar vista de lista solo cuando se renderizan canciones
        this.applyViewMode(true);
        
        if (songs.length === 0) {
            this.showNoResultsMessage();
        } else {
            this.hideNoResultsMessage();
            this.appendSongs(songs);
            // Verificar imágenes visibles después de un pequeño delay para asegurar que el DOM esté listo
            setTimeout(() => this.checkVisibleImages(), 100);
        }
    }

    /**
     * Muestra mensaje de "sin resultados"
     */
    showNoResultsMessage() {
        const message = document.createElement('div');
        message.className = 'no-results-message';
        message.innerHTML = `
            <p>No se encontraron canciones</p>
            <p class="no-results-subtitle">Intenta con otro término de búsqueda</p>
        `;
        this.songListContainer.appendChild(message);
    }

    /**
     * Oculta el mensaje de "sin resultados"
     */
    hideNoResultsMessage() {
        const message = this.songListContainer.querySelector('.no-results-message');
        if (message) {
            message.remove();
        }
    }

    /**
     * Agrega canciones al final de la lista
     * @param {Array} songs - Array de canciones a agregar
     */
    appendSongs(songs) {
        songs.forEach(song => {
            if (!this.renderedSongs.has(song.id)) {
                const songCard = this.createSongCard(song);
                this.songListContainer.appendChild(songCard);
                this.renderedSongs.add(song.id);
            }
        });
        
        // Verificar si hay imágenes visibles que necesitan cargarse inmediatamente
        this.checkVisibleImages();
    }
    
    /**
     * Verifica y carga imágenes que ya están visibles en el viewport
     */
    checkVisibleImages() {
        const containers = this.songListContainer.querySelectorAll('.song-cover-container[data-img-element="true"]');
        containers.forEach(container => {
            const img = container.querySelector('.song-cover');
            if (img && img.dataset.loaded === 'false') {
                // Verificar si el contenedor está visible
                const rect = container.getBoundingClientRect();
                const isVisible = rect.top < window.innerHeight + 100 && rect.bottom > -100;
                
                if (isVisible) {
                    const coverPath = img.dataset.coverPath;
                    if (coverPath) {
                        this.loadCoverImage(img, container, coverPath);
                        // Dejar de observar ya que lo estamos cargando manualmente
                        this.intersectionObserver.unobserve(container);
                    }
                }
            }
        });
    }

    /**
     * Crea un elemento card para una canción
     * @param {Object} song - Objeto de canción
     * @returns {HTMLElement} Elemento card
     */
    createSongCard(song) {
        if (this.viewMode === 'list') {
            return this.createListCard(song);
        } else {
            return this.createDefaultCard(song);
        }
    }

    /**
     * Crea un card en vista por defecto
     * @param {Object} song - Objeto de canción
     * @returns {HTMLElement} Elemento card
     */
    createDefaultCard(song) {
        const card = document.createElement('div');
        card.className = 'song-card';
        card.dataset.songId = song.id;

        // Agregar clase si es la canción actual
        if (this.currentPlayingId === song.id) {
            card.classList.add('playing');
        }

        // Cover container con placeholder
        const coverContainer = document.createElement('div');
        coverContainer.className = 'song-cover-container';

        const img = document.createElement('img');
        img.className = 'song-cover';
        img.dataset.coverPath = song.coverPath || '';
        img.dataset.loaded = 'false';
        img.alt = `${song.title} - ${song.artist}`;
        img.style.display = 'none'; // Ocultar hasta que se cargue

        // Placeholder mientras carga
        const placeholder = document.createElement('div');
        placeholder.className = 'song-cover-loading';
        placeholder.innerHTML = '<div class="spinner"></div>';
        coverContainer.appendChild(placeholder);
        coverContainer.appendChild(img);

        // Información de la canción
        const songInfo = document.createElement('div');
        songInfo.className = 'song-info';

        const title = document.createElement('div');
        title.className = 'song-title';
        title.textContent = song.title || 'Sin título';

        const artist = document.createElement('div');
        artist.className = 'song-artist';
        artist.textContent = song.artist || 'Artista desconocido';

        const album = document.createElement('div');
        album.className = 'song-album';
        album.textContent = song.album || '';

        songInfo.appendChild(title);
        songInfo.appendChild(artist);
        if (song.album) {
            songInfo.appendChild(album);
        }

        // Botón para añadir a playlist (esquina superior derecha)
        const addToPlaylistBtn = document.createElement('button');
        addToPlaylistBtn.className = 'song-card-add-btn';
        addToPlaylistBtn.title = 'Añadir a playlist';
        addToPlaylistBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
        `;
        addToPlaylistBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Evitar que se active el click del card
            const event = new CustomEvent('addSongToPlaylist', { detail: { song } });
            document.dispatchEvent(event);
        });

        card.appendChild(coverContainer);
        card.appendChild(songInfo);
        card.appendChild(addToPlaylistBtn);

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

        // Boton para eliminar de playlist (solo visible cuando estamos en una playlist)
        if (this.currentFilterType === 'playlist' && this.currentFilterValue) {
            const removeFromPlaylistBtn = document.createElement('button');
            removeFromPlaylistBtn.className = 'song-card-remove-btn';
            removeFromPlaylistBtn.title = 'Quitar de playlist';
            removeFromPlaylistBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 13H5v-2h14v2z"/>
                </svg>
            `;
            removeFromPlaylistBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const event = new CustomEvent('removeSongFromPlaylist', {
                    detail: {
                        song,
                        playlistId: this.currentPlaylistId
                    }
                });
                document.dispatchEvent(event);
            });
            card.appendChild(removeFromPlaylistBtn);
        }

        // Indicador de corazón si la canción es favorita del usuario
        if (userLikesService.isLiked(song.id)) {
            const likedHeart = document.createElement('div');
            likedHeart.className = 'song-card-liked-heart';
            likedHeart.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
            `;
            card.appendChild(likedHeart);
        }

        // Event listener para reproducir canción
        card.addEventListener('click', () => {
            this.onSongClick(song);
        });

        // Observar el contenedor en lugar de la imagen para mejor detección
        if (song.coverPath) {
            // Observar el contenedor del cover
            this.intersectionObserver.observe(coverContainer);
            // Guardar referencia a la imagen en el contenedor
            coverContainer.dataset.imgElement = 'true';
        } else {
            // Si no hay cover, ocultar placeholder también
            placeholder.style.display = 'none';
        }

        return card;
    }

    /**
     * Crea un card en vista de lista
     * @param {Object} song - Objeto de canción
     * @returns {HTMLElement} Elemento card
     */
    createListCard(song) {
        const card = document.createElement('div');
        card.className = 'song-card list-view-card';
        card.dataset.songId = song.id;

        // Agregar clase si es la canción actual
        if (this.currentPlayingId === song.id) {
            card.classList.add('playing');
        }

        // Cover container con placeholder (más pequeño en vista lista)
        const coverContainer = document.createElement('div');
        coverContainer.className = 'song-cover-container';

        const img = document.createElement('img');
        img.className = 'song-cover';
        img.dataset.coverPath = song.coverPath || '';
        img.dataset.loaded = 'false';
        img.alt = `${song.title} - ${song.artist}`;
        img.style.display = 'none'; // Ocultar hasta que se cargue

        // Placeholder mientras carga
        const placeholder = document.createElement('div');
        placeholder.className = 'song-cover-loading';
        placeholder.innerHTML = '<div class="spinner"></div>';
        coverContainer.appendChild(placeholder);
        coverContainer.appendChild(img);

        // Información de la canción
        const songInfo = document.createElement('div');
        songInfo.className = 'song-info';

        const title = document.createElement('div');
        title.className = 'song-title';
        title.textContent = song.title || 'Sin título';

        const artist = document.createElement('div');
        artist.className = 'song-artist';
        artist.textContent = song.artist || 'Artista desconocido';

        const album = document.createElement('div');
        album.className = 'song-album';
        album.textContent = song.album || '';

        songInfo.appendChild(title);
        songInfo.appendChild(artist);
        if (song.album) {
            songInfo.appendChild(album);
        }

        // Información adicional para vista de lista
        const listInfo = document.createElement('div');
        listInfo.className = 'song-list-info';

        const genre = document.createElement('div');
        genre.className = 'song-list-info-item';
        genre.textContent = song.genre ? `Género: ${song.genre}` : 'Género: -';

        const source = document.createElement('div');
        source.className = 'song-list-info-item';
        source.textContent = song.source ? `Source: ${song.source}` : 'Source: -';

        const year = document.createElement('div');
        year.className = 'song-list-info-item';
        year.textContent = song.year ? `Año: ${song.year}` : 'Año: -';

        listInfo.appendChild(genre);
        listInfo.appendChild(source);
        listInfo.appendChild(year);

        // Botón para añadir a playlist
        const addToPlaylistBtn = document.createElement('button');
        addToPlaylistBtn.className = 'song-card-add-btn';
        addToPlaylistBtn.title = 'Añadir a playlist';
        addToPlaylistBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
        `;
        addToPlaylistBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Evitar que se active el click del card
            const event = new CustomEvent('addSongToPlaylist', { detail: { song } });
            document.dispatchEvent(event);
        });

        card.appendChild(coverContainer);
        card.appendChild(songInfo);
        card.appendChild(listInfo);
        card.appendChild(addToPlaylistBtn);

        // Botón para añadir a la cola
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

        // Boton para eliminar de playlist (solo visible cuando estamos en una playlist)
        if (this.currentFilterType === 'playlist' && this.currentFilterValue) {
            const removeFromPlaylistBtn = document.createElement('button');
            removeFromPlaylistBtn.className = 'song-card-remove-btn';
            removeFromPlaylistBtn.title = 'Quitar de playlist';
            removeFromPlaylistBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 13H5v-2h14v2z"/>
                </svg>
            `;
            removeFromPlaylistBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const event = new CustomEvent('removeSongFromPlaylist', {
                    detail: {
                        song,
                        playlistId: this.currentPlaylistId
                    }
                });
                document.dispatchEvent(event);
            });
            card.appendChild(removeFromPlaylistBtn);
        }

        // Indicador de corazón si la canción es favorita del usuario
        if (userLikesService.isLiked(song.id)) {
            const likedHeart = document.createElement('div');
            likedHeart.className = 'song-card-liked-heart';
            likedHeart.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
            `;
            card.appendChild(likedHeart);
        }

        // Event listener para reproducir canción
        card.addEventListener('click', () => {
            this.onSongClick(song);
        });

        // Observar el contenedor en lugar de la imagen para mejor detección
        if (song.coverPath) {
            // Observar el contenedor del cover
            this.intersectionObserver.observe(coverContainer);
            // Guardar referencia a la imagen en el contenedor
            coverContainer.dataset.imgElement = 'true';
        } else {
            // Si no hay cover, ocultar placeholder también
            placeholder.style.display = 'none';
        }

        return card;
    }

    /**
     * Carga una imagen de cover
     * @param {HTMLImageElement} img - Elemento imagen
     * @param {HTMLElement} container - Contenedor del cover
     * @param {string} coverPath - Ruta del cover
     */
    async loadCoverImage(img, container, coverPath) {
        // Marcar como cargando para evitar cargas duplicadas
        if (img.dataset.loaded === 'loading') {
            return;
        }
        img.dataset.loaded = 'loading';
        
        const placeholder = container.querySelector('.song-cover-loading');
        
        try {
            const coverUrl = await storageService.getCoverUrl(coverPath);
            img.src = coverUrl;
            
            img.onload = () => {
                img.dataset.loaded = 'true';
                if (placeholder) {
                    placeholder.style.display = 'none';
                }
                img.style.display = 'block';
            };
            
            img.onerror = () => {
                // Si falla, usar placeholder
                img.dataset.loaded = 'true';
                if (placeholder) {
                    placeholder.style.display = 'none';
                }
                img.src = storageService.getPlaceholderCoverUrl();
                img.style.display = 'block';
            };
        } catch (error) {
            console.error('Error cargando cover:', error);
            img.dataset.loaded = 'true';
            if (placeholder) {
                placeholder.style.display = 'none';
            }
            img.src = storageService.getPlaceholderCoverUrl();
            img.style.display = 'block';
        }
    }

    /**
     * Maneja el click en una canción
     * @param {Object} song - Canción clickeada
     */
    onSongClick(song) {
        // Disparar evento para que el audio player lo maneje
        const event = new CustomEvent('songSelected', { detail: { song } });
        document.dispatchEvent(event);
    }

    /**
     * Actualiza qué canción se está reproduciendo
     * @param {string} songId - ID de la canción
     */
    updatePlayingSong(songId) {
        // Remover clase playing de todas las cards
        document.querySelectorAll('.song-card').forEach(card => {
            card.classList.remove('playing');
        });

        // Agregar clase playing a la card actual
        const currentCard = document.querySelector(`[data-song-id="${songId}"]`);
        if (currentCard) {
            currentCard.classList.add('playing');
            // Scroll suave a la canción actual
            currentCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        this.currentPlayingId = songId;
    }

    /**
     * Maneja el scroll para cargar más canciones
     * IMPORTANTE: Solo carga más canciones si estamos mostrando canciones, no items de filtro
     */
    handleScroll() {
        const container = document.querySelector('.song-list-container');
        if (!container) return;

        // Verificar si estamos mostrando items de filtro (filter-item-card) o canciones (song-card)
        const hasFilterItems = container.querySelector('.filter-item-card') !== null;
        const hasSongCards = container.querySelector('.song-card') !== null;
        
        // Solo cargar más canciones si estamos mostrando canciones, NO items de filtro
        if (hasFilterItems && !hasSongCards) {
            // Estamos mostrando items de filtro (artistas, sources, etc.), NO cargar canciones
            return;
        }

        const scrollTop = container.scrollTop;
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;

        // Cargar más cuando esté cerca del final (80% del scroll)
        if (scrollTop + clientHeight >= scrollHeight * 0.8) {
            const event = new CustomEvent('loadMoreSongs');
            document.dispatchEvent(event);
        }
    }

    /**
     * Muestra el indicador de carga
     */
    showLoading() {
        if (this.loadingIndicator) {
            this.loadingIndicator.style.display = 'block';
        }
    }

    /**
     * Oculta el indicador de carga
     */
    hideLoading() {
        if (this.loadingIndicator) {
            this.loadingIndicator.style.display = 'none';
        }
    }

    /**
     * Muestra el indicador de "cargando más"
     */
    showLoadMore() {
        if (this.loadMoreIndicator) {
            this.loadMoreIndicator.style.display = 'block';
        }
    }

    /**
     * Oculta el indicador de "cargando más"
     */
    hideLoadMore() {
        if (this.loadMoreIndicator) {
            this.loadMoreIndicator.style.display = 'none';
        }
    }

    /**
     * Muestra los items de filtro (artistas, álbumes, etc.)
     * @param {string} filterType - Tipo de filtro
     * @param {Array} items - Array de items de filtro
     */
    showFilterItems(filterType, items) {
        // Limpiar la lista actual y el set de canciones renderizadas
        this.songListContainer.innerHTML = '';
        this.renderedSongs.clear();
        
        // Remover vista de lista cuando se muestran filtros (mantener vista por defecto)
        this.applyViewMode(false);

        console.log(`showFilterItems: filterType=${filterType}, items.length=${items.length}`);
        if (items.length > 0) {
            console.log('showFilterItems: Primer item:', items[0]);
        }

        // Para "source", mostrar un combo box con géneros en lugar de cards
        // Solo cuando se llama desde el menú inicial (items son géneros)
        // Los géneros tienen campo 'id', las sources filtradas no lo tienen
        if (filterType === 'source') {
            // Verificar si los items son géneros (tienen campo 'id') o sources (no tienen 'id')
            const isGenres = items.length > 0 && items[0].hasOwnProperty('id') && items[0].id !== undefined && items[0].id !== null && items[0].id !== '';
            
            console.log(`showFilterItems: isGenres=${isGenres} para filterType=source`);
            
            if (isGenres) {
                // Mostrar selector de géneros
                console.log('showFilterItems: Mostrando selector de géneros para sources');
                this.showSourceGenreSelector(items);
                return;
            } else {
                // Mostrar sources como cards
                console.log('showFilterItems: Mostrando sources como cards, cantidad:', items.length);
                this.showSourceItems(items);
                return;
            }
        }

        // Para "playlist", mostrar el botón de crear como primer elemento
        if (filterType === 'playlist') {
            this.showPlaylistItems(items);
            return;
        }

        if (items.length === 0) {
            this.showNoResultsMessage();
            return;
        }

        // Crear grid de items de filtro
        items.forEach(item => {
            const filterCard = this.createFilterItemCard(item, filterType);
            this.songListContainer.appendChild(filterCard);
        });
    }

    /**
     * Muestra sources como cards de filtro (después de seleccionar un género)
     * IMPORTANTE: Solo muestra sources, NO carga canciones
     * Funciona igual que showFilterItems para artista - solo muestra las cards
     * @param {Array} sources - Array de sources
     */
    showSourceItems(sources) {
        // Limpiar completamente la lista actual y el set de canciones renderizadas
        // Igual que cuando se muestran los artistas - solo cards, sin canciones
        this.songListContainer.innerHTML = '';
        this.renderedSongs.clear();
        
        // Remover vista de lista cuando se muestran filtros (mantener vista por defecto)
        this.applyViewMode(false);
        
        // Asegurarse de ocultar cualquier mensaje de "sin resultados" que pueda quedar
        this.hideNoResultsMessage();

        if (sources.length === 0) {
            this.showNoResultsMessage();
            return;
        }

        console.log(`showSourceItems: Mostrando ${sources.length} sources como cards (NO canciones, igual que artista)`);
        
        // Crear grid de sources como items de filtro
        // Esto es igual que showFilterItems para otros tipos - solo muestra cards
        sources.forEach(source => {
            const filterCard = this.createFilterItemCard(source, 'source');
            this.songListContainer.appendChild(filterCard);
        });
        
        // NO llamar a renderSongs ni cargar canciones aquí
        // Las canciones solo se cargan cuando el usuario hace click en una card de source específica
    }

    /**
     * Muestra playlists como cards de filtro con el botón de crear como primer elemento
     * @param {Array} playlists - Array de playlists
     */
    showPlaylistItems(playlists) {
        // Limpiar completamente la lista actual y el set de canciones renderizadas
        this.songListContainer.innerHTML = '';
        this.renderedSongs.clear();
        this.hideNoResultsMessage();

        // Crear botón de crear playlist como primer elemento
        const createCard = document.createElement('div');
        createCard.className = 'filter-item-card';
        createCard.style.cursor = 'pointer';

        const coverContainer = document.createElement('div');
        coverContainer.className = 'song-cover-container';

        // Placeholder para el botón de crear
        const placeholder = document.createElement('div');
        placeholder.className = 'filter-item-placeholder';
        placeholder.innerHTML = '<div class="filter-item-icon" style="font-size: 3rem;">➕</div>';
        coverContainer.appendChild(placeholder);

        const itemInfo = document.createElement('div');
        itemInfo.className = 'song-info';

        const title = document.createElement('div');
        title.className = 'song-title';
        title.textContent = 'Crear playlist';

        const count = document.createElement('div');
        count.className = 'song-artist';
        count.textContent = 'Nueva playlist';

        itemInfo.appendChild(title);
        itemInfo.appendChild(count);

        createCard.appendChild(coverContainer);
        createCard.appendChild(itemInfo);

        // Event listener para crear playlist
        createCard.addEventListener('click', () => {
            const event = new CustomEvent('createPlaylist');
            document.dispatchEvent(event);
        });

        this.songListContainer.appendChild(createCard);

        // Crear grid de playlists como items de filtro
        playlists.forEach(playlist => {
            const filterCard = this.createFilterItemCard(playlist, 'playlist');
            this.songListContainer.appendChild(filterCard);
        });
    }

    /**
     * Muestra un selector de género para filtrar sources
     * @param {Array} genres - Array de géneros
     */
    showSourceGenreSelector(genres) {
        const container = document.createElement('div');
        container.className = 'source-genre-selector-container';
        container.innerHTML = `
            <div class="source-genre-selector">
                <label class="source-genre-label">Selecciona un género para ver sus sources:</label>
                <select class="source-genre-select" id="sourceGenreSelect">
                    <option value="">Selecciona un género...</option>
                </select>
            </div>
        `;

        const select = container.querySelector('#sourceGenreSelect');
        
        // Agregar géneros al select
        genres.forEach(genre => {
            if (genre.key && genre.key.trim() !== '') {
                const option = document.createElement('option');
                // Asegurarse de usar siempre el ID del documento (genre.id)
                // Si no hay id, usar el key como fallback, pero esto debería ser raro
                option.value = genre.id || genre.key;
                option.dataset.genreName = genre.key;
                option.dataset.genreId = genre.id || genre.key; // Guardar el ID del documento también
                option.textContent = `${genre.key} (${genre.count || 0} canciones)`;
                select.appendChild(option);
            }
        });

        // Event listener para cuando se selecciona un género
        select.addEventListener('change', (e) => {
            const selectedOption = e.target.selectedOptions[0];
            if (selectedOption && selectedOption.value) {
                // El value es el ID del documento (que ahora es el nombre del género)
                // El dataset.genreName también es el nombre del género
                // Usar el nombre del género (que es igual al ID del documento ahora)
                const genreId = selectedOption.value; // ID del documento = nombre del género
                const genreName = selectedOption.dataset.genreName || genreId;
                
                console.log(`showSourceGenreSelector: Género seleccionado - genreId: ${genreId}, genreName: ${genreName}`);
                
                // Disparar evento para cargar sources del género seleccionado
                // Pasar el nombre del género (que es igual al ID del documento)
                const event = new CustomEvent('sourceGenreSelected', {
                    detail: {
                        genreId: genreId, // ID del documento = nombre del género
                        genreName: genreName
                    }
                });
                document.dispatchEvent(event);
            }
        });

        this.songListContainer.appendChild(container);
    }

    /**
     * Crea un card para un item de filtro
     * @param {Object} item - Item de filtro {key, count, coverPath}
     * @param {string} filterType - Tipo de filtro
     * @returns {HTMLElement} Elemento card
     */
    createFilterItemCard(item, filterType) {
        const card = document.createElement('div');
        card.className = 'filter-item-card';
        card.dataset.filterType = filterType;
        card.dataset.filterValue = item.key;

        // Cover container
        const coverContainer = document.createElement('div');
        coverContainer.className = 'song-cover-container';

        // Si hay coverPath, intentar cargarlo
        if (item.coverPath) {
            const img = document.createElement('img');
            img.className = 'song-cover';
            img.dataset.coverPath = item.coverPath;
            img.dataset.loaded = 'false';
            img.alt = item.key;
            img.style.display = 'none';

            const placeholder = document.createElement('div');
            placeholder.className = 'song-cover-loading';
            placeholder.innerHTML = '<div class="spinner"></div>';
            coverContainer.appendChild(placeholder);
            coverContainer.appendChild(img);

            // Cargar imagen
            this.loadCoverImage(img, coverContainer, item.coverPath);
        } else {
            // Placeholder sin imagen
            const placeholder = document.createElement('div');
            placeholder.className = 'filter-item-placeholder';
            placeholder.innerHTML = '<div class="filter-item-icon">📁</div>';
            coverContainer.appendChild(placeholder);
        }

        // Agregar botón de subida de imagen para artist, genre, source, year y playlist
        if (['artist', 'genre', 'source', 'year', 'playlist'].includes(filterType)) {
            const uploadButton = document.createElement('button');
            uploadButton.className = 'filter-item-upload-btn';
            uploadButton.title = 'Subir imagen de portada';
            uploadButton.innerHTML = '📷';
            uploadButton.addEventListener('click', (e) => {
                e.stopPropagation(); // Evitar que se active el click del card
                this.handleUploadImage(filterType, item.key, card);
            });
            coverContainer.appendChild(uploadButton);
        }

        // Información del item
        const itemInfo = document.createElement('div');
        itemInfo.className = 'song-info';

        const title = document.createElement('div');
        title.className = 'song-title';
        title.textContent = item.key || 'Sin nombre';

        const count = document.createElement('div');
        count.className = 'song-artist';
        count.textContent = `${item.count || 0} canción${item.count !== 1 ? 'es' : ''}`;

        itemInfo.appendChild(title);
        itemInfo.appendChild(count);

        card.appendChild(coverContainer);
        card.appendChild(itemInfo);

        // Event listener para seleccionar el filtro
        card.addEventListener('click', (e) => {
            // No activar si se hizo click en el botón de subida
            if (e.target.closest('.filter-item-upload-btn')) {
                return;
            }
            
            console.log(`createFilterItemCard: Click en ${filterType} card, filterValue: ${item.key}, item completo:`, item);
            
            // Si es un source card, el item.key es el nombre del source
            // getSongsBySource busca por el campo 'source' de las canciones (que es el nombre del source)
            const event = new CustomEvent('filterItemSelected', {
                detail: {
                    filterType: filterType,
                    filterValue: item.key, // Nombre del source, género, o playlist
                    filterItemId: item.id || null, // ID del documento (para playlists)
                    count: item.count || 0 // Número de canciones en este filtro
                }
            });
            console.log(`createFilterItemCard: Disparando evento filterItemSelected con filterType=${filterType}, filterValue=${item.key}, filterItemId=${item.id || null}, count=${item.count || 0}`);
            document.dispatchEvent(event);
        });

        return card;
    }

    /**
     * Maneja la subida de una imagen para un item de filtro
     * @param {string} filterType - Tipo de filtro ('artist', 'genre', 'source', 'year', 'playlist')
     * @param {string} itemKey - Nombre o clave del item
     * @param {HTMLElement} cardElement - Elemento card donde se mostrará la imagen
     */
    handleUploadImage(filterType, itemKey, cardElement) {
        // Crear input de archivo
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) {
                return;
            }

            // Validar que sea una imagen
            if (!file.type.startsWith('image/')) {
                alert('Por favor, selecciona un archivo de imagen válido.');
                return;
            }

            // Validar tamaño (por ejemplo, máximo 5MB)
            if (file.size > 5 * 1024 * 1024) {
                alert('La imagen es demasiado grande. Por favor, selecciona una imagen de menos de 5MB.');
                return;
            }

            try {
                // Mostrar indicador de carga
                this.showUploadProgress(cardElement, true);

                // Disparar evento para que app.js maneje la subida
                const event = new CustomEvent('uploadCoverImage', {
                    detail: {
                        filterType: filterType,
                        itemKey: itemKey,
                        file: file,
                        cardElement: cardElement
                    }
                });
                document.dispatchEvent(event);
            } catch (error) {
                console.error('Error preparando subida de imagen:', error);
                alert('Error al preparar la subida de la imagen. Por favor, intenta de nuevo.');
                this.showUploadProgress(cardElement, false);
            } finally {
                // Limpiar input
                fileInput.remove();
            }
        });

        // Simular click en el input
        document.body.appendChild(fileInput);
        fileInput.click();
    }

    /**
     * Muestra/oculta el indicador de progreso de subida
     * @param {HTMLElement} cardElement - Elemento card
     * @param {boolean} show - Mostrar u ocultar
     */
    showUploadProgress(cardElement, show) {
        const coverContainer = cardElement.querySelector('.song-cover-container');
        if (!coverContainer) return;

        let progressIndicator = coverContainer.querySelector('.upload-progress');
        
        if (show) {
            if (!progressIndicator) {
                progressIndicator = document.createElement('div');
                progressIndicator.className = 'upload-progress';
                progressIndicator.innerHTML = '<div class="spinner"></div><span>Subiendo...</span>';
                coverContainer.appendChild(progressIndicator);
            }
            progressIndicator.style.display = 'flex';
        } else {
            if (progressIndicator) {
                progressIndicator.style.display = 'none';
            }
        }
    }

    /**
     * Actualiza la imagen del cover en un card después de subirla
     * @param {HTMLElement} cardElement - Elemento card
     * @param {string} coverPath - Nueva ruta del cover
     */
    async updateCardCover(cardElement, coverPath) {
        const coverContainer = cardElement.querySelector('.song-cover-container');
        if (!coverContainer) return;

        // Limpiar contenido anterior
        coverContainer.innerHTML = '';

        // Crear nueva imagen
        const img = document.createElement('img');
        img.className = 'song-cover';
        img.dataset.coverPath = coverPath;
        img.dataset.loaded = 'false';
        img.alt = cardElement.dataset.filterValue;
        img.style.display = 'none';

        const placeholder = document.createElement('div');
        placeholder.className = 'song-cover-loading';
        placeholder.innerHTML = '<div class="spinner"></div>';
        coverContainer.appendChild(placeholder);
        coverContainer.appendChild(img);

        // Cargar imagen
        await this.loadCoverImage(img, coverContainer, coverPath);

        // Reagregar botón de subida si corresponde
        const filterType = cardElement.dataset.filterType;
        if (['artist', 'genre', 'source', 'year', 'playlist'].includes(filterType)) {
            const uploadButton = document.createElement('button');
            uploadButton.className = 'filter-item-upload-btn';
            uploadButton.title = 'Subir imagen de portada';
            uploadButton.innerHTML = '📷';
            uploadButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleUploadImage(filterType, cardElement.dataset.filterValue, cardElement);
            });
            coverContainer.appendChild(uploadButton);
        }

        // Ocultar progreso
        this.showUploadProgress(cardElement, false);
    }

    // ========================================
    // AUTH UI METHODS
    // ========================================

    /**
     * Muestra la UI de usuario logueado
     * @param {string} email - Email del usuario
     */
    showUserLoggedIn(email) {
        const userAuthBtn = document.getElementById('userAuthBtn');
        const userName = document.getElementById('userName');
        const userDropdownEmail = document.getElementById('userDropdownEmail');

        if (userAuthBtn) {
            userAuthBtn.classList.add('logged-in');
            userAuthBtn.title = 'Mi cuenta';
        }
        if (userName) {
            userName.textContent = email.split('@')[0];
        }
        if (userDropdownEmail) {
            userDropdownEmail.textContent = email;
        }
    }

    /**
     * Muestra la UI de usuario no logueado
     */
    showUserLoggedOut() {
        const userAuthBtn = document.getElementById('userAuthBtn');
        const userName = document.getElementById('userName');
        const userDropdown = document.getElementById('userDropdown');

        if (userAuthBtn) {
            userAuthBtn.classList.remove('logged-in');
            userAuthBtn.title = 'Iniciar sesion';
        }
        if (userName) {
            userName.textContent = '';
        }
        if (userDropdown) {
            userDropdown.style.display = 'none';
        }
    }

    /**
     * Muestra el modal de autenticacion
     */
    showAuthModal() {
        const modal = document.getElementById('authModal');
        if (modal) {
            modal.style.display = 'flex';
            // Enfocar el primer input
            const firstInput = modal.querySelector('input');
            if (firstInput) {
                setTimeout(() => firstInput.focus(), 100);
            }
        }
    }

    /**
     * Oculta el modal de autenticacion
     */
    hideAuthModal() {
        const modal = document.getElementById('authModal');
        if (modal) {
            modal.style.display = 'none';
            // Limpiar formularios
            const forms = modal.querySelectorAll('form');
            forms.forEach(form => form.reset());
            // Limpiar errores
            const errors = modal.querySelectorAll('.auth-error');
            errors.forEach(error => error.textContent = '');
        }
    }

    /**
     * Muestra un error en el formulario de login
     * @param {string} message - Mensaje de error
     */
    showLoginError(message) {
        const errorDiv = document.getElementById('loginError');
        if (errorDiv) {
            errorDiv.textContent = message;
        }
    }

    /**
     * Muestra un error en el formulario de registro
     * @param {string} message - Mensaje de error
     */
    showRegisterError(message) {
        const errorDiv = document.getElementById('registerError');
        if (errorDiv) {
            errorDiv.textContent = message;
        }
    }

    /**
     * Cambia entre tabs de login y registro
     * @param {string} tab - 'login' o 'register'
     */
    switchAuthTab(tab) {
        const tabs = document.querySelectorAll('.auth-tab');
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');

        tabs.forEach(t => {
            if (t.dataset.tab === tab) {
                t.classList.add('active');
            } else {
                t.classList.remove('active');
            }
        });

        if (tab === 'login') {
            if (loginForm) loginForm.style.display = 'flex';
            if (registerForm) registerForm.style.display = 'none';
        } else {
            if (loginForm) loginForm.style.display = 'none';
            if (registerForm) registerForm.style.display = 'flex';
        }

        // Limpiar errores al cambiar de tab
        const errors = document.querySelectorAll('.auth-error');
        errors.forEach(error => error.textContent = '');
    }

    /**
     * Muestra/oculta el dropdown del usuario
     */
    toggleUserDropdown() {
        const dropdown = document.getElementById('userDropdown');
        if (dropdown) {
            const isVisible = dropdown.style.display === 'block';
            dropdown.style.display = isVisible ? 'none' : 'block';
        }
    }

    /**
     * Oculta el dropdown del usuario
     */
    hideUserDropdown() {
        const dropdown = document.getElementById('userDropdown');
        if (dropdown) {
            dropdown.style.display = 'none';
        }
    }

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
        // Si hay un arrastre en curso, abortarlo antes de reconstruir el panel
        if (this.queueDragState) this.cleanupQueueDrag();
        body.innerHTML = '';
        queue = Array.isArray(queue) ? queue : [];
        upcoming = Array.isArray(upcoming) ? upcoming : [];

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
            clearBtn.addEventListener('click', () => {
                document.dispatchEvent(new CustomEvent('queueClearClick'));
            });
            queueTitle.appendChild(clearBtn);
        }
        body.appendChild(queueTitle);

        if (queue.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'queue-empty';
            empty.textContent = 'La cola está vacía';
            body.appendChild(empty);
        } else {
            const list = document.createElement('div');
            list.className = 'queue-list';
            list.id = 'queueDraggableList';
            queue.forEach(song => {
                list.appendChild(this.buildQueueRow(song, { variant: 'queued', removable: true, clickable: true, draggable: true }));
            });
            body.appendChild(list);
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
                .catch(() => { cover.src = storageService.getPlaceholderCoverUrl(); });
        } else {
            cover.src = storageService.getPlaceholderCoverUrl();
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

        if (opts.draggable) {
            const handle = document.createElement('div');
            handle.className = 'queue-drag-handle';
            handle.title = 'Arrastra para reordenar';
            handle.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 5h2v2H9V5zm4 0h2v2h-2V5zM9 11h2v2H9v-2zm4 0h2v2h-2v-2zm-4 6h2v2H9v-2zm4 0h2v2h-2v-2z"/>
                </svg>
            `;
            // Evitar que un clic en el tirador reproduzca la canción
            handle.addEventListener('click', (e) => e.stopPropagation());
            handle.addEventListener('pointerdown', (e) => this.startQueueDrag(e, row));
            row.appendChild(handle);
        }

        row.appendChild(cover);
        row.appendChild(info);

        if (opts.clickable) {
            row.addEventListener('click', () => {
                if (row.dataset.dragJustEnded) return;
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

    /**
     * Inicia el arrastre de una fila de la cola (Pointer Events: ratón y táctil).
     */
    startQueueDrag(e, row) {
        if (this.queueDragState) return; // ya hay un arrastre activo (evita multitouch)
        e.preventDefault();
        e.stopPropagation();
        const container = row.parentElement;
        if (!container) return;
        const handle = e.currentTarget;
        const onMove = (ev) => this.onQueueDragMove(ev);
        const onUp = (ev) => this.onQueueDragEnd(ev);
        this.queueDragState = {
            row,
            container,
            handle,
            pointerId: e.pointerId,
            startIndex: Array.from(container.children).indexOf(row),
            moved: false,
            onMove,
            onUp
        };
        try { handle.setPointerCapture(e.pointerId); } catch (_) {}
        row.classList.add('dragging');
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
    }

    /** Reordena en vivo mientras se arrastra. */
    onQueueDragMove(e) {
        const state = this.queueDragState;
        if (!state) return;
        e.preventDefault();
        state.moved = true;
        const after = this.getQueueDragAfterElement(state.container, e.clientY);
        if (after == null) {
            state.container.appendChild(state.row);
        } else if (after !== state.row) {
            state.container.insertBefore(state.row, after);
        }
    }

    /** Calcula la fila ante la que insertar según la posición vertical del cursor. */
    getQueueDragAfterElement(container, y) {
        const rows = [...container.querySelectorAll('.queue-row:not(.dragging)')];
        let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
        for (const child of rows) {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                closest = { offset, element: child };
            }
        }
        return closest.element;
    }

    /** Limpia el estado y los listeners de un arrastre de cola (sin emitir evento). */
    cleanupQueueDrag() {
        const state = this.queueDragState;
        if (!state) return;
        const { row, handle, pointerId, onMove, onUp } = state;
        if (row) row.classList.remove('dragging');
        if (handle) {
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            handle.removeEventListener('pointercancel', onUp);
            if (pointerId != null) {
                try { handle.releasePointerCapture(pointerId); } catch (_) {}
            }
        }
        this.queueDragState = null;
    }

    /** Termina el arrastre y emite queueReorder si cambió la posición. */
    onQueueDragEnd(e) {
        const state = this.queueDragState;
        if (!state) return;
        const { row, container, startIndex, moved } = state;
        const endIndex = Array.from(container.children).indexOf(row);
        this.cleanupQueueDrag();
        if (moved) {
            // Evitar que el click sintético tras arrastrar reproduzca la canción
            row.dataset.dragJustEnded = '1';
            setTimeout(() => { delete row.dataset.dragJustEnded; }, 0);
        }
        if (moved && endIndex !== -1 && endIndex !== startIndex) {
            document.dispatchEvent(new CustomEvent('queueReorder', { detail: { fromIndex: startIndex, toIndex: endIndex } }));
        }
    }
}

export default UIManager;
