// ============================================================================
// Marca con hideFromHome:true las canciones que pertenecen a una playlist dada
// (por nombre). Estas canciones dejaran de aparecer en Inicio (vista aleatoria),
// pero siguen accesibles desde playlists y filtros.
//
// Uso:
//   node scripts/mark-hide-from-home.js --playlist JoelNuevas
//   node scripts/mark-hide-from-home.js --playlist JoelNuevas --unset   (revierte)
// ============================================================================

const admin = require('firebase-admin');

const SERVICE_ACCOUNT_PATH = 'C:/Users/hiber/Music/ServiceAcount/serviceAccountKey.json';

function getArg(name, fallback) {
    const idx = process.argv.indexOf(`--${name}`);
    return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}
const PLAYLIST_NAME = getArg('playlist', 'JoelNuevas');
const UNSET = process.argv.includes('--unset');

const serviceAccount = require(SERVICE_ACCOUNT_PATH);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
    console.log(`=== Marcar hideFromHome (${UNSET ? 'QUITAR' : 'PONER'}) ===`);
    console.log(`  Playlist: ${PLAYLIST_NAME}\n`);

    // 1. Leer los titulos de la playlist
    const snap = await db.collection('playlists').where('name', '==', PLAYLIST_NAME).limit(1).get();
    if (snap.empty) {
        console.error(`Playlist "${PLAYLIST_NAME}" no encontrada.`);
        process.exit(1);
    }
    const titles = new Set(snap.docs[0].data().songs || []);
    console.log(`  Titulos en la playlist: ${titles.size}`);

    // 2. Recorrer todas las canciones y actualizar las que coincidan por titulo
    const value = UNSET ? admin.firestore.FieldValue.delete() : true;
    let batch = db.batch();
    let batchCount = 0;
    let actualizadas = 0;
    let last = null;
    const encontrados = new Set();

    while (true) {
        let q = db.collection('songs').orderBy('__name__').limit(400);
        if (last) q = q.startAfter(last);
        const s = await q.get();
        if (s.empty) break;

        for (const doc of s.docs) {
            const title = doc.data().title;
            if (titles.has(title)) {
                encontrados.add(title);
                batch.update(doc.ref, { hideFromHome: value });
                batchCount++;
                actualizadas++;
                if (batchCount === 400) {
                    await batch.commit();
                    batch = db.batch();
                    batchCount = 0;
                }
            }
        }
        last = s.docs[s.docs.length - 1];
        if (s.size < 400) break;
    }
    if (batchCount > 0) await batch.commit();

    console.log(`\n  Documentos actualizados: ${actualizadas}`);

    // 3. Reportar titulos de la playlist que no se encontraron como cancion
    const noEncontrados = [...titles].filter(t => !encontrados.has(t));
    if (noEncontrados.length > 0) {
        console.log(`  Titulos de la playlist SIN documento de cancion: ${noEncontrados.length}`);
        noEncontrados.slice(0, 20).forEach(t => console.log(`    - ${t}`));
    }

    process.exit(0);
}

main().catch(e => { console.error('Error fatal:', e); process.exit(1); });
