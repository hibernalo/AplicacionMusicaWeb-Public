// Detecta y (opcionalmente) borra documentos "huérfanos" de la colección
// `songs`: aquellos cuyo archivo de audio no existe en Storage. Son las
// canciones que cargan título/metadata pero fallan al reproducir.
//
// USO:
//   1) Revisar primero (no borra nada):   node scripts/clean-orphan-songs.js
//   2) Borrar de verdad:                  node scripts/clean-orphan-songs.js --apply
//
// Requiere firebase-admin y la service account (igual que los demás scripts).

const admin = require('firebase-admin');

const SERVICE_ACCOUNT_PATH = 'C:/Users/hiber/Music/ServiceAcount/serviceAccountKey.json';
const STORAGE_BUCKET = 'aplicacionmusicakt.firebasestorage.app';

// Por seguridad, solo borra si se pasa --apply en la línea de comandos.
const DRY_RUN = !process.argv.includes('--apply');
// Cuántas comprobaciones de Storage hacer en paralelo.
const CONCURRENCY = 10;

const serviceAccount = require(SERVICE_ACCOUNT_PATH);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: STORAGE_BUCKET
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

/**
 * Determina si una canción es huérfana (sin audio reproducible en Storage).
 * @returns {Promise<{orphan: boolean, reason: string}>}
 */
async function checkSong(data) {
    const audioPath = (data.audioPath || '').trim();
    if (!audioPath) {
        return { orphan: true, reason: 'sin audioPath' };
    }
    try {
        const [exists] = await bucket.file(audioPath).exists();
        if (!exists) {
            return { orphan: true, reason: `archivo no existe: ${audioPath}` };
        }
        return { orphan: false, reason: '' };
    } catch (e) {
        return { orphan: true, reason: `error comprobando ${audioPath}: ${e.message}` };
    }
}

/** Procesa un array en lotes con concurrencia limitada. */
async function mapLimit(items, limit, fn) {
    const results = [];
    for (let i = 0; i < items.length; i += limit) {
        const chunk = items.slice(i, i + limit);
        const res = await Promise.all(chunk.map(fn));
        results.push(...res);
        process.stdout.write(`\r  Comprobadas ${Math.min(i + limit, items.length)}/${items.length}`);
    }
    process.stdout.write('\n');
    return results;
}

async function main() {
    console.log('=== Limpieza de canciones huérfanas ===');
    console.log(DRY_RUN
        ? 'MODO REVISIÓN (no se borra nada). Usa --apply para borrar.\n'
        : 'MODO BORRADO (--apply): se eliminarán los documentos huérfanos.\n');

    const snapshot = await db.collection('songs').get();
    const docs = snapshot.docs.map(d => ({ id: d.id, data: d.data() }));
    console.log(`Total de canciones en Firestore: ${docs.length}`);
    console.log('Comprobando archivos en Storage...');

    const checks = await mapLimit(docs, CONCURRENCY, async (doc) => {
        const result = await checkSong(doc.data);
        return { ...doc, ...result };
    });

    const orphans = checks.filter(c => c.orphan);

    console.log(`\nHuérfanas encontradas: ${orphans.length}`);
    orphans.forEach(o => {
        const title = o.data.title || '(sin título)';
        console.log(`  - ${o.id}  "${title}"  [${o.reason}]`);
    });

    if (orphans.length === 0) {
        console.log('\nNada que limpiar.');
        process.exit(0);
    }

    if (DRY_RUN) {
        console.log('\nRevisión completada. Ejecuta con --apply para borrarlas.');
        process.exit(0);
    }

    // Borrado real
    let okDocs = 0, failDocs = 0, okCovers = 0;
    for (const o of orphans) {
        try {
            await db.collection('songs').doc(o.id).delete();
            okDocs++;
            console.log(`Documento borrado: ${o.id} "${o.data.title || ''}"`);
        } catch (e) {
            failDocs++;
            console.error(`ERROR borrando documento ${o.id}:`, e.message);
            continue;
        }

        // Intentar borrar la portada huérfana asociada (best-effort).
        const coverPath = (o.data.coverPath || '').trim();
        if (coverPath) {
            try {
                await bucket.file(coverPath).delete();
                okCovers++;
            } catch (e) {
                // Si no existe o falla, no es crítico.
            }
        }
    }

    console.log('\n=== Resumen ===');
    console.log(`  Documentos borrados: ${okDocs}/${orphans.length} (fallidos: ${failDocs})`);
    console.log(`  Portadas borradas:   ${okCovers}`);
    process.exit(0);
}

main().catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
});
