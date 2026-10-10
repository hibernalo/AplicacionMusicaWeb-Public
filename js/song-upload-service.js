/**
 * Lógica pura de la subida de canciones desde la web (sin DOM, sin Firebase).
 *
 * Trabaja con "borradores" (drafts): un objeto por archivo de audio elegido,
 * con los metadatos leídos del propio archivo (o deducidos del nombre) y los
 * datos que el usuario va corrigiendo antes de subir. Aquí viven las reglas
 * para deducir título/artista del nombre de archivo, aplicar cambios en bloque
 * a varios borradores, validar y construir el documento de Firestore.
 *
 * No importa nada: se puede probar con `node test/song-upload-service.test.js`.
 */

export const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.ogg', '.wav', '.flac', '.aac', '.opus', '.webm'];
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const STATUS = {
    PENDING: 'pendiente',
    UPLOADING: 'subiendo',
    DONE: 'subida',
    ERROR: 'error'
};

// Sufijo que yt-dlp añade con el id del vídeo: "...-PfKVlVbUQjc"
const ID_YOUTUBE = /-[A-Za-z0-9_-]{11}$/;
// Marcas de los títulos de YouTube que no forman parte del nombre de la canción:
// "(Official Video)", "[MV]", "(Offizielles Video)", "(Lyrics)"...
const MARCAS_VIDEO = /\s*[([](?:official\s+|offizielles\s+|oficial\s+)?(?:music\s+)?(?:video(?:\s*oficial)?|audio|lyrics?(?:\s+video)?|mv|visualizer)\s*[)\]]/gi;

let nextDraftId = 1;

/**
 * Devuelve la extensión (con punto, en minúsculas) de un nombre de archivo.
 * @param {string} fileName
 * @returns {string} p. ej. ".mp3" o "" si no tiene
 */
export function fileExtension(fileName) {
    const name = String(fileName || '');
    const idx = name.lastIndexOf('.');
    if (idx <= 0 || idx === name.length - 1) return '';
    return name.slice(idx).toLowerCase();
}

/**
 * Nombre de archivo sin extensión.
 * @param {string} fileName
 * @returns {string}
 */
export function baseName(fileName) {
    const name = String(fileName || '');
    const ext = fileExtension(name);
    return ext ? name.slice(0, -ext.length) : name;
}

/**
 * ¿Es un archivo de audio? Se mira la extensión y, si no, el tipo MIME.
 * @param {{name: string, type?: string}} file
 * @returns {boolean}
 */
export function isAudioFile(file) {
    if (!file) return false;
    if (AUDIO_EXTENSIONS.includes(fileExtension(file.name))) return true;
    return typeof file.type === 'string' && file.type.startsWith('audio/');
}

/**
 * Quita del título las marcas que añaden los descargadores, p. ej. " (SPOTISAVER)".
 * @param {string} title
 * @returns {string}
 */
export function limpiarTitulo(title) {
    return String(title || '').replace(/\s*\(SPOTISAVER\)/gi, '').replace(/\s+/g, ' ').trim();
}

/**
 * Quita del nombre de archivo el id de YouTube y las marcas de vídeo.
 * @param {string} audioBaseName - nombre sin extensión
 * @returns {string}
 */
