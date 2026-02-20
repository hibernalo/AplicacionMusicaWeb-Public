import firestoreService from './firestore-service.js';
import storageService from './storage-service.js';
import authService from './auth-service.js';
import userLikesService from './user-likes-service.js';
import AudioPlayer from './audio-player.js';
import SongListManager from './song-list.js';
import UIManager from './ui-manager.js';

/**
 * Aplicación principal - Coordina todos los componentes
 */
class App {
    constructor() {
        this.audioPlayer = null;
        this.songListManager = null;
        this.uiManager = null;
        this.isInitialized = false;
        this.currentNavMenu = 'inicio'; // 'inicio', 'liked', 'genre', 'source', 'artist', 'album', 'year'
        this.sourceGenreId = null; // ID del género seleccionado cuando estamos en sources
        this.currentUser = null; // Usuario autenticado actual
    }

    /**
     * Inicializa la aplicación
     */
    async init() {
        try {
            console.log('Inicializando aplicación...');

            // Verificar configuración de Firebase
            if (!this.checkFirebaseConfig()) {
                console.error('Firebase no está configurado correctamente');
                alert('Por favor, configura Firebase en js/firebase-config.js');
                return;
            }

            // Inicializar componentes
            this.uiManager = new UIManager();
            this.songListManager = new SongListManager();
            this.audioPlayer = new AudioPlayer();

            // Mostrar indicador de carga
            this.uiManager.showLoading();

            // Cargar canciones iniciales
            const initialSongs = await this.songListManager.loadInitialSongs(50, 'rand');
            
            // Establecer lista de canciones en el reproductor
            this.audioPlayer.setSongList(this.songListManager.getAllSongs());

            // Ocultar indicador de carga
            this.uiManager.hideLoading();

            // Configurar event listeners
            this.setupEventListeners();

            // Inicializar autenticacion
            this.setupAuthUI();
            authService.init();
            authService.onAuthStateChanged((user) => {
                this.handleAuthStateChange(user);
            });

            this.isInitialized = true;
            console.log(`Aplicación inicializada. ${initialSongs.length} canciones cargadas.`);

            // Verificar si hay un parametro 'play' en la URL para reproducir una cancion
            await this.checkAutoPlayFromUrl();
        } catch (error) {
            console.error('Error inicializando aplicación:', error);
            this.uiManager.hideLoading();
            alert('Error al cargar las canciones. Por favor, verifica la configuración de Firebase.');
        }
    }

    /**
     * Verifica si Firebase está configurado
     * @returns {boolean} true si está configurado
     */
    checkFirebaseConfig() {
        try {
            // Verificar que firebase esté disponible
            if (typeof firebase === 'undefined') {
                return false;
            }

            // Verificar que las referencias estén disponibles
            const config = firebase.app().options;
            return config && config.apiKey && config.apiKey !== 'TU_API_KEY';
        } catch (error) {
            return false;
        }
    }

