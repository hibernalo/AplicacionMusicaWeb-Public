/**
 * Estadísticas de escucha por usuario: tiempo REAL que ha sonado cada
 * canción, artista, género y source.
 *
 * Cómo cuenta
 * -----------
 * El reproductor llama a beginSong(song) cuando arranca una canción y a
 * onTimeUpdate(currentTime) en cada evento 'timeupdate' del <audio>. Se suma
 * la diferencia entre dos posiciones consecutivas solo si es positiva y
 * pequeña (≤ MAX_DELTA_SECONDS): una pausa no genera 'timeupdate', y un salto
 * en la barra de progreso da una diferencia grande que se descarta. Así solo
 * cuenta audio que de verdad ha sonado. No hay contador de "veces": solo ms.
 *
 * Dónde se guarda
 * ---------------
 * users/{uid}/listeningStats/{docId} con docId = 'total' | 'YYYY-MM' | 'YYYY-MM-DD'.
 * Cada documento tiene los mapas { songs, artists, genres, sources } (clave →
 * milisegundos) y totalMs. Se escribe con set(merge) + FieldValue.increment,
 * sin leer antes: no hay carreras entre pestañas ni dispositivos.
 *
 * Fiabilidad
 * ----------
 * Lo escuchado se acumula en memoria (agrupado por día local) y se persiste en
 * localStorage. flush() mueve lo pendiente a un bloque "en vuelo" y lo escribe
 * en un único batch (día + mes + total). Si el commit falla, el bloque en vuelo
 * se conserva y se reintenta con el siguiente disparador. Si la pestaña muere,
 * al volver a cargar (mismo usuario) se reenvía lo que quedó sin confirmar.
 * Mientras hay un volcado en vuelo no se lanza otro: nada se cuenta dos veces.
 *
 * Sin dependencias: recibe db, increment, storage y reloj por el constructor.
 * El singleton real se construye en listening-stats.js.
 */

export const STORAGE_KEY = 'listeningStatsPending';
export const COLLECTION_NAME = 'listeningStats';
export const TOTAL_DOC_ID = 'total';
export const DIMENSIONS = ['songs', 'artists', 'genres', 'sources'];
export const UNKNOWN_LABEL = 'Desconocido';

const DEFAULT_MAX_DELTA_SECONDS = 2;
const DEFAULT_PERSIST_DEBOUNCE_MS = 3000;
const DEFAULT_PERIODIC_FLUSH_MS = 120000;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// ---------------------------------------------------------------------------
// Utilidades de fechas y formato (puras, exportadas para la vista y los tests)
// ---------------------------------------------------------------------------

function pad2(n) {
    return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' en hora local. */
export function dayKey(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 'YYYY-MM' en hora local. */
export function monthKey(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

/** 'YYYY-MM-DD' → 'YYYY-MM'. */
export function monthKeyFromDay(day) {
    return day.slice(0, 7);
}

/** Suma `delta` meses a una clave 'YYYY-MM'. */
export function shiftMonth(key, delta) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return monthKey(d);
}

/** Claves de los últimos `n` días (incluido `date`), de más antiguo a más nuevo. */
export function lastNDayKeys(n, date) {
    const keys = [];
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() - i);
        keys.push(dayKey(d));
    }
    return keys;
}

/** '0 min' | 'menos de 1 min' | '47 min' | '2 h 13 min'. */
export function formatDuration(ms) {
    if (!(ms > 0)) return '0 min';
    const totalMin = Math.floor(ms / 60000);
    if (totalMin < 1) return 'menos de 1 min';
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `${m} min`;
    return `${h} h ${m} min`;
}

