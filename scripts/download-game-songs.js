// ============================================================================
// DESCARGA DE CANCIONES CON genre == 'game'
// ============================================================================
//
// Uso:
//   node scripts/download-game-songs.js
//
// Descripcion:
//   Consulta Firestore por todas las canciones cuyo campo genre sea 'game' y,
//   por cada valor distinto de 'source', crea una carpeta con dos subcarpetas:
//     C:/Users/hiber/Music/MusicaRoblox/<source>/audios/<archivo>
//     C:/Users/hiber/Music/MusicaRoblox/<source>/covers/<archivo>
//   Las covers se deduplican por contenido: si dos canciones comparten la misma
//   imagen, solo se guarda una vez (con el nombre de la primera encontrada).
//
// ============================================================================

const admin = require('firebase-admin');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// --- Configuracion ---
const SERVICE_ACCOUNT_PATH = 'C:/Users/hiber/Music/ServiceAcount/serviceAccountKey.json';
const STORAGE_BUCKET = 'aplicacionmusicakt.firebasestorage.app';
const OUTPUT_ROOT = 'C:/Users/hiber/Music/MusicaRoblox';

const serviceAccount = require(SERVICE_ACCOUNT_PATH);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: STORAGE_BUCKET
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

// Limpia un nombre para usarlo como carpeta/archivo en Windows
function sanitize(name) {
    return String(name || '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\.+$/, '')
        .trim() || 'desconocido';
}

async function main() {
    console.log('=== Descargando canciones genre == "game" ===\n');

    const snapshot = await db.collection('songs').where('genre', '==', 'game').get();

    if (snapshot.empty) {
        console.log('No se encontraron canciones con genre == "game".');
        process.exit(0);
    }

    console.log(`Encontradas ${snapshot.size} canciones.\n`);

    let okAudio = 0, failAudio = 0, skipAudio = 0;
    let okCover = 0, dupCover = 0, failCover = 0;
    const porSource = {};

    // Por cada source: { hash -> fileName } para deduplicar covers por contenido,
    // y un Set de nombres ya usados para resolver colisiones de nombre.
    const coverHashes = {};   // source -> Map(hashHex -> fileName)
    const coverNames = {};    // source -> Set(fileName)

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const title = data.title || doc.id;
        const audioPath = data.audioPath;
        const coverPath = data.coverPath;
        const source = sanitize(data.source || 'sin_source');

        const audiosDir = path.join(OUTPUT_ROOT, source, 'audios');
        const coversDir = path.join(OUTPUT_ROOT, source, 'covers');

        // --- Audio ---
        if (!audioPath) {
            console.warn(`  SKIP audio "${title}": sin audioPath`);
            skipAudio++;
        } else {
            fs.mkdirSync(audiosDir, { recursive: true });
            const fileName = sanitize(path.basename(audioPath));
            const destPath = path.join(audiosDir, fileName);
            if (fs.existsSync(destPath)) {
                console.log(`  YA EXISTE audio [${source}] ${fileName}`);
                skipAudio++;
            } else {
                try {
                    await bucket.file(audioPath).download({ destination: destPath });
                    console.log(`  OK audio [${source}] ${fileName}`);
                    okAudio++;
                } catch (e) {
                    console.error(`  ERROR audio "${title}" (${audioPath}):`, e.message);
                    failAudio++;
                }
            }
        }

        // --- Cover (deduplicada por contenido dentro del source) ---
        if (coverPath) {
            if (!coverHashes[source]) {
                coverHashes[source] = new Map();
                coverNames[source] = new Set();
            }
            try {
                const [buffer] = await bucket.file(coverPath).download();
                const hash = crypto.createHash('md5').update(buffer).digest('hex');

                if (coverHashes[source].has(hash)) {
                    // Cover identica ya guardada: no duplicar
                    dupCover++;
                } else {
                    fs.mkdirSync(coversDir, { recursive: true });
                    // Resolver colision de nombre (distinto contenido, mismo basename)
                    let fileName = sanitize(path.basename(coverPath));
                    if (coverNames[source].has(fileName)) {
                        const ext = path.extname(fileName);
                        const base = path.basename(fileName, ext);
                        let i = 2;
                        while (coverNames[source].has(`${base} (${i})${ext}`)) i++;
                        fileName = `${base} (${i})${ext}`;
                    }
                    fs.writeFileSync(path.join(coversDir, fileName), buffer);
                    coverHashes[source].set(hash, fileName);
                    coverNames[source].add(fileName);
                    console.log(`  OK cover [${source}] ${fileName}`);
                    okCover++;
                }
            } catch (e) {
                console.error(`  ERROR cover "${title}" (${coverPath}):`, e.message);
                failCover++;
            }
        }

        porSource[source] = (porSource[source] || 0) + 1;
    }

    console.log('\n=== Resumen ===');
    console.log(`  Audios -> descargados: ${okAudio}, saltados: ${skipAudio}, fallidos: ${failAudio}`);
    console.log(`  Covers -> guardadas: ${okCover}, duplicadas omitidas: ${dupCover}, fallidas: ${failCover}`);
    console.log('\n  Canciones por source:');
    Object.keys(porSource).sort().forEach(s => {
        console.log(`    ${s}: ${porSource[s]}`);
    });

    process.exit(0);
}

main().catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
});