    /**
     * Configura los event listeners globales
     */
    setupEventListeners() {
        // Cuando se selecciona una canción desde la UI
        document.addEventListener('songSelected', async (e) => {
            const { song } = e.detail;
            const index = this.songListManager.getSongIndex(song.id);
            await this.audioPlayer.playSong(song, index);
        });

        // Cuando se necesita cargar más canciones
        document.addEventListener('loadMoreSongs', async () => {
            // IMPORTANTE: Solo cargar más canciones si estamos mostrando canciones, NO items de filtro
            // Si estamos en un menú de filtros mostrando items (artistas, sources, etc.), NO cargar canciones
            const isFilterMenuShowingItems = ['genre', 'source', 'artist', 'album', 'year'].includes(this.currentNavMenu) && 
                                             this.songListManager.currentFilterValue === null;
            
            if (isFilterMenuShowingItems) {
                console.log('loadMoreSongs: Estamos mostrando items de filtro, NO cargar canciones');
                return;
            }

            if (this.songListManager.isLoadingSongs() || !this.songListManager.hasMoreSongs()) {
                return;
            }

            this.uiManager.showLoadMore();

            try {
                const newSongs = await this.songListManager.loadMoreSongs();
                
                // Actualizar lista en el reproductor
                this.audioPlayer.setSongList(this.songListManager.getAllSongs());

                if (newSongs.length === 0) {
                    // No hay más canciones
                    this.uiManager.hideLoadMore();
                }
            } catch (error) {
                console.error('Error cargando más canciones:', error);
            } finally {
                this.uiManager.hideLoadMore();
            }
        });

        // Cuando cambia la canción en el reproductor
        document.addEventListener('songChanged', (e) => {
            // El UIManager ya escucha este evento para actualizar la UI
            console.log('Canción cambiada:', e.detail.song.title);
        });

        // Cuando se solicita una búsqueda
        document.addEventListener('searchRequested', async (e) => {
            const query = e.detail.query;
            
            // Determinar el contexto de búsqueda según el menú activo
            const isFilterMenu = ['genre', 'source', 'artist', 'album', 'year', 'playlist'].includes(this.currentNavMenu);
            
            this.uiManager.showLoading();
            
            try {
                if (isFilterMenu) {
                    // Si estamos en un menú de filtros, siempre buscar en los items del filtro
                    // (géneros, sources, artistas, etc.), no en canciones
                    let genreId = null;
                    if (this.currentNavMenu === 'source') {
                        genreId = this.sourceGenreId;
                        
                        // Si estamos en source y hay un género seleccionado, mostrar sources de ese género
                        // NO cargar géneros de nuevo
                        if (genreId && (!query || query.trim() === '')) {
                            // Recargar sources del género seleccionado (no géneros)
                            const sources = await this.songListManager.loadFilterItemsForSource(genreId);
                            const sourcesToShow = sources.map(source => {
                                const { id, ...sourceWithoutId } = source;
                                return sourceWithoutId;
                            });
                            this.uiManager.showSourceItems(sourcesToShow);
                            this.uiManager.hideLoading();
                            return; // IMPORTANTE: Salir aquí para NO cargar canciones
                        }
                    }
                    
                    // Si la búsqueda está vacía, recargar todos los items del filtro
                    if (!query || query.trim() === '') {
                        // Para source sin género seleccionado, cargar géneros
                        // Para otros filtros, cargar items normalmente
                        const filterItems = await this.songListManager.loadFilterItems(this.currentNavMenu);
                        this.uiManager.showFilterItems(this.currentNavMenu, filterItems);
                    } else {
                        const filterItems = await this.songListManager.searchFilterItems(
                            this.currentNavMenu,
                            query,
                            genreId
                        );
                        
                        // Mostrar los items de filtro encontrados
                        this.uiManager.showFilterItems(this.currentNavMenu, filterItems);
                    }
                } else {
                    // Si estamos en inicio o liked, buscar en canciones
                    const hasFilterSelected = this.songListManager.hasActiveFilter();
                    
                    if (!query || query.trim() === '') {
                        // Si la búsqueda está vacía, mostrar canciones según el contexto
                        if (hasFilterSelected) {
                            // Mostrar las canciones del filtro actual
                            const allSongs = this.songListManager.getAllSongs();
                            const event = new CustomEvent('searchPerformed', {
                                detail: { songs: allSongs }
                            });
                            document.dispatchEvent(event);
                            this.audioPlayer.setSongList(allSongs);
                        } else {
                            // Mostrar todas las canciones cargadas
                            const allSongs = this.songListManager.getAllSongs();
                            const event = new CustomEvent('searchPerformed', {
                                detail: { songs: allSongs }
                            });
                            document.dispatchEvent(event);
                            this.audioPlayer.setSongList(allSongs);
                        }
                    } else {
                        // Realizar búsqueda en canciones
                        const searchResults = await this.songListManager.searchSongs(query);
                        const event = new CustomEvent('searchPerformed', {
                            detail: { songs: searchResults }
                        });
                        document.dispatchEvent(event);
                        this.audioPlayer.setSongList(searchResults);
                    }
                }
            } catch (error) {
                console.error('Error en búsqueda:', error);
                // En caso de error, intentar mostrar contenido por defecto
                if (!isFilterMenu) {
                    const allSongs = this.songListManager.getAllSongs();
                    const event = new CustomEvent('searchPerformed', {
                        detail: { songs: allSongs }
                    });
                    document.dispatchEvent(event);
                    this.audioPlayer.setSongList(allSongs);
                }
            } finally {
                this.uiManager.hideLoading();
            }
        });

        // Event listeners para los botones de filtro
        this.setupFilterButtons();
    }

