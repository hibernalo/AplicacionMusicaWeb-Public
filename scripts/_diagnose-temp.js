// SOLO LECTURA. No escribe nada en Firebase. (temporal, se borra)
const admin = require('firebase-admin');
const { parseFile } = require('music-metadata');
const fs = require('fs');
const path = require('path');

const SERVICE_ACCOUNT_PATH = 'C:/Users/hiber/Music/ServiceAcount/serviceAccountKey.json';
const STORAGE_BUCKET = 'aplicacionmusicakt.firebasestorage.app';
const SONGS_FOLDER = 'C:/Users/hiber/Music/CancionesNuevas';
const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.ogg', '.wav', '.flac'];

admin.initializeApp({
    credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
    storageBucket: STORAGE_BUCKET
});
const db = admin.firestore();

async function titleFor(file) {
    const full = path.join(SONGS_FOLDER, file);
    const base = path.parse(file).name;
    try {
        const md = await parseFile(full);
        return (md.common.title || base);
    } catch {
        return base;
    }
}

async function main() {
    const pl = await db.collection('playlists').get();
    console.log(`\n=== PLAYLISTS (${pl.size}) ===`);
    pl.docs.forEach(d => {
        const x = d.data();
        console.log(`  "${x.name}"  id=${d.id}  songCount=${x.songCount}  (array songs: ${(x.songs||[]).length})`);
    });

    const songsSnap = await db.collection('songs').get();
    const existentes = new Set();
    songsSnap.docs.forEach(d => { const t = d.data().title; if (t) existentes.add(t); });
    console.log(`\n=== SONGS en Firestore: ${songsSnap.size} (títulos únicos: ${existentes.size}) ===`);

    const files = fs.readdirSync(SONGS_FOLDER).filter(f => AUDIO_EXTENSIONS.includes(path.extname(f).toLowerCase()));
    console.log(`\nLeyendo metadata de ${files.length} archivos locales...`);
    const localTitles = [];
    for (const f of files) localTitles.push(await titleFor(f));

    const counts = {};
    localTitles.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    const dupLocal = Object.entries(counts).filter(([, n]) => n > 1);

    const yaExisten = localTitles.filter(t => existentes.has(t));
    const nuevas = localTitles.filter(t => !existentes.has(t));

    console.log(`\n=== COMPARATIVA ===`);
    console.log(`  Archivos locales:                  ${files.length}`);
    console.log(`  Titulos que YA existen en songs:   ${yaExisten.length}`);
    console.log(`  Titulos NUEVOS (no existen):       ${new Set(nuevas).size} unicos / ${nuevas.length} archivos`);
    console.log(`  Titulos duplicados dentro carpeta: ${dupLocal.length}`);
    if (dupLocal.length) {
        console.log('    (colisionarian en Storage por usar Audios/<title>.mp3):');
        dupLocal.slice(0, 25).forEach(([t, n]) => console.log(`      x${n}  "${t}"`));
    }
    if (yaExisten.length) {
        console.log('\n  Ejemplos de los que YA existen (primeros 15):');
        [...new Set(yaExisten)].slice(0, 15).forEach(t => console.log(`      - "${t}"`));
    }
    process.exit(0);
}
main().catch(e => { console.error('Error:', e); process.exit(1); });
