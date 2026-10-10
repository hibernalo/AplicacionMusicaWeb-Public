// Test unitario de js/song-upload-service.js (sin navegador ni Firebase).
// Ejecutar:  node test/song-upload-service.test.js
//
// El módulo es ES6 puro (sin imports) y el package.json es "commonjs", así que
// se carga vía import() de una data: URL.

const fs = require('fs');
const path = require('path');

async function loadModule() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'song-upload-service.js'), 'utf8');
    return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
}

let passed = 0;
let failed = 0;
function assert(cond, msg) {
    if (cond) {
        passed++;
        console.log(`PASS: ${msg}`);
    } else {
        failed++;
        console.log(`FAIL: ${msg}`);
    }
}
function assertEq(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    assert(a === e, `${msg}${a === e ? '' : `\n      esperado: ${e}\n      obtenido: ${a}`}`);
}

(async () => {
    const S = await loadModule();

    // --- nombres de archivo -------------------------------------------------
    assertEq(S.fileExtension('cancion.MP3'), '.mp3', 'fileExtension en minúsculas');
    assertEq(S.fileExtension('sin extension'), '', 'fileExtension vacía si no hay punto');
    assertEq(S.baseName('Artista - Tema.m4a'), 'Artista - Tema', 'baseName quita la extensión');
    assert(S.isAudioFile({ name: 'a.flac', type: '' }), 'isAudioFile por extensión');
    assert(S.isAudioFile({ name: 'raro.bin', type: 'audio/mpeg' }), 'isAudioFile por MIME');
    assert(!S.isAudioFile({ name: 'foto.jpg', type: 'image/jpeg' }), 'isAudioFile rechaza imágenes');

    assertEq(S.limpiarTitulo('  Tema (SPOTISAVER) '), 'Tema', 'limpiarTitulo quita la marca SPOTISAVER');
    assertEq(
        S.limpiarNombreArchivo('Yukopi - 将棋一番！ (feat.歌愛ユキ)-dB8QCac8FSM'),
        'Yukopi - 将棋一番！ (feat.歌愛ユキ)',
        'limpiarNombreArchivo quita el id de YouTube'
    );
    assertEq(
        S.limpiarNombreArchivo('Artista - Tema (Official Video) [MV]'),
        'Artista - Tema',
        'limpiarNombreArchivo quita marcas de vídeo'
    );
    assertEq(S.separarArtistaTitulo('Joost - Friesenjung-PfKVlVbUQjc'), { artist: 'Joost', title: 'Friesenjung' }, 'separarArtistaTitulo corta por " - "');
    assertEq(S.separarArtistaTitulo('Solo titulo'), { artist: null, title: 'Solo titulo' }, 'separarArtistaTitulo sin artista');
    assertEq(S.separarArtistaTitulo('A - B - C'), { artist: 'A', title: 'B - C' }, 'separarArtistaTitulo corta por el primer separador');

    // --- portadas -------------------------------------------------------------
    assertEq(S.coverExtension('image/jpeg', null), '.jpg', 'coverExtension por MIME jpeg');
    assertEq(S.coverExtension('', [0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0, 0]), '.png', 'coverExtension por bytes PNG');
    assertEq(S.coverExtension('', [0xFF, 0xD8, 0xFF, 0xE0]), '.jpg', 'coverExtension por bytes JPEG');
    assertEq(S.coverExtension('application/octet-stream', [1, 2, 3, 4]), null, 'coverExtension desconocida → null');
    assertEq(S.imageExtension({ name: 'x.JPEG', type: '' }), '.jpg', 'imageExtension .jpeg → .jpg');
    assertEq(S.imageExtension({ name: 'x.gif', type: 'image/gif' }), null, 'imageExtension rechaza gif');

    // --- año y género ---------------------------------------------------------
    assertEq(S.normalizeYear('2003-05-01'), 2003, 'normalizeYear acepta fecha completa');
    assertEq(S.normalizeYear('abc'), null, 'normalizeYear inválido → null');
    assertEq(S.normalizeYear(0), null, 'normalizeYear 0 → null');
    assertEq(S.normalizeYear(''), null, 'normalizeYear vacío → null');
    const generos = [{ key: 'anime' }, { key: 'game' }];
    assertEq(S.matchGenre(['Game'], generos), 'game', 'matchGenre casa sin mayúsculas y devuelve el de la app');
    assertEq(S.matchGenre('Rock', generos), '', 'matchGenre sin coincidencia → vacío');
    assertEq(S.matchGenre(null, generos), '', 'matchGenre nulo → vacío');

    // --- createDraft ----------------------------------------------------------
    const f1 = { name: 'Koji Kondo - Wind Requiem-abcdefghijk.mp3', size: 1000, type: 'audio/mpeg' };
    const d1 = S.createDraft({
        file: f1,
        metadata: { title: 'Wind\'s Requiem (SPOTISAVER)', artist: 'Koji Kondo', album: 'OST', year: 2003, genre: ['Game'], durationMs: 7497.14, picture: { blob: 'B', ext: '.jpg' } },
        appGenres: generos
    });
    assertEq(d1.title, 'Wind\'s Requiem', 'createDraft usa el título del tag limpio');
    assertEq(d1.artist, 'Koji Kondo', 'createDraft usa el artista del tag');
    assertEq(d1.album, 'OST', 'createDraft álbum');
    assertEq(d1.year, 2003, 'createDraft año');
    assertEq(d1.genre, 'game', 'createDraft género casado con la app');
    assertEq(d1.durationMs, 7497, 'createDraft redondea la duración');
    assertEq(d1.ext, '.mp3', 'createDraft extensión');
    assertEq(d1.cover, { blob: 'B', ext: '.jpg' }, 'createDraft portada embebida');
    assertEq(d1.status, S.STATUS.PENDING, 'createDraft estado pendiente');
    assert(d1.metadataRead, 'createDraft marca que se leyeron metadatos');

    const f2 = { name: 'Joost - Friesenjung (Official Video)-PfKVlVbUQjc.m4a', size: 5 };
    const d2 = S.createDraft({ file: f2, metadata: null });
    assertEq(d2.title, 'Friesenjung', 'createDraft sin tags deduce el título del nombre');
    assertEq(d2.artist, 'Joost', 'createDraft sin tags deduce el artista del nombre');
    assertEq(d2.year, null, 'createDraft sin tags año null');
    assert(!d2.metadataRead, 'createDraft sin tags no marca metadatos');
    assert(d1.id !== d2.id, 'createDraft ids distintos');

    const d3 = S.createDraft({ file: { name: 'Solo Titulo.ogg' }, metadata: { durationMs: 1000 }, splitFilename: false });
    assertEq(d3.title, 'Solo Titulo', 'createDraft sin separar nombre');
    assertEq(d3.artist, '', 'createDraft sin artista');

    // --- applyBulkChanges -----------------------------------------------------
    const drafts = [d1, d2, d3];
    d2.source = 'viejo';
    d2.genre = 'otro';
    const n = S.applyBulkChanges(drafts, [d1.id, d2.id], { genre: 'anime', year: '2020', artist: '', album: '   ', playlists: { add: ['p1'] } });
    assertEq(n, 2, 'applyBulkChanges cuenta los modificados');
    assertEq(d1.genre, 'anime', 'applyBulkChanges pone el género a d1');
    assertEq(d2.genre, 'anime', 'applyBulkChanges pone el género a d2');
    assertEq(d2.source, '', 'applyBulkChanges vacía el source al cambiar de género');
    assertEq(d1.year, 2020, 'applyBulkChanges año como texto');
    assertEq(d1.artist, 'Koji Kondo', 'applyBulkChanges no pisa con cadena vacía');
    assertEq(d1.album, 'OST', 'applyBulkChanges no pisa con espacios');
    assertEq(d1.playlistIds, ['p1'], 'applyBulkChanges añade playlist');
    assertEq(d3.genre, '', 'applyBulkChanges no toca los no seleccionados');

    S.applyBulkChanges(drafts, [d1.id], { playlists: { add: ['p2'], remove: ['p1'] } });
    assertEq(d1.playlistIds, ['p2'], 'applyBulkChanges quita y añade playlists');
    S.applyBulkChanges(drafts, [d1.id], { playlists: { add: ['p2'] } });
    assertEq(d1.playlistIds, ['p2'], 'applyBulkChanges no duplica playlists');

    S.applyBulkChanges(drafts, [d1.id, d2.id], { genre: 'game', source: 'zelda' });
    assertEq(d2.source, 'zelda', 'applyBulkChanges género+source a la vez conserva el source nuevo');

    S.applyBulkChanges(drafts, [d1.id], { cover: null });
    assertEq(d1.cover, null, 'applyBulkChanges cover null quita la portada');
    S.applyBulkChanges(drafts, [d1.id], { artist: 'X' });
    assertEq(d1.cover, null, 'applyBulkChanges cover undefined no toca la portada');

    S.applyBulkChanges(drafts, [d1.id, d2.id], { title: 'Nuevo' });
    assertEq(d1.title, 'Wind\'s Requiem', 'applyBulkChanges ignora el título con varios seleccionados');
    S.applyBulkChanges(drafts, [d1.id], { title: 'Nuevo (SPOTISAVER)' });
    assertEq(d1.title, 'Nuevo', 'applyBulkChanges cambia el título con uno solo');

    d3.status = S.STATUS.DONE;
    const n2 = S.applyBulkChanges(drafts, [d3.id], { genre: 'anime' });
    assertEq(n2, 0, 'applyBulkChanges no modifica las ya subidas');
    assertEq(d3.genre, '', 'applyBulkChanges deja intacta la subida');
    d3.status = S.STATUS.PENDING;

    d2.status = S.STATUS.ERROR; d2.error = 'x';
    S.applyBulkChanges(drafts, [d2.id], { album: 'Nuevo' });
    assertEq(d2.status, S.STATUS.PENDING, 'applyBulkChanges tras un error vuelve a pendiente');
    assertEq(d2.error, null, 'applyBulkChanges limpia el error');

    // --- setDraftValues -------------------------------------------------------
    S.setDraftValues(d3, { title: '  Tema 3 ', artist: '', album: 'Al', year: '1999', genre: '', source: 'algo', playlistIds: ['a', 'a', 'b'], cover: null });
    assertEq(d3.title, 'Tema 3', 'setDraftValues título');
    assertEq(d3.artist, '', 'setDraftValues vacía el artista');
    assertEq(d3.year, 1999, 'setDraftValues año');
    assertEq(d3.source, '', 'setDraftValues sin género vacía el source');
    assertEq(d3.playlistIds, ['a', 'b'], 'setDraftValues playlists sin duplicados');
    S.setDraftValues(d3, { title: '   ' });
    assertEq(d3.title, 'Tema 3', 'setDraftValues no deja el título vacío');

    // --- estados de casillas y valores comunes --------------------------------
    d1.playlistIds = ['p1']; d2.playlistIds = ['p1', 'p2']; d3.playlistIds = [];
    assertEq(S.playlistCheckboxState(drafts, [d1.id, d2.id], 'p1'), 'all', 'playlistCheckboxState all');
    assertEq(S.playlistCheckboxState(drafts, [d1.id, d2.id], 'p2'), 'some', 'playlistCheckboxState some');
    assertEq(S.playlistCheckboxState(drafts, [d1.id, d3.id], 'p2'), 'none', 'playlistCheckboxState none');
    d1.genre = 'anime'; d2.genre = 'anime'; d3.genre = 'game';
    assertEq(S.commonValue(drafts, [d1.id, d2.id], 'genre'), 'anime', 'commonValue igual');
    assertEq(S.commonValue(drafts, [d1.id, d3.id], 'genre'), '', 'commonValue distinto → vacío');
    d1.year = 2020; d2.year = 2020;
    assertEq(S.commonValue(drafts, [d1.id, d2.id], 'year'), '2020', 'commonValue numérico como texto');

    // --- duplicados y validación ---------------------------------------------
    d1.title = 'Repe'; d2.title = 'repe'; d3.title = 'Única';
    const dup = S.duplicateTitlesInBatch(drafts);
    assert(dup.has('repe') && dup.size === 1, 'duplicateTitlesInBatch detecta repetidos sin mayúsculas');
    assertEq(S.validateDraft(d1, { duplicates: dup }), ['Hay otra canción con el mismo título en este lote'], 'validateDraft marca el duplicado');
    assertEq(S.validateDraft(d3, { duplicates: dup }), [], 'validateDraft válido');
    assertEq(S.validateDraft({ title: '  ' }), ['El título no puede estar vacío'], 'validateDraft título vacío');
    assertEq(S.validateDraft({ title: 'X', source: 's', genre: '' }), ['Para asignar un source hay que elegir también el género'], 'validateDraft source sin género');

    // --- rutas y documento ----------------------------------------------------
    assertEq(S.storageFileName('A/B\\C: "x"?*#[1]'), 'A-B-C x1', 'storageFileName quita caracteres problemáticos');
    assertEq(S.storageFileName('   '), 'cancion', 'storageFileName vacío → cancion');
    const d4 = { title: 'Mi Tema', ext: '.mp3', cover: { blob: 'b', ext: '.png' } };
    assertEq(S.storagePathsFor(d4), { audioPath: 'Audios/Mi Tema.mp3', coverPath: 'Covers/Mi Tema.png' }, 'storagePathsFor con portada');
    assertEq(S.storagePathsFor({ title: 'Otro', ext: '.m4a', cover: null }, ' (2)'), { audioPath: 'Audios/Otro (2).m4a', coverPath: '' }, 'storagePathsFor sin portada y con sufijo');

    const doc = S.buildSongDocument(
        { title: ' Mi Tema ', artist: 'Yo', album: '', year: '2001', genre: 'anime', source: 'x', durationMs: 1234.6 },
        { audioPath: 'Audios/Mi Tema.mp3', coverPath: '', rand: 0.5 }
    );
    assertEq(doc, {
        title: 'Mi Tema', titleMinusculas: 'mi tema', artist: 'Yo', album: '', year: 2001, genre: 'anime', source: 'x',
        audioPath: 'Audios/Mi Tema.mp3', coverPath: '', rand: 0.5, liked: false, durationMs: 1235
    }, 'buildSongDocument completo');
    const doc2 = S.buildSongDocument({ title: 'T', durationMs: null }, { audioPath: 'a', coverPath: 'c' });
    assert(!('durationMs' in doc2), 'buildSongDocument omite durationMs si no se conoce');
    assert(typeof doc2.rand === 'number' && doc2.rand >= 0 && doc2.rand < 1, 'buildSongDocument rand aleatorio en [0,1)');

    // --- agrupación por playlist y resumen ------------------------------------
    d1.status = S.STATUS.DONE; d1.playlistIds = ['p1', 'p2']; d1.playlistsDone = ['p2'];
    d2.status = S.STATUS.DONE; d2.playlistIds = ['p1'];
    d3.status = S.STATUS.ERROR; d3.playlistIds = ['p1'];
    const grupos = S.groupTitlesByPlaylist(drafts);
    assertEq(Array.from(grupos.keys()), ['p1'], 'groupTitlesByPlaylist solo playlists pendientes de subidas');
    assertEq(grupos.get('p1'), ['Repe', 'repe'], 'groupTitlesByPlaylist títulos de las subidas (no la fallida)');
    assertEq(S.summarize(drafts), { total: 3, pending: 0, uploading: 0, done: 2, error: 1 }, 'summarize');

    // --- formatos -------------------------------------------------------------
    assertEq(S.formatDurationMs(7497), '0:07', 'formatDurationMs segundos');
    assertEq(S.formatDurationMs(225000), '3:45', 'formatDurationMs minutos');
    assertEq(S.formatDurationMs(null), '', 'formatDurationMs null');
    assertEq(S.formatBytes(2048), '2 KB', 'formatBytes KB');
    assertEq(S.formatBytes(3.5 * 1024 * 1024), '3.5 MB', 'formatBytes MB');

    console.log(`\n${passed} pasados, ${failed} fallidos`);
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