    /**
     * Configura los event listeners de los botones de filtro
     */
    setupFilterButtons() {
        // Botón Inicio
        const navInicio = document.getElementById('navInicio');
        if (navInicio) {
            navInicio.addEventListener('click', async (e) => {
                e.preventDefault();
                this.setActiveNavLink(navInicio);
                this.currentNavMenu = 'inicio';
                this.sourceGenreId = null;
                
                // IMPORTANTE: Limpiar las cards de filtro antes de cargar las canciones iniciales
                // Esto asegura que las canciones se rendericen correctamente
                const songListContainer = document.getElementById('songList');
                if (songListContainer) {
                    // Limpiar todas las cards de filtro
                    const filterCards = songListContainer.querySelectorAll('.filter-item-card');
                    filterCards.forEach(card => card.remove());
                    
                    // También limpiar el selector de género de sources si existe
                    const genreSelector = songListContainer.querySelector('.source-genre-selector-container');
                    if (genreSelector) {
                        genreSelector.remove();
                    }
                }
                
                // Resetear y cargar canciones iniciales
                this.songListManager.reset();
                this.uiManager.showLoading();
                
                // Resetear el contador al total general antes de cargar las canciones
                this.uiManager.loadTotalSongsCount();
                
                try {
                    await this.songListManager.loadInitialSongs(50, 'rand');
                    this.audioPlayer.setSongList(this.songListManager.getAllSongs());
                } catch (error) {
                    console.error('Error cargando canciones iniciales:', error);
                    this.uiManager.hideLoading();
                }
                // Nota: El loading se oculta automáticamente cuando se renderizan las canciones
                // a través del evento 'songsLoaded' cuando isInitial es true
            });
        }

        // Botón Añadidos recientemente
        const navRecent = document.getElementById('navRecent');
        if (navRecent) {
            navRecent.addEventListener('click', async (e) => {
                e.preventDefault();
                this.setActiveNavLink(navRecent);
                this.currentNavMenu = 'recent';
                this.sourceGenreId = null;
                
                // IMPORTANTE: Limpiar las cards de filtro antes de cargar las canciones recientes
                // Esto asegura que las canciones se rendericen correctamente
                const songListContainer = document.getElementById('songList');
                if (songListContainer) {
                    // Limpiar todas las cards de filtro
                    const filterCards = songListContainer.querySelectorAll('.filter-item-card');
                    filterCards.forEach(card => card.remove());
                    
                    // También limpiar el selector de género de sources si existe
                    const genreSelector = songListContainer.querySelector('.source-genre-selector-container');
                    if (genreSelector) {
                        genreSelector.remove();
                    }
                }
                
                // Resetear y cargar canciones recientes
                this.songListManager.reset();
                this.uiManager.showLoading();
                
                try {
                    await this.songListManager.loadRecentSongs();
                    this.audioPlayer.setSongList(this.songListManager.getAllSongs());
                } catch (error) {
                    console.error('Error cargando canciones recientes:', error);
                    this.uiManager.hideLoading();
                }
                // Nota: El loading se oculta automáticamente cuando se renderizan las canciones
                // a través del evento 'songsLoaded' cuando isInitial es true
            });
        }

        // Botón Source especial (con submenú)
        const navSource = document.getElementById('navSource');
        if (navSource) {
            navSource.addEventListener('click', async (e) => {
                e.preventDefault();
                const navItem = navSource.closest('.nav-item-expandable');
                const submenu = document.getElementById('sourceGenresMenu');
                
                // Toggle expand/collapse
                if (navItem) {
                    const isExpanded = navItem.classList.contains('expanded');
                    
                    if (isExpanded) {
                        navItem.classList.remove('expanded');
                        submenu.style.display = 'none';
                    } else {
                        navItem.classList.add('expanded');
                        submenu.style.display = 'block';
                        
                        // Si el submenú está vacío, cargar géneros
                        if (submenu.children.length === 0) {
                            await this.loadSourceGenresMenu();
                        }
                    }
                }
            });
        }

        // Botones de filtro (incluyendo playlist, excluyendo Source que ya está manejado)
        const filterButtons = document.querySelectorAll('.filter-link');
        console.log(`Encontrados ${filterButtons.length} botones de filtro`);
        
        filterButtons.forEach(button => {
            const filterType = button.dataset.filter;
            console.log(`Registrando listener para filtro: ${filterType}`);
            
            button.addEventListener('click', async (e) => {
                e.preventDefault();
                console.log(`Click en filtro: ${filterType}`);
                this.setActiveNavLink(button);
                this.currentNavMenu = filterType;
                this.sourceGenreId = null; // Resetear genreId cuando cambiamos de menú
                
                // Colapsar el menú de Source si está expandido
                const expandedNavItems = document.querySelectorAll('.nav-item-expandable.expanded');
                expandedNavItems.forEach(navItem => {
                    navItem.classList.remove('expanded');
                    const submenu = navItem.querySelector('.nav-submenu');
                    if (submenu) {
                        submenu.style.display = 'none';
                    }
                });
                
                await this.handleFilterClick(filterType);
            });
        });

        // Escuchar cuando se cargan items de filtro
        document.addEventListener('filterItemsLoaded', (e) => {
            const { filterType, items } = e.detail;
            this.uiManager.showFilterItems(filterType, items);
            // Ocultar loading después de mostrar los items
            this.uiManager.hideLoading();
        });

        // Escuchar cuando se selecciona un item de filtro
        document.addEventListener('filterItemSelected', async (e) => {
            const { filterType, filterValue, filterItemId, count } = e.detail;

            // Si estamos en el contexto de Source mostrando sources, no cargar canciones automáticamente
            // Solo cargar canciones cuando se hace click en una card de source específica
            // (esto se maneja en handleFilterItemSelected)
            await this.handleFilterItemSelected(filterType, filterValue, count, filterItemId);
        });

        // Escuchar cuando se selecciona un género en el selector de sources
        document.addEventListener('sourceGenreSelected', async (e) => {
            const { genreId, genreName } = e.detail;
            await this.handleSourceGenreSelected(genreId, genreName);
        });
        
        // Escuchar cuando se selecciona un género desde el submenú de Source
        document.addEventListener('sourceGenreMenuSelected', async (e) => {
            const { genreId, genreName } = e.detail;
            await this.handleSourceGenreSelected(genreId, genreName);
        });

        // Escuchar cuando se quiere subir una imagen de cover
        document.addEventListener('uploadCoverImage', async (e) => {
            const { filterType, itemKey, file, cardElement } = e.detail;
            await this.handleUploadCoverImage(filterType, itemKey, file, cardElement);
        });

        // Escuchar cuando se quiere crear una playlist
        document.addEventListener('createPlaylist', async () => {
            await this.handleCreatePlaylist();
        });

        // Escuchar cuando se quiere añadir una canción a una playlist
        document.addEventListener('addSongToPlaylist', async (e) => {
            const { song } = e.detail;
            await this.handleAddSongToPlaylist(song);
        });

        // Escuchar cuando se quiere eliminar una canción de una playlist
        document.addEventListener('removeSongFromPlaylist', async (e) => {
            const { song, playlistId } = e.detail;
            await this.handleRemoveSongFromPlaylist(song, playlistId);
        });

        // Escuchar cuando cambia el modo de vista
        document.addEventListener('viewModeChanged', () => {
            // Re-renderizar las canciones actuales con la nueva vista
            const allSongs = this.songListManager.getAllSongs();
            if (allSongs.length > 0) {
                this.uiManager.rerenderSongs(allSongs);
            }
        });
    }

