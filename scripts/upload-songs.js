// ============================================================================
// SCRIPT DE SUBIDA DE CANCIONES A FIREBASE
// ============================================================================
//
// Uso:
//   node scripts/upload-songs.js
//
// Requisitos previos:
//   1. Tener Node.js instalado
//   2. Instalar dependencias: npm install firebase-admin music-metadata
//   3. Configurar las rutas en las constantes SERVICE_ACCOUNT_PATH,
//      SONGS_FOLDER y COVERS_FOLDER al inicio del script
//
// Descripcion:
//   Lee archivos de audio de una carpeta local, extrae sus metadatos (titulo,
//   artista, album, año), busca covers coincidentes y sube todo a Firebase
//   Storage y Firestore.
//
// ============================================================================

const admin = require('firebase-admin');
const { parseFile } = require('music-metadata');
const fs = require('fs');
const path = require('path');

// --- Configuracion ---
const SERVICE_ACCOUNT_PATH = 'C:/Users/hiber/Music/ServiceAcount/serviceAccountKey.json';
const SONGS_FOLDER = 'C:/Users/hiber/Music/CancionesNuevas';
const COVERS_FOLDER = 'C:/Users/hiber/Music/CoversNuevas';
const STORAGE_BUCKET = 'aplicacionmusicakt.firebasestorage.app';

// Inicializar Firebase Admin
const serviceAccount = require(SERVICE_ACCOUNT_PATH);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: STORAGE_BUCKET
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

// Extensiones de audio validas
const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.ogg', '.wav', '.flac'];
// Extensiones de imagen validas
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * Lee los metadatos de un archivo de audio (titulo, artista, album, año)
 */
async function readMetadata(filePath) {
    try {
        const metadata = await parseFile(filePath);
        return {
            title: metadata.common.title || null,
            artist: metadata.common.artist || null,
            album: metadata.common.album || null,
            year: metadata.common.year || null
        };
    } catch (error) {
        console.error(`  Error leyendo metadatos de ${path.basename(filePath)}:`, error.message);
        return { title: null, artist: null, album: null, year: null };
    }
}

/**
 * Busca un archivo de cover que coincida con el nombre base del audio
 */
function findCover(audioBaseName) {
    for (const ext of IMAGE_EXTENSIONS) {
        const coverPath = path.join(COVERS_FOLDER, audioBaseName + ext);
        if (fs.existsSync(coverPath)) {
            return coverPath;
        }
    }
    return null;
}

/**
 * Sube un archivo a Firebase Storage
 */
async function uploadToStorage(localPath, storagePath) {
    await bucket.upload(localPath, {
        destination: storagePath,
        metadata: {
            cacheControl: 'public, max-age=31536000'
        }
    });
    console.log(`  Subido: ${storagePath}`);
    return storagePath;
}

/**
 * Crea el documento de la cancion en Firestore
 */
async function createSongDocument(data) {
    const docRef = await db.collection('songs').add(data);
    console.log(`  Documento creado: ${docRef.id}`);
    return docRef.id;
}

/**
 * Procesa y sube una cancion
 */
async function processSong(audioFile) {
    const audioBaseName = path.parse(audioFile).name;
    const audioExt = path.parse(audioFile).ext;
    const audioFullPath = path.join(SONGS_FOLDER, audioFile);

    console.log(`\nProcesando: ${audioFile}`);

    // 1. Leer metadatos del MP3
    const metadata = await readMetadata(audioFullPath);
    const title = metadata.title || audioBaseName;
    const artist = metadata.artist || '';
    const album = metadata.album || '';
    const year = metadata.year || null;

    console.log(`  Titulo: ${title}`);
    console.log(`  Artista: ${artist}`);
    console.log(`  Album: ${album}`);
    console.log(`  Año: ${year || 'N/A'}`);

    // 2. Buscar cover correspondiente
    const coverLocalPath = findCover(audioBaseName);
    if (coverLocalPath) {
        console.log(`  Cover encontrado: ${path.basename(coverLocalPath)}`);
    } else {
        console.log('  Sin cover encontrado');
    }

    // 3. Subir audio a Storage
    const audioStoragePath = `Audios/${title}${audioExt}`;
    await uploadToStorage(audioFullPath, audioStoragePath);

    // 4. Subir cover a Storage (si existe)
    let coverStoragePath = '';
    if (coverLocalPath) {
        const coverExt = path.parse(coverLocalPath).ext;
        coverStoragePath = `Covers/${title}${coverExt}`;
        await uploadToStorage(coverLocalPath, coverStoragePath);
    }

    // 5. Crear documento en Firestore
    const songData = {
        title: title,
        titleMinusculas: title.toLowerCase(),
        artist: artist,
        album: album,
        year: year,
        genre: '',
        source: '',
        audioPath: audioStoragePath,
        coverPath: coverStoragePath,
        rand: Math.random(),
        liked: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await createSongDocument(songData);
    console.log(`  OK - "${title}" subida correctamente`);
}

/**
 * Funcion principal
 */
async function main() {
    console.log('=== Script de subida de canciones ===\n');

    // Validar que las carpetas existen
    if (!fs.existsSync(SONGS_FOLDER)) {
        console.error(`Error: La carpeta de canciones no existe: ${SONGS_FOLDER}`);
        process.exit(1);
    }
    if (!fs.existsSync(COVERS_FOLDER)) {
        console.error(`Error: La carpeta de covers no existe: ${COVERS_FOLDER}`);
        process.exit(1);
    }

    // Leer archivos de audio
    const allFiles = fs.readdirSync(SONGS_FOLDER);
    const audioFiles = allFiles.filter(f => {
        const ext = path.extname(f).toLowerCase();
        return AUDIO_EXTENSIONS.includes(ext);
    });

    if (audioFiles.length === 0) {
        console.log('No se encontraron archivos de audio en la carpeta.');
        process.exit(0);
    }

    console.log(`Encontradas ${audioFiles.length} canciones para subir:\n`);
    audioFiles.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));

    // Procesar cada cancion
    let exitosas = 0;
    let fallidas = 0;

    for (const audioFile of audioFiles) {
        try {
            await processSong(audioFile);
            exitosas++;
        } catch (error) {
            console.error(`  ERROR procesando ${audioFile}:`, error.message);
            fallidas++;
        }
    }

    console.log('\n=== Resumen ===');
    console.log(`  Exitosas: ${exitosas}`);
    console.log(`  Fallidas: ${fallidas}`);
    console.log(`  Total: ${audioFiles.length}`);

    process.exit(0);
}

main().catch(error => {
    console.error('Error fatal:', error);
    process.exit(1);
});
