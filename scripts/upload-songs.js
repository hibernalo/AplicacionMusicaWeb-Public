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

// Genero y fuente a asignar a las canciones subidas.
// Se pueden pasar por linea de comandos:
//   node scripts/upload-songs.js --genre game --source deltarune
function getArg(name, fallback) {
    const idx = process.argv.indexOf(`--${name}`);
    return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}
const GENRE = getArg('genre', '');
const SOURCE = getArg('source', '');
// Playlists (por nombre, separadas por coma) donde se agregaran las canciones subidas.
//   node scripts/upload-songs.js --playlists JoelNuevas,JoelYT1
const PLAYLISTS = getArg('playlists', '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);

// Filtros opcionales por nombre de archivo (subcadena, insensible a mayúsculas):
//   --only "Safe And Sound"              -> solo procesa archivos que contengan ese texto
//   --exclude "Safe And Sound,Drown"     -> procesa todos MENOS los que contengan alguno
//                                           (varios valores separados por coma)
const ONLY = getArg('only', '');
const EXCLUDE = getArg('exclude', '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

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
        genre: GENRE,
        source: SOURCE,
        audioPath: audioStoragePath,
        coverPath: coverStoragePath,
        rand: Math.random(),
        liked: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await createSongDocument(songData);
    console.log(`  OK - "${title}" subida correctamente`);
    return title;
}

/**
 * Agrega una lista de titulos a las playlists indicadas (por nombre).
 * No duplica titulos ya presentes. Actualiza cada playlist una sola vez.
 */
async function addTitlesToPlaylists(titles, playlistNames) {
    if (titles.length === 0 || playlistNames.length === 0) return;

    console.log('\n=== Agregando canciones a playlists ===');
    for (const name of playlistNames) {
        try {
            const snapshot = await db.collection('playlists')
                .where('name', '==', name)
                .limit(1)
                .get();

            if (snapshot.empty) {
                console.error(`  Playlist "${name}" no encontrada. Omitida.`);
                continue;
            }

            const doc = snapshot.docs[0];
            const existing = doc.data().songs || [];
            const set = new Set(existing);
            let agregadas = 0;
            for (const t of titles) {
                if (!set.has(t)) {
                    set.add(t);
                    agregadas++;
                }
            }

            if (agregadas === 0) {
                console.log(`  "${name}": sin cambios (todas ya estaban).`);
                continue;
            }

            await doc.ref.update({ songs: Array.from(set) });
            console.log(`  "${name}": ${agregadas} cancion(es) agregada(s) (total ${set.size}).`);
        } catch (error) {
            console.error(`  ERROR actualizando playlist "${name}":`, error.message);
        }
    }
}

/**
 * Funcion principal
 */
async function main() {
    console.log('=== Script de subida de canciones ===');
    console.log(`  Genero: ${GENRE || '(vacio)'}`);
    console.log(`  Fuente: ${SOURCE || '(vacio)'}`);
    console.log(`  Playlists: ${PLAYLISTS.length ? PLAYLISTS.join(', ') : '(ninguna)'}\n`);

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
    let audioFiles = allFiles.filter(f => {
        const ext = path.extname(f).toLowerCase();
        return AUDIO_EXTENSIONS.includes(ext);
    });

    // Aplicar filtros --only / --exclude (subcadena en el nombre de archivo)
    if (ONLY) {
        const needle = ONLY.toLowerCase();
        audioFiles = audioFiles.filter(f => f.toLowerCase().includes(needle));
        console.log(`Filtro --only "${ONLY}": ${audioFiles.length} archivo(s) coinciden.`);
    }
    if (EXCLUDE.length > 0) {
        const antes = audioFiles.length;
        audioFiles = audioFiles.filter(f => {
            const lower = f.toLowerCase();
            return !EXCLUDE.some(needle => lower.includes(needle));
        });
        console.log(`Filtro --exclude [${EXCLUDE.join(', ')}]: excluidos ${antes - audioFiles.length} archivo(s).`);
    }

    if (audioFiles.length === 0) {
        console.log('No se encontraron archivos de audio en la carpeta.');
        process.exit(0);
    }

    console.log(`Encontradas ${audioFiles.length} canciones para subir:\n`);
    audioFiles.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));

    // Procesar cada cancion
    let exitosas = 0;
    let fallidas = 0;
    const titulosSubidos = [];

    for (const audioFile of audioFiles) {
        try {
            const title = await processSong(audioFile);
            if (title) titulosSubidos.push(title);
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

    // Agregar las canciones subidas a las playlists indicadas
    await addTitlesToPlaylists(titulosSubidos, PLAYLISTS);

    process.exit(0);
}

main().catch(error => {
    console.error('Error fatal:', error);
    process.exit(1);
});
