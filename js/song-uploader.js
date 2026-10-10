/**
 * Orquestación de la subida de una canción desde la web: comprueba duplicados,
 * sube el audio y la portada a Storage, garantiza los documentos de
 * género/source/artista y crea el documento en `songs`. Después, añade los
 * títulos subidos a las playlists elegidas.
 *
 * La vista (upload-view.js) no sabe nada de Firebase: solo llama a estas dos
 * funciones y pinta el progreso.
 */
import firestoreService from './firestore-service.js';
import storageService from './storage-service.js';
import {
    STATUS,
    storagePathsFor,
    buildSongDocument,
    groupTitlesByPlaylist
} from './song-upload-service.js';

// Reparto del progreso por fases (fracción del total)
const PROGRESO_AUDIO = 0.85;
const PROGRESO_PORTADA = 0.10;

/**
 * Busca rutas de Storage libres para el borrador. Si "Audios/<título>.mp3" ya
 * existe (archivo huérfano de una subida anterior, por ejemplo), prueba con
 * " (2)", " (3)"... para no sobrescribirlo.
 * @param {Object} draft
 * @returns {Promise<{audioPath: string, coverPath: string}>}
 */
async function rutasLibres(draft) {
    let paths = storagePathsFor(draft);
    for (let i = 2; i <= 9; i++) {
        const ocupado = await storageService.fileExists(paths.audioPath);
        if (!ocupado) return paths;
        paths = storagePathsFor(draft, ` (${i})`);
    }
    return paths;
}

/**
 * Sube una canción (audio + portada) y crea su documento en Firestore.
 *
 * Si falla la creación del documento, se borran los archivos ya subidos para
 * no dejar huérfanos en Storage. Si falla solo la portada, la canción se sube
 * igualmente sin portada (no es un error grave).
 *
 * @param {Object} draft - Borrador (ver song-upload-service.createDraft)
 * @param {Object} [options]
 * @param {Function} [options.onProgress] - (fraccion 0..1) → void
 * @returns {Promise<{songId: string, audioPath: string, coverPath: string}>}
 */
export async function uploadDraft(draft, { onProgress = null } = {}) {
    const report = (f) => { if (onProgress) onProgress(Math.max(0, Math.min(1, f))); };

    // 1. No subir dos veces la misma canción
    const existente = await firestoreService.findSongByTitle(draft.title);
    if (existente) {
        throw new Error(`Ya existe una canción con el título "${draft.title}"`);
    }

    // 2. Rutas en Storage (evitando pisar archivos existentes)
    const paths = await rutasLibres(draft);
    report(0.01);

    // 3. Audio
    const subidos = [];
    await storageService.uploadFile(draft.file, paths.audioPath, {
        contentType: draft.file.type || null,
        onProgress: (f) => report(f * PROGRESO_AUDIO)
    });
    subidos.push(paths.audioPath);

    // 4. Portada (opcional, no bloquea)
    let coverPath = '';
    if (draft.cover && draft.cover.blob && paths.coverPath) {
        try {
            await storageService.uploadFile(draft.cover.blob, paths.coverPath, {
                contentType: draft.cover.blob.type || null,
                onProgress: (f) => report(PROGRESO_AUDIO + f * PROGRESO_PORTADA)
            });
            coverPath = paths.coverPath;
            subidos.push(coverPath);
        } catch (error) {
            console.warn(`No se pudo subir la portada de "${draft.title}", se sube sin portada:`, error);
        }
    }
    report(PROGRESO_AUDIO + PROGRESO_PORTADA);

    try {
        // 5. Documentos auxiliares para que aparezca en los menús de filtro.
        //    No son críticos: si uno falla se avisa y se sigue con la canción.
        const auxiliares = [];
        if (draft.genre) auxiliares.push(firestoreService.ensureGenre(draft.genre));
        if (draft.source && draft.genre) auxiliares.push(firestoreService.ensureSource(draft.source, draft.genre));
        if (draft.artist) auxiliares.push(firestoreService.ensureArtist(draft.artist));
        const resultados = await Promise.allSettled(auxiliares);
        resultados
            .filter(r => r.status === 'rejected')
            .forEach(r => console.warn('No se pudo crear un documento auxiliar (género/source/artista):', r.reason));

        // 6. Documento de la canción
        const songId = await firestoreService.createSong(
            buildSongDocument(draft, { audioPath: paths.audioPath, coverPath })
        );
        report(1);
        return { songId, audioPath: paths.audioPath, coverPath };
    } catch (error) {
        // Limpiar lo subido para no dejar archivos sin canción
        await Promise.allSettled(subidos.map(p => storageService.deleteFile(p)));
        throw error;
    }
}

/**
 * Añade a cada playlist los títulos de los borradores ya subidos que la tengan
 * marcada (y que aún no se hayan añadido). Marca en cada borrador las
 * playlists completadas (`playlistsDone`) para no repetir en reintentos.
 *
 * @param {Object[]} drafts
 * @returns {Promise<{added: number, errors: Array<{playlistId: string, message: string}>}>}
 */
export async function addDraftsToPlaylists(drafts) {
    const grupos = groupTitlesByPlaylist(drafts);
    const resultado = { added: 0, errors: [] };

    for (const [playlistId, titles] of grupos) {
        try {
            await firestoreService.addSongsToPlaylist(playlistId, titles);
            resultado.added += titles.length;
            drafts.forEach(d => {
                if (d.status === STATUS.DONE && d.playlistIds.includes(playlistId)) {
                    d.playlistsDone = Array.from(new Set([...(d.playlistsDone || []), playlistId]));
                }
            });
        } catch (error) {
            console.error(`Error añadiendo canciones a la playlist ${playlistId}:`, error);
            resultado.errors.push({ playlistId, message: error.message || 'Error desconocido' });
        }
    }
    return resultado;
}
