// ============================================================================
// CONFIGURAR CORS EN EL BUCKET DE FIREBASE STORAGE
// ============================================================================
//
// Uso:
//   node scripts/set-storage-cors.js            # aplica la configuración
//   node scripts/set-storage-cors.js --show     # sólo muestra la actual
//   node scripts/set-storage-cors.js --clear    # la elimina (vuelve al estado anterior)
//
// Por qué hace falta:
//   El reproductor precarga en memoria la siguiente canción con fetch()
//   (js/song-prefetcher.js) para que la transición entre canciones no
//   dependa de la red (con la pantalla del móvil apagada el sistema corta la
//   red/JS en cuanto deja de sonar audio). Un fetch() desde el navegador a
//   otro origen (firebasestorage.googleapis.com) sólo puede leer los bytes si
//   el bucket devuelve la cabecera Access-Control-Allow-Origin, y por defecto
//   NO la devuelve para las descargas (?alt=media).
//
//   Esta configuración sólo permite GET/HEAD. Los ficheros del bucket ya son
//   de lectura pública (cualquiera con la URL puede descargarlos), así que no
//   expone nada nuevo: únicamente permite que el JavaScript de la web lea los
//   bytes que el <audio> ya podía reproducir.
//
// Requisitos: los mismos que scripts/upload-songs.js (firebase-admin y la
// clave de cuenta de servicio en SERVICE_ACCOUNT_PATH).
//
// ============================================================================

const admin = require('firebase-admin');

// --- Configuracion (misma que upload-songs.js) ---
const SERVICE_ACCOUNT_PATH = 'C:/Users/hiber/Music/ServiceAcount/serviceAccountKey.json';
const STORAGE_BUCKET = 'aplicacionmusicakt.firebasestorage.app';

// Sólo lectura (GET/HEAD) desde cualquier origen: la web se sirve desde
// *.web.app, *.firebaseapp.com y localhost durante el desarrollo.
const CORS_CONFIG = [
    {
        origin: ['*'],
        method: ['GET', 'HEAD'],
        responseHeader: ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'Range'],
        maxAgeSeconds: 3600
    }
];

async function main() {
    const args = process.argv.slice(2);
    const show = args.includes('--show');
    const clear = args.includes('--clear');

    admin.initializeApp({
        credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
        storageBucket: STORAGE_BUCKET
    });
    const bucket = admin.storage().bucket();

    const [before] = await bucket.getMetadata();
    console.log(`Bucket: ${bucket.name}`);
    console.log('CORS actual:', JSON.stringify(before.cors || [], null, 2));

    if (show) {
        return;
    }

    const nuevo = clear ? [] : CORS_CONFIG;
    await bucket.setCorsConfiguration(nuevo);

    const [after] = await bucket.getMetadata();
    console.log(clear ? '\nCORS eliminado.' : '\nCORS aplicado.');
    console.log('CORS resultante:', JSON.stringify(after.cors || [], null, 2));
    console.log('\nNota: puede tardar unos minutos en propagarse a todas las respuestas.');
}

main().catch(error => {
    console.error('Error configurando CORS:', error.message || error);
    process.exit(1);
});
