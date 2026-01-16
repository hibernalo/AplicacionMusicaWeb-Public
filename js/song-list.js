import firestoreService from './firestore-service.js';
import userLikesService from './user-likes-service.js';

/**
 * Gestor de lista de canciones con paginación
 */
class SongListManager {
    constructor() {
        this.allSongs = [];
        this.currentPage = 0;
        this.pageSize = 50;
        this.lastDoc = null;
        this.hasMore = true;
        this.isLoading = false;
        this.orderBy = 'rand';
        
        // Estado de filtros
        this.currentFilterType = null; // 'liked', 'genre', 'source', 'artist', 'album', 'year', 'recent'
        this.currentFilterValue = null; // Valor del filtro seleccionado
        this.filterItems = []; // Lista de items de filtro (artistas, álbumes, etc.)
        this.recentOffset = 0; // Offset para paginación de canciones recientes
    }

    /**
     * Carga la primera página de canciones
     * @param {number} pageSize - Tamaño de página (default: 50)
     * @param {string} orderBy - Campo por el cual ordenar (default: 'rand')
     * @returns {Promise<Array>} Array de canciones cargadas
     */
    async loadInitialSongs(pageSize = 50, orderBy = 'rand') {
        if (this.isLoading) return [];

        this.pageSize = pageSize;
        this.orderBy = orderBy;
        this.allSongs = [];
        this.currentPage = 0;
        this.lastDoc = null;
        this.hasMore = true;
        this.isLoading = true;

        try {
            const result = await firestoreService.getSongsPaginated(
                this.pageSize,
                this.lastDoc,
                this.orderBy
            );

            this.allSongs = result.songs;
            this.lastDoc = result.lastDoc;
            this.hasMore = result.hasMore;
            this.currentPage = 1;

            this.isLoading = false;
            this.dispatchEvent('songsLoaded', { songs: this.allSongs, isInitial: true });

            return this.allSongs;
        } catch (error) {
            console.error('Error cargando canciones iniciales:', error);
            this.isLoading = false;
            throw error;
        }
    }

    /**
     * Carga la siguiente página de canciones
     * @returns {Promise<Array>} Array de nuevas canciones cargadas
     */
    async loadMoreSongs() {
        // Si hay un filtro activo, usar la función de filtros
        if (this.hasActiveFilter()) {
            return await this.loadMoreFilteredSongs();
        }

        if (this.isLoading || !this.hasMore) {
            return [];
        }

        this.isLoading = true;

        try {
            const result = await firestoreService.getSongsPaginated(
                this.pageSize,
                this.lastDoc,
                this.orderBy
            );

            if (result.songs.length > 0) {
                // Las canciones ya vienen mezcladas desde firestore-service si es modo 'rand'
                this.allSongs = [...this.allSongs, ...result.songs];
                this.lastDoc = result.lastDoc;
                this.hasMore = result.hasMore;
                this.currentPage++;

                this.dispatchEvent('songsLoaded', {
                    songs: result.songs,
                    isInitial: false,
                    totalSongs: this.allSongs.length
                });
            } else {
                this.hasMore = false;
            }

            this.isLoading = false;
            return result.songs;
        } catch (error) {
            console.error('Error cargando más canciones:', error);
            this.isLoading = false;
            throw error;
        }
    }

    /**
     * Obtiene todas las canciones cargadas
     * @returns {Array} Array de canciones
     */
    getAllSongs() {
        return this.allSongs;
    }

    /**
     * Obtiene una canción por su ID
     * @param {string} songId - ID de la canción
     * @returns {Object|null} Canción encontrada o null
     */
    getSongById(songId) {
        return this.allSongs.find(song => song.id === songId) || null;
    }

    /**
     * Obtiene el índice de una canción por su ID
     * @param {string} songId - ID de la canción
     * @returns {number} Índice de la canción o -1 si no se encuentra
     */
    getSongIndex(songId) {
        return this.allSongs.findIndex(song => song.id === songId);
    }

    /**
     * Verifica si hay más canciones para cargar
     * @returns {boolean} true si hay más canciones
     */
    hasMoreSongs() {
        return this.hasMore;
    }

