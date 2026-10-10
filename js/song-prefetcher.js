/**
 * Precarga en memoria de la SIGUIENTE canción.
 *
 * Problema que resuelve: en el móvil con la pantalla apagada, en cuanto deja
 * de sonar audio el sistema deja de tratar la pestaña como "reproduciendo":
 * Android retira el servicio de reproducción de Chrome (y el ahorro de
 * batería / Doze bloquea la red) e iOS suspende el JavaScript. Si la
 * transición a la siguiente canción necesita red en ese instante (bajar la
 * URL, bajar los primeros bytes...), se cuelga y no suena nada más.
 *
 * Solución: mientras la canción actual suena (momento en el que sí hay red y
 * JS activo) se descarga ENTERA la siguiente con fetch() y se guarda como
 * Blob. En el evento 'ended' el reproductor sólo tiene que hacer
 * `audio.src = blobUrl; audio.play()` de forma síncrona: cero red, cero
 * esperas, y la canción completa ya está en memoria (no puede "cortarse" a
 * mitad por falta de datos).
 *
 * Requisito: el bucket de Storage debe permitir CORS para GET (ver
 * scripts/set-storage-cors.js). Si el fetch falla (CORS, red...), el
 * reproductor sigue funcionando por la vía normal (URL directa).
 *
 * Todas las dependencias se inyectan por el constructor para poder probar el
 * módulo en Node sin navegador (test/song-prefetcher.test.js).
 */
class SongPrefetcher {
    /**
     * @param {Object} options
     * @param {(audioPath: string) => Promise<string>} options.resolveAudioUrl  Ruta de Storage → URL de descarga
     * @param {(coverPath: string) => Promise<string>} [options.resolveCoverUrl] Ruta de Storage → URL de la carátula
     * @param {Function} [options.fetchImpl]        fetch a usar (por defecto window.fetch)
     * @param {Function} [options.createObjectURL]  Blob → blob: URL
     * @param {Function} [options.revokeObjectURL]  Libera una blob: URL
     * @param {number}   [options.maxAttempts]      Intentos por canción (por defecto 3)
     * @param {number}   [options.retryDelayMs]     Espera base entre reintentos (por defecto 4000 ms)
     * @param {Function} [options.logger]           Recibe mensajes de diagnóstico (opcional)
     */
    constructor(options = {}) {
        if (typeof options.resolveAudioUrl !== 'function') {
            throw new Error('SongPrefetcher: falta resolveAudioUrl');
        }
        this.resolveAudioUrl = options.resolveAudioUrl;
        this.resolveCoverUrl = typeof options.resolveCoverUrl === 'function' ? options.resolveCoverUrl : null;
        this.fetchImpl = options.fetchImpl || ((url, init) => fetch(url, init));
        this.createObjectURL = options.createObjectURL || ((blob) => URL.createObjectURL(blob));
        this.revokeObjectURL = options.revokeObjectURL || ((url) => URL.revokeObjectURL(url));
        this.maxAttempts = options.maxAttempts !== undefined ? options.maxAttempts : 3;
        this.retryDelayMs = options.retryDelayMs !== undefined ? options.retryDelayMs : 4000;
        this.logger = typeof options.logger === 'function' ? options.logger : null;

        // Canción ya descargada: { audioPath, songId, blobUrl, coverUrl, size }
        this.ready = null;
        // Descarga en curso: { audioPath, controller, promise }
        this.inflight = null;
    }

    /**
     * ¿Hay algo (listo o descargándose) para esta ruta de audio?
     * @param {string} audioPath
     * @returns {boolean}
     */
    has(audioPath) {
        return this.isReady(audioPath) ||
            (this.inflight !== null && this.inflight.audioPath === audioPath);
    }

    /**
     * ¿Está esta ruta de audio ya descargada y lista para usar?
     * @param {string} audioPath
     * @returns {boolean}
     */
    isReady(audioPath) {
        return this.ready !== null && this.ready.audioPath === audioPath;
    }

    /**
     * Empieza (o reutiliza) la precarga de una canción. Sólo se mantiene UNA
     * canción precargada: pedir otra distinta aborta/libera la anterior.
     * @param {Object} song - Canción con audioPath (y opcionalmente coverPath)
     * @returns {Promise<boolean>} true si la canción queda lista en memoria
     */
    prefetch(song) {
        if (!song || !song.audioPath) {
            return Promise.resolve(false);
        }
        if (this.isReady(song.audioPath)) {
            return Promise.resolve(true);
        }
        if (this.inflight && this.inflight.audioPath === song.audioPath) {
            return this.inflight.promise;
        }

        // Otra canción distinta: descartar lo anterior
        this.cancel();

        const controller = new AbortController();
        const entry = { audioPath: song.audioPath, controller, promise: null };
        entry.promise = this.download(song, controller.signal).then((result) => {
            // Sólo aplicar si esta descarga sigue siendo la vigente
            if (this.inflight === entry) {
                this.inflight = null;
                if (result) {
                    this.ready = result;
                    return true;
                }
            } else if (result) {
                // Llegó tarde (ya se canceló): no dejar el blob huérfano
                this.safeRevoke(result.blobUrl);
            }
            return false;
        });
        this.inflight = entry;
        return entry.promise;
    }