/** 'YYYY-MM' → 'Septiembre 2026'. */
export function formatMonthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    const nombre = MESES[m - 1] || '';
    return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${y}`;
}

// ---------------------------------------------------------------------------
// Buckets: { songs: {}, artists: {}, genres: {}, sources: {}, totalMs: 0 }
// ---------------------------------------------------------------------------

function emptyBucket() {
    const b = { totalMs: 0 };
    DIMENSIONS.forEach(dim => { b[dim] = {}; });
    return b;
}

function addToMap(map, key, ms) {
    map[key] = (map[key] || 0) + ms;
}

/** Suma `src` sobre `dst` (in place) y devuelve `dst`. */
function accumulate(dst, src) {
    if (!src) return dst;
    DIMENSIONS.forEach(dim => {
        const m = src[dim];
        if (!m || typeof m !== 'object') return;
        Object.keys(m).forEach(key => {
            const ms = Number(m[key]);
            if (Number.isFinite(ms) && ms > 0) addToMap(dst[dim], key, ms);
        });
    });
    const t = Number(src.totalMs);
    if (Number.isFinite(t) && t > 0) dst.totalMs += t;
    return dst;
}

/** Fusiona dos mapas día → bucket en uno nuevo. */
function mergeDays(a, b) {
    const out = {};
    [a, b].forEach(days => {
        if (!days) return;
        Object.keys(days).forEach(day => {
            if (!out[day]) out[day] = emptyBucket();
            accumulate(out[day], days[day]);
        });
    });
    return out;
}

function isEmptyDays(days) {
    return !days || Object.keys(days).length === 0;
}

function labelOf(value) {
    if (value === null || value === undefined) return UNKNOWN_LABEL;
    const s = String(value).trim();
    return s === '' ? UNKNOWN_LABEL : s;
}

function rank(map) {
    return Object.keys(map)
        .map(key => ({ key, ms: map[key] }))
        .sort((x, y) => y.ms - x.ms || x.key.localeCompare(y.key));
}

// ---------------------------------------------------------------------------
// Servicio
// ---------------------------------------------------------------------------

export default class ListeningStatsService {
    /**
     * @param {Object} deps
     * @param {Object} deps.db - Firestore (API compat): collection().doc().collection(), batch()
     * @param {Function} deps.increment - n → FieldValue.increment(n)
     * @param {Function} [deps.documentIdField] - () → FieldPath.documentId() (para getFirstMonthKey)
     * @param {Object|null} [deps.storage] - localStorage o compatible (getItem/setItem/removeItem)
     * @param {Function} [deps.now] - () → Date
     * @param {Function} [deps.logger] - (mensaje) → void
     * @param {number} [deps.maxDeltaSeconds]
     * @param {number} [deps.persistDebounceMs]
     * @param {number} [deps.periodicFlushMs]
     * @param {Function} [deps.setTimeoutFn]
     * @param {Function} [deps.clearTimeoutFn]
     */
    constructor({
        db,
        increment,
        documentIdField = null,
        storage = null,
        now = () => new Date(),
        logger = () => {},
        maxDeltaSeconds = DEFAULT_MAX_DELTA_SECONDS,
        persistDebounceMs = DEFAULT_PERSIST_DEBOUNCE_MS,
        periodicFlushMs = DEFAULT_PERIODIC_FLUSH_MS,
        setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
        clearTimeoutFn = (id) => clearTimeout(id)
    }) {
        this.db = db;
        this.increment = increment;
        this.documentIdField = documentIdField;
        this.storage = storage;
        this.now = now;
        this.logger = logger;
        this.maxDeltaSeconds = maxDeltaSeconds;
        this.persistDebounceMs = persistDebounceMs;
        this.periodicFlushMs = periodicFlushMs;
        this.setTimeoutFn = setTimeoutFn;
        this.clearTimeoutFn = clearTimeoutFn;

        // Buffer del usuario actual. Se sustituye entero al cambiar de usuario
        // (los volcados en curso conservan su propia referencia).
        this.buffer = { userId: null, pending: {}, inFlight: null, flushing: false };

        this.currentSong = null;
        this.lastTime = null;
        this.persistTimer = null;
        this.lastFlushAttemptAt = this.now().getTime();
        this.firstMonthCache = null;
    }

    // ----- sesión -----------------------------------------------------------

    getUserId() {
        return this.buffer.userId;
    }

    /**
     * Cambia el usuario. Envía lo pendiente del anterior (sin esperar),
     * recupera de localStorage lo que quedó sin confirmar del nuevo (si es el
     * mismo uid) y lo envía. Con null se deja de contar.
     * @param {string|null} userId
     */
    setUserId(userId) {
        const uid = userId || null;
        if (this.buffer.userId === uid) return;

        const previous = this.buffer;
        if (previous.userId && (!isEmptyDays(previous.pending) || !isEmptyDays(previous.inFlight))) {
            this.flushBuffer(previous);
        }

        this.buffer = { userId: uid, pending: {}, inFlight: null, flushing: false };
        this.lastTime = null;
        this.firstMonthCache = null;

        if (uid) {
            const stored = this.loadStored();
            if (stored && stored.userId === uid) {
                // Lo que estaba "en vuelo" al morir la pestaña nunca se confirmó:
                // vuelve a pendiente y se reenvía.
                this.buffer.pending = mergeDays(stored.pending, stored.inFlight);
                if (!isEmptyDays(this.buffer.pending)) {
                    this.logger(`recuperados ${Object.keys(this.buffer.pending).length} día(s) pendientes de localStorage`);
                }
            } else if (stored && stored.userId && stored.userId !== uid) {
                this.logger('pendiente de otro usuario descartado');
            }
            this.persistNow();
            this.flushBuffer(this.buffer);
        } else {
            this.persistNow();
        }
    }

    // ----- captura ----------------------------------------------------------

    /**
     * Canción que empieza a sonar: todo lo que se sume a partir de ahora se
     * atribuye a ella. Llamar ANTES del primer 'timeupdate' de la canción.
     * @param {Object|null} song
     */
    beginSong(song) {
        this.currentSong = song || null;
        this.lastTime = null;
    }

    /**
     * Posición actual del <audio> (segundos). Síncrono y sin red.
     * @param {number} currentTime
     */
    onTimeUpdate(currentTime) {
        if (typeof currentTime !== 'number' || !Number.isFinite(currentTime)) return;
        const last = this.lastTime;
        this.lastTime = currentTime;
        if (last === null) return;
        if (!this.buffer.userId || !this.currentSong) return;

        const delta = currentTime - last;
        if (delta <= 0 || delta > this.maxDeltaSeconds) return;

        this.addListenedTime(this.currentSong, Math.round(delta * 1000), this.now());
        this.maybePeriodicFlush();
    }

    /**
     * Suma `ms` escuchados de `song` al día de `date`.
     * @param {Object} song
     * @param {number} ms
     * @param {Date} [date]
     */
    addListenedTime(song, ms, date = this.now()) {
        if (!this.buffer.userId || !song || !song.id || !(ms > 0)) return;
        const key = dayKey(date);
        const pending = this.buffer.pending;
        if (!pending[key]) pending[key] = emptyBucket();
        const bucket = pending[key];
        addToMap(bucket.songs, String(song.id), ms);
        addToMap(bucket.artists, labelOf(song.artist), ms);
        addToMap(bucket.genres, labelOf(song.genre), ms);
        addToMap(bucket.sources, labelOf(song.source), ms);
        bucket.totalMs += ms;
        this.schedulePersist();
    }

    hasUnsent() {
        return !isEmptyDays(this.buffer.pending) || !isEmptyDays(this.buffer.inFlight);
    }

    /** Copia fusionada de lo que aún no ha confirmado Firestore (día → bucket). */
    getUnsentDays() {
        return mergeDays(this.buffer.pending, this.buffer.inFlight);
    }

    /**
     * Lo que hay que SUMAR a una lectura de Firestore para que refleje todo lo
     * escuchado. Firestore aplica compensación de latencia: un get() ya incluye
     * las escrituras entregadas al SDK aunque el servidor no las haya
     * confirmado. Por eso, mientras hay un volcado en vuelo, su bloque NO se
     * superpone (ya está en la lectura); sí se superpone lo pendiente que aún
     * no se ha enviado y un bloque en vuelo que falló y espera reintento.
     */
    getOverlayDays() {
        return mergeDays(this.buffer.pending, this.buffer.flushing ? null : this.buffer.inFlight);
    }

    maybePeriodicFlush() {
        if (this.now().getTime() - this.lastFlushAttemptAt >= this.periodicFlushMs) {
            this.flush();
        }
    }

    // ----- persistencia local -----------------------------------------------

    schedulePersist() {
        if (!this.storage) return;
        if (this.persistTimer !== null) return;
        this.persistTimer = this.setTimeoutFn(() => {
            this.persistTimer = null;
            this.persistNow();
        }, this.persistDebounceMs);
    }

    persistNow() {
        if (!this.storage) return;
        if (this.persistTimer !== null) {
            this.clearTimeoutFn(this.persistTimer);
            this.persistTimer = null;
        }
        const b = this.buffer;
        try {
            if (!b.userId || (isEmptyDays(b.pending) && isEmptyDays(b.inFlight))) {
                this.storage.removeItem(STORAGE_KEY);
            } else {
                this.storage.setItem(STORAGE_KEY, JSON.stringify({
                    userId: b.userId,
                    pending: b.pending,
                    inFlight: b.inFlight
                }));
            }
        } catch (error) {
            // Sin almacenamiento disponible: seguir solo en memoria
        }
    }

    loadStored() {
        if (!this.storage) return null;
        try {
            const raw = this.storage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            return {
                userId: parsed.userId || null,
                pending: parsed.pending && typeof parsed.pending === 'object' ? parsed.pending : {},
                inFlight: parsed.inFlight && typeof parsed.inFlight === 'object' ? parsed.inFlight : null
            };
        } catch (error) {
            return null;
        }
    }

    // ----- volcado a Firestore ----------------------------------------------

    /**
     * Envía lo pendiente del usuario actual. Nunca lanza.
     * @returns {Promise<boolean>} true si Firestore confirmó la escritura
     */
    flush() {
        return this.flushBuffer(this.buffer);
    }

    async flushBuffer(buffer) {
        if (!buffer.userId || buffer.flushing) return false;
        if (isEmptyDays(buffer.pending) && isEmptyDays(buffer.inFlight)) return false;

        this.lastFlushAttemptAt = this.now().getTime();
        buffer.inFlight = mergeDays(buffer.inFlight, buffer.pending);
        buffer.pending = {};
        buffer.flushing = true;
        if (buffer === this.buffer) this.persistNow();

        const dias = Object.keys(buffer.inFlight);
        try {
            await this.writeDays(buffer.userId, buffer.inFlight);
            buffer.inFlight = null;
            this.logger(`volcado ok (${dias.join(', ')})`);
            return true;
        } catch (error) {
            const msg = error && (error.message || error.code || error);
            this.logger(`ERROR volcado (${dias.join(', ')}): ${msg}; se reintentará`);
            if (buffer !== this.buffer) {
                this.logger('volcado de un usuario anterior perdido (ya no es el usuario activo)');
            }
            return false;
        } finally {
            buffer.flushing = false;
            if (buffer === this.buffer) this.persistNow();
        }
    }

    /**
     * Escribe `days` (día → bucket) en un solo batch: por cada día, su
     * documento diario, su mensual y el total, todos con increment.
     */
    async writeDays(userId, days) {
        const docs = {};
        Object.keys(days).forEach(day => {
            [day, monthKeyFromDay(day), TOTAL_DOC_ID].forEach(id => {
                if (!docs[id]) docs[id] = emptyBucket();
                accumulate(docs[id], days[day]);
            });
        });

        const col = this.collectionRef(userId);
        const batch = this.db.batch();
        Object.keys(docs).forEach(id => {
            const bucket = docs[id];
            const data = { totalMs: this.increment(bucket.totalMs) };
            DIMENSIONS.forEach(dim => {
                const keys = Object.keys(bucket[dim]);
                if (keys.length === 0) return;
                data[dim] = {};
                keys.forEach(key => { data[dim][key] = this.increment(bucket[dim][key]); });
            });
            batch.set(col.doc(id), data, { merge: true });
        });
        await batch.commit();
    }

    collectionRef(userId) {
        return this.db.collection('users').doc(userId).collection(COLLECTION_NAME);
    }

    // ----- lectura ----------------------------------------------------------

    /**
     * Estadísticas de un periodo, ya ordenadas de mayor a menor. Incluye lo
     * que aún no ha confirmado Firestore (para que lo que acaba de sonar
     * aparezca aunque no haya red).
     * @param {Object} opts
     * @param {'7d'|'month'|'total'} opts.period
     * @param {string} [opts.month] - 'YYYY-MM' (solo para period = 'month')
     * @returns {Promise<{totalMs:number, songs:Array, artists:Array, genres:Array, sources:Array}|null>}
     *   null si no hay usuario
     */
    async getPeriodStats({ period, month = null }) {
        const uid = this.buffer.userId;
        if (!uid) return null;

        const hoy = this.now();
        let docIds;
        let matchesDay;
        if (period === 'total') {
            docIds = [TOTAL_DOC_ID];
            matchesDay = () => true;
        } else if (period === 'month') {
            const key = month || monthKey(hoy);
            docIds = [key];
            matchesDay = (day) => monthKeyFromDay(day) === key;
        } else {
            docIds = lastNDayKeys(7, hoy);
            matchesDay = (day) => docIds.includes(day);
        }

        const col = this.collectionRef(uid);
        const snaps = await Promise.all(docIds.map(id => col.doc(id).get()));

        const merged = emptyBucket();
        snaps.forEach(snap => {
            if (snap && snap.exists) accumulate(merged, snap.data());
        });
        const overlay = this.getOverlayDays();
        Object.keys(overlay).forEach(day => {
            if (matchesDay(day)) accumulate(merged, overlay[day]);
        });

        const result = { totalMs: merged.totalMs };
        DIMENSIONS.forEach(dim => { result[dim] = rank(merged[dim]); });
        return result;
    }

    /**
     * Primer mes con datos ('YYYY-MM'), para limitar la flecha ◀ de la vista.
     * Se cachea por sesión. Si no se puede consultar, devuelve el mes actual.
     * @returns {Promise<string>}
     */
    async getFirstMonthKey() {
        const uid = this.buffer.userId;
        const actual = monthKey(this.now());
        if (!uid) return actual;
        if (this.firstMonthCache) return this.firstMonthCache;

        let first = null;
        if (this.documentIdField) {
            try {
                const fieldPath = this.documentIdField();
                const snap = await this.collectionRef(uid)
                    .where(fieldPath, '>=', '0000-00')
                    .where(fieldPath, '<=', '9999-99')
                    .orderBy(fieldPath)
                    .limit(1)
                    .get();
                if (snap && snap.docs && snap.docs.length > 0) {
                    first = monthKeyFromDay(snap.docs[0].id);
                }
            } catch (error) {
                this.logger(`ERROR consultando primer mes: ${error && (error.message || error)}`);
            }
        }
        // Lo no enviado también puede ser anterior (raro, pero barato de cubrir)
        Object.keys(this.getUnsentDays()).forEach(day => {
            const m = monthKeyFromDay(day);
            if (!first || m < first) first = m;
        });

        this.firstMonthCache = first && first <= actual ? first : actual;
        return this.firstMonthCache;
    }
}