    /**
     * Verifica si está cargando
     * @returns {boolean} true si está cargando
     */
    isLoadingSongs() {
        return this.isLoading;
    }

    /**
     * Obtiene el número total de canciones cargadas
     * @returns {number} Número de canciones
     */
    getTotalSongs() {
        return this.allSongs.length;
    }

    /**
     * Busca canciones por título en todas las canciones guardadas en Firestore
     * @param {string} searchQuery - Texto de búsqueda
     * @returns {Promise<Array>} Array de canciones que coinciden con la búsqueda
     */
    async searchSongs(searchQuery) {
        if (!searchQuery || searchQuery.trim() === '') {
            // Si no hay query, retornar las canciones cargadas actualmente
            return this.allSongs;
        }

        // Buscar en todas las canciones de Firestore, no solo en las cargadas
        // Si hay un filtro activo, buscar dentro de ese filtro
        try {
            const searchResults = await firestoreService.searchSongsByTitle(
                searchQuery,
                this.currentFilterType,
                this.currentFilterValue
            );
            return searchResults;
        } catch (error) {
            console.error('Error buscando canciones:', error);
            // En caso de error, hacer búsqueda local como fallback
            const query = searchQuery.toLowerCase().trim();
            return this.allSongs.filter(song => {
                if (!song.titleMinusculas) {
                    const title = (song.title || '').toLowerCase();
                    return title.includes(query);
                }
                return song.titleMinusculas.includes(query);
            });
        }
    }

    /**
     * Busca items de filtro según el tipo (géneros, sources, artistas, álbumes, años)
     * @param {string} filterType - Tipo de filtro ('genre', 'source', 'artist', 'album', 'year')
     * @param {string} searchQuery - Texto de búsqueda
     * @param {string} genreId - ID del género (solo para búsqueda de sources)
     * @returns {Promise<Array>} Array de items que coinciden con la búsqueda
     */
    async searchFilterItems(filterType, searchQuery, genreId = null) {
        try {
            switch (filterType) {
                case 'genre':
                    return await firestoreService.searchGenres(searchQuery);
                case 'source':
                    if (!genreId) {
                        // Si no hay genreId, retornar lista vacía o todos los géneros
                        // En realidad, cuando estamos en el menú de sources sin género seleccionado,
                        // deberíamos mostrar géneros, no sources
                        return await firestoreService.searchGenres(searchQuery);
                    }
                    return await firestoreService.searchSources(searchQuery, genreId);
                case 'artist':
                    return await firestoreService.searchArtists(searchQuery);
                case 'album':
                    return await firestoreService.searchAlbums(searchQuery);
                case 'year':
                    return await firestoreService.searchYears(searchQuery);
                case 'playlist':
                    // Buscar playlists por nombre
                    const allPlaylists = await firestoreService.getPlaylistsWithCounts();
                    if (!searchQuery || searchQuery.trim() === '') {
                        return allPlaylists;
                    }
                    const query = searchQuery.toLowerCase().trim();
                    return allPlaylists.filter(playlist => {
                        const name = (playlist.key || '').toLowerCase();
                        return name.includes(query);
                    });
                default:
                    return [];
            }
        } catch (error) {
            console.error(`Error buscando items de filtro ${filterType}:`, error);
            throw error;
        }
    }

    /**
     * Obtiene todas las canciones sin filtrar (para búsqueda)
     * @returns {Array} Todas las canciones cargadas
     */
    getAllSongsUnfiltered() {
        return this.allSongs;
    }

    /**
     * Resetea la lista de canciones
     */
    reset() {
        this.allSongs = [];
        this.currentPage = 0;
        this.lastDoc = null;
        this.hasMore = true;
        this.isLoading = false;
        this.currentFilterType = null;
        this.currentFilterValue = null;
        this.filterItems = [];
        this.recentOffset = 0;
    }

