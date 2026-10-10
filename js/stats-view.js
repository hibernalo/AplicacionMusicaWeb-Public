/**
 * Vista "Estadísticas": rankings de tiempo escuchado por canción, artista,
 * género y source en tres pestañas (últimos 7 días / mes / total), con flechas
 * para recorrer meses anteriores.
 *
 * Se pinta dentro del contenedor #songList ocupando todo el ancho. Igual que
 * las tarjetas de filtro, desaparece cuando la siguiente vista vacía el
 * contenedor (renderSongs / showFilterItems), así que no necesita "cerrarse".
 *
 * Solo DOM: los datos vienen de ListeningStatsService y las acciones
 * (reproducir, abrir un filtro, pedir login, indicador de carga) se delegan
 * por callbacks. No importa ningún módulo con estado.
 */
import {
    formatDuration,
    formatMonthLabel,
    monthKey,
    shiftMonth,
    UNKNOWN_LABEL
} from './listening-stats-service.js';

const TOP_N = 10;

const PERIODS = [
    { id: '7d', label: 'Últimos 7 días' },
    { id: 'month', label: 'Este mes' },
    { id: 'total', label: 'Total' }
];

// `icon` es el relleno de la miniatura mientras no hay portada (o si no existe)
const SECTIONS = [
    { dim: 'songs', titulo: 'Canciones', filterType: null, icon: '🎧' },
    { dim: 'artists', titulo: 'Artistas', filterType: 'artist', icon: '👤' },
    { dim: 'genres', titulo: 'Géneros', filterType: 'genre', icon: '🎵' },
    { dim: 'sources', titulo: 'Sources', filterType: 'source', icon: '📁' }
];

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export default class StatsView {
    /**
     * @param {Object} deps
     * @param {HTMLElement} deps.container - Contenedor donde pintar (#songList)
     * @param {Object} deps.service - ListeningStatsService
     * @param {Function} deps.getSongById - (id) → Promise<song|null>
     * @param {Function} deps.onPlaySong - (song) → void
     * @param {Function} deps.onOpenFilter - (filterType, filterValue) → void
     * @param {Function} deps.onRequestLogin - () → void
     * @param {Function} [deps.getCoverUrl] - (coverPath) → Promise<url> (miniaturas)
     * @param {Function} [deps.getItemCoverPath] - (filterType, nombre) → Promise<coverPath|null>
     *   para la portada de un artista/género/source
     * @param {Function} [deps.showLoading]
     * @param {Function} [deps.hideLoading]
     * @param {Function} [deps.now] - () → Date
     */
    constructor({
        container,
        service,
        getSongById,
        onPlaySong,
        onOpenFilter,
        onRequestLogin,
        getCoverUrl = null,
        getItemCoverPath = null,
        showLoading = () => {},
        hideLoading = () => {},
        now = () => new Date()
    }) {
        this.container = container;
        this.service = service;
        this.getSongById = getSongById;
        this.onPlaySong = onPlaySong;
        this.onOpenFilter = onOpenFilter;
        this.onRequestLogin = onRequestLogin;
        this.getCoverUrl = getCoverUrl;
        this.getItemCoverPath = getItemCoverPath;
        this.showLoading = showLoading;
        this.hideLoading = hideLoading;
        this.now = now;

        // Cachés de miniaturas por sesión (guardan promesas: evitan pedir dos
        // veces lo mismo aunque se solicite en paralelo)
        this.coverUrlCache = new Map();       // coverPath → Promise<url|null>
        this.itemCoverPathCache = new Map();  // 'tipo:nombre' → Promise<coverPath|null>

        this.period = '7d';
        this.month = monthKey(this.now());
        this.firstMonth = null;      // primer mes con datos ('YYYY-MM'), se consulta una vez
        this.lastTotalMs = null;     // resumen de la última carga (null = cargando)
        this.songCache = new Map();  // id → song | null (canción borrada)
        this.root = null;
        this.header = null;
        this.body = null;
        this.loadToken = 0;          // descarta respuestas de cargas antiguas
    }

    /** Pinta la vista (o la repinta) y carga el periodo actual. */
    show() {
        this.container.innerHTML = '';
        this.root = el('div', 'stats-view');
        this.header = el('div', 'stats-header');
        this.body = el('div', 'stats-body');
        this.root.appendChild(this.header);
        this.root.appendChild(this.body);
        this.container.appendChild(this.root);
        this.renderHeader();
        this.load();
    }

    isVisible() {
        return Boolean(this.root && this.container.contains(this.root));
    }

    // ----- cabecera ---------------------------------------------------------

    renderHeader() {
        const header = this.header;
        header.innerHTML = '';
        header.appendChild(el('h2', 'stats-title', 'Estadísticas de escucha'));

        const tabs = el('div', 'stats-tabs');
        tabs.setAttribute('role', 'tablist');
        PERIODS.forEach(p => {
            const tab = el('button', 'stats-tab' + (p.id === this.period ? ' active' : ''), p.label);
            tab.type = 'button';
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', p.id === this.period ? 'true' : 'false');
            tab.addEventListener('click', () => this.setPeriod(p.id));
            tabs.appendChild(tab);
        });
        header.appendChild(tabs);

        if (this.period === 'month') {
            const actual = monthKey(this.now());
            const nav = el('div', 'stats-month-nav');
            const prev = el('button', 'stats-month-btn', '◀');
            prev.type = 'button';
            prev.title = 'Mes anterior';
            prev.setAttribute('aria-label', 'Mes anterior');
            prev.disabled = Boolean(this.firstMonth) && this.month <= this.firstMonth;
            prev.addEventListener('click', () => this.shiftMonthBy(-1));
            const label = el('span', 'stats-month-label', formatMonthLabel(this.month));
            const next = el('button', 'stats-month-btn', '▶');
            next.type = 'button';
            next.title = 'Mes siguiente';
            next.setAttribute('aria-label', 'Mes siguiente');
            next.disabled = this.month >= actual;
            next.addEventListener('click', () => this.shiftMonthBy(1));
            nav.appendChild(prev);
            nav.appendChild(label);
            nav.appendChild(next);
            header.appendChild(nav);
        }

        if (this.service.getUserId()) {
            const summary = el('div', 'stats-summary', 'Tiempo escuchado: ');
            summary.appendChild(el('strong', null, this.lastTotalMs === null ? '…' : formatDuration(this.lastTotalMs)));
            header.appendChild(summary);
        }
    }

    setPeriod(id) {
        if (id === 'month') {
            // Volver a pulsar la pestaña de mes vuelve al mes actual
            this.month = monthKey(this.now());
        }
        this.period = id;
        this.lastTotalMs = null;
        this.renderHeader();
        this.load();
    }

    shiftMonthBy(delta) {
        const destino = shiftMonth(this.month, delta);
        if (destino > monthKey(this.now())) return;
        if (this.firstMonth && destino < this.firstMonth) return;
        this.month = destino;
        this.lastTotalMs = null;
        this.renderHeader();
        this.load();
    }

    // ----- carga ------------------------------------------------------------

    async load() {
        const token = ++this.loadToken;

        if (!this.service.getUserId()) {
            this.lastTotalMs = null;
            this.renderHeader();
            this.renderLoggedOut();
            return;
        }

        this.renderMessage('Cargando estadísticas…');
        this.showLoading();
        try {
            // Enviar ya lo que acaba de sonar. No se espera: flush() nunca
            // lanza y sin red podría tardar; la lectura ya lo tiene en cuenta
            // (compensación de latencia + superposición de lo no enviado).
            this.service.flush();

            const [stats, firstMonth] = await Promise.all([
                this.service.getPeriodStats({ period: this.period, month: this.month }),
                this.period === 'month' && !this.firstMonth
                    ? this.service.getFirstMonthKey()
                    : Promise.resolve(this.firstMonth)
            ]);
            if (token !== this.loadToken || !this.isVisible()) return;
            if (firstMonth) this.firstMonth = firstMonth;

            if (!stats) {
                this.renderLoggedOut();
                return;
            }

            this.lastTotalMs = stats.totalMs;
            this.renderHeader();
            await this.renderStats(stats, token);
        } catch (error) {
            console.error('Error cargando estadísticas de escucha:', error);
            if (token !== this.loadToken || !this.isVisible()) return;
            this.renderError();
        } finally {
            if (token === this.loadToken) this.hideLoading();
        }
    }

    // ----- cuerpo -----------------------------------------------------------

    async renderStats(stats, token) {
        if (!stats.totalMs) {
            this.renderMessage('Todavía no hay escuchas en este periodo');
            return;
        }

        // Resolver los títulos de las canciones del top (con caché por sesión)
        const topSongs = stats.songs.slice(0, TOP_N + 5); // margen por si alguna se borró
        const songs = await Promise.all(topSongs.map(item => this.resolveSong(item.key)));
        if (token !== this.loadToken || !this.isVisible()) return;

        const body = this.body;
        body.innerHTML = '';

        SECTIONS.forEach(section => {
            let filas;
            if (section.dim === 'songs') {
                filas = topSongs
                    .map((item, i) => ({ item, song: songs[i] }))
                    .filter(f => f.song)
                    .slice(0, TOP_N);
            } else {
                filas = stats[section.dim].slice(0, TOP_N).map(item => ({ item, song: null }));
            }
            body.appendChild(this.buildSection(section, filas));
        });
    }

    async resolveSong(songId) {
        if (this.songCache.has(songId)) return this.songCache.get(songId);
        let song = null;
        try {
            song = await this.getSongById(songId);
        } catch (error) {
            console.warn(`Estadísticas: no se pudo cargar la canción ${songId}`, error);
        }
        this.songCache.set(songId, song || null);
        return song || null;
    }

    buildSection(section, filas) {
        const sec = el('section', 'stats-section');
        sec.appendChild(el('h3', null, section.titulo));

        if (filas.length === 0) {
            sec.appendChild(el('p', 'stats-section-empty', 'Sin datos'));
            return sec;
        }

        const maxMs = filas[0].item.ms || 1;
        const list = el('ol', 'stats-list');
        filas.forEach(({ item, song }, index) => {
            list.appendChild(this.buildRow(section, item, song, index + 1, maxMs));
        });
        sec.appendChild(list);
        return sec;
    }

    buildRow(section, item, song, posicion, maxMs) {
        const row = el('li', 'stats-row');
        row.appendChild(el('span', 'stats-rank', String(posicion)));

        // Miniatura: icono de relleno ya, portada real cuando llegue
        const thumb = el('div', 'stats-thumb');
        thumb.appendChild(el('span', 'stats-thumb-placeholder', section.icon));
        row.appendChild(thumb);
        this.loadThumb(thumb, section, item, song);

        const main = el('div', 'stats-row-main');
        const head = el('div', 'stats-row-head');
        const nombre = song ? (song.title || 'Sin título') : item.key;
        head.appendChild(el('span', 'stats-name', nombre));
        head.appendChild(el('span', 'stats-time', formatDuration(item.ms)));
        main.appendChild(head);
        if (song) {
            main.appendChild(el('div', 'stats-sub', song.artist || 'Artista desconocido'));
        }
        const bar = el('div', 'stats-bar');
        const fill = el('div', 'stats-bar-fill');
        fill.style.width = `${Math.max(2, Math.round((item.ms / maxMs) * 100))}%`;
        bar.appendChild(fill);
        main.appendChild(bar);
        row.appendChild(main);

        // Acción: reproducir la canción o abrir el filtro. "Desconocido" no
        // corresponde a ningún valor real, así que esa fila no es pulsable.
        let action = null;
        if (song) {
            action = () => this.onPlaySong(song);
            row.title = 'Reproducir';
        } else if (section.filterType && item.key !== UNKNOWN_LABEL) {
            action = () => this.onOpenFilter(section.filterType, item.key);
            row.title = `Ver canciones de ${item.key}`;
        }

        if (action) {
            row.setAttribute('role', 'button');
            row.tabIndex = 0;
            row.addEventListener('click', action);
            row.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    action();
                }
            });
        } else {
            row.classList.add('static');
        }
        return row;
    }

    // ----- miniaturas -------------------------------------------------------

    /**
     * Carga la portada de una fila (canción: su coverPath; artista/género/
     * source: la portada de su colección). Si no hay portada o falla, se
     * queda el icono. Nunca lanza.
     */
    async loadThumb(thumb, section, item, song) {
        if (!this.getCoverUrl) return;
        // Se llama mientras la fila aún se está construyendo: ceder el turno
        // para que ya esté en el DOM antes de comprobar `isConnected`.
        await Promise.resolve();
        try {
            let coverPath = null;
            if (song) {
                coverPath = song.coverPath || null;
            } else if (section.filterType && item.key !== UNKNOWN_LABEL) {
                coverPath = await this.resolveItemCoverPath(section.filterType, item.key);
            }
            if (!coverPath || !thumb.isConnected) return;

            const url = await this.resolveCoverUrl(coverPath);
            if (!url || !thumb.isConnected) return;

            const img = document.createElement('img');
            img.alt = '';
            img.decoding = 'async';
            img.onload = () => {
                if (!thumb.isConnected) return;
                thumb.appendChild(img);
                thumb.classList.add('loaded');
            };
            img.src = url;
        } catch (error) {
            // Sin portada: se queda el icono
        }
    }

    resolveItemCoverPath(filterType, key) {
        if (!this.getItemCoverPath) return Promise.resolve(null);
        const cacheKey = `${filterType}:${key}`;
        if (!this.itemCoverPathCache.has(cacheKey)) {
            const p = Promise.resolve()
                .then(() => this.getItemCoverPath(filterType, key))
                .then(path => path || null)
                .catch(() => null);
            this.itemCoverPathCache.set(cacheKey, p);
        }
        return this.itemCoverPathCache.get(cacheKey);
    }

    resolveCoverUrl(coverPath) {
        if (!this.coverUrlCache.has(coverPath)) {
            const p = Promise.resolve()
                .then(() => this.getCoverUrl(coverPath))
                .then(url => url || null)
                .catch(() => null);
            this.coverUrlCache.set(coverPath, p);
        }
        return this.coverUrlCache.get(coverPath);
    }

    // ----- estados ----------------------------------------------------------

    renderMessage(texto) {
        this.body.innerHTML = '';
        const box = el('div', 'stats-empty');
        box.appendChild(el('p', null, texto));
        this.body.appendChild(box);
    }

    renderLoggedOut() {
        this.body.innerHTML = '';
        const box = el('div', 'stats-empty');
        box.appendChild(el('p', null, 'Inicia sesión para ver tus estadísticas'));
        box.appendChild(el('span', 'stats-empty-subtitle',
            'El tiempo escuchado se guarda en tu cuenta y solo tú puedes verlo.'));
        const btn = el('button', 'stats-empty-btn', 'Iniciar sesión');
        btn.type = 'button';
        btn.addEventListener('click', () => this.onRequestLogin());
        box.appendChild(btn);
        this.body.appendChild(box);
    }

    renderError() {
        this.body.innerHTML = '';
        const box = el('div', 'stats-empty');
        box.appendChild(el('p', null, 'No se han podido cargar las estadísticas'));
        box.appendChild(el('span', 'stats-empty-subtitle', 'Comprueba la conexión e inténtalo de nuevo.'));
        const btn = el('button', 'stats-empty-btn', 'Reintentar');
        btn.type = 'button';
        btn.addEventListener('click', () => this.load());
        box.appendChild(btn);
        this.body.appendChild(box);
    }
}