    /**
     * Carga los géneros en el submenú de Source
     */
    async loadSourceGenresMenu() {
        try {
            const genres = await firestoreService.getGenresList();
            const submenu = document.getElementById('sourceGenresMenu');
            
            if (!submenu) return;
            
            // Limpiar el submenú
            submenu.innerHTML = '';
            
            // Agregar cada género como item del submenú
            genres.forEach(genre => {
                const li = document.createElement('li');
                li.className = 'nav-submenu-item';
                
                const link = document.createElement('a');
                link.href = '#';
                link.className = 'nav-submenu-link';
                link.textContent = genre.key || genre.name || genre.id;
                link.dataset.genreId = genre.id || genre.key;
                link.dataset.genreName = genre.key || genre.name || genre.id;
                
                link.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    // Remover active de todos los links del submenú
                    submenu.querySelectorAll('.nav-submenu-link').forEach(l => {
                        l.classList.remove('active');
                    });
                    
                    // Agregar active al link clickeado
                    link.classList.add('active');
                    
                    // Disparar evento para manejar la selección
                    const event = new CustomEvent('sourceGenreMenuSelected', {
                        detail: {
                            genreId: link.dataset.genreId,
                            genreName: link.dataset.genreName
                        }
                    });
                    document.dispatchEvent(event);
                });
                
                li.appendChild(link);
                submenu.appendChild(li);
            });
            
