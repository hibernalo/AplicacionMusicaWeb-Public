/**
 * Singleton de estadísticas de escucha con las dependencias reales
 * (Firestore, localStorage, registro de diagnóstico) y los disparadores de
 * volcado ligados al ciclo de vida de la página.
 *
 * La lógica está en listening-stats-service.js (sin dependencias, con test
 * en test/listening-stats-service.test.js). Aquí solo se cablea.
 */
import { db } from './firebase-config.js';
import debugLog from './debug-log.js';
import ListeningStatsService from './listening-stats-service.js';

let storage = null;
try {
    storage = window.localStorage;
    storage.getItem('__probe__');
} catch (error) {
    storage = null; // modo privado / bloqueado: seguir solo en memoria
}

const listeningStats = new ListeningStatsService({
    db,
    increment: (n) => firebase.firestore.FieldValue.increment(n),
    documentIdField: () => firebase.firestore.FieldPath.documentId(),
    storage,
    logger: (mensaje) => debugLog.log('stats', mensaje)
});

// Disparadores de volcado. Todos son "best-effort" y ninguno bloquea nada:
// flush() nunca lanza y no se espera su resultado.
//
// - Cambio de canción: lo más habitual (cada 3-4 minutos).
// - Pausa del <audio>: también salta justo antes de 'ended'. Su parte
//   síncrona es mínima (armar el batch), así que no interfiere con la vía
//   rápida ended → play() que exige CLAUDE.md.
// - Página oculta: la pantalla se apaga o se cambia de app; es la última
//   oportunidad con red casi segura.
// - Vuelve la red: reintentar lo que quedó sin confirmar.
// - pagehide: solo persistir en localStorage (no hay tiempo para red).
document.addEventListener('songChanged', () => listeningStats.flush());
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        listeningStats.persistNow();
        listeningStats.flush();
    }
});
window.addEventListener('online', () => listeningStats.flush());
window.addEventListener('pagehide', () => listeningStats.persistNow());

const attachAudioHooks = () => {
    const audio = document.getElementById('audioElement');
    if (audio) {
        audio.addEventListener('pause', () => listeningStats.flush());
    }
};
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachAudioHooks);
} else {
    attachAudioHooks();
}

export default listeningStats;
