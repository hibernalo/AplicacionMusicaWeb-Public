// Corrige los `audioPath` / `coverPath` de canciones cuyo archivo SÍ existe en
// Storage pero bajo un nombre ligeramente distinto (típico: apóstrofos o `%`
// que al guardar se convirtieron en `_`). En vez de borrar la canción,
// reapunta la ruta al archivo real encontrado por coincidencia normalizada.
//
// USO:
//   1) Revisar (no escribe nada):   node scripts/fix-orphan-paths.js
//   2) Aplicar correcciones:        node scripts/fix-orphan-paths.js --apply

const admin = require('firebase-admin');

const SERVICE_ACCOUNT_PATH = 'C:/Users/hiber/Music/ServiceAcount/serviceAccountKey.json';
const STORAGE_BUCKET = 'aplicacionmusicakt.firebasestorage.app';

const DRY_RUN = !process.argv.includes('--apply');

admin.initializeApp({
    credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
    storageBucket: STORAGE_BUCKET
});
const db = admin.firestore();
const bucket = admin.storage().bucket();

// Normaliza un nombre: minúsculas y todo lo que no sea letra/número (espacios,
// apóstrofos, %, ·, puntuación...) se colapsa en `_`. Conserva caracteres CJK.
function norm(name) {
    return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_');
}

// Construye un índice normalizado -> nombre real para una carpeta de Storage.
// Marca como ambiguos los nombres normalizados que apuntan a >1 archivo.
async function buildIndex(prefix) {
    const [files] = await bucket.getFiles({ prefix });
    const index = new Map();
    const ambiguous = new Set();
    const exact = new Set();
    for (const f of files) {
        if (f.name.endsWith('/')) continue; // carpeta
        exact.add(f.name);
        const key = norm(f.name);
        if (index.has(key) && index.get(key) !== f.name) {
            ambiguous.add(key);
        } else {
            index.set(key, f.name);
        }
    }
    return { index, ambiguous, exact };
}

// Devuelve la ruta corregida, o null si ya es válida / no hay match único.
function resolve(path, idx) {
    if (!path) return null;
    if (idx.exact.has(path)) return null;        // ya apunta a un archivo real
    const key = norm(path);
    if (idx.ambiguous.has(key)) return 'AMBIGUO';
    const real = idx.index.get(key);
    return real && real !== path ? real : (real ? null : 'NO_ENCONTRADO');
}

async function main() {
    console.log('=== Corrección de rutas huérfanas ===');
    console.log(DRY_RUN ? 'MODO REVISIÓN (no escribe). Usa --apply para aplicar.\n'
                        : 'MODO APLICAR (--apply): se actualizarán los documentos.\n');

    console.log('Indexando Storage (Audios/ y Covers/)...');
    const audioIdx = await buildIndex('Audios/');
    const coverIdx = await buildIndex('Covers/');
    console.log(`  Audios: ${audioIdx.exact.size} archivos | Covers: ${coverIdx.exact.size} archivos\n`);

    const snapshot = await db.collection('songs').get();

    const fixes = [];      // {id, title, audioFrom, audioTo, coverFrom, coverTo}
    const problems = [];   // canciones sin match (realmente perdidas o ambiguas)

    snapshot.docs.forEach(doc => {
        const d = doc.data();
        const newAudio = resolve(d.audioPath, audioIdx);
        const newCover = resolve(d.coverPath, coverIdx);

        const audioBad = newAudio === 'NO_ENCONTRADO' || newAudio === 'AMBIGUO';
        const coverBad = newCover === 'AMBIGUO'; // cover sin match no es crítico (hay placeholder)

        const audioFix = newAudio && !audioBad ? newAudio : null;
        const coverFix = newCover && !coverBad ? newCover : null;

        if (audioFix || coverFix) {
            fixes.push({ id: doc.id, title: d.title || '', audioFrom: d.audioPath, audioTo: audioFix, coverFrom: d.coverPath, coverTo: coverFix });
        }
        if (audioBad) {
            problems.push({ id: doc.id, title: d.title || '', audioPath: d.audioPath, estado: newAudio });
        }
    });

    console.log(`Canciones con ruta corregible: ${fixes.length}`);
    fixes.forEach(f => {
        console.log(`\n  "${f.title}" (${f.id})`);
        if (f.audioTo) console.log(`    audio: ${f.audioFrom}\n        -> ${f.audioTo}`);
        if (f.coverTo) console.log(`    cover: ${f.coverFrom}\n        -> ${f.coverTo}`);
    });

    if (problems.length) {
        console.log(`\nCanciones con audio SIN match (revisar manualmente): ${problems.length}`);
        problems.forEach(p => console.log(`  - ${p.id} "${p.title}" [${p.estado}] ${p.audioPath}`));
    }

    if (DRY_RUN) {
        console.log('\nRevisión completada. Ejecuta con --apply para aplicar las correcciones.');
        process.exit(0);
    }

    let ok = 0, fail = 0;
    for (const f of fixes) {
        const update = {};
        if (f.audioTo) update.audioPath = f.audioTo;
        if (f.coverTo) update.coverPath = f.coverTo;
        try {
            await db.collection('songs').doc(f.id).update(update);
            ok++;
            console.log(`Actualizado: ${f.id} "${f.title}"`);
        } catch (e) {
            fail++;
            console.error(`ERROR actualizando ${f.id}:`, e.message);
        }
    }

    console.log('\n=== Resumen ===');
    console.log(`  Documentos corregidos: ${ok}/${fixes.length} (fallidos: ${fail})`);
    console.log(`  Sin match (no tocados): ${problems.length}`);
    process.exit(0);
}

main().catch(e => { console.error('Error fatal:', e); process.exit(1); });
