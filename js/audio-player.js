import storageService from './storage-service.js';
import firestoreService from './firestore-service.js';
import userLikesService from './user-likes-service.js';
import queueManager from './queue-manager.js';

/**
 * Controlador del reproductor de audio
 */
class AudioPlayer {
    constructor() {
        this.audioElement = document.getElementById('audioElement');
        this.currentSong = null;
        this.songList = [];
        this.originalSongList = []; // Para shuffle
        this.shuffleQueue = []; // Cola aleatoria sin repetición para shuffle
        this.currentIndex = -1;
        this.isPlaying = false;
        // Cargar volumen desde localStorage o usar valor por defecto
        const savedVolume = localStorage.getItem('audioPlayerVolume');
        this.volume = savedVolume !== null ? parseFloat(savedVolume) : 0.7;
        this.isShuffle = false;
        this.repeatMode = 'off'; // 'off', 'all', 'one'
        // Saltos consecutivos por canciones rotas (sin archivo en Storage).
        // Sirve para auto-saltar a la siguiente sin entrar en bucle infinito.
        this.consecutiveLoadFailures = 0;

        this.initializeElements();
        this.attachEventListeners();
        this.setVolume(this.volume);
        this.setupMediaSession();
    }

    /**
     * Configura los manejadores de la MediaSession API.
     * Esto permite que el sistema operativo (pantalla de bloqueo / Centro de
     * Control en iOS y Android, controles multimedia en escritorio) muestre
     * los botones de control y reciba sus pulsaciones. Los metadatos
     * (título, artista, carátula) se actualizan en updateMediaSession().
     */
    setupMediaSession() {
        if (!('mediaSession' in navigator)) {
            return;
        }

        const setHandler = (action, handler) => {
            try {
                navigator.mediaSession.setActionHandler(action, handler);
            } catch (error) {
                // Algunas acciones no están soportadas en todos los navegadores
            }
        };

        setHandler('play', () => this.play());
        setHandler('pause', () => this.pause());
        setHandler('previoustrack', () => this.playPrevious());
        setHandler('nexttrack', () => this.playNext());
        setHandler('seekto', (details) => {
            if (details.fastSeek && 'fastSeek' in this.audioElement) {
                this.audioElement.fastSeek(details.seekTime);
                return;
            }
            if (typeof details.seekTime === 'number') {
                this.audioElement.currentTime = details.seekTime;
            }
        });
    }

    /**
     * Actualiza los metadatos que muestra el sistema operativo en la pantalla
     * de bloqueo / Centro de Control (título, artista, álbum y carátula).
     * @param {Object} song - Objeto de canción
     * @param {string|null} coverUrl - URL absoluta de la carátula (opcional)
     */
    updateMediaSession(song, coverUrl) {
        if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') {
            return;
        }

