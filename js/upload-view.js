/**
 * Vista "Subir canciones": el usuario con permiso elige uno o varios archivos
 * de audio, se leen sus metadatos (título, artista, álbum, año, portada,
 * duración) y aparecen en una lista donde puede corregir los datos de cada
 * canción o aplicar los mismos datos a varias a la vez (género, source,
 * artista, álbum, año, playlists, portada). Después pulsa "Subir" y ve el
 * progreso de cada archivo.
 *
 * Se pinta dentro de #songList ocupando todo el ancho, igual que la vista de
 * estadísticas. El estado (borradores, selección, subida en curso) vive en la
 * instancia, así que si el usuario cambia de menú y vuelve, lo encuentra como
 * lo dejó y una subida en marcha sigue hasta terminar.
 *
 * Solo DOM: Firebase queda detrás de los callbacks que recibe en el constructor.
 */
import {
    STATUS,
    IMAGE_MAX_BYTES,
    isAudioFile,
    createDraft,
    applyBulkChanges,
    setDraftValues,
    playlistCheckboxState,
    commonValue,
    duplicateTitlesInBatch,
    validateDraft,
    summarize,
    formatDurationMs,
    formatBytes,
    imageExtension
} from './song-upload-service.js';

const NUEVO = '__new__';
const ACCEPT_AUDIO = 'audio/*,.mp3,.m4a,.ogg,.wav,.flac,.aac,.opus';
const CONCURRENCIA_LECTURA = 3;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function btn(label, { className = 'upload-btn', title = null, onClick = null, disabled = false } = {}) {
    const b = el('button', className, label);
    b.type = 'button';
    if (title) b.title = title;
    if (onClick) b.addEventListener('click', onClick);
    b.disabled = Boolean(disabled);
    return b;
}

function plural(n, singular, pluralForm) {
    return `${n} ${n === 1 ? singular : pluralForm}`;
}

export default class UploadView {
    /**
     * @param {Object} deps
     * @param {HTMLElement} deps.container - Contenedor donde pintar (#songList)
     * @param {Function} deps.readMetadata - (file) → Promise<metadata|null>
     * @param {Function} [deps.readDuration] - (file) → Promise<ms|null> (respaldo)
     * @param {Function} deps.getGenres - () → Promise<[{key, id}]>
     * @param {Function} deps.getSources - () → Promise<[{key, genreId}]>
     * @param {Function} deps.getArtistNames - () → Promise<string[]>
     * @param {Function} deps.getPlaylists - () → Promise<[{id, name}]> (solo las editables)
     * @param {Function} deps.uploadDraft - (draft, {onProgress}) → Promise<{songId}>
     * @param {Function} deps.addDraftsToPlaylists - (drafts) → Promise<{added, errors}>
     * @param {Function} [deps.onUploaded] - (numSubidas) → void
     * @param {Function} [deps.confirm] - (mensaje) → boolean|Promise<boolean>
     */
    constructor({
        container,
        readMetadata,
        readDuration = null,
        getGenres,
        getSources,
        getArtistNames,
        getPlaylists,
        uploadDraft,
        addDraftsToPlaylists,
        onUploaded = null,
        confirm = (msg) => window.confirm(msg)
    }) {
        this.container = container;
        this.deps = {
            readMetadata, readDuration, getGenres, getSources, getArtistNames,
            getPlaylists, uploadDraft, addDraftsToPlaylists, onUploaded, confirm
        };

        this.drafts = [];
        this.selected = new Set();
        this.uploading = false;
        this.lastSummary = null;
        this.catalog = null;          // { genres, sources, artists, playlists }
        this.catalogPromise = null;
        this.root = null;
        this.modal = null;
        this.noticeTimer = null;

        this.beforeUnload = (e) => {
            e.preventDefault();
            e.returnValue = 'Hay una subida en curso. Si sales ahora se interrumpirá.';
            return e.returnValue;
        };
    }

    // ----- ciclo de vida ----------------------------------------------------