    /**
     * Carga lista de items de filtro (artistas, álbumes, años, géneros, sources)
     * @param {string} filterType - Tipo de filtro: 'artist', 'album', 'year', 'genre', 'source'
     * @returns {Promise<Array>} Array de items de filtro
     */
    async loadFilterItems(filterType) {
        if (this.isLoading) {
            console.log('Ya está cargando, ignorando solicitud');
            return [];
        }

        console.log(`loadFilterItems: Iniciando carga de items para ${filterType}`);
        this.isLoading = true;
        this.currentFilterType = filterType;
        this.currentFilterValue = null;
        this.filterItems = [];

        try {
            let items = [];
            console.log(`loadFilterItems: Llamando a función de Firestore para ${filterType}`);
            switch (filterType) {
                case 'artist':
                    items = await firestoreService.getArtistsWithCounts(2);
                    break;
                case 'album':
                    items = await firestoreService.getAlbumsWithCounts(2);
                    break;
                case 'year':
                    items = await firestoreService.getYearsWithCounts();
                    break;
                case 'genre':
                    items = await firestoreService.getGenresList();
                    break;
                case 'source':
                    // Para source, cargar géneros en lugar de sources directamente
                    // Los sources se cargarán después de seleccionar un género
                    items = await firestoreService.getGenresList();
                    break;
                case 'playlist':
                    items = await firestoreService.getPlaylistsWithCounts();
                    break;
                default:
                    console.error(`Tipo de filtro desconocido: ${filterType}`);
            }

            console.log(`loadFilterItems: Se obtuvieron ${items.length} items para ${filterType}`);
            this.filterItems = items;
            this.isLoading = false;
            console.log(`loadFilterItems: Disparando evento filterItemsLoaded con ${items.length} items`);
            this.dispatchEvent('filterItemsLoaded', { filterType, items });
            return items;
        } catch (error) {
            console.error(`Error cargando items de filtro ${filterType}:`, error);
            console.error('Stack trace:', error.stack);
            this.isLoading = false;
            throw error;
        }
    }

    /**
     * Carga canciones filtradas
     * @param {string} filterType - Tipo de filtro
     * @param {string} filterValue - Valor del filtro
     * @returns {Promise<Array>} Array de canciones filtradas
     */
    async loadFilteredSongs(filterType, filterValue = null, totalCount = null) {
        if (this.isLoading) {
            console.log('Ya está cargando canciones, ignorando solicitud');
            return [];
        }

        console.log(`loadFilteredSongs: Iniciando carga para ${filterType} = ${filterValue}, totalCount=${totalCount}`);
        this.currentFilterType = filterType;
        this.currentFilterValue = filterValue;
        this.allSongs = [];
        this.currentPage = 0;
        this.lastDoc = null;
        this.hasMore = true;
        this.isLoading = true;

        try {
            let result;
            console.log(`loadFilteredSongs: Llamando a función de Firestore para ${filterType}`);
            switch (filterType) {
                case 'liked':
                    const userId = userLikesService.getCurrentUserId();
                    if (!userId) {
                        console.log('loadFilteredSongs: No hay usuario autenticado para liked');
                        result = { songs: [], lastDoc: null, hasMore: false, total: 0 };
                    } else {
                        result = await firestoreService.getLikedSongs(userId, this.pageSize, this.lastDoc);
                    }
                    break;
                case 'artist':
                    result = await firestoreService.getSongsByArtist(filterValue, this.pageSize, this.lastDoc);
                    break;
                case 'album':
                    result = await firestoreService.getSongsByAlbum(filterValue, this.pageSize, this.lastDoc);
                    break;
                case 'year':
                    const year = parseInt(filterValue);
                    result = await firestoreService.getSongsByYear(year, this.pageSize, this.lastDoc);
                    break;
                case 'genre':
                    result = await firestoreService.getSongsByGenre(filterValue, this.pageSize, this.lastDoc);
                    break;
                case 'source':
                    result = await firestoreService.getSongsBySource(filterValue, this.pageSize, this.lastDoc);
                    break;
                case 'playlist':
                    // Para playlists, obtener todas las canciones directamente ya que no hay paginación
                    const playlistSongs = await firestoreService.getPlaylistSongs(filterValue);
                    result = {
                        songs: playlistSongs,
                        lastDoc: null,
                        hasMore: false
                    };
                    break;
                default:
                    console.error(`Tipo de filtro desconocido: ${filterType}`);
                    this.isLoading = false;
                    return [];
            }

            console.log(`loadFilteredSongs: Se obtuvieron ${result.songs.length} canciones`);
            this.allSongs = result.songs;
            this.lastDoc = result.lastDoc;
            this.hasMore = result.hasMore;
            this.currentPage = 1;

            this.isLoading = false;
            // Para 'liked', usar el total del resultado si está disponible, o totalCount si se pasa
            const finalTotalCount = filterType === 'liked' && result.total !== undefined ? result.total : totalCount;
            console.log(`loadFilteredSongs: Disparando evento songsLoaded con ${this.allSongs.length} canciones, totalCount=${finalTotalCount}`);
            this.dispatchEvent('songsLoaded', { songs: this.allSongs, isInitial: true, totalSongs: finalTotalCount });
            return this.allSongs;
        } catch (error) {
            console.error(`Error cargando canciones filtradas ${filterType}:`, error);
            console.error('Stack trace:', error.stack);
            this.isLoading = false;
            throw error;
        }
    }