        // iOS necesita varias entradas de artwork con distintos tamaños para
        // elegir la más adecuada; apuntamos todas a la misma URL de Storage.
        const artwork = [];
        if (coverUrl) {
            ['96x96', '128x128', '192x192', '256x256', '384x384', '512x512'].forEach(sizes => {
                artwork.push({ src: coverUrl, sizes });
            });
        }

        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: song.title || 'Sin título',
                artist: song.artist || 'Artista desconocido',
                album: song.album || '',
                artwork
            });
        } catch (error) {
            console.error('Error actualizando MediaSession:', error);
        }
    }

    /**
     * Sincroniza el estado de reproducción (playing/paused) con la MediaSession.
     * @param {string} state - 'playing', 'paused' o 'none'
     */
    updateMediaSessionPlaybackState(state) {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = state;
        }
    }

    /**
     * Inicializa referencias a elementos del DOM
     */
    initializeElements() {
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.prevBtn = document.getElementById('prevBtn');
        this.nextBtn = document.getElementById('nextBtn');
        this.shuffleBtn = document.getElementById('shuffleBtn');
        this.repeatBtn = document.getElementById('repeatBtn');
        this.progressBar = document.getElementById('progressBar');
        this.volumeSlider = document.getElementById('volumeSlider');
        this.muteBtn = document.getElementById('muteBtn');
        this.currentTimeDisplay = document.getElementById('currentTime');
        this.totalTimeDisplay = document.getElementById('totalTime');
        this.currentCover = document.getElementById('currentCover');
        this.currentTitle = document.getElementById('currentTitle');
        this.currentArtist = document.getElementById('currentArtist');
        
        // Botones de información
        this.songInfoButtonsContainer = document.getElementById('songInfoButtonsContainer');
        this.addToPlaylistBtn = document.getElementById('addToPlaylistBtn');
        this.infoBtnLikedRight = document.getElementById('infoBtnLikedRight');
        this.infoBtnGenre = document.getElementById('infoBtnGenre');
        this.infoBtnSource = document.getElementById('infoBtnSource');
        this.infoBtnArtist = document.getElementById('infoBtnArtist');
        this.infoBtnAlbum = document.getElementById('infoBtnAlbum');
        this.infoBtnYear = document.getElementById('infoBtnYear');
        this.infoValueGenre = document.getElementById('infoValueGenre');
        this.infoValueSource = document.getElementById('infoValueSource');
        this.infoValueArtist = document.getElementById('infoValueArtist');
        this.infoValueAlbum = document.getElementById('infoValueAlbum');
        this.infoValueYear = document.getElementById('infoValueYear');
        this.specialSongImage = document.getElementById('specialSongImage');
        
        // Combobox
        this.genreSelect = document.getElementById('genreSelect');
        this.sourceSelect = document.getElementById('sourceSelect');
    }

    /**
     * Adjunta event listeners a los controles
     */
    attachEventListeners() {
        // Play/Pause
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());

        // Navegación
        this.prevBtn.addEventListener('click', () => this.playPrevious());
        this.nextBtn.addEventListener('click', () => this.playNext());

        // Progreso
        this.progressBar.addEventListener('input', (e) => this.seek(e.target.value));
        this.audioElement.addEventListener('timeupdate', () => this.updateProgress());
        this.audioElement.addEventListener('loadedmetadata', () => this.updateTotalTime());
        this.audioElement.addEventListener('ended', () => this.onSongEnded());

        // Volumen
        this.volumeSlider.addEventListener('input', (e) => this.setVolume(e.target.value / 100));
        this.muteBtn.addEventListener('click', () => this.toggleMute());

        // Shuffle y Repeat
        this.shuffleBtn.addEventListener('click', () => this.toggleShuffle());
        this.repeatBtn.addEventListener('click', () => this.toggleRepeat());

        // Botón de añadir a playlist
        if (this.addToPlaylistBtn) {
            this.addToPlaylistBtn.addEventListener('click', () => this.handleAddToPlaylistClick());
        }

        // Botón de corazón
        if (this.infoBtnLikedRight) {
            this.infoBtnLikedRight.addEventListener('click', () => this.handleLikedButtonClick());
        }
        
        // Botones de información - búsqueda por filtro
        if (this.infoBtnGenre) {
            this.infoBtnGenre.addEventListener('click', () => this.handleInfoButtonClick('genre'));
        }
        if (this.infoBtnSource) {
            this.infoBtnSource.addEventListener('click', () => this.handleInfoButtonClick('source'));
        }
        if (this.infoBtnArtist) {
            this.infoBtnArtist.addEventListener('click', () => this.handleInfoButtonClick('artist'));
        }
        if (this.infoBtnAlbum) {
            this.infoBtnAlbum.addEventListener('click', () => this.handleInfoButtonClick('album'));
        }
        if (this.infoBtnYear) {
            this.infoBtnYear.addEventListener('click', () => this.handleInfoButtonClick('year'));
        }

        // Listener para cambio de género en combobox
        if (this.genreSelect) {
            this.genreSelect.addEventListener('change', async (e) => {
                if (e.target.value === '__add__') {
                    // Agregar un nuevo género
                    await this.handleAddGenre();
                    e.target.value = '';
                    return;
                }
                this.handleGenreChange();
            });
        }

        // Listener para cambio de source en combobox
        if (this.sourceSelect) {
            this.sourceSelect.addEventListener('change', async (e) => {
                if (e.target.value === '__add__') {
                    // Agregar un nuevo source
                    await this.handleAddSource();
                    e.target.value = '';
                    return;
                }
                this.handleSourceChange();
            });
        }

        // Cargar géneros en el combobox
        this.loadGenres();

        // Actualizar UI cuando se carga el audio
        this.audioElement.addEventListener('canplay', () => {
            this.updateTotalTime();
        });
    }

    /**
     * Carga las opciones de género en el combobox
     */
    async loadGenres() {
        try {
            console.log('loadGenres: Cargando géneros...');
            const genres = await firestoreService.getGenresList();
            console.log(`loadGenres: Se obtuvieron ${genres.length} géneros`);
            
            if (this.genreSelect) {
                this.genreSelect.innerHTML = '<option value="">Género</option><option value="__add__">➕ Agregar género</option>';
                genres.forEach(genre => {
                    if (genre.key && genre.key.trim() !== '') {
                        const option = document.createElement('option');
                        // Asegurarse de usar siempre el ID del documento (genre.id) como value
                        // El genre.id es el ID del documento del género, que es lo que necesita getSourcesList()
                        if (!genre.id) {
                            console.warn(`loadGenres: Género ${genre.key} no tiene ID, usando key como fallback`);
                        }
                        option.value = genre.id || genre.key; // genre.id debe estar siempre presente según getGenresList()
                        option.dataset.genreName = genre.key;
                        option.dataset.genreId = genre.id || genre.key; // Guardar el ID del documento también
                        option.textContent = `${genre.key} (${genre.count || 0})`;
                        this.genreSelect.appendChild(option);
                        console.log(`loadGenres: Género agregado - name: ${genre.key}, id: ${genre.id || genre.key}`);
                    }
                });
                console.log(`loadGenres: Géneros cargados en el combo box: ${this.genreSelect.options.length - 2} géneros`);
            }
        } catch (error) {
            console.error('loadGenres: Error cargando géneros:', error);
            console.error('Error details:', error.message, error.stack);
        }
    }

    /**
     * Maneja el cambio de género en el combobox
     * Solo actualiza la canción actual, NO hace búsquedas
     */
    async handleGenreChange() {
        console.log('handleGenreChange: Iniciando...');
        const selectedOption = this.genreSelect ? this.genreSelect.selectedOptions[0] : null;
        if (!selectedOption) {
            console.log('handleGenreChange: No hay opción seleccionada');
            return;
        }
        
        // Usar genreId del dataset si está disponible, sino usar el value
        // Esto asegura que siempre se use el ID del documento del género
        const selectedGenreId = selectedOption.dataset.genreId || selectedOption.value || '';
        const selectedGenreName = selectedOption.dataset.genreName || '';
        
        console.log(`handleGenreChange: selectedGenreId=${selectedGenreId}, selectedGenreName=${selectedGenreName}, hasCurrentSong=${!!this.currentSong}`);
        
        // Si se seleccionó "Agregar género", no hacer nada más (ya se manejó en el listener)
        if (selectedGenreId === '__add__' || selectedGenreId === '') {
            console.log('handleGenreChange: Género vacío o agregar, limpiando sources');
            if (this.sourceSelect) {
                this.sourceSelect.disabled = true;
                this.sourceSelect.innerHTML = '<option value="">Source</option><option value="__add__">➕ Agregar source</option>';
            }
            return;
        }

        // Siempre cargar sources cuando se selecciona un género (con o sin canción actual)
        const currentSource = this.currentSong && this.currentSong.source ? this.currentSong.source : null;
        console.log(`handleGenreChange: Cargando sources para genreId: ${selectedGenreId}, currentSource: ${currentSource}`);
        await this.loadSources(selectedGenreId, currentSource);
        
        // Si hay canción actual, también guardar el género en la canción
        if (this.currentSong) {
            try {
                console.log(`handleGenreChange: Actualizando género en canción ${this.currentSong.id}`);
                await firestoreService.updateSongGenre(this.currentSong.id, selectedGenreName || selectedGenreId);
                this.currentSong.genre = selectedGenreName || selectedGenreId;
                
                // Actualizar el valor mostrado en los botones de información
                if (this.infoValueGenre) {
                    this.infoValueGenre.textContent = selectedGenreName || selectedGenreId;
                    if (this.infoBtnGenre) {
                        this.infoBtnGenre.disabled = false;
                    }
                }
                
                console.log(`handleGenreChange: Género actualizado para canción ${this.currentSong.id}: ${selectedGenreName || selectedGenreId}`);
            } catch (error) {
                console.error('handleGenreChange: Error actualizando género:', error);
                alert('Error al actualizar el género. Por favor, intenta de nuevo.');
            }
        }
    }

    /**
     * Carga las opciones de source filtradas por género
     * @param {string} genreId - ID del género (que ahora es el nombre del género usado como ID del documento)
     * @param {string} selectedSourceName - Nombre del source que debe estar seleccionado (opcional)
     */
    async loadSources(genreId, selectedSourceName = null) {
        try {
            console.log(`loadSources: Cargando sources para genreId: ${genreId}`);
            
            if (!genreId || genreId.trim() === '' || genreId === '__add__') {
                console.log('loadSources: genreId inválido, limpiando sources');
                if (this.sourceSelect) {
                    this.sourceSelect.disabled = true;
                    this.sourceSelect.innerHTML = '<option value="">Source</option><option value="__add__">➕ Agregar source</option>';
                }
                return;
            }
            
            // El genreId ahora es el nombre del género (que también es el ID del documento)
            // getSourcesList busca por el nombre del género
            const sources = await firestoreService.getSourcesList(genreId);
            console.log(`loadSources: Se obtuvieron ${sources.length} sources para genreId: ${genreId}`);
            
            if (this.sourceSelect) {
                const currentValue = selectedSourceName || (this.sourceSelect.value && this.sourceSelect.value !== '__add__' ? this.sourceSelect.value : null);
                
                this.sourceSelect.innerHTML = '<option value="">Source</option><option value="__add__">➕ Agregar source</option>';
                
                if (sources.length > 0) {
                    this.sourceSelect.disabled = false;
                    sources.forEach(source => {
                        if (source.key && source.key.trim() !== '') {
                            const option = document.createElement('option');
                            option.value = source.key;
                            option.textContent = `${source.key} (${source.count || 0})`;
                            this.sourceSelect.appendChild(option);
                        }
                    });
                    
                    // Restaurar el valor seleccionado si existe
                    if (currentValue) {
                        const optionToSelect = Array.from(this.sourceSelect.options).find(
                            opt => opt.value === currentValue || opt.textContent.includes(currentValue)
                        );
                        if (optionToSelect) {
                            this.sourceSelect.value = optionToSelect.value;
                            console.log(`loadSources: Source seleccionado restaurado: ${currentValue}`);
                        }
                    }
                    console.log(`loadSources: Sources cargados exitosamente: ${sources.length} sources`);
                } else {
                    // Si no hay sources, habilitar el select para permitir agregar uno nuevo
                    this.sourceSelect.disabled = false;
                    console.log('loadSources: No se encontraron sources para este género');
                }
            }
        } catch (error) {
            console.error('Error cargando sources:', error);
            console.error('Error details:', error.message, error.stack);
            if (this.sourceSelect) {
                this.sourceSelect.disabled = false;
                alert(`Error al cargar los sources: ${error.message || 'Error desconocido'}`);
            }
        }
    }

    /**
     * Maneja el cambio de source en el combobox
     * Solo actualiza la canción actual, NO hace búsquedas
     */
    async handleSourceChange() {
        const selectedSource = this.sourceSelect ? this.sourceSelect.value : '';
        
        if (!this.currentSong) {
            // Si no hay canción actual, no hacer nada
            return;
        }
        
        if (selectedSource && selectedSource !== '__add__') {
            // Guardar el source en la canción actual
            try {
                await firestoreService.updateSongSource(this.currentSong.id, selectedSource);
                this.currentSong.source = selectedSource;
                
                // Actualizar el valor mostrado en los botones de información
                if (this.infoValueSource) {
                    this.infoValueSource.textContent = selectedSource;
                    if (this.infoBtnSource) {
                        this.infoBtnSource.disabled = false;
                    }
                }
                
                console.log(`Source actualizado para canción ${this.currentSong.id}: ${selectedSource}`);
            } catch (error) {
                console.error('Error actualizando source:', error);
                alert('Error al actualizar el source. Por favor, intenta de nuevo.');
            }
        }
    }

    /**
     * Selecciona un género en el combobox si existe
     * @param {string} genreName - Nombre del género
     */
    async selectGenreInCombobox(genreName) {
        if (!this.genreSelect || !genreName || genreName.trim() === '') {
            // Si no hay género, limpiar sources
            if (this.sourceSelect) {
                this.sourceSelect.disabled = true;
                this.sourceSelect.innerHTML = '<option value="">Source</option><option value="__add__">➕ Agregar source</option>';
            }
            return;
        }

        // Buscar el género en las opciones del combobox
        const options = this.genreSelect.options;
        let found = false;
        for (let i = 0; i < options.length; i++) {
            const option = options[i];
            const genreNameInOption = option.dataset.genreName || option.value;
            
            if (genreNameInOption === genreName || option.textContent.includes(genreName)) {
                this.genreSelect.value = option.value;
                found = true;
                
                // Si hay un género seleccionado, cargar los sources correspondientes
                // Pasar el source actual de la canción si existe para mantenerlo seleccionado
                if (option.value && option.value !== '__add__') {
                    const currentSource = this.currentSong && this.currentSong.source ? this.currentSong.source : null;
                    await this.loadSources(option.value, currentSource);
                }
                return;
            }
        }

        // Si no se encontró el género, intentar cargar los géneros de nuevo y buscar
        if (!found) {
            try {
                await this.loadGenres();
                // Buscar de nuevo después de recargar
                const optionsAfterReload = this.genreSelect.options;
                for (let i = 0; i < optionsAfterReload.length; i++) {
                    const option = optionsAfterReload[i];
                    const genreNameInOption = option.dataset.genreName || option.value;
                    
                    if (genreNameInOption === genreName || option.textContent.includes(genreName)) {
                        this.genreSelect.value = option.value;
                        if (option.value && option.value !== '__add__') {
                            await this.loadSources(option.value);
                        }
                        return;
                    }
                }
            } catch (error) {
                console.error('Error recargando géneros:', error);
            }
        }
    }

    /**
     * Selecciona un source en el combobox si existe
     * Si la canción no tiene source, deja el combo box en "Source" (vacío)
     * @param {string} sourceName - Nombre del source
     */
    async selectSourceInCombobox(sourceName) {
        if (!this.sourceSelect) {
            return;
        }
        
        // Si no hay source, dejar el combo box en "Source" (valor vacío)
        if (!sourceName || sourceName.trim() === '') {
            this.sourceSelect.value = '';
            console.log('selectSourceInCombobox: No hay source, dejando combo box vacío');
            return;
        }

        // Intentar seleccionar el source de inmediato si ya está cargado
        const options = this.sourceSelect.options;
        for (let i = 0; i < options.length; i++) {
            const option = options[i];
            if (option.value === sourceName || option.textContent.includes(sourceName)) {
                this.sourceSelect.value = option.value;
                this.sourceSelect.disabled = false;
                return;
            }
        }

        // Si no se encuentra, esperar un poco más para que se carguen los sources
        // Esto es necesario cuando se carga el source antes de que los sources se hayan cargado
        setTimeout(async () => {
            const optionsAfterWait = this.sourceSelect.options;
            for (let i = 0; i < optionsAfterWait.length; i++) {
                const option = optionsAfterWait[i];
                if (option.value === sourceName || option.textContent.includes(sourceName)) {
                    this.sourceSelect.value = option.value;
                    this.sourceSelect.disabled = false;
                    return;
                }
            }
            
            // Si aún no se encuentra, puede que el source no exista para el género actual
            // En ese caso, intentar buscar el género de la canción y cargar sus sources
            if (this.currentSong && this.currentSong.genre) {
                try {
                    // Buscar el género primero
                    await this.selectGenreInCombobox(this.currentSong.genre);
                    
                    // Esperar un poco más y buscar de nuevo
                    setTimeout(() => {
                        const optionsFinal = this.sourceSelect.options;
                        for (let i = 0; i < optionsFinal.length; i++) {
                            const option = optionsFinal[i];
                            if (option.value === sourceName || option.textContent.includes(sourceName)) {
                                this.sourceSelect.value = option.value;
                                this.sourceSelect.disabled = false;
                                return;
                            }
                        }
                    }, 300);
                } catch (error) {
                    console.error('Error buscando source:', error);
                }
            }
        }, 200);
    }

    /**
     * Establece la lista de canciones
     * @param {Array} songs - Array de canciones
     */
    setSongList(songs) {
        this.originalSongList = [...songs];
        if (this.isShuffle) {
            this.initializeShuffleQueue();
        } else {
            this.songList = [...songs];
            this.shuffleQueue = [];
        }
    }

    /**
     * Reproduce una canción
     * @param {Object} song - Objeto de canción
     * @param {number} index - Índice de la canción en la lista
     */
    async playSong(song, index = -1) {
        try {
            // Si es la misma canción, solo toggle play/pause
            if (this.currentSong && this.currentSong.id === song.id) {
                this.togglePlayPause();
                return;
            }

            // Si está en modo shuffle y la canción viene de fuera de playNext() (click manual, etc.),
            // remover la canción del queue si está presente
            if (this.isShuffle && this.shuffleQueue.length > 0) {
                const songIndexInQueue = this.shuffleQueue.findIndex(s => s.id === song.id);
                if (songIndexInQueue !== -1) {
                    this.shuffleQueue.splice(songIndexInQueue, 1);
                }
            }

            this.currentSong = song;
            if (index >= 0) {
                this.currentIndex = index;
            } else {
                // Buscar índice si no se proporciona
                this.currentIndex = this.songList.findIndex(s => s.id === song.id);
            }

            // Obtener URL del audio
            const audioUrl = await storageService.getAudioUrl(song.audioPath);
            this.audioElement.src = audioUrl;

            // Actualizar UI
            this.updateSongInfo(song);

            // Cargar y reproducir
            await this.audioElement.load();
            await this.play();

            // Carga correcta: reiniciar el contador de fallos
            this.consecutiveLoadFailures = 0;

            // Disparar evento personalizado
            this.dispatchEvent('songChanged', { song, index: this.currentIndex });
        } catch (error) {
            console.error('Error reproduciendo canción:', error);

            // La canción está rota (su archivo no existe en Storage). En vez de
            // bloquear con un error, saltar automáticamente a la siguiente.
            // Limitamos los saltos consecutivos para no entrar en bucle si hay
            // muchas canciones rotas seguidas.
            this.consecutiveLoadFailures++;
            const maxSkips = Math.min(25, this.songList.length || 1);
            const haySiguiente = this.songList.length > 1 || !queueManager.isEmpty();

            if (this.consecutiveLoadFailures < maxSkips && haySiguiente) {
                this.playNext();
            } else {
                this.consecutiveLoadFailures = 0;
                alert('No se pudo cargar la canción (archivo no disponible).');
            }
        }
    }

    /**
     * Actualiza la información de la canción en el UI
     * @param {Object} song - Objeto de canción
     */
    async updateSongInfo(song) {
        this.currentTitle.textContent = song.title || 'Sin título';
        this.currentArtist.textContent = song.artist || 'Artista desconocido';

        // Actualizar botones de información
        this.updateInfoButtons(song);

        // Asegurar que el elemento de imagen especial esté disponible
        if (!this.specialSongImage) {
            this.specialSongImage = document.getElementById('specialSongImage');
        }

        // Actualizar imagen especial según la canción
        this.updateSpecialSongImage(song);

        // Cargar cover
        if (song.coverPath) {
            try {
                const coverUrl = await storageService.getCoverUrl(song.coverPath);
                this.currentCover.src = coverUrl;
                this.currentCover.style.display = 'block';
                // Pasar la carátula al sistema operativo (pantalla de bloqueo iOS, etc.)
                this.updateMediaSession(song, coverUrl);
            } catch (error) {
                console.error('Error cargando cover:', error);
                this.currentCover.style.display = 'none';
                this.updateMediaSession(song, null);
            }
        } else {
            this.currentCover.style.display = 'none';
            this.updateMediaSession(song, null);
        }
    }

    /**
     * Actualiza la imagen especial según el título de la canción
     * @param {Object} song - Objeto de canción
     */
    updateSpecialSongImage(song) {
        // Intentar obtener el elemento si no está disponible
        if (!this.specialSongImage) {
            this.specialSongImage = document.getElementById('specialSongImage');
        }
        
        if (!this.specialSongImage) {
            console.warn('updateSpecialSongImage: No se encontró el elemento specialSongImage');
            return;
        }
        
        if (!song || !song.title) {
            this.specialSongImage.style.display = 'none';
            return;
        }

        const title = song.title.toLowerCase().trim();
        let imagePath = null;

        console.log(`updateSpecialSongImage: Buscando imagen para "${song.title}" (normalizado: "${title}")`);

        // Mapeo de títulos de canciones a imágenes (búsqueda flexible)
        // Dragon Roost Island - The Legend of Zelda: The Wind Waker OST
        if (title.includes('dragon roost') || title.includes('dragonroost')) {
            imagePath = 'images/Baton_U-removebg-preview.png';
            console.log('✓ Detectada: Dragon Roost Island -> Baton_U');
        } 
        // Outset Island - The Legend of Zelda: The Wind Waker OST
        else if (title.includes('outset island') || title.includes('outsetisland')) {
            imagePath = 'images/Baton_L-removebg-preview.png';
            console.log('✓ Detectada: Outset Island -> Baton_L');
        } 
        // Wind Waker The Great Sea (Ocean) Music Extended
        else if (title.includes('wind waker') || title.includes('windwaker')) {
            if (title.includes('great sea') || title.includes('greatsea') || title.includes('ocean') || title.includes('great')) {
                imagePath = 'images/Baton_R__1_-removebg-preview.png';
                console.log('✓ Detectada: Wind Waker Great Sea/Ocean -> Baton_R');
            }
        }

        // Mostrar u ocultar la imagen
        if (imagePath) {
            this.specialSongImage.src = imagePath;
            this.specialSongImage.style.display = 'block';
            this.specialSongImage.alt = song.title;
            console.log(`✓ Imagen mostrada: ${imagePath}`);
        } else {
            this.specialSongImage.style.display = 'none';
            console.log(`✗ No se encontró imagen especial para: "${song.title}"`);
        }
    }

    /**
     * Actualiza los botones de información con los datos de la canción
     * @param {Object} song - Objeto de canción
     */
    async updateInfoButtons(song) {
        // Mostrar contenedor de botones solo si hay una canción
        if (song && song.id) {
            if (this.songInfoButtonsContainer) {
                this.songInfoButtonsContainer.style.display = 'flex';
            }
        } else {
            if (this.songInfoButtonsContainer) {
                this.songInfoButtonsContainer.style.display = 'none';
            }
            return;
        }

        // Actualizar boton de liked (usando userLikesService)
        const isLiked = userLikesService.isLiked(song.id);
        if (this.infoBtnLikedRight) {
            if (isLiked) {
                this.infoBtnLikedRight.classList.add('liked');
            } else {
                this.infoBtnLikedRight.classList.remove('liked');
            }
        }

        // Seleccionar género y source en los combobox si la canción los tiene
        // Primero seleccionar el género (esto cargará los sources)
        if (song.genre) {
            await this.selectGenreInCombobox(song.genre);
            // Luego seleccionar el source después de que se hayan cargado los sources
            if (song.source) {
                await this.selectSourceInCombobox(song.source);
            }
        } else if (song.source) {
            // Si hay source pero no género, intentar seleccionar solo el source
            // Esto probablemente no funcionará bien sin género, pero lo intentamos
            await this.selectSourceInCombobox(song.source);
        }

        // Actualizar valores
        const genre = song.genre || '';
        const source = song.source || '';
        const artist = song.artist || '';
        const album = song.album || '';
        const year = song.year ? song.year.toString() : '';

        // Actualizar textos
        if (this.infoValueGenre) {
            this.infoValueGenre.textContent = genre || '-';
            this.infoBtnGenre.disabled = !genre;
        }
        if (this.infoValueSource) {
            this.infoValueSource.textContent = source || '-';
            this.infoBtnSource.disabled = !source;
        }
        if (this.infoValueArtist) {
            this.infoValueArtist.textContent = artist || '-';
            this.infoBtnArtist.disabled = !artist;
        }
        if (this.infoValueAlbum) {
            this.infoValueAlbum.textContent = album || '-';
            this.infoBtnAlbum.disabled = !album;
        }
        if (this.infoValueYear) {
            this.infoValueYear.textContent = year || '-';
            this.infoBtnYear.disabled = !year;
        }
    }

    /**
     * Maneja el clic en el botón de añadir a playlist
     */
    handleAddToPlaylistClick() {
        if (!this.currentSong) {
            alert('No hay una canción seleccionada para añadir a la playlist.');
            return;
        }

        // Disparar evento para añadir canción a playlist
        const event = new CustomEvent('addSongToPlaylist', {
            detail: { song: this.currentSong }
        });
        document.dispatchEvent(event);
    }

    /**
     * Maneja el clic en el boton de liked
     */
    async handleLikedButtonClick() {
        if (!this.currentSong) return;

        // Verificar si hay usuario autenticado
        const userId = userLikesService.getCurrentUserId();
        if (!userId) {
            alert('Debes iniciar sesion para marcar canciones como favoritas');
            return;
        }

        try {
            // Toggle like usando userLikesService
            const newLikedValue = await userLikesService.toggleLike(this.currentSong.id);

            // Actualizar el boton visualmente
            if (this.infoBtnLikedRight) {
                if (newLikedValue) {
                    this.infoBtnLikedRight.classList.add('liked');
                } else {
                    this.infoBtnLikedRight.classList.remove('liked');
                }
            }

            // Actualizar el corazón en la card de la canción
            const songCard = document.querySelector(`.song-card[data-song-id="${this.currentSong.id}"]`);
            if (songCard) {
                const existingHeart = songCard.querySelector('.song-card-liked-heart');
                if (newLikedValue && !existingHeart) {
                    const likedHeart = document.createElement('div');
                    likedHeart.className = 'song-card-liked-heart';
                    likedHeart.innerHTML = `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                        </svg>
                    `;
                    songCard.appendChild(likedHeart);
                } else if (!newLikedValue && existingHeart) {
                    existingHeart.remove();
                }
            }

            console.log(`Cancion ${this.currentSong.id} marcada como ${newLikedValue ? 'favorita' : 'no favorita'}`);
        } catch (error) {
            console.error('Error actualizando liked:', error);
            alert('Error al actualizar la cancion favorita. Por favor, intenta de nuevo.');
        }
    }

    /**
     * Maneja el clic en un botón de información
     * @param {string} filterType - Tipo de filtro ('genre', 'source', 'artist', 'album', 'year')
     */
    handleInfoButtonClick(filterType) {
        if (!this.currentSong) return;

        let filterValue = null;

        switch (filterType) {
            case 'genre':
                filterValue = this.currentSong.genre;
                break;
            case 'source':
                filterValue = this.currentSong.source;
                break;
            case 'artist':
                filterValue = this.currentSong.artist;
                break;
            case 'album':
                filterValue = this.currentSong.album;
                break;
            case 'year':
                filterValue = this.currentSong.year ? this.currentSong.year.toString() : null;
                break;
        }

        if (!filterValue) {
            console.log(`No hay valor para el filtro ${filterType}`);
            return;
        }

        // Activar el enlace de navegación correspondiente
        this.activateNavLink(filterType);

        // Disparar evento para realizar la búsqueda
        this.dispatchEvent('filterItemSelected', {
            filterType,
            filterValue
        });
    }

    /**
     * Activa el enlace de navegación correspondiente al tipo de filtro
     * @param {string} filterType - Tipo de filtro
     */
    activateNavLink(filterType) {
        // Mapeo de tipos de filtro a IDs de navegación
        const navIdMap = {
            'genre': 'navGenre',
            'source': 'navSource',
            'artist': 'navArtist',
            'album': 'navAlbum',
            'year': 'navYear'
        };

        const navId = navIdMap[filterType];
        if (navId) {
            const navLink = document.getElementById(navId);
            if (navLink) {
                // Remover clase active de todos los enlaces
                document.querySelectorAll('.nav-link').forEach(link => {
                    link.classList.remove('active');
                });
                // Añadir clase active al enlace correspondiente
                navLink.classList.add('active');
            }
        }
    }

    /**
     * Reproduce el audio
     */
    async play() {
        try {
            await this.audioElement.play();
            this.isPlaying = true;
            this.updatePlayPauseButton();
            this.updateMediaSessionPlaybackState('playing');
        } catch (error) {
            console.error('Error reproduciendo:', error);
            this.isPlaying = false;
            this.updatePlayPauseButton();
            this.updateMediaSessionPlaybackState('paused');
        }
    }

    /**
     * Pausa el audio
     */
    pause() {
        this.audioElement.pause();
        this.isPlaying = false;
        this.updatePlayPauseButton();
        this.updateMediaSessionPlaybackState('paused');
    }

    /**
     * Alterna entre reproducir y pausar
     */
    togglePlayPause() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    /**
     * Actualiza el botón de play/pause
     */
    updatePlayPauseButton() {
        if (this.isPlaying) {
            this.playPauseBtn.classList.add('playing');
        } else {
            this.playPauseBtn.classList.remove('playing');
        }
    }

    /**
     * Reproduce la canción anterior
     */
    playPrevious() {
        if (this.songList.length === 0) return;

        if (this.repeatMode === 'off') {
            if (this.currentIndex <= 0) {
                this.currentIndex = this.songList.length - 1;
            } else {
                this.currentIndex--;
            }
        } else {
            // En modo repeat, volver al final si estamos al inicio
            if (this.currentIndex <= 0) {
                this.currentIndex = this.songList.length - 1;
            } else {
                this.currentIndex--;
            }
        }

        const previousSong = this.songList[this.currentIndex];
        this.playSong(previousSong, this.currentIndex);
    }

    /**
     * Reproduce la siguiente canción
     */
    playNext() {
        // La cola manual tiene prioridad sobre la lista/aleatorio
        if (!queueManager.isEmpty()) {
            const nextFromQueue = queueManager.takeNext();
            if (nextFromQueue) {
                const idx = this.songList.findIndex(s => s.id === nextFromQueue.id);
                this.playSong(nextFromQueue, idx);
                return;
            }
        }

        if (this.songList.length === 0) return;

        if (this.isShuffle) {
            // En modo shuffle, usar la cola aleatoria sin repetición
            // Si la cola está vacía, reinicializarla
            if (this.shuffleQueue.length === 0) {
                this.initializeShuffleQueue();
            }
            
            // Si aún está vacía (solo hay una canción o ninguna), no hacer nada
            if (this.shuffleQueue.length === 0) {
                return;
            }

            // Tomar y remover la primera canción de la cola
            const nextSong = this.shuffleQueue.shift(); // Remueve el primer elemento
            const nextIndex = this.songList.findIndex(s => s.id === nextSong.id);
            this.currentIndex = nextIndex >= 0 ? nextIndex : 0;
            // No necesitamos remover de la cola en playSong porque ya lo hicimos aquí
            this.playSong(nextSong, this.currentIndex);
        } else {
            // Modo normal o repeat
            if (this.currentIndex >= this.songList.length - 1) {
                if (this.repeatMode === 'all') {
                    this.currentIndex = 0;
                } else {
                    return; // No hay más canciones
                }
            } else {
                this.currentIndex++;
            }
            
            const nextSong = this.songList[this.currentIndex];
            this.playSong(nextSong, this.currentIndex);
        }
    }

    /**
     * Se ejecuta cuando termina una canción
     */
    onSongEnded() {
        if (this.repeatMode === 'one') {
            // Repetir la misma canción
            this.audioElement.currentTime = 0;
            this.play();
        } else if (this.repeatMode === 'all') {
            // Repetir toda la lista
            this.playNext();
        } else if (this.isShuffle) {
            // En modo shuffle: siempre continuar (playNext reinicia la cola si está vacía)
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
    }

    /**
     * Actualiza la barra de progreso
     */
    updateProgress() {
        if (this.audioElement.duration) {
            const progress = (this.audioElement.currentTime / this.audioElement.duration) * 100;
            this.progressBar.value = progress;
            this.currentTimeDisplay.textContent = this.formatTime(this.audioElement.currentTime);
        }
    }

    /**
     * Actualiza el tiempo total
     */
    updateTotalTime() {
        if (this.audioElement.duration) {
            this.totalTimeDisplay.textContent = this.formatTime(this.audioElement.duration);
        }
    }

    /**
     * Salta a una posición específica en la canción
     * @param {number} percentage - Porcentaje de la canción (0-100)
     */
    seek(percentage) {
        if (this.audioElement.duration) {
            const time = (percentage / 100) * this.audioElement.duration;
            this.audioElement.currentTime = time;
        }
    }

    /**
     * Establece el volumen
     * @param {number} volume - Volumen entre 0 y 1
     */
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        this.audioElement.volume = this.volume;
        this.volumeSlider.value = this.volume * 100;
        this.updateMuteButton();
        
        // Guardar volumen en localStorage
        localStorage.setItem('audioPlayerVolume', this.volume.toString());
    }

    /**
     * Alterna el mute
     */
    toggleMute() {
        if (this.audioElement.muted) {
            this.audioElement.muted = false;
        } else {
            this.audioElement.muted = true;
        }
        this.updateMuteButton();
    }

    /**
     * Actualiza el botón de mute
     */
    updateMuteButton() {
        const volumeHigh = this.muteBtn.querySelector('.volume-high');
        const volumeMute = this.muteBtn.querySelector('.volume-mute');
        
        if (this.audioElement.muted || this.volume === 0) {
            if (volumeHigh) volumeHigh.style.display = 'none';
            if (volumeMute) volumeMute.style.display = 'block';
        } else {
            if (volumeHigh) volumeHigh.style.display = 'block';
            if (volumeMute) volumeMute.style.display = 'none';
        }
    }

    /**
     * Formatea el tiempo en formato mm:ss
     * @param {number} seconds - Segundos
     * @returns {string} Tiempo formateado
     */
    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Obtiene la canción actual
     * @returns {Object|null} Canción actual
     */
    getCurrentSong() {
        return this.currentSong;
    }

    /**
     * Obtiene el índice actual
     * @returns {number} Índice actual
     */
    getCurrentIndex() {
        return this.currentIndex;
    }

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

    /**
     * Alterna el modo shuffle (aleatorio)
     */
    toggleShuffle() {
        this.isShuffle = !this.isShuffle;
        
        if (this.isShuffle) {
            this.shuffleBtn.classList.add('active');
            this.initializeShuffleQueue();
            // Mantener la canción actual si existe
            if (this.currentSong) {
                const currentSongId = this.currentSong.id;
                const newIndex = this.songList.findIndex(s => s.id === currentSongId);
                if (newIndex !== -1) {
                    this.currentIndex = newIndex;
                }
            }
        } else {
            this.shuffleBtn.classList.remove('active');
            this.shuffleQueue = [];
            // Restaurar orden original pero mantener la posición actual
            if (this.currentSong) {
                const currentSongId = this.currentSong.id;
                this.songList = [...this.originalSongList];
                const newIndex = this.songList.findIndex(s => s.id === currentSongId);
                if (newIndex !== -1) {
                    this.currentIndex = newIndex;
                }
            } else {
                this.songList = [...this.originalSongList];
            }
        }
    }

    /**
     * Inicializa la cola aleatoria para shuffle sin repetición
     * Crea una cola mezclada con todas las canciones disponibles,
     * excluyendo la canción actual para evitar repetición inmediata
     */
    initializeShuffleQueue() {
        // Crear una copia de todas las canciones disponibles
        let availableSongs = [...this.originalSongList];
        
        // Si hay una canción actual, excluirla del pool inicial
        if (this.currentSong && availableSongs.length > 1) {
            availableSongs = availableSongs.filter(s => s.id !== this.currentSong.id);
        }
        
        // Mezclar las canciones disponibles usando Fisher-Yates
        const shuffled = [...availableSongs];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        
        this.shuffleQueue = shuffled;
        // Mantener songList con todas las canciones para búsqueda y navegación
        this.songList = [...this.originalSongList];
    }

    /**
     * Mezcla la lista de canciones aleatoriamente (método legacy, ya no se usa)
     * @deprecated Se usa initializeShuffleQueue() en su lugar
     */
    shuffleSongList() {
        // Este método ya no se usa, pero se mantiene por compatibilidad
        this.initializeShuffleQueue();
    }

    /**
     * Alterna el modo repeat
     * Estados: 'off' -> 'all' -> 'one' -> 'off'
     */
    toggleRepeat() {
        const repeatIcon = this.repeatBtn.querySelector('.repeat-icon');
        const repeatOneIcon = this.repeatBtn.querySelector('.repeat-one-icon');
        
        if (this.repeatMode === 'off') {
            this.repeatMode = 'all';
            this.repeatBtn.classList.add('active');
            if (repeatIcon) repeatIcon.style.display = 'block';
            if (repeatOneIcon) repeatOneIcon.style.display = 'none';
            this.repeatBtn.title = 'Repetir lista';
        } else if (this.repeatMode === 'all') {
            this.repeatMode = 'one';
            this.repeatBtn.classList.add('active');
            if (repeatIcon) repeatIcon.style.display = 'none';
            if (repeatOneIcon) repeatOneIcon.style.display = 'block';
            this.repeatBtn.title = 'Repetir canción';
        } else {
            this.repeatMode = 'off';
            this.repeatBtn.classList.remove('active');
            if (repeatIcon) repeatIcon.style.display = 'block';
            if (repeatOneIcon) repeatOneIcon.style.display = 'none';
            this.repeatBtn.title = 'Repetir';
        }
    }

    /**
     * Maneja la acción de agregar un nuevo género
     */
    async handleAddGenre() {
        const genreName = prompt('Ingresa el nombre del nuevo género:');
        
        if (!genreName || genreName.trim() === '') {
            return;
        }

        try {
            await firestoreService.addGenre(genreName.trim());
            alert(`Género "${genreName}" agregado exitosamente.`);
            
            // Recargar la lista de géneros en el combobox
            await this.loadGenres();
            
            // Si hay una canción actual, actualizar el género seleccionado automáticamente
            if (this.currentSong) {
                // Buscar el género recién agregado y seleccionarlo
                const options = this.genreSelect.options;
                for (let i = 0; i < options.length; i++) {
                    const option = options[i];
                    if (option.dataset.genreName === genreName.trim() || option.textContent.includes(genreName.trim())) {
                        this.genreSelect.value = option.value;
                        
                        // Guardar el género en la canción actual
                        await firestoreService.updateSongGenre(this.currentSong.id, genreName.trim());
                        this.currentSong.genre = genreName.trim();
                        
                        // Actualizar el valor mostrado en los botones de información
                        if (this.infoValueGenre) {
                            this.infoValueGenre.textContent = genreName.trim();
                            if (this.infoBtnGenre) {
                                this.infoBtnGenre.disabled = false;
                            }
                        }
                        
                        // Cargar los sources del nuevo género
                        if (option.value && option.value !== '__add__') {
                            await this.loadSources(option.value);
                        }
                        break;
                    }
                }
            }
        } catch (error) {
            console.error('Error agregando género:', error);
            alert(`Error al agregar el género: ${error.message || 'Error desconocido'}`);
        }
    }

    /**
     * Maneja la acción de agregar un nuevo source
     */
    async handleAddSource() {
        // Verificar que haya un género seleccionado
        const selectedGenreOption = this.genreSelect ? this.genreSelect.selectedOptions[0] : null;
        if (!selectedGenreOption || !selectedGenreOption.value || selectedGenreOption.value === '' || selectedGenreOption.value === '__add__') {
            alert('Por favor, selecciona un género primero antes de agregar un source.');
            return;
        }

        const genreId = selectedGenreOption.value;
        const genreName = selectedGenreOption.dataset.genreName || genreId;

        const sourceName = prompt(`Ingresa el nombre del nuevo source para el género "${genreName}":`);
        
        if (!sourceName || sourceName.trim() === '') {
            return;
        }

        try {
            await firestoreService.addSource(sourceName.trim(), genreId);
            alert(`Source "${sourceName}" agregado exitosamente para el género "${genreName}".`);
            
            // Recargar la lista de sources en el combobox
            await this.loadSources(genreId);
            
            // Si hay una canción actual, actualizar el source seleccionado automáticamente
            if (this.currentSong) {
                // Seleccionar el nuevo source en el combobox
                this.sourceSelect.value = sourceName.trim();
                
                // Guardar el source en la canción actual
                await firestoreService.updateSongSource(this.currentSong.id, sourceName.trim());
                this.currentSong.source = sourceName.trim();
                
                // Actualizar el valor mostrado en los botones de información
                if (this.infoValueSource) {
                    this.infoValueSource.textContent = sourceName.trim();
                    if (this.infoBtnSource) {
                        this.infoBtnSource.disabled = false;
                    }
                }
            }
        } catch (error) {
            console.error('Error agregando source:', error);
            alert(`Error al agregar el source: ${error.message || 'Error desconocido'}`);
        }
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

export default AudioPlayer;
