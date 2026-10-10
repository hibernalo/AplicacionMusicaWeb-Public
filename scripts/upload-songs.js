// ============================================================================
// SCRIPT DE SUBIDA DE CANCIONES A FIREBASE
// ============================================================================
//
// Uso:
//   node scripts/upload-songs.js
//   node scripts/upload-songs.js --covers-only   (solo extrae caratulas, no sube)
//   node scripts/upload-songs.js --dry-run       (muestra lo que subiria, no sube)
//
// Requisitos previos:
//   1. Tener Node.js instalado
//   2. Instalar dependencias: npm install firebase-admin music-metadata
//   3. Configurar las rutas en las constantes SERVICE_ACCOUNT_PATH,
//      SONGS_FOLDER y COVERS_FOLDER al inicio del script
//
// Descripcion:
//   Lee archivos de audio de una carpeta local, extrae sus metadatos (titulo,
//   artista, album, año), vuelca a COVERS_FOLDER las caratulas que vengan
//   embebidas en los audios, busca covers coincidentes y sube todo a Firebase
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
// Artista a forzar en todas las canciones (si no, se usa el de los metadatos):
//   node scripts/upload-songs.js --artist Joost
const ARTIST = getArg('artist', '');
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
// Solo extraer las caratulas embebidas a COVERS_FOLDER, sin subir nada:
//   node scripts/upload-songs.js --covers-only
const COVERS_ONLY = process.argv.includes('--covers-only');

// Mostrar lo que se subiria sin escribir nada en Firebase:
//   node scripts/upload-songs.js --dry-run
const DRY_RUN = process.argv.includes('--dry-run');

// Por defecto, cuando el audio no trae tags, el artista y el titulo se deducen
// del nombre del archivo ("Artista - Titulo"). Se desactiva con --no-split.
const SPLIT_FILENAME = !process.argv.includes('--no-split');

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

const metadataCache = new Map();

/**
 * Lee los metadatos de un archivo de audio (titulo, artista, album, año) y la
 * caratula embebida, si la trae. El resultado se cachea por ruta.
 */
async function readMetadata(filePath) {
    if (metadataCache.has(filePath)) return metadataCache.get(filePath);

    let datos;
    try {
        const metadata = await parseFile(filePath);
        const imagenes = metadata.common.picture || [];
        // Si el archivo trae varias imagenes, preferir la caratula frontal
        const portada = imagenes.find(p => /front/i.test(p.type || '')) || imagenes[0] || null;
        datos = {
            title: metadata.common.title || null,
            artist: metadata.common.artist || null,
            album: metadata.common.album || null,
            year: metadata.common.year || null,
            picture: portada
        };
    } catch (error) {
        console.error(`  Error leyendo metadatos de ${path.basename(filePath)}:`, error.message);
        datos = { title: null, artist: null, album: null, year: null, picture: null };
    }

    metadataCache.set(filePath, datos);
    return datos;
}

/**
 * Quita del titulo las marcas que añaden los descargadores, p. ej. " (SPOTISAVER)"
 */
function limpiarTitulo(title) {
    return title.replace(/\s*\(SPOTISAVER\)/gi, '').trim();
}

// Sufijo que yt-dlp añade con el id del video: "...-PfKVlVbUQjc"
const ID_YOUTUBE = /-[A-Za-z0-9_-]{11}$/;
// Marcas de los titulos de YouTube que no forman parte del nombre de la cancion:
// "(Official Video)", "[MV]", "(Offizielles Video)", "(Lyrics)"...
const MARCAS_VIDEO = /\s*[([](?:official\s+|offizielles\s+|oficial\s+)?(?:music\s+)?(?:video(?:oficial)?|audio|lyrics?(?:\s+video)?|mv|visualizer)\s*[)\]]/gi;

/**
 * Quita del nombre de archivo el id de YouTube y las marcas de video.
 */
function limpiarNombreArchivo(audioBaseName) {
    return audioBaseName
        .replace(ID_YOUTUBE, '')
        .replace(MARCAS_VIDEO, '')
        .trim();
}

/**
 * Deduce artista y titulo de un nombre "Artista - Titulo". Corta por el primer
 * " - "; si no lo hay, devuelve el nombre entero como titulo y sin artista.
 */