    /**
     * Carga canciones recientemente añadidas
     * @returns {Promise<Array>} Array de canciones recientes
     */
    async loadRecentSongs() {
        if (this.isLoading) {
            console.log('Ya está cargando canciones, ignorando solicitud');
            return [];
        }

        console.log('loadRecentSongs: Iniciando carga de canciones recientes');
        this.currentFilterType = 'recent';
        this.currentFilterValue = null;
        this.allSongs = [];
        this.currentPage = 0;
        this.lastDoc = null;
        this.recentOffset = 0;
        this.hasMore = true;
        this.isLoading = true;

        try {
            console.log('loadRecentSongs: Llamando a función de Firestore para canciones recientes');
            const result = await firestoreService.getRecentSongs(this.pageSize, this.recentOffset);

            console.log(`loadRecentSongs: Se obtuvieron ${result.songs.length} canciones`);
            this.allSongs = result.songs;
            this.recentOffset = result.offset;
            this.hasMore = result.hasMore;
            this.currentPage = 1;

            this.isLoading = false;
            console.log(`loadRecentSongs: Disparando evento songsLoaded con ${this.allSongs.length} canciones`);
            this.dispatchEvent('songsLoaded', { songs: this.allSongs, isInitial: true, totalSongs: result.total || this.allSongs.length });
            return this.allSongs;
        } catch (error) {
            console.error('Error cargando canciones recientes:', error);
            console.error('Stack trace:', error.stack);
            this.isLoading = false;
            throw error;
        }
    }

    /**
     * Carga más canciones filtradas (paginación)
     * @returns {Promise<Array>} Array de nuevas canciones cargadas
     */
    async loadMoreFilteredSongs() {
        if (this.isLoading || !this.hasMore || !this.currentFilterType) {
            return [];
        }

        // Si es 'recent', usar loadMoreRecentSongs
        if (this.currentFilterType === 'recent') {
            return await this.loadMoreRecentSongs();
        }

        this.isLoading = true;

        try {
            let result;
            switch (this.currentFilterType) {
                case 'liked':
                    const likedUserId = userLikesService.getCurrentUserId();
                    if (!likedUserId) {
                        result = { songs: [], lastDoc: null, hasMore: false };
                    } else {
                        result = await firestoreService.getLikedSongs(likedUserId, this.pageSize, this.lastDoc);
                    }
                    break;
                case 'artist':
                    result = await firestoreService.getSongsByArtist(this.currentFilterValue, this.pageSize, this.lastDoc);
                    break;
                case 'album':
                    result = await firestoreService.getSongsByAlbum(this.currentFilterValue, this.pageSize, this.lastDoc);
                    break;
                case 'year':
                    const year = parseInt(this.currentFilterValue);
                    result = await firestoreService.getSongsByYear(year, this.pageSize, this.lastDoc);
                    break;
                case 'genre':
                    result = await firestoreService.getSongsByGenre(this.currentFilterValue, this.pageSize, this.lastDoc);
                    break;
                case 'source':
                    result = await firestoreService.getSongsBySource(this.currentFilterValue, this.pageSize, this.lastDoc);
                    break;
                case 'playlist':
                    // Para playlists, no hay más canciones ya que se cargan todas de una vez
                    this.isLoading = false;
                    return [];
                default:
                    this.isLoading = false;
                    return [];
            }

            if (result.songs.length > 0) {
                this.allSongs = [...this.allSongs, ...result.songs];
                this.lastDoc = result.lastDoc;
                this.hasMore = result.hasMore;
                this.currentPage++;

                this.dispatchEvent('songsLoaded', {
                    songs: result.songs,
                    isInitial: false,
                    totalSongs: this.allSongs.length
                });
            } else {
                this.hasMore = false;
            }

            this.isLoading = false;
            return result.songs;
        } catch (error) {
            console.error('Error cargando más canciones filtradas:', error);
            this.isLoading = false;
            throw error;
        }
    }

