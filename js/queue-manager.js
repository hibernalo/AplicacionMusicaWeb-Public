const STORAGE_KEY = 'musicQueue';

/**
 * Gestor de la cola de reproducción manual.
 * Prioridad LIFO: la última canción añadida suena primero.
 * Implementado como pila sobre un array: unshift() al añadir, shift() al reproducir.
 * Persiste en localStorage (por navegador).
 */
class QueueManager {
    constructor() {
        this.queue = []; // array de objetos canción completos
        this.restore();
    }

    /**
     * Añade una canción al PRINCIPIO de la cola (LIFO).
     * Si ya estaba en la cola, la mueve al principio.
     * @param {Object} song - Objeto canción completo (con id, audioPath, etc.)
     */
    add(song) {
        if (!song || !song.id) return;
        // Evitar duplicados: si ya está, quitarla antes de re-insertar al frente
        this.queue = this.queue.filter(s => s.id !== song.id);
        this.queue.unshift(song);
        this.persist();
        this.dispatchChange();
    }

    /**
     * Saca y devuelve la primera canción de la cola (la que suena a continuación).
     * @returns {Object|null} Canción o null si la cola está vacía
     */
    takeNext() {
        if (this.queue.length === 0) return null;
        const next = this.queue.shift();
        this.persist();
        this.dispatchChange();
        return next;
    }

    /**
     * Salta a una canción de la cola: la devuelve y descarta esa y todas las
     * anteriores a ella. El resto permanece.
     * @param {string} songId - ID de la canción objetivo
     * @returns {Object|null} Canción objetivo o null si no está en la cola
     */
    jumpTo(songId) {
        const index = this.queue.findIndex(s => s.id === songId);
        if (index === -1) return null;
        const target = this.queue[index];
        this.queue = this.queue.slice(index + 1);
        this.persist();
        this.dispatchChange();
        return target;
    }

    /**
     * Reordena la cola: mueve el elemento de fromIndex a toIndex.
     * @param {number} fromIndex
     * @param {number} toIndex
     */
    move(fromIndex, toIndex) {
        const len = this.queue.length;
        if (fromIndex < 0 || fromIndex >= len) return;
        if (toIndex < 0 || toIndex >= len) return;
        if (fromIndex === toIndex) return;
        const [item] = this.queue.splice(fromIndex, 1);
        this.queue.splice(toIndex, 0, item);
        this.persist();
        this.dispatchChange();
    }

    /**
     * Quita una canción concreta de la cola sin reproducirla.
     * @param {string} songId - ID de la canción a quitar
     */
    remove(songId) {
        const before = this.queue.length;
        this.queue = this.queue.filter(s => s.id !== songId);
        if (this.queue.length !== before) {
            this.persist();
            this.dispatchChange();
        }
    }

    /** Vacía la cola por completo. */
    clear() {
        if (this.queue.length === 0) return;
        this.queue = [];
        this.persist();
        this.dispatchChange();
    }

    /** @returns {Array} Copia del array de la cola. */
    getQueue() {
        return [...this.queue];
    }

    /** @returns {boolean} true si la cola está vacía. */
    isEmpty() {
        return this.queue.length === 0;
    }

    /** Guarda la cola en localStorage. */
    persist() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
        } catch (error) {
            console.error('QueueManager: error guardando la cola', error);
        }
    }

    /** Restaura la cola desde localStorage (tolerante a JSON corrupto). */
    restore() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                this.queue = Array.isArray(parsed) ? parsed : [];
            }
        } catch (error) {
            console.error('QueueManager: error restaurando la cola, se vacía', error);
            this.queue = [];
        }
    }

    /** Emite el evento queueChanged para que la UI se redibuje. */
    dispatchChange() {
        const event = new CustomEvent('queueChanged', { detail: { queue: this.getQueue() } });
        document.dispatchEvent(event);
    }
}

// Singleton, igual que el resto de servicios del proyecto
const queueManager = new QueueManager();
export default queueManager;