            console.log(`Géneros cargados en el submenú de Source: ${genres.length}`);
        } catch (error) {
            console.error('Error cargando géneros para el submenú de Source:', error);
        }
    }


    /**
     * Maneja la creacion de una nueva playlist
     */
    async handleCreatePlaylist() {
        // Verificar si hay usuario autenticado
        if (!this.currentUser) {
            alert('Debes iniciar sesion para crear una playlist');
            this.uiManager.showAuthModal();
            return;
        }

        const playlistName = prompt('Ingresa el nombre de la nueva playlist:');

        if (!playlistName || playlistName.trim() === '') {
            return;
        }

        try {
            // Pasar el ownerId del usuario actual
            await firestoreService.createPlaylist(playlistName.trim(), this.currentUser.uid);
            alert(`Playlist "${playlistName}" creada exitosamente.`);

            // Si estamos en el menu de playlists, recargar los items
            if (this.currentNavMenu === 'playlist') {
                this.uiManager.showLoading();
                const items = await this.songListManager.loadFilterItems('playlist');
                this.uiManager.hideLoading();
            }
        } catch (error) {
            console.error('Error creando playlist:', error);
            alert(`Error al crear la playlist: ${error.message || 'Error desconocido'}`);
        }
    }


    /**
     * Maneja la adición de una canción a una playlist
     * @param {Object} song - Canción a añadir
     */
    async handleAddSongToPlaylist(song) {
        if (!song || !song.title) {
            alert('No hay una canción seleccionada para añadir a la playlist.');
            return;
        }

        try {
            // Cargar todas las playlists
            const playlists = await firestoreService.getAllPlaylists();
            
            if (playlists.length === 0) {
                const createPlaylist = confirm('No hay playlists creadas. ¿Deseas crear una nueva playlist?');
                if (createPlaylist) {
                    await this.handleCreatePlaylist();
                    // Intentar de nuevo después de crear la playlist
                    if (playlists.length === 0) {
                        const newPlaylists = await firestoreService.getAllPlaylists();
                        if (newPlaylists.length > 0) {
                            await this.showPlaylistSelectorAndAdd(song, newPlaylists);
                        }
                    } else {
                        await this.showPlaylistSelectorAndAdd(song, playlists);
                    }
                }
                return;
            }

            await this.showPlaylistSelectorAndAdd(song, playlists);
        } catch (error) {
            console.error('Error cargando playlists:', error);
            alert('Error al cargar las playlists. Por favor, intenta de nuevo.');
        }
    }

    /**
     * Muestra un selector de playlists y añade la canción a la seleccionada
     * @param {Object} song - Canción a añadir
     * @param {Array} playlists - Array de playlists disponibles
     */
    async showPlaylistSelectorAndAdd(song, playlists) {
        // Crear un diálogo simple para seleccionar playlist
        const playlistNames = playlists.map(p => p.name);
        const playlistList = playlists.map((p, index) => `${index + 1}. ${p.name} (${p.songCount} canciones)`).join('\n');
        
        const input = prompt(
            `Selecciona una playlist para añadir "${song.title}":\n\n${playlistList}\n\nIngresa el número de la playlist:`
        );

        if (!input || input.trim() === '') {
            return;
        }

        const selectedIndex = parseInt(input.trim()) - 1;
        
        if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= playlists.length) {
            alert('Número de playlist inválido.');
            return;
        }

        const selectedPlaylist = playlists[selectedIndex];

        try {
            await firestoreService.addSongToPlaylist(selectedPlaylist.id, song.title);
            alert(`Canción "${song.title}" añadida a la playlist "${selectedPlaylist.name}".`);
        } catch (error) {
            console.error('Error añadiendo canción a playlist:', error);
            alert(`Error al añadir la canción a la playlist: ${error.message || 'Error desconocido'}`);
        }
    }

    /**
     * Maneja la eliminación de una canción de una playlist
     * @param {Object} song - Canción a eliminar
     * @param {string} playlistId - ID de la playlist
     */
    async handleRemoveSongFromPlaylist(song, playlistId) {
        if (!song || !song.title || !playlistId) {
            console.error('Datos incompletos para eliminar canción de playlist');
            return;
        }

        const confirmRemove = confirm(`¿Eliminar "${song.title}" de esta playlist?`);
        if (!confirmRemove) {
            return;
        }

        try {
            const userId = this.currentUser ? this.currentUser.uid : null;
            await firestoreService.removeSongFromPlaylist(playlistId, song.title, userId);

            // Eliminar la card de la canción del DOM
            const songCard = document.querySelector(`.song-card[data-song-id="${song.id}"]`);
            if (songCard) {
                songCard.remove();
            }

            // Actualizar el contador de canciones
            const currentCount = this.songListManager.allSongs.length;
            this.uiManager.updateSongCounter(currentCount - 1);

            // Eliminar la canción del array local
            const songIndex = this.songListManager.allSongs.findIndex(s => s.id === song.id);
            if (songIndex !== -1) {
                this.songListManager.allSongs.splice(songIndex, 1);
            }
        } catch (error) {
            console.error('Error eliminando canción de playlist:', error);
            alert(`Error al eliminar la canción: ${error.message || 'Error desconocido'}`);
        }
    }

    /**
     * Maneja el click en un botón de filtro
     * @param {string} filterType - Tipo de filtro
     */
    async handleFilterClick(filterType) {
        console.log(`handleFilterClick llamado con: ${filterType}`);
        this.uiManager.showLoading();

        try {
            if (filterType === 'liked') {
                // Para "liked", cargar directamente las canciones con liked = true
                console.log('Cargando canciones favoritas...');
                const songs = await this.songListManager.loadFilteredSongs('liked');
                // Las canciones se renderizan automáticamente a través del evento 'songsLoaded'
                // El loading se oculta en el evento 'songsLoaded' cuando isInitial es true
                this.audioPlayer.setSongList(this.songListManager.getAllSongs());
                console.log(`Canciones favoritas cargadas: ${songs.length} canciones`);
                
                // Si no hay canciones, asegurarse de ocultar el loading
                if (songs.length === 0) {
                    this.uiManager.hideLoading();
                }
            } else {
                // Para otros filtros (genre, source, artist, album, year, playlist), cargar la lista de items primero
                console.log(`Cargando items de filtro para: ${filterType}`);
                const items = await this.songListManager.loadFilterItems(filterType);
                // El loading se oculta cuando se dispara el evento 'filterItemsLoaded'
                console.log(`Items de filtro cargados: ${items.length} items para ${filterType}`);
                
                // Si no hay items, asegurarse de ocultar el loading
                if (items.length === 0) {
                    this.uiManager.hideLoading();
                }
            }
        } catch (error) {
            console.error(`Error manejando filtro ${filterType}:`, error);
            console.error('Stack trace:', error.stack);
            this.uiManager.hideLoading();
        }
    }

    /**
     * Maneja la selección de un item de filtro
     * @param {string} filterType - Tipo de filtro
     * @param {string} filterValue - Valor del filtro seleccionado
     * @param {number} count - Número total de canciones en este filtro (opcional)
     * @param {string} filterItemId - ID del documento (para playlists)
     */
    async handleFilterItemSelected(filterType, filterValue, count = null, filterItemId = null) {
        console.log(`handleFilterItemSelected: filterType=${filterType}, filterValue="${filterValue}", count=${count}, filterItemId=${filterItemId}`);
        
        // IMPORTANTE: Limpiar las cards de filtro antes de cargar las canciones
        // Esto asegura que las canciones se rendericen correctamente
        const songListContainer = document.getElementById('songList');
        if (songListContainer) {
            // Limpiar solo las cards de filtro, no las canciones si ya están renderizadas
            const filterCards = songListContainer.querySelectorAll('.filter-item-card');
            filterCards.forEach(card => card.remove());
            
            // También limpiar el selector de género de sources si existe
            const genreSelector = songListContainer.querySelector('.source-genre-selector-container');
            if (genreSelector) {
                genreSelector.remove();
            }
        }
        
        this.uiManager.showLoading();

        try {
            // Cuando se selecciona un filtro, ahora el buscador debe buscar en canciones
            // del filtro seleccionado, no en items de filtro
            const songs = await this.songListManager.loadFilteredSongs(filterType, filterValue, count, filterItemId);
            // Las canciones se renderizan automáticamente a través del evento 'songsLoaded'
            // El loading se oculta en el evento 'songsLoaded' cuando isInitial es true
            // Solo necesitamos actualizar la lista en el reproductor
            this.audioPlayer.setSongList(this.songListManager.getAllSongs());
            console.log(`handleFilterItemSelected: Canciones filtradas cargadas: ${songs.length} canciones para ${filterType} = ${filterValue}`);
        } catch (error) {
            console.error(`handleFilterItemSelected: Error cargando canciones filtradas ${filterType}:`, error);
            console.error('Error details:', error.message, error.stack);
            this.uiManager.hideLoading();
            alert(`Error al cargar las canciones de la ${filterType === 'playlist' ? 'playlist' : 'filtro'}: ${error.message || 'Error desconocido'}`);
        }
    }

    /**
     * Maneja la selección de un género en el selector de sources
     * @param {string} genreId - ID del género seleccionado
     * @param {string} genreName - Nombre del género seleccionado
     */
    async handleSourceGenreSelected(genreId, genreName) {
        console.log(`handleSourceGenreSelected: genreId=${genreId}, genreName=${genreName}`);
        
        // Marcar Source como menú activo
        this.currentNavMenu = 'source';
        const navSource = document.getElementById('navSource');
        if (navSource) {
            // Remover active de todos los links
            document.querySelectorAll('.nav-link').forEach(link => {
                link.classList.remove('active');
            });
            // Agregar active a Source
            navSource.classList.add('active');
        }
        
        // Asegurar que el submenú esté expandido
        const navItem = navSource?.closest('.nav-item-expandable');
        const submenu = document.getElementById('sourceGenresMenu');
        if (navItem && submenu) {
            navItem.classList.add('expanded');
            submenu.style.display = 'block';
        }
        
        // Guardar el genreId para búsquedas de sources
        this.sourceGenreId = genreId;
        
        // IMPORTANTE: Resetear completamente el filtro para que NO se carguen canciones
        // Funciona igual que cuando haces click en "Artista" - solo muestra las cards
        this.songListManager.reset();
        this.songListManager.currentFilterType = null;
        this.songListManager.currentFilterValue = null;
        
        // Limpiar la lista de canciones del reproductor también
        this.audioPlayer.setSongList([]);

        this.uiManager.showLoading();

        try {
            // Cargar sources del género seleccionado (igual que loadFilterItems para artista)
            console.log(`handleSourceGenreSelected: Cargando sources para genreId: ${genreId} (SIN cargar canciones)`);
            const sources = await this.songListManager.loadFilterItemsForSource(genreId);
            console.log(`handleSourceGenreSelected: Sources cargados: ${sources.length} sources`);
            
            // Verificar que los sources no tengan el campo 'id' (para que se muestren como cards)
            const sourcesToShow = sources.map(source => {
                const { id, ...sourceWithoutId } = source;
                return sourceWithoutId;
            });
            
            console.log('handleSourceGenreSelected: Mostrando SOLO sources como cards (NO canciones)');
            // Mostrar SOLO las sources como cards de filtro - igual que showFilterItems para artista
            // NO cargar canciones aquí - solo se cargan cuando haces click en una card de source
            this.uiManager.showSourceItems(sourcesToShow);
            
            this.uiManager.hideLoading();
        } catch (error) {
            console.error(`Error cargando sources para género ${genreName}:`, error);
            console.error('Error details:', error.message, error.stack);
            this.uiManager.hideLoading();
            alert(`Error al cargar los sources del género ${genreName}. Por favor, intenta de nuevo.`);
        }
    }

    /**
     * Establece el enlace de navegación activo
     * @param {HTMLElement} activeLink - Enlace a activar
     */
    setActiveNavLink(activeLink) {
        // Remover clase active de todos los enlaces y submenús
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });
        document.querySelectorAll('.nav-submenu-link').forEach(link => {
            link.classList.remove('active');
        });
        
        // Si el enlace activo no es Source, colapsar el submenú de Source
        if (!activeLink.id || activeLink.id !== 'navSource') {
            const sourceNavItem = document.querySelector('.nav-item-expandable.expanded');
            if (sourceNavItem) {
                sourceNavItem.classList.remove('expanded');
                const sourceSubmenu = document.getElementById('sourceGenresMenu');
                if (sourceSubmenu) {
                    sourceSubmenu.style.display = 'none';
                }
            }
        }
        
        // Añadir clase active al enlace seleccionado
        activeLink.classList.add('active');
    }

    /**
     * Maneja la subida de una imagen de cover
     * @param {string} filterType - Tipo de filtro ('artist', 'genre', 'source', 'year')
     * @param {string} itemKey - Nombre o clave del item
     * @param {File} file - Archivo de imagen a subir
     * @param {HTMLElement} cardElement - Elemento card donde actualizar la imagen
     */
    async handleUploadCoverImage(filterType, itemKey, file, cardElement) {
        try {
            // Determinar la carpeta según el tipo
            let folder;
            switch (filterType) {
                case 'artist':
                    folder = 'CoverArtistas';
                    break;
                case 'genre':
                    folder = 'CoverGenres';
                    break;
                case 'source':
                    folder = 'CoverSources';
                    break;
                case 'year':
                    folder = 'CoverAños';
                    break;
                case 'playlist':
                    folder = 'CoverPlaylists';
                    break;
                default:
                    throw new Error(`Tipo de filtro no válido: ${filterType}`);
            }

            // Limpiar nombre del archivo para usarlo como nombre base (eliminar caracteres especiales)
            const cleanFileName = itemKey.replace(/[^a-zA-Z0-9_-]/g, '_');

            // Obtener el coverPath anterior para eliminarlo después
            let previousCoverPath = null;
            if (filterType === 'playlist') {
                previousCoverPath = await firestoreService.getPreviousPlaylistCoverPath(itemKey);
            } else {
                previousCoverPath = await firestoreService.getPreviousCoverPath(filterType, itemKey);
            }

            // Subir la imagen a Storage
            const coverPath = await storageService.uploadImage(file, folder, cleanFileName);
            
            // Actualizar el coverPath en Firestore
            switch (filterType) {
                case 'artist':
                    await firestoreService.updateArtistCoverPath(itemKey, coverPath);
                    break;
                case 'genre':
                    await firestoreService.updateGenreCoverPath(itemKey, coverPath);
                    break;
                case 'source':
                    await firestoreService.updateSourceCoverPath(itemKey, coverPath);
                    break;
                case 'year':
                    await firestoreService.updateYearCoverPath(itemKey, coverPath);
                    break;
                case 'playlist':
                    await firestoreService.updatePlaylistCoverPath(itemKey, coverPath);
                    break;
            }

            // Si había una imagen anterior, eliminarla de Storage
            if (previousCoverPath && previousCoverPath.trim() !== '') {
                try {
                    await storageService.deleteImage(previousCoverPath);
                } catch (error) {
                    console.warn('No se pudo eliminar la imagen anterior:', error);
                    // No es crítico, continuar
                }
            }

            // Actualizar la UI del card
            await this.uiManager.updateCardCover(cardElement, coverPath);

            console.log(`Imagen subida exitosamente para ${filterType}: ${itemKey}`);
        } catch (error) {
            console.error(`Error subiendo imagen para ${filterType} ${itemKey}:`, error);
            alert(`Error al subir la imagen: ${error.message || 'Error desconocido'}`);
            this.uiManager.showUploadProgress(cardElement, false);
        }
    }

    // ========================================
    // AUTH METHODS
    // ========================================

    /**
     * Configura la UI de autenticacion
     */
    setupAuthUI() {
        const userAuthBtn = document.getElementById('userAuthBtn');
        const userDropdown = document.getElementById('userDropdown');
        const logoutBtn = document.getElementById('logoutBtn');
        const authModal = document.getElementById('authModal');
        const authModalClose = document.getElementById('authModalClose');
        const authModalOverlay = document.getElementById('authModalOverlay');
        const authTabs = document.querySelectorAll('.auth-tab');
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');

        // Click en boton de usuario
        if (userAuthBtn) {
            userAuthBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.currentUser) {
                    // Usuario logueado - mostrar dropdown
                    this.uiManager.toggleUserDropdown();
                } else {
                    // Usuario no logueado - mostrar modal
                    this.uiManager.showAuthModal();
                }
            });
        }

        // Click en cerrar sesion
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                try {
                    await authService.signOut();
                    this.uiManager.hideUserDropdown();
                } catch (error) {
                    console.error('Error cerrando sesion:', error);
                    alert('Error al cerrar sesion');
                }
            });
        }

        // Cerrar dropdown al hacer click fuera
        document.addEventListener('click', (e) => {
            if (userDropdown && !userDropdown.contains(e.target) && !userAuthBtn.contains(e.target)) {
                this.uiManager.hideUserDropdown();
            }
        });

        // Cerrar modal
        if (authModalClose) {
            authModalClose.addEventListener('click', () => {
                this.uiManager.hideAuthModal();
            });
        }

        if (authModalOverlay) {
            authModalOverlay.addEventListener('click', () => {
                this.uiManager.hideAuthModal();
            });
        }

        // Cambiar tabs
        authTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                this.uiManager.switchAuthTab(tab.dataset.tab);
            });
        });

        // Submit login
        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('loginEmail').value;
                const password = document.getElementById('loginPassword').value;

                try {
                    const submitBtn = loginForm.querySelector('.auth-submit-btn');
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Iniciando...';

                    await authService.signIn(email, password);
                    this.uiManager.hideAuthModal();
                } catch (error) {
                    this.uiManager.showLoginError(error.message);
                } finally {
                    const submitBtn = loginForm.querySelector('.auth-submit-btn');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Iniciar Sesion';
                }
            });
        }

        // Submit registro
        if (registerForm) {
            registerForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('registerEmail').value;
                const password = document.getElementById('registerPassword').value;
                const passwordConfirm = document.getElementById('registerPasswordConfirm').value;

                // Validaciones
                if (!authService.validateEmail(email)) {
                    this.uiManager.showRegisterError('El correo electronico no es valido');
                    return;
                }

                if (!authService.validatePassword(password)) {
                    this.uiManager.showRegisterError('La contrasena debe tener al menos 6 caracteres');
                    return;
                }

                if (password !== passwordConfirm) {
                    this.uiManager.showRegisterError('Las contrasenas no coinciden');
                    return;
                }

                try {
                    const submitBtn = registerForm.querySelector('.auth-submit-btn');
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Creando cuenta...';

                    await authService.signUp(email, password);
                    this.uiManager.hideAuthModal();
                } catch (error) {
                    this.uiManager.showRegisterError(error.message);
                } finally {
                    const submitBtn = registerForm.querySelector('.auth-submit-btn');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Crear cuenta';
                }
            });
        }

        // Cerrar modal con Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && authModal && authModal.style.display !== 'none') {
                this.uiManager.hideAuthModal();
            }
        });
    }

    /**
     * Maneja cambios en el estado de autenticacion
     * @param {firebase.User|null} user
     */
    handleAuthStateChange(user) {
        this.currentUser = user;

        if (user) {
            console.log('Usuario autenticado:', user.email);
            this.uiManager.showUserLoggedIn(user.email);
            userLikesService.setUserId(user.uid);

            // Si estamos en "Favoritas", recargar con likes del usuario
            if (this.currentNavMenu === 'liked') {
                this.handleFilterClick('liked');
            }
        } else {
            console.log('Usuario no autenticado');
            this.uiManager.showUserLoggedOut();
            userLikesService.setUserId(null);

            // Si estamos en "Favoritas" y el usuario cierra sesion, volver a inicio
            if (this.currentNavMenu === 'liked') {
                this.handleNavigation('inicio');
            }
        }
    }

    /**
     * Verifica si hay un parametro 'play' en la URL y reproduce la cancion
     */
    async checkAutoPlayFromUrl() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const songId = urlParams.get('play');

            if (!songId) {
                return;
            }

            console.log(`Auto-play solicitado para cancion ID: ${songId}`);

            // Buscar la cancion por ID
            const song = await firestoreService.getSongById(songId);

            if (song) {
                console.log(`Cancion encontrada: ${song.title}`);
                // Reproducir la cancion
                await this.audioPlayer.playSong(song, -1);

                // Limpiar el parametro de la URL sin recargar la pagina
                const newUrl = window.location.pathname;
                window.history.replaceState({}, document.title, newUrl);
            } else {
                console.log(`Cancion con ID ${songId} no encontrada`);
            }
        } catch (error) {
            console.error('Error en auto-play desde URL:', error);
        }
    }
}

// Inicializar aplicación cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        const app = new App();
        app.init();
    });
} else {
    const app = new App();
    app.init();
}
