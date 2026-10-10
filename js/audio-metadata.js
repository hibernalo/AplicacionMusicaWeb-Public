/**
 * Lectura de metadatos (tags) de archivos de audio en el navegador.
 *
 * Usa la librería `music-metadata` cargada bajo demanda desde una CDN (no hay
 * bundler en el proyecto). Si la CDN falla, se intenta una segunda; si ninguna
 * carga, se devuelve `null` y el llamador deduce título/artista del nombre del
 * archivo (igual que hace `scripts/upload-songs.js` cuando el audio no trae tags).
 *
 * Solo se usa en la vista "Subir canciones": no se carga nada en el arranque.
 */
import { coverExtension } from './song-upload-service.js';

const CDN_URLS = [
    'https://cdn.jsdelivr.net/npm/music-metadata@11.12.3/+esm',
    'https://esm.sh/music-metadata@11.12.3'
];

let libPromise = null;

/**
 * Carga (una sola vez) la librería de metadatos. Resuelve a `null` si no se
 * puede cargar desde ninguna CDN.
 * @returns {Promise<Object|null>}
 */
export function loadMetadataLibrary() {
    if (!libPromise) {
        libPromise = (async () => {
            for (const url of CDN_URLS) {
                try {
                    const mod = await import(url);
                    if (mod && typeof mod.parseBlob === 'function') return mod;
                } catch (error) {
                    console.warn(`No se pudo cargar music-metadata desde ${url}:`, error);
                }
            }
            return null;
        })();
    }
    return libPromise;
}

/**
 * Convierte la imagen embebida que devuelve music-metadata en { blob, ext }.
 * Si el archivo trae varias, se prefiere la carátula frontal.
 * @param {Array} pictures
 * @returns {{blob: Blob, ext: string}|null}
 */
function pictureToCover(pictures) {
    const lista = Array.isArray(pictures) ? pictures : [];
    const portada = lista.find(p => /front/i.test(p.type || '')) || lista[0] || null;
    if (!portada || !portada.data || portada.data.length === 0) return null;
    const ext = coverExtension(portada.format, portada.data);
    if (!ext) return null;
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    // Copiar los bytes: el buffer de la librería puede estar compartido
    const bytes = portada.data instanceof Uint8Array ? portada.data : new Uint8Array(portada.data);
    return { blob: new Blob([bytes.slice()], { type: mime }), ext };
}

/**
 * Lee los metadatos de un archivo de audio.
 * @param {File} file
 * @returns {Promise<{title: string|null, artist: string|null, album: string|null,
 *   year: number|null, genre: string[]|null, durationMs: number|null,
 *   picture: {blob: Blob, ext: string}|null}|null>} null si no se pudo leer nada
 */
export async function readAudioMetadata(file) {
    const lib = await loadMetadataLibrary();
    if (!lib) return null;

    try {
        // skipPostHeaders/duration: queremos la duración aunque haya que
        // recorrer el archivo (es local, no cuesta red)
        const md = await lib.parseBlob(file, { duration: true, skipCovers: false });
        const common = md.common || {};
        const format = md.format || {};
        return {
            title: common.title ? String(common.title).trim() : null,
            artist: common.artist ? String(common.artist).trim() : null,
            album: common.album ? String(common.album).trim() : null,
            year: Number.isFinite(common.year) ? common.year : null,
            genre: Array.isArray(common.genre) && common.genre.length ? common.genre : null,
            durationMs: Number.isFinite(format.duration) ? Math.round(format.duration * 1000) : null,
            picture: pictureToCover(common.picture)
        };
    } catch (error) {
        console.warn(`No se pudieron leer los metadatos de ${file.name}:`, error);
        return null;
    }
}

/**
 * Duración de un audio usando el propio reproductor del navegador (respaldo
 * cuando la librería no está disponible o no devuelve duración).
 * @param {File} file
 * @returns {Promise<number|null>} ms o null
 */
export function readDurationWithAudioElement(file) {
    return new Promise(resolve => {
        let url = null;
        const audio = document.createElement('audio');
        const done = (ms) => {
            audio.removeAttribute('src');
            if (url) URL.revokeObjectURL(url);
            resolve(ms);
        };
        const timer = setTimeout(() => done(null), 8000);
        audio.preload = 'metadata';
        audio.addEventListener('loadedmetadata', () => {
            clearTimeout(timer);
            done(Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : null);
        });
        audio.addEventListener('error', () => { clearTimeout(timer); done(null); });
        try {
            url = URL.createObjectURL(file);
            audio.src = url;
        } catch (_) {
            clearTimeout(timer);
            done(null);
        }
    });
}
