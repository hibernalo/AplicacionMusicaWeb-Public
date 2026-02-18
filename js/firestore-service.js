import { db } from './firebase-config.js';

/**
 * Servicio para consultar canciones desde Firestore
 */
class FirestoreService {
    /**
     * Obtiene canciones paginadas desde Firestore
     * @param {number} limit - Número de canciones a obtener por página (default: 50)
     * @param {Object} lastDoc - Último documento de la página anterior (para paginación)
     * @param {string} orderBy - Campo por el cual ordenar ('rand', 'title', 'artist') (default: 'rand')
     * @returns {Promise<{songs: Array, lastDoc: Object}>} Objeto con array de canciones y último documento
     */
    async getSongsPaginated(limit = 50, lastDoc = null, orderBy = 'rand') {
        try {
            // Ordenamiento no aleatorio: comportamiento original
            if (orderBy !== 'rand') {
                let query = db.collection('songs');
                if (orderBy === 'title') {
                    query = query.orderBy('titleMinusculas', 'asc');
                } else if (orderBy === 'artist') {
                    query = query.orderBy('artist', 'asc');
                }
                if (lastDoc) {
                    query = query.startAfter(lastDoc);
                }
                query = query.limit(limit);
                const snapshot = await query.get();
                if (snapshot.empty) {
                    return { songs: [], lastDoc: null, hasMore: false };
                }
                return {
                    songs: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                    lastDoc: snapshot.docs[snapshot.docs.length - 1],
                    hasMore: snapshot.docs.length === limit
                };
            }

            // Ordenamiento aleatorio con punto de inicio aleatorio por sesión.
            // lastDoc es null en la carga inicial, o { phase, firestoreDoc, threshold }
            // en páginas siguientes. Esto garantiza que cada visita empiece en un
            // punto distinto de la colección (verdadera aleatoriedad entre sesiones).
            const phase = lastDoc ? lastDoc.phase : 1;
            const threshold = lastDoc ? lastDoc.threshold : Math.random();
            const firestoreDoc = lastDoc ? lastDoc.firestoreDoc : null;

            if (phase === 1) {
                // Fase 1: canciones con rand >= threshold, ordenadas por rand asc
                let q = db.collection('songs')
                    .where('rand', '>=', threshold)
                    .orderBy('rand', 'asc');
                if (firestoreDoc) {
                    q = q.startAfter(firestoreDoc);
                }
                q = q.limit(limit);

                const snapshot = await q.get();
                let songs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                if (snapshot.docs.length === limit) {
                    // Página completa, continuar en fase 1
                    return {
                        songs: this.shuffleArray(songs),
                        lastDoc: { phase: 1, firestoreDoc: snapshot.docs[snapshot.docs.length - 1], threshold },
                        hasMore: true
                    };
                }

                // Fase 1 agotada: hacer wrap-around a la fase 2 (desde rand = 0)
                const remaining = limit - songs.length;
                const existingIds = new Set(songs.map(s => s.id));

                const p2Snapshot = await db.collection('songs')
                    .where('rand', '<', threshold)
                    .orderBy('rand', 'asc')
                    .limit(remaining)
                    .get();

                const p2Songs = p2Snapshot.docs
                    .map(doc => ({ id: doc.id, ...doc.data() }))
                    .filter(s => !existingIds.has(s.id));

                songs = [...songs, ...p2Songs];

                const hasMoreInP2 = p2Snapshot.docs.length === remaining;
                const newLastDoc = p2Snapshot.docs.length > 0
                    ? { phase: 2, firestoreDoc: p2Snapshot.docs[p2Snapshot.docs.length - 1], threshold }
                    : null;

                return {
                    songs: this.shuffleArray(songs),
                    lastDoc: newLastDoc,
                    hasMore: hasMoreInP2
                };
            }

            // Fase 2: canciones con rand < threshold, ordenadas por rand asc
            let q2 = db.collection('songs')
                .where('rand', '<', threshold)
                .orderBy('rand', 'asc');
            if (firestoreDoc) {
                q2 = q2.startAfter(firestoreDoc);
            }
            q2 = q2.limit(limit);

            const p2Snapshot = await q2.get();
            if (p2Snapshot.empty) {
                return { songs: [], lastDoc: null, hasMore: false };
            }

            const songs = this.shuffleArray(p2Snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            const hasMore = p2Snapshot.docs.length === limit;

            return {
                songs,
                lastDoc: hasMore
                    ? { phase: 2, firestoreDoc: p2Snapshot.docs[p2Snapshot.docs.length - 1], threshold }
                    : null,
                hasMore
            };

        } catch (error) {
            console.error('Error obteniendo canciones desde Firestore:', error);
            throw error;
        }
    }

    /**
     * Obtiene el conteo total de canciones en la colección
     * @returns {Promise<number>} Número total de canciones
     */
    async getTotalSongsCount() {
        try {
            const snapshot = await db.collection('songs').get();
            return snapshot.docs.length;
        } catch (error) {
            console.error('Error obteniendo conteo total de canciones:', error);
            throw error;
        }
    }

    /**
     * Obtiene todas las canciones (útil para búsqueda, pero no recomendado para ~600 canciones)
     * @returns {Promise<Array>} Array con todas las canciones
     */
    async getAllSongs() {
        try {
            const snapshot = await db.collection('songs').get();
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('Error obteniendo todas las canciones:', error);
            throw error;
        }
    }

    /**
     * Obtiene todas las canciones de un filtro específico (obtiene todas las páginas)
     * @param {string} filterType - Tipo de filtro
     * @param {string} filterValue - Valor del filtro (puede ser null para 'liked')
     * @returns {Promise<Array>} Array con todas las canciones del filtro
     */
    async getAllFilteredSongs(filterType, filterValue) {
        try {
            let allSongs = [];
            let lastDoc = null;
            let hasMore = true;
            const pageSize = 100;

            while (hasMore) {
                let result;
                switch (filterType) {
                    case 'liked':
                        // Para 'liked', filterValue puede ser null
                        result = await this.getLikedSongs(pageSize, lastDoc);
                        break;
                    case 'genre':
                        if (!filterValue) return await this.getAllSongs();
                        result = await this.getSongsByGenre(filterValue, pageSize, lastDoc);
                        break;
                    case 'source':
                        if (!filterValue) return await this.getAllSongs();
                        result = await this.getSongsBySource(filterValue, pageSize, lastDoc);
                        break;
                    case 'artist':
                        if (!filterValue) return await this.getAllSongs();
                        result = await this.getSongsByArtist(filterValue, pageSize, lastDoc);
                        break;
                    case 'album':
                        if (!filterValue) return await this.getAllSongs();
                        result = await this.getSongsByAlbum(filterValue, pageSize, lastDoc);
                        break;
                    case 'year':
                        if (!filterValue) return await this.getAllSongs();
                        const year = parseInt(filterValue);
                        result = await this.getSongsByYear(year, pageSize, lastDoc);
                        break;
                    case 'playlist':
                        if (!filterValue) return await this.getAllSongs();
                        // Para playlists, obtener todas las canciones directamente
                        const playlistSongs = await this.getPlaylistSongs(filterValue);
                        return playlistSongs; // Retornar directamente ya que no hay paginación
                    default:
                        return await this.getAllSongs();
                }

                allSongs = [...allSongs, ...result.songs];
                lastDoc = result.lastDoc;
                hasMore = result.hasMore;
            }

            return allSongs;
        } catch (error) {
            console.error(`Error obteniendo todas las canciones filtradas ${filterType}:`, error);
            throw error;
        }
    }

    /**
     * Busca canciones por título en todas las canciones guardadas en Firestore
     * @param {string} searchQuery - Texto de búsqueda
     * @param {string} filterType - Tipo de filtro ('liked', 'genre', 'source', 'artist', 'album', 'year' o null)
     * @param {string} filterValue - Valor del filtro (género, source, artista, álbum, año)
     * @returns {Promise<Array>} Array de canciones que coinciden con la búsqueda
     */
    async searchSongsByTitle(searchQuery, filterType = null, filterValue = null) {
        try {
            let allSongs = [];

            // Si hay un filtro activo, obtener todas las canciones filtradas primero
            // Para 'liked', filterValue puede ser null
            if (filterType) {
                if (filterType === 'liked' || filterValue) {
                    allSongs = await this.getAllFilteredSongs(filterType, filterValue);
                } else {
                    allSongs = await this.getAllSongs();
                }
            } else {
                allSongs = await this.getAllSongs();
            }

            // Si no hay query, retornar todas las canciones (filtradas o no)
            if (!searchQuery || searchQuery.trim() === '') {
                return allSongs;
            }

            // Filtrar por título
            const query = searchQuery.toLowerCase().trim();
            return allSongs.filter(song => {
                if (!song.titleMinusculas) {
                    const title = (song.title || '').toLowerCase();
                    return title.includes(query);
                }
                return song.titleMinusculas.includes(query);
            });
        } catch (error) {
            console.error('Error buscando canciones en Firestore:', error);
            throw error;
        }
    }

    /**
     * Busca géneros por nombre
     * @param {string} searchQuery - Texto de búsqueda
     * @returns {Promise<Array>} Array de géneros que coinciden con la búsqueda
     */
    async searchGenres(searchQuery) {
        try {
            const genres = await this.getGenresList();
            
            if (!searchQuery || searchQuery.trim() === '') {
                return genres;
            }

            const query = searchQuery.toLowerCase().trim();
            return genres.filter(genre => {
                const name = (genre.key || '').toLowerCase();
                return name.includes(query);
            });
        } catch (error) {
            console.error('Error buscando géneros:', error);
            throw error;
        }
    }

    /**
     * Busca sources por nombre dentro de un género
     * @param {string} searchQuery - Texto de búsqueda
     * @param {string} genreId - ID del género
     * @returns {Promise<Array>} Array de sources que coinciden con la búsqueda
     */
    async searchSources(searchQuery, genreId) {
        try {
            const sources = await this.getSourcesList(genreId);
            
            if (!searchQuery || searchQuery.trim() === '') {
                return sources;
            }

            const query = searchQuery.toLowerCase().trim();
            return sources.filter(source => {
                const name = (source.key || '').toLowerCase();
                return name.includes(query);
            });
        } catch (error) {
            console.error('Error buscando sources:', error);
            throw error;
        }
    }

    /**
     * Busca artistas por nombre
     * @param {string} searchQuery - Texto de búsqueda
     * @returns {Promise<Array>} Array de artistas que coinciden con la búsqueda
     */
    async searchArtists(searchQuery) {
        try {
            const artists = await this.getArtistsWithCounts(1); // Incluir todos, incluso con 1 canción
            
            if (!searchQuery || searchQuery.trim() === '') {
                return artists;
            }

            const query = searchQuery.toLowerCase().trim();
            return artists.filter(artist => {
                const name = (artist.key || '').toLowerCase();
                return name.includes(query);
            });
        } catch (error) {
            console.error('Error buscando artistas:', error);
            throw error;
        }
    }

    /**
     * Busca álbumes por nombre
     * @param {string} searchQuery - Texto de búsqueda
     * @returns {Promise<Array>} Array de álbumes que coinciden con la búsqueda
     */
    async searchAlbums(searchQuery) {
        try {
            const albums = await this.getAlbumsWithCounts(1); // Incluir todos, incluso con 1 canción
            
            if (!searchQuery || searchQuery.trim() === '') {
                return albums;
            }

            const query = searchQuery.toLowerCase().trim();
            return albums.filter(album => {
                const name = (album.key || '').toLowerCase();
                return name.includes(query);
            });
        } catch (error) {
            console.error('Error buscando álbumes:', error);
            throw error;
        }
    }

    /**
     * Busca años
     * @param {string} searchQuery - Texto de búsqueda (número de año)
     * @returns {Promise<Array>} Array de años que coinciden con la búsqueda
     */
    async searchYears(searchQuery) {
        try {
            const years = await this.getYearsWithCounts();
            
            if (!searchQuery || searchQuery.trim() === '') {
                return years;
            }

            const query = searchQuery.trim();
            return years.filter(year => {
                const yearStr = year.key || '';
                return yearStr.includes(query);
            });
        } catch (error) {
            console.error('Error buscando años:', error);
            throw error;
        }
    }

    /**
     * Obtiene una canción por su ID
     * @param {string} songId - ID del documento
     * @returns {Promise<Object>} Datos de la canción
     */
    async getSongById(songId) {
        try {
            const doc = await db.collection('songs').doc(songId).get();
            if (doc.exists) {
                return {
                    id: doc.id,
                    ...doc.data()
                };
            }
            return null;
        } catch (error) {
            console.error(`Error obteniendo canción ${songId}:`, error);
            throw error;
        }
    }

    /**
     * Mezcla un array de forma aleatoria usando el algoritmo Fisher-Yates
     * @param {Array} array - Array a mezclar
     * @returns {Array} Array mezclado
     */
    shuffleArray(array) {
        const shuffled = [...array]; // Crear copia para no modificar el original
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    /**
     * Obtiene lista de artistas con conteos (mínimo 2 canciones)
     * @param {number} minCount - Número mínimo de canciones (default: 2)
     * @returns {Promise<Array>} Array de objetos {key: string, count: number, coverPath: string|null}
     */
    async getArtistsWithCounts(minCount = 2) {
        try {
            // Obtener todos los artistas de la colección "artistas"
            const artistsSnap = await db.collection('artistas').get();
            
            // Obtener conteos de canciones por artista
            const songsSnap = await db.collection('songs').get();
            const artistCounts = {};
            
            songsSnap.docs.forEach(doc => {
                const artist = doc.data().artist;
                if (artist && artist.trim() !== '') {
                    artistCounts[artist] = (artistCounts[artist] || 0) + 1;
                }
            });

            // Combinar datos de artistas con conteos
            const artists = [];
            artistsSnap.docs.forEach(doc => {
                const name = doc.data().name || doc.id;
                const count = artistCounts[name] || 0;
                if (count >= minCount) {
                    artists.push({
                        key: name,
                        count: count,
                        coverPath: doc.data().coverPath || null
                    });
                }
            });

            // Ordenar por conteo descendente, luego alfabéticamente
            return artists.sort((a, b) => {
                if (b.count !== a.count) return b.count - a.count;
                return a.key.toLowerCase().localeCompare(b.key.toLowerCase());
            });
        } catch (error) {
            console.error('Error obteniendo artistas:', error);
            throw error;
        }
    }

    /**
     * Obtiene lista de álbumes con conteos (mínimo 2 canciones)
     * @param {number} minCount - Número mínimo de canciones (default: 2)
     * @returns {Promise<Array>} Array de objetos {key: string, count: number, coverPath: string|null}
     */
    async getAlbumsWithCounts(minCount = 2) {
        try {
            const songsSnap = await db.collection('songs').get();
            const albumsMap = {}; // album -> {count, coverPath}

            songsSnap.docs.forEach(doc => {
                const data = doc.data();
                const album = data.album;
                if (album && album.trim() !== '') {
                    const coverPath = data.coverPath || null;
                    if (albumsMap[album]) {
                        albumsMap[album].count++;
                        if (!albumsMap[album].coverPath && coverPath) {
                            albumsMap[album].coverPath = coverPath;
                        }
                    } else {
                        albumsMap[album] = {
                            count: 1,
                            coverPath: coverPath
                        };
                    }
                }
            });

            const albums = Object.entries(albumsMap)
                .filter(([_, data]) => data.count >= minCount)
                .map(([album, data]) => ({
                    key: album,
                    count: data.count,
                    coverPath: data.coverPath
                }));

            return albums.sort((a, b) => b.count - a.count);
        } catch (error) {
            console.error('Error obteniendo álbumes:', error);
            throw error;
        }
    }

    /**
     * Obtiene lista de años con conteos
     * @returns {Promise<Array>} Array de objetos {key: string, count: number, coverPath: string|null}
     */
    async getYearsWithCounts() {
        try {
            // Obtener todos los años de la colección "años"
            const yearsSnap = await db.collection('years').get();
            
            // Obtener conteos de canciones por año
            const songsSnap = await db.collection('songs').get();
            const yearCounts = {};

            songsSnap.docs.forEach(doc => {
                const year = doc.data().year;
                if (year && year > 0) {
                    const yearStr = year.toString();
                    yearCounts[yearStr] = (yearCounts[yearStr] || 0) + 1;
                }
            });

            // Combinar datos de años con conteos
            const yearsMap = new Map();
            
            // Primero agregar años de la colección "años"
            yearsSnap.docs.forEach(doc => {
                const yearData = doc.data();
                // El año puede estar en el campo 'year' o ser el ID del documento
                const yearKey = yearData.year || doc.id;
                const yearStr = yearKey.toString();
                const count = yearCounts[yearStr] || 0;
                yearsMap.set(yearStr, {
                    key: yearStr,
                    count: count,
                    coverPath: yearData.coverPath || null
                });
            });
            
            // Luego agregar años que están en canciones pero no en la colección "años"
            Object.entries(yearCounts).forEach(([yearStr, count]) => {
                if (!yearsMap.has(yearStr)) {
                    yearsMap.set(yearStr, {
                        key: yearStr,
                        count: count,
                        coverPath: null
                    });
                }
            });
            
            const years = Array.from(yearsMap.values());

            // También incluir años que están en canciones pero no en la colección "años"
            Object.entries(yearCounts).forEach(([yearStr, count]) => {
                const exists = years.find(y => y.key === yearStr);
                if (!exists) {
                    years.push({
                        key: yearStr,
                        count: count,
                        coverPath: null
                    });
                }
            });

            return years.sort((a, b) => parseInt(b.key) - parseInt(a.key));
        } catch (error) {
            console.error('Error obteniendo años:', error);
            throw error;
        }
    }

    /**
     * Obtiene lista de géneros con conteos
     * @returns {Promise<Array>} Array de objetos {key: string, count: number, coverPath: string|null}
     */
    async getGenresList() {
        try {
            const genresSnap = await db.collection('genres').get();
            const songsSnap = await db.collection('songs').get();
            const genreCounts = {};

            songsSnap.docs.forEach(doc => {
                const genre = doc.data().genre;
                if (genre && genre.trim() !== '') {
                    genreCounts[genre] = (genreCounts[genre] || 0) + 1;
                }
            });

            const genres = [];
            genresSnap.docs.forEach(doc => {
                const name = doc.data().name || doc.id;
                // Usar el ID del documento como genreId para mantener consistencia
                // (el genreId en sources se guarda como el ID del documento del género)
                const genreId = doc.id;
                genres.push({
                    key: name,
                    id: genreId, // ID del documento del género
                    count: genreCounts[name] || 0,
                    coverPath: doc.data().coverPath || null
                });
            });

            return genres.sort((a, b) => {
                if (b.count !== a.count) return b.count - a.count;
                return a.key.toLowerCase().localeCompare(b.key.toLowerCase());
            });
        } catch (error) {
            console.error('Error obteniendo géneros:', error);
            throw error;
        }
    }

    /**
     * Obtiene lista de sources con conteos filtrados por género
     * Busca sources por el campo name del género (que también es el ID del documento del género)
     * @param {string} genreNameOrId - Nombre del género o ID del documento (son lo mismo ahora)
     * @returns {Promise<Array>} Array de objetos {key: string, count: number, coverPath: string|null}
     */
    async getSourcesList(genreNameOrId = null) {
        try {
            console.log(`getSourcesList: Buscando sources para genreNameOrId: ${genreNameOrId}`);
            
            if (!genreNameOrId || genreNameOrId.trim() === '') {
                console.log('getSourcesList: No hay genreNameOrId, retornando array vacío');
                return [];
            }

            // El genreNameOrId puede ser el ID del documento del género (que es el nombre del género)
            // o el campo name del género. Como ahora usamos el nombre como ID, son lo mismo.
            // Obtener el documento del género para verificar que existe y obtener su name
            let genreDoc = await db.collection('genres').doc(genreNameOrId).get();
            let actualGenreName = null;

            if (genreDoc.exists) {
                // Si el documento existe con ese ID, el name debe ser igual al ID
                actualGenreName = genreDoc.data().name || genreNameOrId;
                console.log(`getSourcesList: Género encontrado por ID: ${genreNameOrId}, name: ${actualGenreName}`);
            } else {
                // Si no existe por ID, buscar por campo name
                const genreByName = await db.collection('genres')
                    .where('name', '==', genreNameOrId)
                    .limit(1)
                    .get();
                
                if (!genreByName.empty) {
                    actualGenreName = genreByName.docs[0].data().name || genreNameOrId;
                    console.log(`getSourcesList: Género encontrado por name: ${genreNameOrId}, usando name: ${actualGenreName}`);
                } else {
                    // Si no se encuentra, asumir que el genreNameOrId es el nombre del género
                    actualGenreName = genreNameOrId;
                    console.log(`getSourcesList: Género no encontrado, usando genreNameOrId como nombre: ${actualGenreName}`);
                }
            }

            // Buscar sources donde genreId sea el nombre del género (que también es el ID del documento)
            // El genreId en sources es el nombre del género
            let sourcesQuery = db.collection('sources')
                .where('genreId', '==', actualGenreName);
            
            console.log(`getSourcesList: Consulta creada buscando sources con genreId == ${actualGenreName}`);
            
            const sourcesSnap = await sourcesQuery.get();
            console.log(`getSourcesList: Se encontraron ${sourcesSnap.docs.length} documentos de sources con genreId == ${actualGenreName}`);
            
            if (sourcesSnap.empty) {
                console.log('getSourcesList: No se encontraron sources para este género');
                return [];
            }
            
            const songsSnap = await db.collection('songs').get();
            const sourceCounts = {};

            // Contar canciones por source
            songsSnap.docs.forEach(doc => {
                const source = doc.data().source;
                if (source && source.trim() !== '') {
                    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
                }
            });

            const sources = [];
            sourcesSnap.docs.forEach(doc => {
                const data = doc.data();
                const name = data.name || doc.id;
                
                console.log(`getSourcesList: Source encontrado - name: ${name}, genreId en source: ${data.genreId}, docId: ${doc.id}`);
                
                sources.push({
                    key: name,
                    count: sourceCounts[name] || 0,
                    coverPath: data.coverPath || null
                });
            });

            const sortedSources = sources.sort((a, b) => {
                if (b.count !== a.count) return b.count - a.count;
                return a.key.toLowerCase().localeCompare(b.key.toLowerCase());
            });
            
            console.log(`getSourcesList: Retornando ${sortedSources.length} sources ordenados para género: ${actualGenreName}`);
            return sortedSources;
        } catch (error) {
            console.error('Error obteniendo sources:', error);
            console.error('Error details:', error.message, error.stack);
            throw error;
        }
    }

    /**
     * Obtiene canciones filtradas por artista (paginadas)
     * @param {string} artist - Nombre del artista
     * @param {number} limit - Límite de canciones (default: 50)
     * @param {Object} lastDoc - Último documento para paginación
     * @returns {Promise<{songs: Array, lastDoc: Object|null, hasMore: boolean}>}
     */
    async getSongsByArtist(artist, limit = 50, lastDoc = null) {
        try {
            let query = db.collection('songs').where('artist', '==', artist);

            query = query.limit(limit);

            if (lastDoc) {
                query = query.startAfter(lastDoc);
            }

            const snapshot = await query.get();
            const songs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            const newLastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
            const hasMore = snapshot.docs.length === limit;

            return {
                songs,
                lastDoc: newLastDoc,
                hasMore
            };
        } catch (error) {
            console.error(`Error obteniendo canciones por artista ${artist}:`, error);
            throw error;
        }
    }

    /**
     * Obtiene canciones filtradas por álbum (paginadas)
     * @param {string} album - Nombre del álbum
     * @param {number} limit - Límite de canciones (default: 50)
     * @param {Object} lastDoc - Último documento para paginación
     * @returns {Promise<{songs: Array, lastDoc: Object|null, hasMore: boolean}>}
     */
    async getSongsByAlbum(album, limit = 50, lastDoc = null) {
        try {
            let query = db.collection('songs').where('album', '==', album);

            query = query.limit(limit);

            if (lastDoc) {
                query = query.startAfter(lastDoc);
            }

            const snapshot = await query.get();
            const songs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            const newLastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
            const hasMore = snapshot.docs.length === limit;

            return {
                songs,
                lastDoc: newLastDoc,
                hasMore
            };
        } catch (error) {
            console.error(`Error obteniendo canciones por álbum ${album}:`, error);
            throw error;
        }
    }

    /**
     * Obtiene canciones filtradas por año (paginadas)
     * @param {number} year - Año
     * @param {number} limit - Límite de canciones (default: 50)
     * @param {Object} lastDoc - Último documento para paginación
     * @returns {Promise<{songs: Array, lastDoc: Object|null, hasMore: boolean}>}
     */
    async getSongsByYear(year, limit = 50, lastDoc = null) {
        try {
            let query = db.collection('songs').where('year', '==', year);

            query = query.limit(limit);

            if (lastDoc) {
                query = query.startAfter(lastDoc);
            }

            const snapshot = await query.get();
            const songs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            const newLastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
            const hasMore = snapshot.docs.length === limit;

            return {
                songs,
                lastDoc: newLastDoc,
                hasMore
            };
        } catch (error) {
            console.error(`Error obteniendo canciones por año ${year}:`, error);
            throw error;
        }
    }

    /**
     * Obtiene canciones filtradas por género (paginadas)
     * @param {string} genre - Género
     * @param {number} limit - Límite de canciones (default: 50)
     * @param {Object} lastDoc - Último documento para paginación
     * @returns {Promise<{songs: Array, lastDoc: Object|null, hasMore: boolean}>}
     */
    async getSongsByGenre(genre, limit = 50, lastDoc = null) {
        try {
            let query = db.collection('songs').where('genre', '==', genre);

            query = query.limit(limit);

            if (lastDoc) {
                query = query.startAfter(lastDoc);
            }

            const snapshot = await query.get();
            const songs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            const newLastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
            const hasMore = snapshot.docs.length === limit;

            return {
                songs,
                lastDoc: newLastDoc,
                hasMore
            };
        } catch (error) {
            console.error(`Error obteniendo canciones por género ${genre}:`, error);
            throw error;
        }
    }

    /**
     * Obtiene canciones filtradas por source (paginadas)
     * @param {string} source - Source
     * @param {number} limit - Límite de canciones (default: 50)
     * @param {Object} lastDoc - Último documento para paginación
     * @returns {Promise<{songs: Array, lastDoc: Object|null, hasMore: boolean}>}
     */
    async getSongsBySource(source, limit = 50, lastDoc = null) {
        try {
            let query = db.collection('songs').where('source', '==', source);

            query = query.limit(limit);

            if (lastDoc) {
                query = query.startAfter(lastDoc);
            }

            const snapshot = await query.get();
            const songs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            const newLastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
            const hasMore = snapshot.docs.length === limit;

            return {
                songs,
                lastDoc: newLastDoc,
                hasMore
            };
        } catch (error) {
            console.error(`Error obteniendo canciones por source ${source}:`, error);
            throw error;
        }
    }

    /**
     * Obtiene canciones favoritas del usuario (desde subcoleccion users/{userId}/likes)
     * @param {string} userId - ID del usuario
     * @param {number} limit - Limite de canciones (default: 50)
     * @param {Object} lastDoc - Ultimo documento para paginacion
     * @returns {Promise<{songs: Array, lastDoc: Object|null, hasMore: boolean, total?: number}>}
     */
    async getLikedSongs(userId, limit = 50, lastDoc = null) {
        try {
            // Si no hay usuario, retornar vacio
            if (!userId) {
                return { songs: [], lastDoc: null, hasMore: false, total: 0 };
            }

            // Obtener IDs de canciones liked del usuario
            const likesRef = db.collection('users').doc(userId).collection('likes');
            const likesSnapshot = await likesRef.orderBy('likedAt', 'desc').get();

            if (likesSnapshot.empty) {
                return { songs: [], lastDoc: null, hasMore: false, total: 0 };
            }

            const likedSongIds = likesSnapshot.docs.map(doc => doc.id);
            const totalLikedSongs = likedSongIds.length;

            // Calcular paginacion manual
            const startIndex = lastDoc ? lastDoc.index + 1 : 0;
            const endIndex = Math.min(startIndex + limit, likedSongIds.length);
            const pageIds = likedSongIds.slice(startIndex, endIndex);

            if (pageIds.length === 0) {
                return { songs: [], lastDoc: null, hasMore: false, total: totalLikedSongs };
            }

            // Obtener datos de canciones (Firestore limite de 10 para whereIn)
            const songs = [];
            const chunks = [];
            for (let i = 0; i < pageIds.length; i += 10) {
                chunks.push(pageIds.slice(i, i + 10));
            }

            for (const chunk of chunks) {
                const songsSnapshot = await db.collection('songs')
                    .where(firebase.firestore.FieldPath.documentId(), 'in', chunk)
                    .get();

                songsSnapshot.docs.forEach(doc => {
                    songs.push({
                        id: doc.id,
                        ...doc.data()
                    });
                });
            }

            // Ordenar canciones en el mismo orden que los IDs liked
            const orderedSongs = pageIds
                .map(id => songs.find(s => s.id === id))
                .filter(s => s !== undefined);

            const hasMore = endIndex < likedSongIds.length;
            const newLastDoc = hasMore ? { index: endIndex - 1 } : null;

            return {
                songs: orderedSongs,
                lastDoc: newLastDoc,
                hasMore,
                total: totalLikedSongs
            };
        } catch (error) {
            console.error('Error obteniendo canciones favoritas:', error);
            throw error;
        }
    }

    /**
     * Obtiene canciones recientemente añadidas ordenadas por fecha de creación (paginadas)
     * Solo incluye canciones que tengan el campo createdAt y que hayan sido añadidas en la última semana.
     * @param {number} limit - Número de canciones a obtener por página (default: 50)
     * @param {number} offset - Offset para paginación (default: 0)
     * @returns {Promise<{songs: Array, offset: number, hasMore: boolean}>} Objeto con array de canciones, offset actual y si hay más
     */
    async getRecentSongs(limit = 50, offset = 0) {
        try {
            // Obtener todas las canciones para filtrar por createdAt
            const snapshot = await db.collection('songs').get();
            
            if (snapshot.empty) {
                return { songs: [], offset: 0, hasMore: false };
            }

            // Calcular rango de fechas: desde hace una semana hasta hoy
            const now = Date.now();
            const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000); // 7 días en milisegundos

            // Filtrar y mapear canciones con createdAt dentro del rango
            let songs = snapshot.docs
                .map(doc => {
                    const data = doc.data();
                    
                    // Solo procesar canciones que tengan createdAt
                    if (!data.createdAt) {
                        return null;
                    }
                    
                    // Convertir createdAt a milisegundos
                    let timestamp;
                    if (data.createdAt.toMillis) {
                        // Es un Timestamp de Firestore
                        timestamp = data.createdAt.toMillis();
                    } else if (data.createdAt.getTime) {
                        // Es un objeto Date
                        timestamp = data.createdAt.getTime();
                    } else if (typeof data.createdAt === 'number') {
                        // Ya es un número (milisegundos)
                        timestamp = data.createdAt;
                    } else {
                        // Formato desconocido, omitir
                        return null;
                    }
                    
                    // Filtrar solo canciones dentro del rango de una semana
                    if (timestamp < oneWeekAgo || timestamp > now) {
                        return null;
                    }
                    
                    return {
                        id: doc.id,
                        ...data,
                        _sortTimestamp: timestamp // Campo temporal para ordenar
                    };
                })
                .filter(song => song !== null); // Eliminar nulls (canciones sin createdAt o fuera de rango)

            // Ordenar por timestamp descendente (más recientes primero)
            songs.sort((a, b) => {
                return b._sortTimestamp - a._sortTimestamp;
            });

            // Remover el campo temporal _sortTimestamp
            songs = songs.map(song => {
                const { _sortTimestamp, ...songWithoutTimestamp } = song;
                return songWithoutTimestamp;
            });

            // Aplicar paginación manual
            const totalRecentSongs = songs.length; // Total de canciones recientes disponibles
            const paginatedSongs = songs.slice(offset, offset + limit);
            const hasMore = offset + limit < songs.length;

            return {
                songs: paginatedSongs,
                offset: offset + paginatedSongs.length,
                hasMore: hasMore,
                total: totalRecentSongs // Total de canciones recientes disponibles
            };
        } catch (error) {
            console.error('Error obteniendo canciones recientes:', error);
            throw error;
        }
    }

    /**
     * Actualiza el campo liked de una canción
     * @param {string} songId - ID de la canción
     * @param {boolean} liked - Valor de liked
     * @returns {Promise<void>}
     */
    async updateSongLiked(songId, liked) {
        try {
            await db.collection('songs').doc(songId).update({
                liked: liked
            });
        } catch (error) {
            console.error(`Error actualizando liked para canción ${songId}:`, error);
            throw error;
        }
    }

    /**
     * Actualiza el género de una canción
     * @param {string} songId - ID de la canción
     * @param {string} genre - Nombre del género
     * @returns {Promise<void>}
     */
    async updateSongGenre(songId, genre) {
        try {
            await db.collection('songs').doc(songId).update({
                genre: genre
            });
        } catch (error) {
            console.error(`Error actualizando género para canción ${songId}:`, error);
            throw error;
        }
    }

    /**
     * Actualiza el source de una canción
     * @param {string} songId - ID de la canción
     * @param {string} source - Nombre del source
     * @returns {Promise<void>}
     */
    async updateSongSource(songId, source) {
        try {
            await db.collection('songs').doc(songId).update({
                source: source
            });
        } catch (error) {
            console.error(`Error actualizando source para canción ${songId}:`, error);
            throw error;
        }
    }

    /**
     * Agrega un nuevo género a la colección genres
     * Usa el nombre como ID del documento
     * @param {string} name - Nombre del género (ej: "game")
     * @returns {Promise<string>} ID del documento creado (el nombre)
     */
    async addGenre(name) {
        try {
            if (!name || name.trim() === '') {
                throw new Error('El nombre del género no puede estar vacío');
            }

            const genreName = name.trim();
            const genreId = genreName; // Usar el nombre como ID del documento
            
            // Verificar si ya existe un género con ese ID (nombre)
            const existingGenreDoc = await db.collection('genres').doc(genreId).get();
            
            if (existingGenreDoc.exists) {
                throw new Error('Ya existe un género con ese nombre');
            }

            // Verificar también por nombre (por si acaso hay algún género con diferente ID pero mismo nombre)
            const existingGenres = await db.collection('genres')
                .where('name', '==', genreName)
                .get();
            
            if (!existingGenres.empty) {
                throw new Error('Ya existe un género con ese nombre');
            }

            // Crear el documento del género usando el nombre como ID
            const genreData = {
                name: genreName
            };

            await db.collection('genres').doc(genreId).set(genreData);
            console.log(`Género agregado: ${genreName} con ID: ${genreId}`);
            return genreId;
        } catch (error) {
            console.error('Error agregando género:', error);
            throw error;
        }
    }

    /**
     * Agrega un nuevo source a la colección sources
     * Usa el nombre como ID del documento
     * @param {string} name - Nombre del source (ej: "chainsaw_man")
     * @param {string} genreId - Nombre del género al que pertenece (usado como ID del documento del género)
     * @param {string} coverPath - Ruta del cover (opcional, por defecto "")
     * @returns {Promise<string>} ID del documento creado (el nombre)
     */
    async addSource(name, genreId, coverPath = '') {
        try {
            if (!name || name.trim() === '') {
                throw new Error('El nombre del source no puede estar vacío');
            }

            if (!genreId || genreId.trim() === '') {
                throw new Error('El genreId es requerido');
            }

            const sourceName = name.trim();
            const sourceId = sourceName; // Usar el nombre como ID del documento
            
            // Buscar el género. El genreId puede ser el ID del documento (nombre) o el campo name
            let foundGenreDoc = await db.collection('genres').doc(genreId).get();
            let foundGenreName = null;

            if (foundGenreDoc.exists) {
                // Si el documento existe con ese ID, usar el campo name del documento
                foundGenreName = foundGenreDoc.data().name || genreId;
                console.log(`addSource: Género encontrado por ID: ${genreId}, name: ${foundGenreName}`);
            } else {
                // Si no existe por ID, buscar por campo name
                const genreByName = await db.collection('genres')
                    .where('name', '==', genreId)
                    .limit(1)
                    .get();
                
                if (!genreByName.empty) {
                    foundGenreName = genreByName.docs[0].data().name || genreId;
                    // El ID del documento del género es el campo name o el doc.id
                    // Pero como ahora usamos name como ID, usar el name
                    console.log(`addSource: Género encontrado por name: ${genreId}`);
                } else {
                    // Si no se encuentra, asumir que el genreId es el nombre del género
                    foundGenreName = genreId;
                    console.log(`addSource: Género no encontrado, usando genreId como nombre: ${genreId}`);
                }
            }

            // Verificar si ya existe un source con ese ID (nombre)
            const existingSourceDoc = await db.collection('sources').doc(sourceId).get();
            
            if (existingSourceDoc.exists) {
                // Si existe, verificar que sea del mismo género
                const existingSourceData = existingSourceDoc.data();
                if (existingSourceData.genreId === foundGenreName) {
                    throw new Error('Ya existe un source con ese nombre para ese género');
                } else {
                    throw new Error('Ya existe un source con ese nombre para otro género');
                }
            }

            // Verificar también por nombre y géneroId
            const existingSources = await db.collection('sources')
                .where('name', '==', sourceName)
                .where('genreId', '==', foundGenreName)
                .get();
            
            if (!existingSources.empty) {
                throw new Error('Ya existe un source con ese nombre para ese género');
            }

            // Crear el documento del source usando el nombre como ID
            // El genreId será el nombre del género (que también es el ID del documento del género)
            const sourceData = {
                name: sourceName,
                genreId: foundGenreName, // Nombre del género (que también es el ID del documento)
                coverPath: coverPath || ''
            };

            await db.collection('sources').doc(sourceId).set(sourceData);
            console.log(`Source agregado: ${sourceName} con ID: ${sourceId}, genreId: ${foundGenreName}`);
            return sourceId;
        } catch (error) {
            console.error('Error agregando source:', error);
            throw error;
        }
    }

    /**
     * Actualiza el coverPath de un artista
     * Busca el documento por el campo 'name' primero, si no existe, busca por ID
     * @param {string} artistName - Nombre del artista
     * @param {string} coverPath - Ruta de la imagen en Storage
     * @returns {Promise<void>}
     */
    async updateArtistCoverPath(artistName, coverPath) {
        try {
            if (!artistName || artistName.trim() === '') {
                throw new Error('El nombre del artista no puede estar vacío');
            }

            const artistNameTrimmed = artistName.trim();
            
            // Primero intentar buscar por campo 'name'
            let artistDoc = null;
            let artistDocId = null;
            
            const artistByName = await db.collection('artistas')
                .where('name', '==', artistNameTrimmed)
                .limit(1)
                .get();
            
            if (!artistByName.empty) {
                // Encontrado por campo name
                artistDoc = artistByName.docs[0];
                artistDocId = artistDoc.id;
                console.log(`Artista encontrado por campo name: ${artistNameTrimmed}, ID: ${artistDocId}`);
            } else {
                // Si no se encontró por name, intentar por ID del documento
                artistDoc = await db.collection('artistas').doc(artistNameTrimmed).get();
                if (artistDoc.exists) {
                    artistDocId = artistDoc.id;
                    console.log(`Artista encontrado por ID: ${artistNameTrimmed}`);
                }
            }
            
            if (artistDoc && artistDoc.exists) {
                // Actualizar el documento existente usando su ID real
                await db.collection('artistas').doc(artistDocId).update({
                    coverPath: coverPath || ''
                });
                console.log(`CoverPath actualizado para artista: ${artistNameTrimmed} (ID: ${artistDocId})`);
            } else {
                // Si no existe, crear el documento usando el nombre como ID
                // Esto asegura consistencia para futuras actualizaciones
                await db.collection('artistas').doc(artistNameTrimmed).set({
                    name: artistNameTrimmed,
                    coverPath: coverPath || ''
                }, { merge: true }); // Usar merge para no sobrescribir otros campos si existen
                console.log(`Documento creado para artista: ${artistNameTrimmed} con coverPath`);
            }
        } catch (error) {
            console.error(`Error actualizando coverPath para artista ${artistName}:`, error);
            throw error;
        }
    }

    /**
     * Actualiza el coverPath de un género
     * Busca el documento por el campo 'name' primero, si no existe, busca por ID
     * @param {string} genreNameOrId - Nombre del género o ID del documento
     * @param {string} coverPath - Ruta de la imagen en Storage
     * @returns {Promise<void>}
     */
    async updateGenreCoverPath(genreNameOrId, coverPath) {
        try {
            if (!genreNameOrId || genreNameOrId.trim() === '') {
                throw new Error('El nombre del género no puede estar vacío');
            }

            const genreNameTrimmed = genreNameOrId.trim();
            
            // Primero intentar buscar por campo 'name'
            let genreDoc = null;
            let genreDocId = null;
            
            const genreByName = await db.collection('genres')
                .where('name', '==', genreNameTrimmed)
                .limit(1)
                .get();
            
            if (!genreByName.empty) {
                // Encontrado por campo name
                genreDoc = genreByName.docs[0];
                genreDocId = genreDoc.id;
                console.log(`Género encontrado por campo name: ${genreNameTrimmed}, ID: ${genreDocId}`);
            } else {
                // Si no se encontró por name, intentar por ID del documento
                genreDoc = await db.collection('genres').doc(genreNameTrimmed).get();
                if (genreDoc.exists) {
                    genreDocId = genreDoc.id;
                    console.log(`Género encontrado por ID: ${genreNameTrimmed}`);
                }
            }
            
            if (genreDoc && genreDoc.exists) {
                // Actualizar el documento existente usando su ID real
                await db.collection('genres').doc(genreDocId).update({
                    coverPath: coverPath || ''
                });
                console.log(`CoverPath actualizado para género: ${genreNameTrimmed} (ID: ${genreDocId})`);
            } else {
                // Si no existe, crear el documento usando el nombre como ID
                // Esto asegura consistencia para futuras actualizaciones
                await db.collection('genres').doc(genreNameTrimmed).set({
                    name: genreNameTrimmed,
                    coverPath: coverPath || ''
                }, { merge: true }); // Usar merge para no sobrescribir otros campos si existen
                console.log(`Documento creado para género: ${genreNameTrimmed} con coverPath`);
            }
        } catch (error) {
            console.error(`Error actualizando coverPath para género ${genreNameOrId}:`, error);
            throw error;
        }
    }

    /**
     * Actualiza el coverPath de un source
     * Busca el documento por el campo 'name' primero, si no existe, busca por ID
     * @param {string} sourceName - Nombre del source
     * @param {string} coverPath - Ruta de la imagen en Storage
     * @returns {Promise<void>}
     */
    async updateSourceCoverPath(sourceName, coverPath) {
        try {
            if (!sourceName || sourceName.trim() === '') {
                throw new Error('El nombre del source no puede estar vacío');
            }

            const sourceNameTrimmed = sourceName.trim();
            
            // Primero intentar buscar por campo 'name'
            let sourceDoc = null;
            let sourceDocId = null;
            
            const sourceByName = await db.collection('sources')
                .where('name', '==', sourceNameTrimmed)
                .limit(1)
                .get();
            
            if (!sourceByName.empty) {
                // Encontrado por campo name
                sourceDoc = sourceByName.docs[0];
                sourceDocId = sourceDoc.id;
                console.log(`Source encontrado por campo name: ${sourceNameTrimmed}, ID: ${sourceDocId}`);
            } else {
                // Si no se encontró por name, intentar por ID del documento
                sourceDoc = await db.collection('sources').doc(sourceNameTrimmed).get();
                if (sourceDoc.exists) {
                    sourceDocId = sourceDoc.id;
                    console.log(`Source encontrado por ID: ${sourceNameTrimmed}`);
                }
            }
            
            if (sourceDoc && sourceDoc.exists) {
                // Actualizar el documento existente usando su ID real
                await db.collection('sources').doc(sourceDocId).update({
                    coverPath: coverPath || ''
                });
                console.log(`CoverPath actualizado para source: ${sourceNameTrimmed} (ID: ${sourceDocId})`);
            } else {
                throw new Error(`No existe un source con el nombre: ${sourceNameTrimmed}`);
            }
        } catch (error) {
            console.error(`Error actualizando coverPath para source ${sourceName}:`, error);
            throw error;
        }
    }

    /**
     * Actualiza el coverPath de un año
     * Busca el documento por el campo 'year' primero, si no existe, busca por ID
     * @param {string} yearStr - Año como string (ej: "2022")
     * @param {string} coverPath - Ruta de la imagen en Storage
     * @returns {Promise<void>}
     */
    async updateYearCoverPath(yearStr, coverPath) {
        try {
            if (!yearStr || yearStr.trim() === '') {
                throw new Error('El año no puede estar vacío');
            }

            const yearTrimmed = yearStr.trim();
            
            // Primero intentar buscar por campo 'year'
            let yearDoc = null;
            let yearDocId = null;
            
            const yearByField = await db.collection('years')
                .where('year', '==', yearTrimmed)
                .limit(1)
                .get();
            
            if (!yearByField.empty) {
                // Encontrado por campo year
                yearDoc = yearByField.docs[0];
                yearDocId = yearDoc.id;
                console.log(`Año encontrado por campo year: ${yearTrimmed}, ID: ${yearDocId}`);
            } else {
                // Si no se encontró por campo year, intentar por ID del documento
                yearDoc = await db.collection('years').doc(yearTrimmed).get();
                if (yearDoc.exists) {
                    yearDocId = yearDoc.id;
                    console.log(`Año encontrado por ID: ${yearTrimmed}`);
                }
            }
            
            if (yearDoc && yearDoc.exists) {
                // Actualizar el documento existente usando su ID real
                await db.collection('years').doc(yearDocId).update({
                    coverPath: coverPath || ''
                });
                console.log(`CoverPath actualizado para año: ${yearTrimmed} (ID: ${yearDocId})`);
            } else {
                // Si no existe, crear el documento usando el año como ID
                // Esto asegura consistencia para futuras actualizaciones
                await db.collection('years').doc(yearTrimmed).set({
                    year: yearTrimmed,
                    coverPath: coverPath || ''
                }, { merge: true }); // Usar merge para no sobrescribir otros campos si existen
                console.log(`Documento creado para año: ${yearTrimmed} con coverPath`);
            }
        } catch (error) {
            console.error(`Error actualizando coverPath para año ${yearStr}:`, error);
            throw error;
        }
    }

    /**
     * Obtiene el coverPath anterior de un artista, género, source o año
     * Busca primero por campo 'name' o 'year', luego por ID
     * @param {string} type - Tipo: 'artist', 'genre', 'source', 'year'
     * @param {string} nameOrId - Nombre o ID del documento
     * @returns {Promise<string|null>} Ruta del cover anterior o null si no existe
     */
    async getPreviousCoverPath(type, nameOrId) {
        try {
            let collectionName;
            let searchField;
            switch (type) {
                case 'artist':
                    collectionName = 'artistas';
                    searchField = 'name';
                    break;
                case 'genre':
                    collectionName = 'genres';
                    searchField = 'name';
                    break;
                case 'source':
                    collectionName = 'sources';
                    searchField = 'name';
                    break;
                case 'year':
                    collectionName = 'years';
                    searchField = 'year';
                    break;
                default:
                    throw new Error(`Tipo inválido: ${type}`);
            }

            const nameTrimmed = nameOrId.trim();
            
            // Primero intentar buscar por campo específico (name o year)
            const docByField = await db.collection(collectionName)
                .where(searchField, '==', nameTrimmed)
                .limit(1)
                .get();
            
            if (!docByField.empty) {
                const data = docByField.docs[0].data();
                return data.coverPath || null;
            }
            
            // Si no se encontró por campo, intentar por ID del documento
            const docById = await db.collection(collectionName).doc(nameTrimmed).get();
            if (docById.exists) {
                const data = docById.data();
                return data.coverPath || null;
            }
            
            return null;
        } catch (error) {
            console.error(`Error obteniendo coverPath anterior para ${type} ${nameOrId}:`, error);
            return null;
        }
    }

    /**
     * Crea una nueva playlist en la coleccion playlists
     * @param {string} name - Nombre de la playlist
     * @param {string|null} ownerId - ID del usuario propietario (null para playlists publicas)
     * @returns {Promise<string>} ID del documento creado
     */
    async createPlaylist(name, ownerId = null) {
        try {
            if (!name || name.trim() === '') {
                throw new Error('El nombre de la playlist no puede estar vacio');
            }

            const playlistName = name.trim();

            // Verificar si ya existe una playlist con ese nombre
            const existingPlaylist = await db.collection('playlists')
                .where('name', '==', playlistName)
                .limit(1)
                .get();

            if (!existingPlaylist.empty) {
                throw new Error('Ya existe una playlist con ese nombre');
            }

            // Crear el documento de la playlist
            const playlistData = {
                name: playlistName,
                songs: [],
                ownerId: ownerId,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                isPublic: true
            };

            const docRef = await db.collection('playlists').add(playlistData);
            console.log(`Playlist creada: ${playlistName} con ID: ${docRef.id}, owner: ${ownerId}`);
            return docRef.id;
        } catch (error) {
            console.error('Error creando playlist:', error);
            throw error;
        }
    }

    /**
     * Verifica si un usuario es propietario de una playlist
     * @param {string} playlistId - ID de la playlist
     * @param {string} userId - ID del usuario
     * @returns {Promise<boolean>}
     */
    async isPlaylistOwner(playlistId, userId) {
        try {
            if (!playlistId || !userId) return false;

            const doc = await db.collection('playlists').doc(playlistId).get();
            if (!doc.exists) return false;

            const data = doc.data();
            return data.ownerId === userId;
        } catch (error) {
            console.error('Error verificando propietario de playlist:', error);
            return false;
        }
    }

    /**
     * Obtiene una playlist por su ID
     * @param {string} playlistId - ID de la playlist
     * @returns {Promise<Object|null>}
     */
    async getPlaylistById(playlistId) {
        try {
            const doc = await db.collection('playlists').doc(playlistId).get();
            if (!doc.exists) return null;

            return {
                id: doc.id,
                ...doc.data()
            };
        } catch (error) {
            console.error('Error obteniendo playlist:', error);
            return null;
        }
    }

    /**
     * Elimina una playlist (solo si el usuario es propietario)
     * @param {string} playlistId - ID de la playlist
     * @param {string} userId - ID del usuario que intenta eliminar
     * @returns {Promise<boolean>}
     */
    async deletePlaylist(playlistId, userId) {
        try {
            if (!playlistId || !userId) {
                throw new Error('Parametros invalidos');
            }

            const isOwner = await this.isPlaylistOwner(playlistId, userId);
            if (!isOwner) {
                throw new Error('No tienes permisos para eliminar esta playlist');
            }

            // Obtener la playlist para eliminar su cover si existe
            const playlist = await this.getPlaylistById(playlistId);
            if (playlist && playlist.coverPath) {
                try {
                    // Importar storageService dinamicamente para evitar dependencia circular
                    const { default: storageService } = await import('./storage-service.js');
                    await storageService.deleteImage(playlist.coverPath);
                } catch (e) {
                    console.warn('No se pudo eliminar la imagen de la playlist:', e);
                }
            }

            await db.collection('playlists').doc(playlistId).delete();
            console.log(`Playlist eliminada: ${playlistId}`);
            return true;
        } catch (error) {
            console.error('Error eliminando playlist:', error);
            throw error;
        }
    }

    /**
     * Elimina una cancion de una playlist (solo si el usuario es propietario)
     * @param {string} playlistId - ID de la playlist
     * @param {string} songTitle - Titulo de la cancion a eliminar
     * @param {string} userId - ID del usuario
     * @returns {Promise<boolean>}
     */
    async removeSongFromPlaylist(playlistId, songTitle, userId) {
        try {
            if (!playlistId || !songTitle) {
                throw new Error('Parametros invalidos');
            }

            // Verificar permisos si se proporciona userId
            if (userId) {
                const isOwner = await this.isPlaylistOwner(playlistId, userId);
                if (!isOwner) {
                    throw new Error('No tienes permisos para modificar esta playlist');
                }
            }

            const playlist = await this.getPlaylistById(playlistId);
            if (!playlist) {
                throw new Error('Playlist no encontrada');
            }

            const songs = playlist.songs || [];
            const updatedSongs = songs.filter(s => s !== songTitle);

            if (songs.length === updatedSongs.length) {
                throw new Error('La cancion no esta en la playlist');
            }

            await db.collection('playlists').doc(playlistId).update({
                songs: updatedSongs
            });

            console.log(`Cancion "${songTitle}" eliminada de playlist ${playlistId}`);
            return true;
        } catch (error) {
            console.error('Error eliminando cancion de playlist:', error);
            throw error;
        }
    }

    /**
     * Obtiene todas las playlists
     * @returns {Promise<Array>} Array de objetos {id, name, songCount, coverPath, ownerId}
     */
    async getAllPlaylists() {
        try {
            const snapshot = await db.collection('playlists').get();
            const playlists = snapshot.docs.map(doc => {
                const data = doc.data();
                const songs = data.songs || [];
                return {
                    id: doc.id,
                    name: data.name || '',
                    songCount: songs.length,
                    coverPath: data.coverPath || null,
                    ownerId: data.ownerId || null
                };
            });

            // Ordenar por nombre alfabeticamente
            return playlists.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        } catch (error) {
            console.error('Error obteniendo playlists:', error);
            throw error;
        }
    }

    /**
     * Obtiene lista de playlists con conteos (similar a getYearsWithCounts)
     * @returns {Promise<Array>} Array de objetos {key: string, count: number, coverPath: string|null, id: string, ownerId: string|null}
     */
    async getPlaylistsWithCounts() {
        try {
            const playlistsSnap = await db.collection('playlists').get();

            const playlists = [];
            playlistsSnap.docs.forEach(doc => {
                const playlistData = doc.data();
                const playlistName = playlistData.name || doc.id;
                const songs = playlistData.songs || [];

                playlists.push({
                    key: playlistName,
                    id: doc.id,
                    count: songs.length,
                    coverPath: playlistData.coverPath || null,
                    ownerId: playlistData.ownerId || null
                });
            });

            return playlists.sort((a, b) => a.key.toLowerCase().localeCompare(b.key.toLowerCase()));
        } catch (error) {
            console.error('Error obteniendo playlists con conteos:', error);
            throw error;
        }
    }

    /**
     * Agrega una canción a una playlist
     * @param {string} playlistId - ID de la playlist
     * @param {string} songTitle - Título de la canción (nombre completo)
     * @returns {Promise<void>}
     */
    async addSongToPlaylist(playlistId, songTitle) {
        try {
            if (!playlistId || !songTitle || songTitle.trim() === '') {
                throw new Error('El ID de la playlist y el título de la canción son requeridos');
            }

            const playlistRef = db.collection('playlists').doc(playlistId);
            const playlistDoc = await playlistRef.get();

            if (!playlistDoc.exists) {
                throw new Error('La playlist no existe');
            }

            const playlistData = playlistDoc.data();
            const songs = playlistData.songs || [];

            // Verificar si la canción ya está en la playlist
            if (songs.includes(songTitle.trim())) {
                throw new Error('La canción ya está en esta playlist');
            }

            // Agregar la canción al array
            songs.push(songTitle.trim());

            // Actualizar el documento
            await playlistRef.update({
                songs: songs
            });

            console.log(`Canción "${songTitle}" agregada a la playlist ${playlistId}`);
        } catch (error) {
            console.error('Error agregando canción a playlist:', error);
            throw error;
        }
    }

    /**
     * Obtiene las canciones de una playlist por nombre de la playlist
     * @param {string} playlistName - Nombre de la playlist
     * @returns {Promise<Array>} Array de objetos de canciones
     */
    async getPlaylistSongs(playlistName) {
        try {
            if (!playlistName || playlistName.trim() === '') {
                console.log('getPlaylistSongs: playlistName está vacío');
                return [];
            }

            const trimmedName = playlistName.trim();
            console.log(`getPlaylistSongs: Buscando playlist con nombre: "${trimmedName}"`);

            // Buscar la playlist por nombre (comparación exacta)
            // Nota: Firestore es case-sensitive en las búsquedas
            let playlistQuery = await db.collection('playlists')
                .where('name', '==', trimmedName)
                .limit(1)
                .get();

            // Si no se encuentra, intentar buscar por ID del documento (por si acaso)
            if (playlistQuery.empty) {
                // Intentar buscar todas las playlists y hacer comparación local
                const allPlaylistsSnap = await db.collection('playlists').get();
                const matchingPlaylist = allPlaylistsSnap.docs.find(doc => {
                    const data = doc.data();
                    const docName = data.name || '';
                    return docName.trim() === trimmedName || docName === trimmedName;
                });
                
                if (matchingPlaylist) {
                    // Simular el resultado de la query
                    playlistQuery = {
                        empty: false,
                        docs: [matchingPlaylist]
                    };
                }
            }

            console.log(`getPlaylistSongs: Resultado de búsqueda - empty: ${playlistQuery.empty}, docs.length: ${playlistQuery.docs.length}`);

            if (playlistQuery.empty) {
                // Intentar buscar sin .where para ver todas las playlists (solo para debug)
                const allPlaylists = await db.collection('playlists').get();
                console.log(`getPlaylistSongs: Playlists existentes en la BD:`);
                allPlaylists.docs.forEach(doc => {
                    const data = doc.data();
                    console.log(`  - ID: ${doc.id}, name: "${data.name}", name === "${trimmedName}": ${data.name === trimmedName}`);
                });
                
                console.log(`getPlaylistSongs: No se encontró la playlist: "${trimmedName}"`);
                return [];
            }

            const playlistData = playlistQuery.docs[0].data();
            const songTitles = playlistData.songs || [];

            console.log(`getPlaylistSongs: Playlist encontrada. Títulos de canciones (${songTitles.length}):`, songTitles);

            if (songTitles.length === 0) {
                console.log('getPlaylistSongs: La playlist no tiene canciones');
                return [];
            }

            // Obtener todas las canciones y filtrar por título
            const allSongsSnapshot = await db.collection('songs').get();
            const allSongs = allSongsSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            console.log(`getPlaylistSongs: Total de canciones en BD: ${allSongs.length}`);

            // Filtrar canciones que coincidan con los títulos de la playlist
            const playlistSongs = allSongs.filter(song => 
                songTitles.includes(song.title)
            );

            console.log(`getPlaylistSongs: Canciones encontradas en la playlist (${playlistSongs.length}):`, playlistSongs.map(s => s.title));

            return playlistSongs;
        } catch (error) {
            console.error('getPlaylistSongs: Error obteniendo canciones de la playlist:', error);
            console.error('Error details:', error.message, error.stack);
            throw error;
        }
    }

    /**
     * Actualiza el coverPath de una playlist
     * Busca el documento por el campo 'name' primero, si no existe, busca por ID
     * @param {string} playlistNameOrId - Nombre de la playlist o ID del documento
     * @param {string} coverPath - Ruta de la imagen en Storage
     * @returns {Promise<void>}
     */
    async updatePlaylistCoverPath(playlistNameOrId, coverPath) {
        try {
            if (!playlistNameOrId || playlistNameOrId.trim() === '') {
                throw new Error('El nombre de la playlist no puede estar vacío');
            }

            const playlistNameTrimmed = playlistNameOrId.trim();
            
            // Primero intentar buscar por campo 'name'
            let playlistDoc = null;
            let playlistDocId = null;
            
            const playlistByName = await db.collection('playlists')
                .where('name', '==', playlistNameTrimmed)
                .limit(1)
                .get();
            
            if (!playlistByName.empty) {
                // Encontrado por campo name
                playlistDoc = playlistByName.docs[0];
                playlistDocId = playlistDoc.id;
                console.log(`Playlist encontrada por campo name: ${playlistNameTrimmed}, ID: ${playlistDocId}`);
            } else {
                // Si no se encontró por name, intentar por ID del documento
                playlistDoc = await db.collection('playlists').doc(playlistNameTrimmed).get();
                if (playlistDoc.exists) {
                    playlistDocId = playlistDoc.id;
                    console.log(`Playlist encontrada por ID: ${playlistNameTrimmed}`);
                }
            }
            
            if (playlistDoc && playlistDoc.exists) {
                // Actualizar el documento existente usando su ID real
                await db.collection('playlists').doc(playlistDocId).update({
                    coverPath: coverPath || ''
                });
                console.log(`CoverPath actualizado para playlist: ${playlistNameTrimmed} (ID: ${playlistDocId})`);
            } else {
                throw new Error(`No existe una playlist con el nombre: ${playlistNameTrimmed}`);
            }
        } catch (error) {
            console.error(`Error actualizando coverPath para playlist ${playlistNameOrId}:`, error);
            throw error;
        }
    }

    /**
     * Obtiene el coverPath anterior de una playlist
     * Busca primero por campo 'name', luego por ID
     * @param {string} playlistNameOrId - Nombre de la playlist o ID del documento
     * @returns {Promise<string|null>} Ruta del cover anterior o null si no existe
     */
    async getPreviousPlaylistCoverPath(playlistNameOrId) {
        try {
            const playlistNameTrimmed = playlistNameOrId.trim();
            
            // Primero intentar buscar por campo 'name'
            const playlistByName = await db.collection('playlists')
                .where('name', '==', playlistNameTrimmed)
                .limit(1)
                .get();
            
            if (!playlistByName.empty) {
                const data = playlistByName.docs[0].data();
                return data.coverPath || null;
            }
            
            // Si no se encontró por campo, intentar por ID del documento
            const playlistById = await db.collection('playlists').doc(playlistNameTrimmed).get();
            if (playlistById.exists) {
                const data = playlistById.data();
                return data.coverPath || null;
            }
            
            return null;
        } catch (error) {
            console.error(`Error obteniendo coverPath anterior para playlist ${playlistNameOrId}:`, error);
            return null;
        }
    }
}

// Crear instancia singleton
const firestoreService = new FirestoreService();

export default firestoreService;
