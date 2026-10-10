/**
 * Registro de diagnóstico persistente (caja negra).
 *
 * Guarda en localStorage los últimos eventos relevantes de la reproducción
 * (cambios de canción, precargas, errores, visibilidad, red...) para poder
 * diagnosticar qué pasa en el móvil con la pantalla apagada, donde no hay
 * consola. Sobrevive a recargas y a que el sistema mate la pestaña (de hecho,
 * ver "pagina cargada" en mitad de una sesión delata que la pestaña murió).
 *
 * Visor: TRIPLE TOQUE rápido sobre el título (o la carátula) de la canción en
 * el reproductor → se abre un panel con el registro y un botón "Copiar".
 *
 * Sin dependencias: no importa ningún otro módulo.
 */

const STORAGE_KEY = 'debugLog';
const MAX_ENTRIES = 400;

class DebugLog {
    constructor() {
        try {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
            this.entries = Array.isArray(stored) ? stored : [];
        } catch (error) {
            this.entries = [];
        }
        this.tapCount = 0;
        this.tapTimer = null;
        this.overlay = null;
        this.installGlobalHooks();
    }

    /**
     * Añade una línea al registro (con fecha y hora) y la persiste.
     * @param {string} tag - Categoría corta (player, precarga, red, ciclo...)
     * @param {string} message - Texto del evento
     */
    log(tag, message) {
        const now = new Date();
        const stamp = now.toISOString().slice(0, 10) + ' ' + now.toTimeString().slice(0, 8) +
            '.' + String(now.getMilliseconds()).padStart(3, '0');
        this.entries.push(`${stamp} [${tag}] ${message}`);
        if (this.entries.length > MAX_ENTRIES) {
            this.entries.splice(0, this.entries.length - MAX_ENTRIES);
        }
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
        } catch (error) {
            // Sin persistencia disponible: seguir solo en memoria
        }
    }

    /**
     * Engancha los eventos globales que interesan para el diagnóstico.
     * @private
     */
    installGlobalHooks() {
        this.log('app', `pagina cargada | ${navigator.userAgent}`);

        window.addEventListener('error', (e) => {
            this.log('js-error', `${e.message} @ ${(e.filename || '?').split('/').pop()}:${e.lineno}`);
        });
        window.addEventListener('unhandledrejection', (e) => {
            const reason = e.reason;
            this.log('js-error', `promesa rechazada: ${reason && (reason.message || reason.code || reason)}`);
        });

        document.addEventListener('visibilitychange', () => {
            this.log('ciclo', document.hidden ? 'pagina OCULTA' : 'pagina visible');
        });
        window.addEventListener('online', () => this.log('red', 'online'));
        window.addEventListener('offline', () => this.log('red', 'offline'));
        window.addEventListener('pagehide', () => this.log('ciclo', 'pagehide'));
        window.addEventListener('pageshow', (e) => this.log('ciclo', `pageshow${e.persisted ? ' (bfcache)' : ''}`));
        document.addEventListener('freeze', () => this.log('ciclo', 'freeze (pestaña congelada)'));
        document.addEventListener('resume', () => this.log('ciclo', 'resume (pestaña descongelada)'));

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.attachViewerTrigger());
        } else {
            this.attachViewerTrigger();
        }
    }

    /**
     * Triple toque en el título/carátula del reproductor → abrir el visor.
     * @private
     */
    attachViewerTrigger() {
        ['currentTitle', 'currentArtist', 'currentCover'].forEach(id => {
            const el = document.getElementById(id);
            if (!el || el.dataset.debugLogHooked) return;
            el.dataset.debugLogHooked = '1';
            el.addEventListener('click', () => this.handleTap());
        });
    }

    /** @private */
    handleTap() {
        this.tapCount++;
        clearTimeout(this.tapTimer);
        this.tapTimer = setTimeout(() => { this.tapCount = 0; }, 800);
        if (this.tapCount >= 3) {
            this.tapCount = 0;
            this.show();
        }
    }

    /**
     * Muestra el panel con el registro y botones Copiar / Borrar / Cerrar.
     */
    show() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.85);' +
            'display:flex;flex-direction:column;padding:12px;gap:8px;box-sizing:border-box;';

        const title = document.createElement('div');
        title.textContent = `Registro de diagnóstico (${this.entries.length} líneas)`;
        title.style.cssText = 'color:#fff;font:bold 14px sans-serif;';

        const area = document.createElement('textarea');
        area.readOnly = true;
        area.value = this.entries.join('\n');
        area.style.cssText = 'flex:1;width:100%;background:#111;color:#0f0;border:1px solid #444;' +
            'font:11px monospace;white-space:pre;resize:none;box-sizing:border-box;';

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;';
        const makeBtn = (label, onClick) => {
            const b = document.createElement('button');
            b.textContent = label;
            b.style.cssText = 'flex:1;padding:10px;font:bold 13px sans-serif;border:0;border-radius:6px;' +
                'background:#1db954;color:#000;';
            b.addEventListener('click', onClick);
            row.appendChild(b);
            return b;
        };
        makeBtn('Copiar', async () => {
            try {
                await navigator.clipboard.writeText(area.value);
            } catch (error) {
                area.focus();
                area.select();
                document.execCommand('copy');
            }
        });
        makeBtn('Borrar', () => {
            this.clear();
            area.value = '';
            title.textContent = 'Registro de diagnóstico (0 líneas)';
        });
        makeBtn('Cerrar', () => {
            overlay.remove();
            this.overlay = null;
        });

        overlay.appendChild(title);
        overlay.appendChild(area);
        overlay.appendChild(row);
        document.body.appendChild(overlay);
        area.scrollTop = area.scrollHeight;
        this.overlay = overlay;
    }

    /**
     * Vacía el registro.
     */
    clear() {
        this.entries = [];
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (error) {
            // Ignorar
        }
    }
}

const debugLog = new DebugLog();
export default debugLog;