export function limpiarNombreArchivo(audioBaseName) {
    return String(audioBaseName || '')
        .replace(ID_YOUTUBE, '')
        .replace(MARCAS_VIDEO, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Deduce artista y título de un nombre "Artista - Título". Corta por el primer
 * " - "; si no lo hay, devuelve el nombre entero como título y sin artista.
 * @param {string} audioBaseName - nombre sin extensión
 * @returns {{artist: string|null, title: string}}
 */
export function separarArtistaTitulo(audioBaseName) {
    const limpio = limpiarNombreArchivo(audioBaseName);
    const corte = limpio.indexOf(' - ');
    if (corte === -1) return { artist: null, title: limpio };
    return {
        artist: limpio.slice(0, corte).trim() || null,
        title: limpio.slice(corte + 3).trim() || limpio
    };
}

/**
 * Deduce la extensión de una carátula embebida. Se mira primero el MIME que
 * declara el tag y, si no sirve, los primeros bytes (hay archivos que declaran
 * el formato vacío o mal).
 * @param {string} format - MIME declarado (p. ej. "image/jpeg")
 * @param {Uint8Array|number[]|null} data - bytes de la imagen
 * @returns {string|null} ".jpg" | ".png" | ".webp" | null
 */
export function coverExtension(format, data) {
    const mime = String(format || '').toLowerCase();
    if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
    if (mime.includes('png')) return '.png';
    if (mime.includes('webp')) return '.webp';

    const b = data || [];
    if (b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return '.jpg';
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return '.png';
    if (b.length > 12 &&
        b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return '.webp';
    return null;
}

/**
 * Extensión para una imagen elegida por el usuario (por MIME o por nombre).
 * @param {{name?: string, type?: string}} file
 * @returns {string|null}
 */
export function imageExtension(file) {
    if (!file) return null;
    const porMime = coverExtension(file.type, null);
    if (porMime) return porMime;
    const ext = fileExtension(file.name);
    if (ext === '.jpeg') return '.jpg';
    if (['.jpg', '.png', '.webp'].includes(ext)) return ext;
    return null;
}

/**
 * Normaliza un año: entero entre 1000 y 2999, o null.
 * @param {*} value
 * @returns {number|null}
 */
export function normalizeYear(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = parseInt(String(value).trim().slice(0, 4), 10);
    if (!Number.isFinite(n) || n < 1000 || n > 2999) return null;
    return n;
}

/**
 * Busca un género de la app que coincida (sin distinguir mayúsculas) con el
 * género que trae el tag del archivo. Devuelve el nombre tal y como está en la
 * app, o '' si no hay coincidencia (no se inventan géneros desde los tags).
 * @param {string|string[]|null} tagGenre
 * @param {Array<{key: string}>} appGenres
 * @returns {string}
 */
export function matchGenre(tagGenre, appGenres) {
    const candidatos = (Array.isArray(tagGenre) ? tagGenre : [tagGenre])
        .map(g => String(g || '').trim().toLowerCase())
        .filter(Boolean);
    if (candidatos.length === 0) return '';
    for (const c of candidatos) {
        const hit = (appGenres || []).find(g => String(g.key || '').trim().toLowerCase() === c);
        if (hit) return hit.key;
    }
    return '';
}

/**
 * Crea un borrador a partir de un archivo y de sus metadatos leídos.
 * @param {Object} params
 * @param {File|{name: string, size?: number, type?: string}} params.file
 * @param {Object} [params.metadata] - { title, artist, album, year, genre, durationMs, picture: {blob, ext}|null }
 * @param {Array<{key: string}>} [params.appGenres] - géneros existentes (para casar el del tag)
 * @param {boolean} [params.splitFilename=true] - deducir "Artista - Título" del nombre
 * @returns {Object} draft
 */
export function createDraft({ file, metadata = null, appGenres = [], splitFilename = true }) {
    const md = metadata || {};
    const nombreBase = baseName(file.name);
    const desdeNombre = splitFilename
        ? separarArtistaTitulo(nombreBase)
        : { artist: null, title: limpiarNombreArchivo(nombreBase) };

    const title = limpiarTitulo(md.title || desdeNombre.title || nombreBase);
    const artist = String(md.artist || desdeNombre.artist || '').trim();

    return {
        id: `draft-${nextDraftId++}`,
        file,
        fileName: file.name,
        fileSize: file.size || 0,
        ext: fileExtension(file.name) || '.mp3',
        title,
        artist,
        album: String(md.album || '').trim(),
        year: normalizeYear(md.year),
        genre: matchGenre(md.genre, appGenres),
        source: '',
        playlistIds: [],
        cover: md.picture || null,         // { blob, ext } | null
        durationMs: Number.isFinite(md.durationMs) ? Math.round(md.durationMs) : null,
        metadataRead: Boolean(metadata && (md.title || md.artist || md.album || md.year || md.durationMs)),
        status: STATUS.PENDING,
        progress: 0,
        error: null,
        songId: null
    };
}

/**
 * Aplica cambios a varios borradores a la vez. Un campo vacío/undefined no se
 * toca; así se puede poner el mismo género a 15 canciones sin pisar el resto.
 *
 * @param {Object[]} drafts - todos los borradores
 * @param {string[]} ids - ids de los borradores a modificar
 * @param {Object} changes
 * @param {string} [changes.title] - solo tiene sentido con un único borrador
 * @param {string} [changes.artist]
 * @param {string} [changes.album]
 * @param {number|string} [changes.year]
 * @param {string} [changes.genre]
 * @param {string} [changes.source]
 * @param {{blob: Blob, ext: string}|null} [changes.cover] - undefined = sin cambios
 * @param {{add?: string[], remove?: string[]}} [changes.playlists]
 * @returns {number} cuántos borradores se han modificado
 */
export function applyBulkChanges(drafts, ids, changes) {
    const objetivo = new Set(ids || []);
    const c = changes || {};
    const texto = (v) => (typeof v === 'string' ? v.trim() : '');
    const add = (c.playlists && c.playlists.add) || [];
    const remove = new Set((c.playlists && c.playlists.remove) || []);
    let modificados = 0;

    for (const d of drafts) {
        if (!objetivo.has(d.id) || d.status === STATUS.DONE || d.status === STATUS.UPLOADING) continue;
        let cambio = false;

        if (texto(c.title) && objetivo.size === 1) { d.title = limpiarTitulo(c.title); cambio = true; }
        if (texto(c.artist)) { d.artist = texto(c.artist); cambio = true; }
        if (texto(c.album)) { d.album = texto(c.album); cambio = true; }
        const year = normalizeYear(c.year);
        if (year !== null) { d.year = year; cambio = true; }
        if (texto(c.genre)) {
            // Al cambiar de género, el source anterior (de otro género) deja de valer
            if (d.genre !== texto(c.genre) && d.source && !texto(c.source)) d.source = '';
            d.genre = texto(c.genre);
            cambio = true;
        }
        if (texto(c.source)) { d.source = texto(c.source); cambio = true; }
        if (c.cover !== undefined) { d.cover = c.cover; cambio = true; }

        if (add.length || remove.size) {
            const set = new Set(d.playlistIds);
            add.forEach(id => set.add(id));
            remove.forEach(id => set.delete(id));
            d.playlistIds = Array.from(set);
            cambio = true;
        }

        if (cambio) {
            modificados++;
            // Un cambio de datos invalida un error anterior (se podrá reintentar)
            if (d.status === STATUS.ERROR) { d.status = STATUS.PENDING; d.error = null; d.progress = 0; }
        }
    }
    return modificados;
}

/**
 * Sustituye por completo los campos editables de UN borrador (edición individual).
 * A diferencia de applyBulkChanges, aquí un valor vacío sí vacía el campo.
 * @param {Object} draft
 * @param {Object} values - { title, artist, album, year, genre, source, playlistIds, cover }
 * @returns {Object} el mismo borrador
 */
export function setDraftValues(draft, values) {
    const v = values || {};
    const texto = (x) => (x === null || x === undefined ? '' : String(x).trim());
    if (v.title !== undefined) draft.title = limpiarTitulo(v.title) || draft.title;
    if (v.artist !== undefined) draft.artist = texto(v.artist);
    if (v.album !== undefined) draft.album = texto(v.album);
    if (v.year !== undefined) draft.year = normalizeYear(v.year);
    if (v.genre !== undefined) draft.genre = texto(v.genre);
    if (v.source !== undefined) draft.source = texto(v.source);
    if (!draft.genre) draft.source = '';
    if (Array.isArray(v.playlistIds)) draft.playlistIds = Array.from(new Set(v.playlistIds));
    if (v.cover !== undefined) draft.cover = v.cover;
    if (draft.status === STATUS.ERROR) { draft.status = STATUS.PENDING; draft.error = null; draft.progress = 0; }
    return draft;
}

/**
 * Estado de la casilla de una playlist para un grupo de borradores.
 * @param {Object[]} drafts
 * @param {string[]} ids
 * @param {string} playlistId
 * @returns {'all'|'some'|'none'}
 */
export function playlistCheckboxState(drafts, ids, playlistId) {
    const objetivo = drafts.filter(d => ids.includes(d.id));
    if (objetivo.length === 0) return 'none';
    const con = objetivo.filter(d => d.playlistIds.includes(playlistId)).length;
    if (con === 0) return 'none';
    return con === objetivo.length ? 'all' : 'some';
}

/**
 * Valor común de un campo entre varios borradores ('' si difieren o está vacío).
 * @param {Object[]} drafts
 * @param {string[]} ids
 * @param {string} field
 * @returns {string}
 */
export function commonValue(drafts, ids, field) {
    const objetivo = drafts.filter(d => ids.includes(d.id));
    if (objetivo.length === 0) return '';
    const norm = (x) => (x === null || x === undefined ? '' : String(x));
    const valor = norm(objetivo[0][field]);
    return objetivo.every(d => norm(d[field]) === valor) ? valor : '';
}

/**
 * Títulos repetidos dentro del propio lote (en minúsculas).
 * @param {Object[]} drafts
 * @returns {Set<string>}
 */
export function duplicateTitlesInBatch(drafts) {
    const vistos = new Map();
    for (const d of drafts) {
        const k = String(d.title || '').trim().toLowerCase();
        if (!k) continue;
        vistos.set(k, (vistos.get(k) || 0) + 1);
    }
    return new Set(Array.from(vistos.entries()).filter(([, n]) => n > 1).map(([k]) => k));
}

/**
 * Valida un borrador antes de subirlo.
 * @param {Object} draft
 * @param {Object} [ctx]
 * @param {Set<string>} [ctx.duplicates] - títulos repetidos en el lote (minúsculas)
 * @returns {string[]} lista de problemas (vacía si es válido)
 */
export function validateDraft(draft, ctx = {}) {
    const errores = [];
    const title = String(draft.title || '').trim();
    if (!title) errores.push('El título no puede estar vacío');
    if (title.length > 200) errores.push('El título es demasiado largo (máx. 200 caracteres)');
    if (ctx.duplicates && ctx.duplicates.has(title.toLowerCase())) {
        errores.push('Hay otra canción con el mismo título en este lote');
    }
    if (draft.source && !draft.genre) {
        errores.push('Para asignar un source hay que elegir también el género');
    }
    return errores;
}

/**
 * Nombre de archivo seguro para Storage a partir del título (se mantiene
 * legible: solo se quitan separadores de ruta y caracteres problemáticos).
 * @param {string} title
 * @returns {string}
 */
export function storageFileName(title) {
    const limpio = String(title || '')
        .replace(/[\\/]/g, '-')
        .replace(/[#[\]*?<>:"|]/g, '')
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return limpio || 'cancion';
}

/**
 * Rutas de Storage para el audio y la portada de un borrador, siguiendo la
 * convención del script de subida (Audios/<título>.<ext>, Covers/<título>.<ext>).
 * @param {Object} draft
 * @param {string} [suffix] - sufijo para evitar colisiones, p. ej. " (2)"
 * @returns {{audioPath: string, coverPath: string}}
 */
export function storagePathsFor(draft, suffix = '') {
    const nombre = storageFileName(draft.title) + suffix;
    return {
        audioPath: `Audios/${nombre}${draft.ext || '.mp3'}`,
        coverPath: draft.cover ? `Covers/${nombre}${draft.cover.ext || '.jpg'}` : ''
    };
}

/**
 * Construye el documento de la colección `songs` para un borrador ya subido.
 * `createdAt` lo añade la capa de Firestore (serverTimestamp).
 * @param {Object} draft
 * @param {{audioPath: string, coverPath: string, rand?: number}} paths
 * @returns {Object}
 */
export function buildSongDocument(draft, { audioPath, coverPath, rand = Math.random() }) {
    const title = String(draft.title || '').trim();
    const doc = {
        title,
        titleMinusculas: title.toLowerCase(),
        artist: String(draft.artist || '').trim(),
        album: String(draft.album || '').trim(),
        year: normalizeYear(draft.year),
        genre: String(draft.genre || '').trim(),
        source: String(draft.source || '').trim(),
        audioPath,
        coverPath: coverPath || '',
        rand,
        liked: false
    };
    if (Number.isFinite(draft.durationMs) && draft.durationMs > 0) {
        doc.durationMs = Math.round(draft.durationMs);
    }
    return doc;
}

/**
 * Agrupa, por playlist, los títulos de los borradores ya subidos que aún no
 * se han añadido a esa playlist.
 * @param {Object[]} drafts
 * @returns {Map<string, string[]>} playlistId → títulos
 */
export function groupTitlesByPlaylist(drafts) {
    const mapa = new Map();
    for (const d of drafts) {
        if (d.status !== STATUS.DONE) continue;
        const hechas = new Set(d.playlistsDone || []);
        for (const pid of d.playlistIds || []) {
            if (hechas.has(pid)) continue;
            if (!mapa.has(pid)) mapa.set(pid, []);
            const lista = mapa.get(pid);
            if (!lista.includes(d.title)) lista.push(d.title);
        }
    }
    return mapa;
}

/**
 * Resumen de estados de un lote.
 * @param {Object[]} drafts
 * @returns {{total: number, pending: number, uploading: number, done: number, error: number}}
 */
export function summarize(drafts) {
    const r = { total: drafts.length, pending: 0, uploading: 0, done: 0, error: 0 };
    for (const d of drafts) {
        if (d.status === STATUS.PENDING) r.pending++;
        else if (d.status === STATUS.UPLOADING) r.uploading++;
        else if (d.status === STATUS.DONE) r.done++;
        else if (d.status === STATUS.ERROR) r.error++;
    }
    return r;
}

/**
 * Formatea una duración en ms como m:ss.
 * @param {number|null} ms
 * @returns {string}
 */
export function formatDurationMs(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const total = Math.round(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Formatea un tamaño en bytes.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
