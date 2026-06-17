// Revierte la subida hecha por upload-songs.js: borra documentos de Firestore
// y archivos de Storage creados en la última ejecución.

const admin = require('firebase-admin');

const SERVICE_ACCOUNT_PATH = 'C:/Users/hiber/Music/ServiceAcount/serviceAccountKey.json';
const STORAGE_BUCKET = 'aplicacionmusicakt.firebasestorage.app';

const serviceAccount = require(SERVICE_ACCOUNT_PATH);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: STORAGE_BUCKET
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

const UPLOADED = [
    { id: 'Uy4spgPzVtBnOADZNyfG', audio: 'Audios/BLACK OUT - EXTENDED MIX.mp3' },
    { id: 'lnGo2d881L3aQ3IyD87v', audio: 'Audios/Dancing - Extended mix.mp3' },
    { id: 'x2JKzUETM22xTpYjs331', audio: "Audios/I Won't Fall Apart - Eurobeat Version.mp3" },
    { id: 'SjkZNK0SR4jI1ijMuxd9', audio: 'Audios/In Hell We Live, Lament (feat. KIHOW).mp3' },
    { id: 'DnZS2oLFResq3bBHWqnI', audio: 'Audios/Lost Into The Night.mp3' },
    { id: 'CrcHFGvrrJNX7V4aOAj5', audio: 'Audios/SR CANGREJO.mp3' }
];

async function main() {
    console.log('=== Revirtiendo subida ===\n');
    let okDocs = 0, failDocs = 0, okFiles = 0, failFiles = 0;

    for (const item of UPLOADED) {
        console.log(`Procesando: ${item.id}`);

        try {
            await db.collection('songs').doc(item.id).delete();
            console.log(`  Documento borrado: ${item.id}`);
            okDocs++;
        } catch (e) {
            console.error(`  ERROR borrando documento ${item.id}:`, e.message);
            failDocs++;
        }

        try {
            await bucket.file(item.audio).delete();
            console.log(`  Archivo borrado: ${item.audio}`);
            okFiles++;
        } catch (e) {
            console.error(`  ERROR borrando archivo ${item.audio}:`, e.message);
            failFiles++;
        }
    }

    console.log('\n=== Resumen ===');
    console.log(`  Documentos borrados: ${okDocs}/${UPLOADED.length} (fallidos: ${failDocs})`);
    console.log(`  Archivos borrados:   ${okFiles}/${UPLOADED.length} (fallidos: ${failFiles})`);
    process.exit(0);
}

main().catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
});