    /** Pinta la vista (o la repinta) con el estado actual. */
    show() {
        this.container.innerHTML = '';
        this.root = el('div', 'upload-view');

        const header = el('div', 'upload-header');
        header.appendChild(el('h2', 'upload-title', 'Subir canciones'));
        header.appendChild(el('p', 'upload-subtitle',
            'Elige uno o varios archivos de audio. Se leen sus metadatos y puedes corregirlos ' +
            'antes de subir: pulsa una canción para editarla, o marca varias y edítalas a la vez.'));
        this.root.appendChild(header);

        this.dropzone = this.buildDropzone();
        this.root.appendChild(this.dropzone);

        this.notice = el('div', 'upload-notice');
        this.notice.style.display = 'none';
        this.root.appendChild(this.notice);

        this.toolbar = el('div', 'upload-toolbar');
        this.root.appendChild(this.toolbar);

        this.list = el('ul', 'upload-list');
        this.root.appendChild(this.list);

        this.summary = el('div', 'upload-summary');
        this.root.appendChild(this.summary);

        // Soltar archivos en cualquier punto de la vista
        this.root.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dropzone.classList.add('dragover');
        });
        this.root.addEventListener('dragleave', (e) => {
            if (!this.root.contains(e.relatedTarget)) this.dropzone.classList.remove('dragover');
        });
        this.root.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dropzone.classList.remove('dragover');
            if (e.dataTransfer && e.dataTransfer.files) this.addFiles(e.dataTransfer.files);
        });

        this.container.appendChild(this.root);
        this.render();
        this.loadCatalog();
    }

    isVisible() {
        return Boolean(this.root && this.container.contains(this.root));
    }

    // ----- catálogo (géneros, sources, artistas, playlists) -----------------

    loadCatalog(force = false) {
        if (!force && this.catalogPromise) return this.catalogPromise;
        const seguro = (p) => Promise.resolve(p).catch((error) => {
            console.warn('No se pudo cargar parte del catálogo para la subida:', error);
            return [];
        });
        this.catalogPromise = Promise.all([
            seguro(this.deps.getGenres()),
            seguro(this.deps.getSources()),
            seguro(this.deps.getArtistNames()),
            seguro(this.deps.getPlaylists())
        ]).then(([genres, sources, artists, playlists]) => {
            this.catalog = { genres, sources, artists, playlists };
            return this.catalog;
        });
        return this.catalogPromise;
    }

    playlistName(id) {
        const pl = this.catalog && this.catalog.playlists.find(p => p.id === id);
        return pl ? pl.name : '(playlist)';
    }

    // ----- archivos -----------------------------------------------------------

    buildDropzone() {
        const zone = el('div', 'upload-dropzone');
        zone.tabIndex = 0;
        zone.setAttribute('role', 'button');
        zone.setAttribute('aria-label', 'Elegir archivos de audio');

        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = ACCEPT_AUDIO;
        input.className = 'upload-file-input';
        input.addEventListener('change', () => {
            this.addFiles(input.files);
            input.value = '';
        });

        const icon = el('div', 'upload-dropzone-icon', '🎵');
        const text = el('div', 'upload-dropzone-text');
        text.appendChild(document.createTextNode('Arrastra aquí archivos de audio o '));
        text.appendChild(el('u', null, 'pulsa para elegirlos'));
        const hint = el('div', 'upload-dropzone-hint', 'mp3, m4a, ogg, wav, flac · puedes elegir varios a la vez');

        zone.appendChild(icon);
        zone.appendChild(text);
        zone.appendChild(hint);
        zone.appendChild(input);

        const abrir = () => { if (!this.uploading) input.click(); };
        zone.addEventListener('click', abrir);
        zone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); }
        });
        return zone;
    }

    async addFiles(fileList) {
        const todos = Array.from(fileList || []);
        const files = todos.filter(isAudioFile);
        if (todos.length && !files.length) {
            this.showNotice('Ninguno de los archivos elegidos es de audio.');
            return;
        }
        if (!files.length) return;
        if (files.length < todos.length) {
            this.showNotice(`${todos.length - files.length} archivo(s) ignorados por no ser de audio.`);
        }

        const catalog = await this.loadCatalog();

        const nuevos = files.map(file => {
            const d = createDraft({ file, metadata: null, appGenres: catalog.genres });
            d.reading = true;
            return d;
        });
        this.drafts.push(...nuevos);
        this.lastSummary = null;
        this.render();

        // Leer metadatos con concurrencia limitada (son archivos locales, pero
        // leer 20 a la vez bloquea la pestaña)
        const cola = nuevos.slice();
        const worker = async () => {
            while (cola.length) {
                const d = cola.shift();
                await this.readDraftMetadata(d, catalog.genres);
            }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCIA_LECTURA, cola.length) }, worker));
        this.renderToolbar();
    }

    async readDraftMetadata(draft, genres) {
        try {
            const md = await this.deps.readMetadata(draft.file);
            if (md) {
                const base = createDraft({ file: draft.file, metadata: md, appGenres: genres });
                draft.title = base.title;
                draft.artist = base.artist;
                draft.album = base.album;
                draft.year = base.year;
                draft.genre = base.genre;
                draft.cover = base.cover;
                draft.durationMs = base.durationMs;
                draft.metadataRead = base.metadataRead;
            }
            if (!draft.durationMs && this.deps.readDuration) {
                draft.durationMs = await this.deps.readDuration(draft.file);
            }
        } catch (error) {
            console.warn(`Error leyendo metadatos de ${draft.fileName}:`, error);
        }
        // Si el borrador se quitó mientras se leía, no hay nada que pintar
        if (!this.drafts.includes(draft)) return;
        draft.reading = false;
        this.updateRow(draft);
    }

    coverUrlFor(draft) {
        const blob = draft.cover && draft.cover.blob;
        if (!blob) {
            this.revokeCoverUrl(draft);
            return null;
        }
        if (draft._coverUrlBlob !== blob) {
            this.revokeCoverUrl(draft);
            try {
                draft._coverUrl = URL.createObjectURL(blob);
                draft._coverUrlBlob = blob;
            } catch (_) {
                draft._coverUrl = null;
            }
        }
        return draft._coverUrl || null;
    }

    revokeCoverUrl(draft) {
        if (draft._coverUrl) {
            try { URL.revokeObjectURL(draft._coverUrl); } catch (_) { /* nada */ }
        }
        draft._coverUrl = null;
        draft._coverUrlBlob = null;
    }

    removeDrafts(ids) {
        if (this.uploading) return;
        const set = new Set(ids);
        this.drafts = this.drafts.filter(d => {
            if (!set.has(d.id)) return true;
            this.revokeCoverUrl(d);
            this.selected.delete(d.id);
            return false;
        });
        this.render();
    }

    // ----- selección ----------------------------------------------------------

    selectable(draft) {
        return draft.status !== STATUS.DONE && draft.status !== STATUS.UPLOADING && !draft.reading;
    }

    toggleSelect(id, on) {
        const d = this.drafts.find(x => x.id === id);
        if (!d || !this.selectable(d)) return;
        if (on) this.selected.add(id); else this.selected.delete(id);
        const row = this.rowElement(id);
        if (row) row.classList.toggle('selected', on);
        this.renderToolbar();
    }

    selectAll(on) {
        this.drafts.forEach(d => {
            if (!this.selectable(d)) return;
            if (on) this.selected.add(d.id); else this.selected.delete(d.id);
        });
        this.renderList();
        this.renderToolbar();
    }

    selectedIds() {
        return this.drafts.filter(d => this.selected.has(d.id) && this.selectable(d)).map(d => d.id);
    }

    // ----- render -------------------------------------------------------------

    render() {
        if (!this.root) return;
        this.dropzone.classList.toggle('compact', this.drafts.length > 0);
        this.dropzone.classList.toggle('disabled', this.uploading);
        this.renderToolbar();
        this.renderList();
        this.renderSummary();
    }

    showNotice(message) {
        if (!this.notice) return;
        this.notice.textContent = message;
        this.notice.style.display = 'block';
        clearTimeout(this.noticeTimer);
        this.noticeTimer = setTimeout(() => { this.notice.style.display = 'none'; }, 5000);
    }

    renderToolbar() {
        const bar = this.toolbar;
        if (!bar) return;
        bar.innerHTML = '';
        if (this.drafts.length === 0) {
            bar.style.display = 'none';
            return;
        }
        bar.style.display = 'flex';

        const seleccionables = this.drafts.filter(d => this.selectable(d));
        const ids = this.selectedIds();
        const resumen = summarize(this.drafts);
        const pendientes = this.drafts.filter(d => (d.status === STATUS.PENDING || d.status === STATUS.ERROR) && !d.reading);
        const leyendo = this.drafts.filter(d => d.reading).length;

        // Seleccionar todo
        const selAll = el('label', 'upload-select-all');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = seleccionables.length > 0 && ids.length === seleccionables.length;
        cb.indeterminate = ids.length > 0 && ids.length < seleccionables.length;
        cb.disabled = this.uploading || seleccionables.length === 0;
        cb.addEventListener('change', () => this.selectAll(cb.checked));
        selAll.appendChild(cb);
        selAll.appendChild(document.createTextNode(' Seleccionar todo'));
        bar.appendChild(selAll);

        bar.appendChild(el('span', 'upload-count',
            ids.length > 0 ? `${ids.length} de ${seleccionables.length} seleccionadas` : plural(this.drafts.length, 'canción', 'canciones')));

        const grupo = el('div', 'upload-toolbar-group');
        grupo.appendChild(btn(ids.length > 1 ? `✏️ Editar ${ids.length} a la vez` : '✏️ Editar',
            {
                title: 'Poner los mismos datos a todas las seleccionadas',
                disabled: this.uploading || ids.length === 0,
                onClick: () => this.openEditor(ids)
            }));
        grupo.appendChild(btn(`🗑 Quitar${ids.length ? ` (${ids.length})` : ''}`,
            {
                title: 'Quitar de la lista las seleccionadas (no borra nada del disco)',
                disabled: this.uploading || ids.length === 0,
                onClick: () => this.removeDrafts(ids)
            }));
        if (resumen.done > 0 && !this.uploading) {
            grupo.appendChild(btn('🧹 Limpiar subidas', {
                title: 'Quitar de la lista las que ya se han subido',
                onClick: () => this.removeDrafts(this.drafts.filter(d => d.status === STATUS.DONE).map(d => d.id))
            }));
        }
        bar.appendChild(grupo);

        bar.appendChild(el('span', 'upload-toolbar-spacer'));

        let etiqueta;
        if (this.uploading) {
            const p = this.uploadProgress || { current: 0, total: 0 };
            etiqueta = `Subiendo ${p.current} de ${p.total}…`;
        } else if (leyendo > 0) {
            etiqueta = `Leyendo metadatos (${leyendo})…`;
        } else {
            etiqueta = `⬆️ Subir ${plural(pendientes.length, 'canción', 'canciones')}`;
        }
        bar.appendChild(btn(etiqueta, {
            className: 'upload-btn primary',
            disabled: this.uploading || leyendo > 0 || pendientes.length === 0,
            onClick: () => this.uploadAll()
        }));
    }

    renderList() {
        if (!this.list) return;
        this.list.innerHTML = '';
        if (this.drafts.length === 0) {
            const vacio = el('li', 'upload-empty', 'Aún no has elegido ningún archivo.');
            this.list.appendChild(vacio);
            return;
        }
        this.drafts.forEach(d => this.list.appendChild(this.buildRow(d)));
    }

    rowElement(id) {
        return this.list ? this.list.querySelector(`.upload-row[data-id="${id}"]`) : null;
    }

    updateRow(draft) {
        const actual = this.rowElement(draft.id);
        if (!actual) { this.renderList(); return; }
        actual.replaceWith(this.buildRow(draft));
    }

    updateRowProgress(draft) {
        const row = this.rowElement(draft.id);
        if (!row) return;
        const fill = row.querySelector('.upload-progress-fill');
        const pct = row.querySelector('.upload-progress-pct');
        const p = Math.round((draft.progress || 0) * 100);
        if (fill) fill.style.width = `${p}%`;
        if (pct) pct.textContent = `${p}%`;
    }

    buildRow(d) {
        const li = el('li', 'upload-row');
        li.dataset.id = d.id;
        li.classList.add(`status-${d.status}`);
        if (d.reading) li.classList.add('reading');
        if (this.selected.has(d.id) && this.selectable(d)) li.classList.add('selected');

        // Casilla
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'upload-row-check';
        cb.checked = this.selected.has(d.id) && this.selectable(d);
        cb.disabled = !this.selectable(d) || this.uploading;
        cb.title = 'Seleccionar';
        cb.addEventListener('click', (e) => e.stopPropagation());
        cb.addEventListener('change', () => this.toggleSelect(d.id, cb.checked));
        li.appendChild(cb);

        // Miniatura
        const thumb = el('div', 'upload-thumb');
        const url = this.coverUrlFor(d);
        if (url) {
            const img = document.createElement('img');
            img.src = url;
            img.alt = '';
            thumb.appendChild(img);
        } else {
            thumb.appendChild(el('span', 'upload-thumb-placeholder', '🎵'));
        }
        li.appendChild(thumb);

        // Datos
        const main = el('div', 'upload-row-main');
        main.appendChild(el('div', 'upload-row-title', d.title || d.fileName));
        const sub = [];
        sub.push(d.artist || 'Sin artista');
        if (d.album) sub.push(d.album);
        if (d.year) sub.push(String(d.year));
        const dur = formatDurationMs(d.durationMs);
        if (dur) sub.push(dur);
        const tam = formatBytes(d.fileSize);
        if (tam) sub.push(tam);
        main.appendChild(el('div', 'upload-row-sub', sub.join(' · ')));

        const tags = el('div', 'upload-row-tags');
        tags.appendChild(el('span', 'upload-tag' + (d.genre ? '' : ' missing'), d.genre ? `🎵 ${d.genre}` : 'sin género'));
        if (d.source) tags.appendChild(el('span', 'upload-tag', `📁 ${d.source}`));
        (d.playlistIds || []).forEach(pid => tags.appendChild(el('span', 'upload-tag playlist', `📋 ${this.playlistName(pid)}`)));
        if (!d.cover) tags.appendChild(el('span', 'upload-tag missing', 'sin portada'));
        main.appendChild(tags);
        li.appendChild(main);

        // Estado
        const status = el('div', 'upload-row-status');
        if (d.reading) {
            status.appendChild(el('span', 'upload-status-text', 'Leyendo metadatos…'));
        } else if (d.status === STATUS.UPLOADING) {
            const bar = el('div', 'upload-progress');
            const fill = el('div', 'upload-progress-fill');
            fill.style.width = `${Math.round((d.progress || 0) * 100)}%`;
            bar.appendChild(fill);
            status.appendChild(bar);
            status.appendChild(el('span', 'upload-progress-pct', `${Math.round((d.progress || 0) * 100)}%`));
        } else if (d.status === STATUS.DONE) {
            status.appendChild(el('span', 'upload-status-text done', '✅ Subida'));
        } else if (d.status === STATUS.ERROR) {
            const err = el('span', 'upload-status-text error', `⚠️ ${d.error || 'Error'}`);
            err.title = d.error || 'Error';
            status.appendChild(err);
        } else {
            status.appendChild(el('span', 'upload-status-text', d.metadataRead ? 'Pendiente' : 'Pendiente · sin tags'));
        }
        li.appendChild(status);

        // Acciones
        const actions = el('div', 'upload-row-actions');
        const editable = this.selectable(d) && !this.uploading;
        actions.appendChild(btn('✏️', {
            className: 'upload-icon-btn',
            title: 'Editar datos',
            disabled: !editable,
            onClick: (e) => { e.stopPropagation(); this.openEditor([d.id]); }
        }));
        actions.appendChild(btn('✕', {
            className: 'upload-icon-btn',
            title: 'Quitar de la lista',
            disabled: this.uploading || d.status === STATUS.UPLOADING,
            onClick: (e) => { e.stopPropagation(); this.removeDrafts([d.id]); }
        }));
        li.appendChild(actions);

        if (editable) {
            li.addEventListener('click', (e) => {
                if (e.target.closest('button, input')) return;
                this.openEditor([d.id]);
            });
        }
        return li;
    }

    renderSummary() {
        if (!this.summary) return;
        this.summary.innerHTML = '';
        const s = this.lastSummary;
        if (!s) { this.summary.style.display = 'none'; return; }
        this.summary.style.display = 'block';

        const partes = [];
        if (s.done) partes.push(`✅ ${plural(s.done, 'canción subida', 'canciones subidas')}`);
        if (s.error) partes.push(`⚠️ ${plural(s.error, 'canción con error', 'canciones con error')}`);
        this.summary.appendChild(el('div', 'upload-summary-main', partes.join(' · ') || 'Nada que subir.'));

        if (s.playlistResult) {
            if (s.playlistResult.added) {
                this.summary.appendChild(el('div', 'upload-summary-sub',
                    `📋 ${plural(s.playlistResult.added, 'canción añadida', 'canciones añadidas')} a playlists.`));
            }
            s.playlistResult.errors.forEach(err => {
                this.summary.appendChild(el('div', 'upload-summary-sub error',
                    `No se pudo añadir a la playlist "${this.playlistName(err.playlistId)}": ${err.message}`));
            });
        }
        if (s.error) {
            this.summary.appendChild(el('div', 'upload-summary-sub',
                'Las canciones con error siguen en la lista: corrige sus datos y vuelve a pulsar "Subir".'));
        }
    }

    // ----- subida -------------------------------------------------------------

    async uploadAll() {
        if (this.uploading) return;
        const candidatos = this.drafts.filter(d => (d.status === STATUS.PENDING || d.status === STATUS.ERROR) && !d.reading);
        if (!candidatos.length) return;

        const duplicados = duplicateTitlesInBatch(this.drafts.filter(d => d.status !== STATUS.DONE));
        const validos = [];
        let invalidos = 0;
        for (const d of candidatos) {
            const errores = validateDraft(d, { duplicates: duplicados });
            if (errores.length) {
                d.status = STATUS.ERROR;
                d.error = errores.join('. ');
                invalidos++;
            } else {
                validos.push(d);
            }
        }
        this.render();

        if (invalidos && !validos.length) {
            this.showNotice('Corrige los errores marcados antes de subir.');
            return;
        }
        if (invalidos) {
            const ok = await this.deps.confirm(
                `${plural(invalidos, 'canción tiene', 'canciones tienen')} errores y no se subirán. ` +
                `¿Subir las otras ${validos.length}?`);
            if (!ok) return;
        }

        this.uploading = true;
        this.lastSummary = null;
        this.uploadProgress = { current: 0, total: validos.length };
        window.addEventListener('beforeunload', this.beforeUnload);
        this.render();

        for (const d of validos) {
            d.status = STATUS.UPLOADING;
            d.progress = 0;
            d.error = null;
            this.uploadProgress.current++;
            this.updateRow(d);
            this.renderToolbar();
            try {
                const r = await this.deps.uploadDraft(d, {
                    onProgress: (f) => { d.progress = f; this.updateRowProgress(d); }
                });
                d.status = STATUS.DONE;
                d.progress = 1;
                d.songId = r && r.songId ? r.songId : null;
                this.selected.delete(d.id);
            } catch (error) {
                console.error(`Error subiendo "${d.title}":`, error);
                d.status = STATUS.ERROR;
                d.error = (error && error.message) || 'Error desconocido';
            }
            this.updateRow(d);
            this.renderToolbar();
        }

        let playlistResult = { added: 0, errors: [] };
        try {
            playlistResult = await this.deps.addDraftsToPlaylists(this.drafts);
        } catch (error) {
            console.error('Error añadiendo canciones a playlists:', error);
            playlistResult.errors.push({ playlistId: '', message: (error && error.message) || 'Error desconocido' });
        }

        this.uploading = false;
        this.uploadProgress = null;
        window.removeEventListener('beforeunload', this.beforeUnload);
        this.lastSummary = { ...summarize(validos), playlistResult };
        this.render();

        if (this.deps.onUploaded && this.lastSummary.done > 0) {
            try { this.deps.onUploaded(this.lastSummary.done); } catch (_) { /* nada */ }
        }
    }

    // ----- editor (una canción o varias a la vez) ---------------------------

    async openEditor(ids) {
        if (this.uploading) return;
        const objetivo = this.drafts.filter(d => ids.includes(d.id) && this.selectable(d));
        if (!objetivo.length) return;
        const catalog = await this.loadCatalog();
        this.closeEditor();

        const bulk = objetivo.length > 1;
        const idsObjetivo = objetivo.map(d => d.id);
        const unico = bulk ? null : objetivo[0];
        // Portada: undefined = sin cambios, null = quitar, {blob, ext} = nueva
        let pendingCover;

        const modal = el('div', 'upload-modal');
        const overlay = el('div', 'upload-modal-overlay');
        const content = el('div', 'upload-modal-content');
        modal.appendChild(overlay);
        modal.appendChild(content);

        const close = btn('×', { className: 'upload-modal-close', title: 'Cerrar', onClick: () => this.closeEditor() });
        content.appendChild(close);
        content.appendChild(el('h2', 'upload-modal-title', bulk ? `Editar ${objetivo.length} canciones a la vez` : 'Editar canción'));
        content.appendChild(el('p', 'upload-modal-subtitle', bulk
            ? 'Lo que rellenes se aplicará a todas las seleccionadas. Lo que dejes vacío o "sin cambios" se conserva en cada una.'
            : unico.fileName));

        const form = el('form', 'upload-form');
        form.noValidate = true;
        content.appendChild(form);

        const campo = (labelText, control, extra = null) => {
            const wrap = el('div', 'upload-field');
            const label = el('label', null, labelText);
            wrap.appendChild(label);
            wrap.appendChild(control);
            if (extra) wrap.appendChild(extra);
            return wrap;
        };
        const input = (type, value, placeholder, listId = null) => {
            const i = document.createElement('input');
            i.type = type;
            i.value = value === null || value === undefined ? '' : String(value);
            if (placeholder) i.placeholder = placeholder;
            if (listId) i.setAttribute('list', listId);
            if (type === 'number') { i.min = '1000'; i.max = '2999'; i.step = '1'; }
            return i;
        };

        // Título (solo edición individual)
        let titleInput = null;
        if (!bulk) {
            titleInput = input('text', unico.title, 'Título de la canción');
            titleInput.required = true;
            form.appendChild(campo('Título', titleInput));
        }

        // Artista (con autocompletado de los existentes)
        const datalist = document.createElement('datalist');
        datalist.id = 'uploadArtistsList';
        (catalog.artists || []).forEach(a => {
            const o = document.createElement('option');
            o.value = a;
            datalist.appendChild(o);
        });
        const artistInput = input('text', bulk ? commonValue(this.drafts, idsObjetivo, 'artist') : unico.artist,
            bulk ? 'Sin cambios' : 'Artista', 'uploadArtistsList');
        const albumInput = input('text', bulk ? commonValue(this.drafts, idsObjetivo, 'album') : unico.album,
            bulk ? 'Sin cambios' : 'Álbum');
        const yearInput = input('number', bulk ? commonValue(this.drafts, idsObjetivo, 'year') : unico.year,
            bulk ? 'Sin cambios' : 'Año');

        const fila1 = el('div', 'upload-field-row');
        fila1.appendChild(campo('Artista', artistInput, datalist));
        fila1.appendChild(campo('Álbum', albumInput));
        form.appendChild(fila1);

        // Género y source
        const genreSelect = document.createElement('select');
        const genreActual = bulk ? commonValue(this.drafts, idsObjetivo, 'genre') : unico.genre;
        const addOpt = (select, value, label) => {
            const o = document.createElement('option');
            o.value = value;
            o.textContent = label;
            select.appendChild(o);
            return o;
        };
        addOpt(genreSelect, '', bulk ? '— Sin cambios —' : 'Sin género');
        (catalog.genres || []).forEach(g => addOpt(genreSelect, g.key, g.key));
        if (genreActual && !(catalog.genres || []).some(g => g.key === genreActual)) addOpt(genreSelect, genreActual, genreActual);
        addOpt(genreSelect, NUEVO, '➕ Nuevo género…');
        genreSelect.value = genreActual || '';
        const newGenreInput = input('text', '', 'Nombre del nuevo género');
        newGenreInput.className = 'upload-new-input';
        newGenreInput.style.display = 'none';

        const sourceSelect = document.createElement('select');
        const newSourceInput = input('text', '', 'Nombre del nuevo source');
        newSourceInput.className = 'upload-new-input';
        newSourceInput.style.display = 'none';
        const sourceHint = el('div', 'upload-field-hint', '');

        const sourceActual = bulk ? commonValue(this.drafts, idsObjetivo, 'source') : unico.source;

        const generoEfectivo = () => {
            const v = genreSelect.value;
            if (v === NUEVO) return newGenreInput.value.trim();
            if (v) return v;
            // En bloque, "sin cambios" vale si todas comparten género
            return bulk ? commonValue(this.drafts, idsObjetivo, 'genre') : '';
        };

        const rellenarSources = () => {
            const genre = generoEfectivo();
            const anterior = sourceSelect.value;
            sourceSelect.innerHTML = '';
            addOpt(sourceSelect, '', bulk ? '— Sin cambios —' : 'Sin source');
            if (!genre) {
                sourceSelect.disabled = true;
                newSourceInput.style.display = 'none';
                sourceHint.textContent = bulk
                    ? 'Elige un género (o selecciona canciones del mismo género) para poder asignar un source.'
                    : 'Elige un género para poder asignar un source.';
                return;
            }
            sourceSelect.disabled = false;
            sourceHint.textContent = '';
            const delGenero = (catalog.sources || []).filter(s => s.genreId.toLowerCase() === genre.toLowerCase());
            delGenero.forEach(s => addOpt(sourceSelect, s.key, s.key));
            if (sourceActual && !delGenero.some(s => s.key === sourceActual)) addOpt(sourceSelect, sourceActual, sourceActual);
            addOpt(sourceSelect, NUEVO, '➕ Nuevo source…');
            const valores = Array.from(sourceSelect.options).map(o => o.value);
            sourceSelect.value = valores.includes(anterior) ? anterior : (valores.includes(sourceActual) ? sourceActual : '');
            newSourceInput.style.display = sourceSelect.value === NUEVO ? 'block' : 'none';
        };

        genreSelect.addEventListener('change', () => {
            newGenreInput.style.display = genreSelect.value === NUEVO ? 'block' : 'none';
            if (genreSelect.value === NUEVO) newGenreInput.focus();
            rellenarSources();
        });
        newGenreInput.addEventListener('input', rellenarSources);
        sourceSelect.addEventListener('change', () => {
            newSourceInput.style.display = sourceSelect.value === NUEVO ? 'block' : 'none';
            if (sourceSelect.value === NUEVO) newSourceInput.focus();
        });
        rellenarSources();

        const fila2 = el('div', 'upload-field-row');
        const campoGenero = campo('Género', genreSelect, newGenreInput);
        const campoSource = campo('Source', sourceSelect, newSourceInput);
        campoSource.appendChild(sourceHint);
        fila2.appendChild(campoGenero);
        fila2.appendChild(campoSource);
        form.appendChild(fila2);

        const fila3 = el('div', 'upload-field-row');
        fila3.appendChild(campo('Año', yearInput));

        // Portada
        const coverField = el('div', 'upload-cover-field');
        const coverThumb = el('div', 'upload-thumb large');
        const coverButtons = el('div', 'upload-cover-buttons');
        const coverFileInput = document.createElement('input');
        coverFileInput.type = 'file';
        coverFileInput.accept = 'image/jpeg,image/png,image/webp';
        coverFileInput.className = 'upload-file-input';
        const pintarPortada = () => {
            coverThumb.innerHTML = '';
            let url = null;
            if (pendingCover && pendingCover.blob) {
                if (coverThumb._url) URL.revokeObjectURL(coverThumb._url);
                coverThumb._url = URL.createObjectURL(pendingCover.blob);
                url = coverThumb._url;
            } else if (pendingCover === undefined && !bulk) {
                url = this.coverUrlFor(unico);
            }
            if (url) {
                const img = document.createElement('img');
                img.src = url;
                img.alt = '';
                coverThumb.appendChild(img);
            } else {
                coverThumb.appendChild(el('span', 'upload-thumb-placeholder',
                    pendingCover === null ? '🚫' : (bulk && pendingCover === undefined ? '＝' : '🎵')));
            }
            coverThumb.title = pendingCover === undefined
                ? (bulk ? 'Sin cambios' : (unico.cover ? 'Portada actual' : 'Sin portada'))
                : (pendingCover === null ? 'Se quitará la portada' : 'Portada nueva');
        };
        coverFileInput.addEventListener('change', () => {
            const f = coverFileInput.files && coverFileInput.files[0];
            coverFileInput.value = '';
            if (!f) return;
            const ext = imageExtension(f);
            if (!ext) { mostrarError('La portada debe ser una imagen JPG, PNG o WebP.'); return; }
            if (f.size > IMAGE_MAX_BYTES) { mostrarError('La portada es demasiado grande (máx. 5 MB).'); return; }
            pendingCover = { blob: f, ext };
            mostrarError('');
            pintarPortada();
        });
        coverButtons.appendChild(btn(bulk ? '🖼 Misma portada para todas…' : '🖼 Cambiar imagen…', {
            onClick: () => coverFileInput.click()
        }));
        coverButtons.appendChild(btn(bulk ? 'Quitar portada de todas' : 'Quitar portada', {
            onClick: () => { pendingCover = null; pintarPortada(); }
        }));
        if (bulk) {
            coverButtons.appendChild(btn('Sin cambios', {
                onClick: () => { pendingCover = undefined; pintarPortada(); }
            }));
        }
        coverField.appendChild(coverThumb);
        coverField.appendChild(coverButtons);
        coverField.appendChild(coverFileInput);
        pintarPortada();
        fila3.appendChild(campo('Portada', coverField));
        form.appendChild(fila3);

        // Playlists
        const playlistsBox = el('div', 'upload-playlists');
        const playlistChecks = [];
        if (!catalog.playlists || catalog.playlists.length === 0) {
            playlistsBox.appendChild(el('div', 'upload-field-hint',
                'No tienes playlists propias. Créalas desde el menú "Playlists" y aparecerán aquí.'));
        } else {
            catalog.playlists.forEach(pl => {
                const label = el('label', 'upload-playlist-option');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.value = pl.id;
                if (bulk) {
                    const estado = playlistCheckboxState(this.drafts, idsObjetivo, pl.id);
                    cb.checked = estado === 'all';
                    cb.indeterminate = estado === 'some';
                    cb.dataset.touched = '0';
                    cb.addEventListener('change', () => { cb.dataset.touched = '1'; cb.indeterminate = false; });
                } else {
                    cb.checked = unico.playlistIds.includes(pl.id);
                }
                label.appendChild(cb);
                label.appendChild(document.createTextNode(` ${pl.name}`));
                playlistsBox.appendChild(label);
                playlistChecks.push(cb);
            });
        }
        form.appendChild(campo(bulk ? 'Playlists (marca para añadir, desmarca para quitar)' : 'Playlists', playlistsBox));

        // Error y acciones
        const errorLine = el('div', 'upload-error');
        form.appendChild(errorLine);
        const mostrarError = (msg) => { errorLine.textContent = msg || ''; };

        const actions = el('div', 'upload-modal-actions');
        actions.appendChild(btn('Cancelar', { onClick: () => this.closeEditor() }));
        const saveBtn = btn(bulk ? `Aplicar a ${objetivo.length} canciones` : 'Guardar', { className: 'upload-btn primary' });
        saveBtn.type = 'submit';
        actions.appendChild(saveBtn);
        form.appendChild(actions);

        form.addEventListener('submit', (e) => {
            e.preventDefault();

            const genreSel = genreSelect.value;
            const genre = genreSel === NUEVO ? newGenreInput.value.trim() : genreSel;
            if (genreSel === NUEVO && !genre) { mostrarError('Escribe el nombre del nuevo género.'); newGenreInput.focus(); return; }

            const sourceSel = sourceSelect.disabled ? '' : sourceSelect.value;
            const source = sourceSel === NUEVO ? newSourceInput.value.trim() : sourceSel;
            if (sourceSel === NUEVO && !source) { mostrarError('Escribe el nombre del nuevo source.'); newSourceInput.focus(); return; }
            if (source && !generoEfectivo()) { mostrarError('Para asignar un source hay que elegir también el género.'); return; }

            const year = yearInput.value.trim();
            if (year && (!/^\d{4}$/.test(year) || Number(year) < 1000 || Number(year) > 2999)) {
                mostrarError('El año debe tener cuatro cifras.');
                yearInput.focus();
                return;
            }

            if (bulk) {
                const add = [];
                const remove = [];
                playlistChecks.forEach(cb => {
                    if (cb.dataset.touched !== '1') return;
                    (cb.checked ? add : remove).push(cb.value);
                });
                applyBulkChanges(this.drafts, idsObjetivo, {
                    artist: artistInput.value,
                    album: albumInput.value,
                    year,
                    genre,
                    source,
                    cover: pendingCover,
                    playlists: { add, remove }
                });
            } else {
                const title = titleInput.value.trim();
                if (!title) { mostrarError('El título no puede estar vacío.'); titleInput.focus(); return; }
                setDraftValues(unico, {
                    title,
                    artist: artistInput.value,
                    album: albumInput.value,
                    year,
                    genre,
                    source,
                    playlistIds: playlistChecks.filter(cb => cb.checked).map(cb => cb.value),
                    cover: pendingCover
                });
            }

            // Que el nuevo género/source salgan ya en los siguientes editores
            if (genre && !(catalog.genres || []).some(g => g.key.toLowerCase() === genre.toLowerCase())) {
                catalog.genres.push({ key: genre, id: genre, count: 0 });
            }
            if (source && genre && !(catalog.sources || []).some(s => s.key.toLowerCase() === source.toLowerCase())) {
                catalog.sources.push({ key: source, genreId: genre, coverPath: null });
            }
            const artista = artistInput.value.trim();
            if (artista && !(catalog.artists || []).includes(artista)) catalog.artists.push(artista);

            this.closeEditor();
            this.lastSummary = null;
            this.render();
        });

        overlay.addEventListener('click', () => this.closeEditor());
        this.modalKeydown = (e) => { if (e.key === 'Escape') this.closeEditor(); };
        document.addEventListener('keydown', this.modalKeydown);

        this.modal = modal;
        this.modalCoverThumb = coverThumb;
        document.body.appendChild(modal);
        const primero = form.querySelector('input, select');
        if (primero) setTimeout(() => primero.focus(), 50);
    }

    closeEditor() {
        if (this.modalKeydown) {
            document.removeEventListener('keydown', this.modalKeydown);
            this.modalKeydown = null;
        }
        if (this.modalCoverThumb && this.modalCoverThumb._url) {
            try { URL.revokeObjectURL(this.modalCoverThumb._url); } catch (_) { /* nada */ }
            this.modalCoverThumb = null;
        }
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }
    }
}
