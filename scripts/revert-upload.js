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
    { id: '7xTYa2TNqOaLRxhk30P3', audio: 'Audios/Applause.mp3' },
    { id: '9NVXPWds995wCFbGKOdu', audio: 'Audios/ASBAK ANTHEM.mp3' },
    { id: 'bJGyrkvN3FNXB79zJPcQ', audio: 'Audios/BARREL KICK.mp3' },
    { id: '453F5fuDfrw44rldVjWN', audio: 'Audios/Bass In Your Face (Vocals from Yellow Claw & Juyen Sebulba’s “Do You Like Bass”).mp3' },
    { id: 'SAGOZbxFiovaqOjKFwyc', audio: 'Audios/Bass Powah.mp3' },
    { id: 'I3y2g7zKz7h00F9U7cdH', audio: 'Audios/Black Sky.mp3' },
    { id: 'cfrC1kw6kdjbH0ag9bvt', audio: 'Audios/BLOW IT UP.mp3' },
    { id: 'VJt2PP9aYmah6AVELEAu', audio: 'Audios/Burn the Floor.mp3' },
    { id: 'iVmOV7mYNApLYqxeL06W', audio: 'Audios/Buttercup With An Axe.mp3' },
    { id: 'AMw7sFM31GKQRVQ03jl3', audio: 'Audios/Chemical Love - Kevin & Cherry [Initial D AMV]-W-vLGHvEaCY.mp3' },
    { id: '8tKLzhPFb32Fag6K4o4g', audio: 'Audios/Dawid Podsiadło, P.T. Adamczyk — Phantom Liberty (Official Cyberpunk 2077 Music Video)-u15tEo0wsQI.mp3', cover: 'Covers/Dawid Podsiadło, P.T. Adamczyk — Phantom Liberty (Official Cyberpunk 2077 Music Video)-u15tEo0wsQI.jpg' },
    { id: 'ynhNVERyNcLsWPMghbzc', audio: 'Audios/DOMINATION.mp3' },
    { id: 'nVPvxLVcYaGxjo00sfSp', audio: "Audios/DON'T WANNA MISS THIS.mp3" },
    { id: 'MsN9UTnAgBKwDNt5K7xu', audio: 'Audios/DUAL ROZES-OTJcxjORFnY.mp3' },
    { id: 'AQ5KVIL7hm7kQcYQcGG9', audio: 'Audios/Excuse Me.mp3' },
    { id: 'EJlh2Ls2rfWw6qwne9dF', audio: 'Audios/F1.mp3' },
    { id: 'W4t1ssWuvXLPYoiTi212', audio: "Audios/Gangsta's Paradise.mp3" },
    { id: 'c1CPl4fiQoAN2ZBFGq67', audio: 'Audios/Ha Ha.mp3' },
    { id: 'awcbknuVdt5fdaPWmQZq', audio: 'Audios/Hard Beat.mp3' },
    { id: 'Z27YIYn5E78PiTANnhQd', audio: 'Audios/HIT IT BOY.mp3' },
    { id: 'G9Iw4y12vCs5vsngMYsO', audio: 'Audios/Hit The Floor.mp3' },
    { id: 'jgrhI6KdVSYzwXLhtD7i', audio: 'Audios/Holy Atlantis.mp3' },
    { id: 'qSVnyGYUKOKVL3eHhtyM', audio: 'Audios/I RUN.mp3' },
    { id: 'boqtE6clMFTldL1ssSwR', audio: 'Audios/IGNITE THE POWER-5qq3nNN8zzQ.mp3' },
    { id: '4Y7c9yHG13DJ2QjE2vHE', audio: 'Audios/In The Dark.mp3' },
    { id: 'XnhuNsvCD8BnlZXD7GCm', audio: 'Audios/Kavinsky - Nightcall (Drive Original Movie Soundtrack) (Official Audio)-MV_3Dpw-BRY.mp3' },
    { id: 'ke2uo0zBw3SpF0fMZm81', audio: 'Audios/KIRA.mp3' },
    { id: 'RNzcXAKcLwieALnDTS7o', audio: 'Audios/KISS ME AGAIN.mp3' },
    { id: '6KN8JJamySA0HAxRsbbP', audio: 'Audios/LIKE ME.mp3' },
    { id: 'iwgJb2qPIfJCShb9Jdyd', audio: 'Audios/Lucky Lucky.mp3' },
    { id: 'jNEsq1fYa9v2o9g25yg4', audio: 'Audios/MBKetamine.mp3' },
    { id: 'T69AbXrJahYPGkPe2I0Q', audio: 'Audios/MBKETAMINE.mp3' },
    { id: 'Ld1uSRQ9U9kpevAZx7m7', audio: 'Audios/No Balance.mp3' },
    { id: 'QbcmOV8EalrZriDrVKRG', audio: 'Audios/On Fire.mp3' },
    { id: 'YVvcomVzuoCYY2w5hEjW', audio: 'Audios/One Man Army.mp3' },
    { id: 'vnlc6H4JdK5lF65wgsPa', audio: 'Audios/Outro.mp3' },
    { id: 'DFoIwpj6rTVnNkPxvsII', audio: 'Audios/POLSKA JUMPSTYLE VIP.mp3' },
    { id: 'hNuf2Z8uIZ04NIJ8K6Gc', audio: 'Audios/SCANDAL ANTHEM.mp3' },
    { id: 'yQDiL5CL82yx7p2jeIZQ', audio: 'Audios/Shake That Bunda.mp3' },
    { id: 'Aw3CnLeaiIefQJCROc7U', audio: 'Audios/SHITTY MUSIC.mp3' },
    { id: '8KrvGB9fhK1s3HEZ7qQa', audio: 'Audios/Summersong.mp3' },
    { id: 'j2O5CtmWPiPnz9OiEMqF', audio: 'Audios/TVアニメ「その着せ替え人形は恋をする」Season 2│PiKi「Kawaii Kaiwai」ノンクレジットエンディング映像-75WraMAZ0Lo.mp3' },
    { id: 'ake3Fly4i9HilTTgZJ4N', audio: 'Audios/Vielleicht Vielleicht - Holy Priest & elMefti Remix.mp3' },
    { id: 'SM21RlHmFySGYtQUHx45', audio: 'Audios/Voices In My Head x Freaks x Love Parade.mp3' },
    { id: '0hPxCHO15SCaZefV0wS2', audio: 'Audios/WTF?.mp3' },
    { id: 'rRXQy8huZ05rKIuTSYzY', audio: 'Audios/[AMV]  InitialD  -  Love is In Danger⧸Priscilla-yNpV1sTspMI.mp3' },
    { id: '45QaNBEnDaauq9gwcir1', audio: 'Audios/【MAD】VICTORIA ⧸ STAY  × 頭文字D【AMV】【initiald】-uttXDSwWZo0.mp3' }
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

        if (item.cover) {
            try {
                await bucket.file(item.cover).delete();
                console.log(`  Cover borrado: ${item.cover}`);
                okFiles++;
            } catch (e) {
                console.error(`  ERROR borrando cover ${item.cover}:`, e.message);
                failFiles++;
            }
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