    /**
     * Entrega la canción precargada si coincide, transfiriendo la propiedad
     * del blob al llamante (que deberá llamar a release() cuando deje de
     * usarlo). Si no coincide, no consume nada.
     * @param {Object} song
     * @returns {{audioPath: string, songId: *, blobUrl: string, coverUrl: string|null, size: number}|null}
     */
    take(song) {
        if (!song || !this.isReady(song.audioPath)) {
            return null;
        }
        const entry = this.ready;
        this.ready = null;
        return entry;
    }

    /**
     * Aborta la descarga en curso y libera la canción lista (si las hay).
     */
    cancel() {
        if (this.inflight) {
            const entry = this.inflight;
            this.inflight = null;
            entry.controller.abort();
            this.note(`descarga cancelada: ${entry.audioPath}`);
        }
        if (this.ready) {
            const url = this.ready.blobUrl;
            this.note(`blob descartado: ${this.ready.audioPath}`);
            this.ready = null;
            this.safeRevoke(url);
        }
    }

    /**
     * Libera una blob: URL entregada previamente por take().
     * @param {string|null} blobUrl
     */
    release(blobUrl) {
        if (blobUrl) {
            this.safeRevoke(blobUrl);
        }
    }

    /**
     * Descarga la canción completa con reintentos.
     * @private
     * @returns {Promise<Object|null>} Entrada lista o null si no se pudo
     */
    async download(song, signal) {
        const started = Date.now();
        this.note(`descargando "${song.title || song.audioPath}"`);
        for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
            try {
                const [downloadUrl, coverUrl] = await Promise.all([
                    this.resolveAudioUrl(song.audioPath),
                    this.resolveCover(song)
                ]);
                if (signal.aborted) return null;

                const response = await this.fetchImpl(downloadUrl, { signal });
                if (!response || !response.ok) {
                    throw new Error(`HTTP ${response ? response.status : 'sin respuesta'}`);
                }
                const blob = await response.blob();
                if (signal.aborted) return null;
                if (!blob || blob.size === 0) {
                    throw new Error('respuesta vacía');
                }

                this.note(`lista "${song.title || song.audioPath}" (${(blob.size / 1048576).toFixed(1)} MB en ${Date.now() - started} ms, intento ${attempt})`);
                return {
                    audioPath: song.audioPath,
                    songId: song.id !== undefined ? song.id : null,
                    blobUrl: this.createObjectURL(blob),
                    coverUrl: coverUrl || null,
                    size: blob.size
                };
            } catch (error) {
                if (signal.aborted) return null;
                this.note(`fallo intento ${attempt} "${song.title || song.audioPath}": ${error && (error.message || error)}`);
                if (attempt >= this.maxAttempts) {
                    console.warn(
                        `SongPrefetcher: no se pudo precargar "${song.title || song.audioPath}" ` +
                        `tras ${attempt} intento(s). Si el error es de CORS, ejecuta ` +
                        `scripts/set-storage-cors.js.`,
                        error
                    );
                    this.note(`abandonada "${song.title || song.audioPath}" tras ${attempt} intentos`);
                    return null;
                }
                await this.delay(this.retryDelayMs * attempt, signal);
                if (signal.aborted) return null;
            }
        }
        return null;
    }

    /**
     * Resuelve la URL de la carátula sin propagar errores (es opcional).
     * @private
     */
    async resolveCover(song) {
        if (!this.resolveCoverUrl || !song.coverPath) {
            return null;
        }
        try {
            return await this.resolveCoverUrl(song.coverPath);
        } catch (error) {
            return null;
        }
    }

    /**
     * Espera abortable.
     * @private
     */
    delay(ms, signal) {
        return new Promise((resolve) => {
            if (signal.aborted) {
                resolve();
                return;
            }
            const timer = setTimeout(() => {
                signal.removeEventListener('abort', onAbort);
                resolve();
            }, ms);
            const onAbort = () => {
                clearTimeout(timer);
                resolve();
            };
            signal.addEventListener('abort', onAbort, { once: true });
        });
    }

    /**
     * Envía un mensaje al registro de diagnóstico (si hay logger).
     * @private
     */
    note(message) {
        if (this.logger) {
            try {
                this.logger(message);
            } catch (error) {
                // El diagnóstico nunca debe romper la precarga
            }
        }
    }

    /**
     * Revoca una blob: URL ignorando errores.
     * @private
     */
    safeRevoke(url) {
        try {
            this.revokeObjectURL(url);
        } catch (error) {
            // Ignorar: liberar memoria es best-effort
        }
    }
}

export default SongPrefetcher;
