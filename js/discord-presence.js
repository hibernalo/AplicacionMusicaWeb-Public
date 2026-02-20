import storageService from './storage-service.js';

/**
 * Cliente de Discord Rich Presence
 * Se conecta a la aplicación Electron local via WebSocket
 * para mostrar el estado de reproducción en Discord
 */
class DiscordPresenceClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 5000;
        this.progressInterval = null;

        this.connect();
        this.setupListeners();
    }

    /**
     * Conecta al servidor WebSocket de la app Electron
     */
    connect() {
        try {
            this.ws = new WebSocket('ws://localhost:6969');

            this.ws.onopen = () => {
                console.log('[Discord Presence] Conectado al servidor');
                this.isConnected = true;
                this.reconnectAttempts = 0;
            };

            this.ws.onclose = () => {
                console.log('[Discord Presence] Desconectado del servidor');
                this.isConnected = false;
                this.scheduleReconnect();
            };

            this.ws.onerror = (error) => {
                // Solo loguear si estaba conectado antes (evita spam en consola)
                if (this.isConnected) {
                    console.log('[Discord Presence] Error de conexion');
                }
            };
        } catch (e) {
            // El servidor Electron no esta corriendo, intentar reconectar
            this.scheduleReconnect();
        }
    }

    /**
     * Programa un intento de reconexion
     */
    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => this.connect(), this.reconnectDelay);
        }
    }

    /**
     * Envia un mensaje al servidor WebSocket
     * @param {string} type - Tipo de mensaje
     * @param {Object} data - Datos del mensaje
     */
    send(type, data) {
        if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify({ type, data }));
            } catch (e) {
                console.log('[Discord Presence] Error enviando mensaje');
            }
        }
    }

    /**
     * Configura los listeners para eventos de reproduccion
     */
    setupListeners() {
        const audioElement = document.getElementById('audioElement');

        // Escuchar evento de cambio de cancion (emitido por AudioPlayer)
        document.addEventListener('songChanged', async (e) => {
            const song = e.detail.song;
            if (song) {
                // Obtener URL de la portada si existe
                let coverUrl = null;
                if (song.coverPath) {
                    try {
                        coverUrl = await storageService.getCoverUrl(song.coverPath);
                    } catch (err) {
                        console.log('[Discord Presence] No se pudo obtener la portada');
                    }
                }

                this.send('songChange', {
                    title: song.title || 'Sin titulo',
                    artist: song.artist || 'Artista desconocido',
                    album: song.album || '',
                    genre: song.genre || '',
                    source: song.source || '',
                    year: song.year || '',
                    coverUrl: coverUrl,
                    songId: song.id || null
                });

                // Reiniciar el intervalo de progreso
                this.startProgressUpdates();
            }
        });

        // Escuchar eventos de play/pause
        if (audioElement) {
            audioElement.addEventListener('play', () => {
                this.send('playState', { isPlaying: true });
                this.startProgressUpdates();
            });

            audioElement.addEventListener('pause', () => {
                this.send('playState', { isPlaying: false });
                this.stopProgressUpdates();
            });

            audioElement.addEventListener('ended', () => {
                this.send('playState', { isPlaying: false });
                this.stopProgressUpdates();
            });
        }
    }

    /**
     * Inicia las actualizaciones periodicas de progreso
     */
    startProgressUpdates() {
        this.stopProgressUpdates();

        const audioElement = document.getElementById('audioElement');
        if (!audioElement) return;

        // Enviar progreso cada 5 segundos
        this.progressInterval = setInterval(() => {
            if (audioElement && !audioElement.paused && !isNaN(audioElement.duration)) {
                this.send('progress', {
                    current: audioElement.currentTime,
                    total: audioElement.duration
                });
            }
        }, 5000);

        // Enviar progreso inicial
        if (!audioElement.paused && !isNaN(audioElement.duration)) {
            this.send('progress', {
                current: audioElement.currentTime,
                total: audioElement.duration
            });
        }
    }

    /**
     * Detiene las actualizaciones de progreso
     */
    stopProgressUpdates() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
    }
}

// Inicializar el cliente cuando el DOM este listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.discordPresenceClient = new DiscordPresenceClient();
    });
} else {
    window.discordPresenceClient = new DiscordPresenceClient();
}

export default DiscordPresenceClient;