function separarArtistaTitulo(audioBaseName) {
    const limpio = limpiarNombreArchivo(audioBaseName);
    const corte = limpio.indexOf(' - ');
    if (corte === -1) return { artist: null, title: limpio };
    return {
        artist: limpio.slice(0, corte).trim() || null,
        title: limpio.slice(corte + 3).trim() || limpio
    };
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
 * Deduce la extension de una caratula embebida. Se mira primero el mime que
 * declara el tag y, si no sirve, los primeros bytes (hay archivos que declaran
 * el formato vacio o mal).
 */
function coverExtension(picture) {
    const mime = String(picture.format || '').toLowerCase();
    if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
    if (mime.includes('png')) return '.png';
    if (mime.includes('webp')) return '.webp';

    const data = picture.data;
    if (data.length > 3 && data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) return '.jpg';
    if (data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) return '.png';
    if (data.length > 12 && data.slice(0, 4).toString('latin1') === 'RIFF' && data.slice(8, 12).toString('latin1') === 'WEBP') return '.webp';
    return null;
}

/**
 * Vuelca a COVERS_FOLDER la caratula embebida de un audio, con el mismo nombre
 * base que el archivo de audio para que findCover() la encuentre despues.
 * No sobrescribe una cover que ya exista en la carpeta.
 * Devuelve 'guardada' | 'existente' | 'sin-caratula' | 'formato-desconocido'.
 */
async function extractEmbeddedCover(audioFile) {
    const audioBaseName = path.parse(audioFile).name;
    if (findCover(audioBaseName)) return 'existente';

    const metadata = await readMetadata(path.join(SONGS_FOLDER, audioFile));
    if (!metadata.picture || !metadata.picture.data || metadata.picture.data.length === 0) {
        return 'sin-caratula';
    }

    const ext = coverExtension(metadata.picture);
    if (!ext) return 'formato-desconocido';

    const destino = path.join(COVERS_FOLDER, audioBaseName + ext);
    fs.writeFileSync(destino, Buffer.from(metadata.picture.data));
    console.log(`  Caratula extraida: ${path.basename(destino)} (${(metadata.picture.data.length / 1024).toFixed(0)} KB)`);
    return 'guardada';
}

/**
 * Fase previa a la subida: extrae a COVERS_FOLDER las caratulas embebidas de
 * todos los audios que vayan a procesarse.
 */
async function extractCovers(audioFiles) {
    console.log('\n=== Extrayendo caratulas embebidas ===');
    const conteo = { guardada: 0, existente: 0, 'sin-caratula': 0, 'formato-desconocido': 0 };

    for (const audioFile of audioFiles) {
        try {
            conteo[await extractEmbeddedCover(audioFile)]++;
        } catch (error) {
            console.error(`  ERROR extrayendo caratula de ${audioFile}:`, error.message);
        }
    }

    console.log(`  Extraidas: ${conteo.guardada} | Ya existian: ${conteo.existente} | Sin caratula embebida: ${conteo['sin-caratula']} | Formato desconocido: ${conteo['formato-desconocido']}`);
    if (conteo['sin-caratula'] > 0) {
        console.log('  (las canciones sin cover se suben con coverPath vacio)');
    }
    return conteo;
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
    const desdeNombre = SPLIT_FILENAME
        ? separarArtistaTitulo(audioBaseName)
        : { artist: null, title: audioBaseName };
    const title = limpiarTitulo(metadata.title || desdeNombre.title);
    const artist = ARTIST || metadata.artist || desdeNombre.artist || '';
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
    if (DRY_RUN) {
        console.log(`  [dry-run] Audios/${title}${audioExt}`);
        console.log(`  [dry-run] cover: ${coverLocalPath ? `Covers/${title}${path.parse(coverLocalPath).ext}` : '(sin cover)'}`);
        return title;
    }
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
    console.log(`  Artista forzado: ${ARTIST || '(metadatos)'}`);
    console.log(`  Nombre de archivo como respaldo: ${SPLIT_FILENAME ? 'si (Artista - Titulo)' : 'no'}`);
    if (DRY_RUN) console.log('  MODO DRY-RUN: no se escribe nada en Firebase');
    console.log(`  Playlists: ${PLAYLISTS.length ? PLAYLISTS.join(', ') : '(ninguna)'}\n`);

    // Validar que las carpetas existen
    if (!fs.existsSync(SONGS_FOLDER)) {
        console.error(`Error: La carpeta de canciones no existe: ${SONGS_FOLDER}`);
        process.exit(1);
    }
    // COVERS_FOLDER es tambien la salida de las caratulas embebidas
    if (!fs.existsSync(COVERS_FOLDER)) {
        fs.mkdirSync(COVERS_FOLDER, { recursive: true });
        console.log(`Carpeta de covers creada: ${COVERS_FOLDER}`);
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

    // Volcar a COVERS_FOLDER las caratulas que traigan los propios audios
    await extractCovers(audioFiles);

    if (COVERS_ONLY) {
        console.log('\n--covers-only: extraccion terminada, no se sube nada.');
        process.exit(0);
    }

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
    if (!DRY_RUN) {
        await addTitlesToPlaylists(titulosSubidos, PLAYLISTS);
    } else if (PLAYLISTS.length > 0) {
        console.log(`[dry-run] Se añadirian ${titulosSubidos.length} titulo(s) a: ${PLAYLISTS.join(', ')}`);
    }

    process.exit(0);
}

main().catch(error => {
    console.error('Error fatal:', error);
    process.exit(1);
});