    /**
     * Carga más canciones recientes (paginación)
     * @returns {Promise<Array>} Array de nuevas canciones cargadas
     */
    async loadMoreRecentSongs() {
        if (this.isLoading || !this.hasMore || this.currentFilterType !== 'recent') {
            return [];
        }

        this.isLoading = true;

        try {
            const result = await firestoreService.getRecentSongs(this.pageSize, this.recentOffset);

            if (result.songs.length > 0) {
                this.allSongs = [...this.allSongs, ...result.songs];
                this.recentOffset = result.offset;
                this.hasMore = result.hasMore;
                this.currentPage++;

                this.dispatchEvent('songsLoaded', {
                    songs: result.songs,
                    isInitial: false,
                    totalSongs: this.allSongs.length
                });
            } else {
                this.hasMore = false;
            }

            this.isLoading = false;
            return result.songs;
        } catch (error) {
            console.error('Error cargando más canciones recientes:', error);
            this.isLoading = false;
            throw error;
        }
    }

    /**
     * Obtiene los items de filtro cargados
     * @returns {Array} Array de items de filtro
     */
    getFilterItems() {
        return this.filterItems;
    }

    /**
     * Carga sources filtrados por género (para cuando se selecciona un género en el selector de sources)
     * IMPORTANTE: Solo retorna sources, NO dispara eventos de canciones (igual que loadFilterItems)
     * @param {string} genreId - ID del género
     * @returns {Promise<Array>} Array de sources
     */
    async loadFilterItemsForSource(genreId) {
        if (this.isLoading) {
            console.log('Ya está cargando, ignorando solicitud');
            return [];
        }

        console.log(`loadFilterItemsForSource: Iniciando carga de sources para género ${genreId} (SIN cargar canciones)`);
        this.isLoading = true;
        
        // IMPORTANTE: NO establecer currentFilterType ni currentFilterValue aquí
        // Esto es solo para obtener items de filtro, igual que loadFilterItems
        // Las canciones solo se cargan cuando se hace click en una card de source específica

        try {
            const sources = await firestoreService.getSourcesList(genreId);
            console.log(`loadFilterItemsForSource: Se obtuvieron ${sources.length} sources (NO se cargaron canciones)`);
            this.isLoading = false;
            // NO disparar ningún evento aquí - solo retornar los sources
            // El evento se disparará cuando se muestren los sources como cards
            return sources;
        } catch (error) {
            console.error(`Error cargando sources para género ${genreId}:`, error);
            this.isLoading = false;
            throw error;
        }
    }

    /**
     * Verifica si hay un filtro activo
     * @returns {boolean} true si hay un filtro activo
     */
    hasActiveFilter() {
        return this.currentFilterType !== null;
    }

    /**
     * Dispara un evento personalizado
     * @param {string} eventName - Nombre del evento
     * @param {Object} detail - Datos del evento
     */
    dispatchEvent(eventName, detail) {
        const event = new CustomEvent(eventName, { detail });
        document.dispatchEvent(event);
    }
}

export default SongListManager;
