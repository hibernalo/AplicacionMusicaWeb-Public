// Test unitario de js/listening-stats-service.js (sin navegador ni Firebase).
// Ejecutar:  node test/listening-stats-service.test.js
//
// El módulo es ES6 y el package.json es "commonjs", así que se carga vía
// import() de una data: URL (no tiene imports relativos, se le inyectan
// todas sus dependencias: db, increment, storage y reloj falsos).

const fs = require('fs');
const path = require('path');

async function loadModule() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'listening-stats-service.js'), 'utf8');
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

function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
const tick = () => new Promise(r => setTimeout(r, 0));

// --- Firestore falso -------------------------------------------------------
// Registra cada batch (ops + deferred del commit para resolver/rechazar desde
// el test) y sirve lecturas desde `docs` (path → data).
function makeDb() {
    const commits = [];
    const docs = {};

    const docRef = (p) => ({
        path: p,
        id: p.split('/').pop(),
        collection: (name) => colRef(`${p}/${name}`),
        get: async () => {
            const data = docs[p];
            return { exists: data !== undefined, id: p.split('/').pop(), data: () => data };
        }
    });
    const colRef = (p) => {
        const query = { constraints: [] };
        const q = {
            path: p,
            doc: (id) => docRef(`${p}/${id}`),
            where: (field, op, value) => { query.constraints.push({ op, value }); return q; },
            orderBy: () => q,
            limit: (n) => { query.limit = n; return q; },
            get: async () => {
                const prefix = `${p}/`;
                let ids = Object.keys(docs)
                    .filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
                    .map(k => k.slice(prefix.length));
                query.constraints.forEach(c => {
                    if (c.op === '>=') ids = ids.filter(id => id >= c.value);
                    if (c.op === '<=') ids = ids.filter(id => id <= c.value);
                });
                ids.sort();
                if (query.limit) ids = ids.slice(0, query.limit);
                return { docs: ids.map(id => ({ id, data: () => docs[`${p}/${id}`] })) };
            }
        };
        return q;
    };

    const db = {
        docs,
        commits,
        collection: (name) => colRef(name),
        batch: () => {
            const ops = [];
            return {
                set: (ref, data, options) => ops.push({ path: ref.path, data, options }),
                commit: () => {
                    const d = deferred();
                    commits.push({ ops, d });
                    return d.promise;
                }
            };
        }
    };
    return db;
}

function makeStorage() {
    const store = {};
    return {
        store,
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
    };
}

// increment falso: deja el valor a la vista para poder comprobarlo
const increment = (n) => ({ inc: n });
const inc = (n) => ({ inc: n });

function makeEnv(mod, options = {}) {
    const db = makeDb();
    const storage = options.storage || makeStorage();
    const clock = { ms: new Date(2026, 8, 2, 22, 0, 0).getTime() }; // 2 sep 2026 22:00 local
    const logs = [];
    const service = new mod.default({
        db,
        increment,
        documentIdField: () => '__docId__',
        storage,
        now: () => new Date(clock.ms),
        logger: (m) => logs.push(m),
        // persistir sin esperar (los timers no pintan nada en el test)
        setTimeoutFn: (fn) => { fn(); return 1; },
        clearTimeoutFn: () => {},
        ...options
    });
    return { service, db, storage, clock, logs };
}

const songA = { id: 'idA', title: 'Cancion A', artist: 'Artista A', genre: 'Rock', source: 'Source1' };
const songB = { id: 'idB', title: 'Cancion B', artist: 'Artista B', genre: 'Pop', source: 'Source2' };
const songSinDatos = { id: 'idC', title: 'C' };

/** Simula 'timeupdate' cada 250 ms durante `segundos` segundos desde `desde`. */
function sonar(service, clock, desde, segundos) {
    let t = desde;
    const pasos = Math.round(segundos * 4);
    for (let i = 0; i < pasos; i++) {
        t += 0.25;
        clock.ms += 250;
        service.onTimeUpdate(t);
    }
    return t;
}

async function main() {
    const mod = await loadModule();
    const { formatDuration, shiftMonth, lastNDayKeys, dayKey, monthKey, formatMonthLabel, STORAGE_KEY } = mod;

    // 1. utilidades puras
    {
        assert(formatDuration(0) === '0 min', 'formatDuration(0) → "0 min"');
        assert(formatDuration(1) === 'menos de 1 min', 'formatDuration(1 ms) → "menos de 1 min"');
        assert(formatDuration(59999) === 'menos de 1 min', 'formatDuration(59 s) → "menos de 1 min"');
        assert(formatDuration(47 * 60000 + 30000) === '47 min', 'formatDuration(47,5 min) → "47 min"');
        assert(formatDuration((2 * 60 + 13) * 60000) === '2 h 13 min', 'formatDuration(2 h 13 min)');
        assert(formatDuration(36 * 3600000) === '36 h 0 min', 'formatDuration(36 h) mantiene horas');
        assert(shiftMonth('2026-01', -1) === '2025-12', 'shiftMonth retrocede de año');
        assert(shiftMonth('2026-12', 1) === '2027-01', 'shiftMonth avanza de año');
        assertEq(lastNDayKeys(3, new Date(2026, 0, 1)), ['2025-12-30', '2025-12-31', '2026-01-01'],
            'lastNDayKeys cruza el año, de antiguo a nuevo');
        assert(dayKey(new Date(2026, 8, 2, 23, 59)) === '2026-09-02' && monthKey(new Date(2026, 8, 2)) === '2026-09',
            'dayKey/monthKey en hora local con ceros');
        assert(formatMonthLabel('2026-09') === 'Septiembre 2026', 'formatMonthLabel en español y capitalizado');
    }

    // 2. suma solo deltas válidos; descarta saltos (seek) y retrocesos
    {
        const { service, clock } = makeEnv(mod);
        service.setUserId('u1');
        service.beginSong(songA);
        service.onTimeUpdate(0);
        let t = sonar(service, clock, 0, 10);          // 10 s reales
        service.onTimeUpdate(t + 60);                  // salto de 60 s → no cuenta
        t = t + 60;
        t = sonar(service, clock, t, 2);               // 2 s más
        service.onTimeUpdate(5);                       // retroceso → no cuenta
        sonar(service, clock, 5, 1);                   // 1 s más
        const dias = service.getUnsentDays();
        const bucket = dias[dayKey(new Date(clock.ms))];
        assert(bucket && bucket.songs.idA === 13000, `suma 13 s reales (obtenido ${bucket && bucket.songs.idA})`);
        assert(bucket.totalMs === 13000, 'totalMs coincide con lo sumado');
    }

    // 3. sin usuario o sin canción no se cuenta nada
    {
        const { service, clock } = makeEnv(mod);
        service.beginSong(songA);
        service.onTimeUpdate(0);
        sonar(service, clock, 0, 5);
        assert(!service.hasUnsent(), 'sin usuario no se acumula');
        service.setUserId('u1');
        service.beginSong(null);
        service.onTimeUpdate(0);
        sonar(service, clock, 0, 5);
        assert(!service.hasUnsent(), 'sin canción no se acumula');
    }

    // 4. atribución a artista/género/source y etiqueta "Desconocido"
    {
        const { service, clock } = makeEnv(mod);
        service.setUserId('u1');
        service.addListenedTime(songA, 1000, new Date(clock.ms));
        service.addListenedTime(songSinDatos, 500, new Date(clock.ms));
        const b = service.getUnsentDays()['2026-09-02'];
        assertEq(b.artists, { 'Artista A': 1000, 'Desconocido': 500 }, 'artistas con "Desconocido" para los vacíos');
        assertEq(b.genres, { 'Rock': 1000, 'Desconocido': 500 }, 'géneros');
        assertEq(b.sources, { 'Source1': 1000, 'Desconocido': 500 }, 'sources');
        assertEq(b.songs, { idA: 1000, idC: 500 }, 'canciones por id');
    }

    // 5. cruzar la medianoche reparte en dos días
    {
        const { service, clock } = makeEnv(mod);
        // El reloj avanza 250 ms ANTES de cada suma: empezando en 23:59:58.750
        // los 4 primeros pasos caen en el día 2 y los 4 últimos en el día 3.
        clock.ms = new Date(2026, 8, 2, 23, 59, 58, 750).getTime();
        service.setUserId('u1');
        service.beginSong(songA);
        service.onTimeUpdate(0);
        sonar(service, clock, 0, 2); // 1 s antes de medianoche, 1 s después
        const dias = service.getUnsentDays();
        assertEq(Object.keys(dias).sort(), ['2026-09-02', '2026-09-03'], 'hay un bucket por día');
        assert(dias['2026-09-02'].totalMs === 1000 && dias['2026-09-03'].totalMs === 1000,
            'cada día recibe su parte');
    }

    // 6. flush: un batch con día + mes + total, increments y merge
    {
        const { service, db } = makeEnv(mod);
        service.setUserId('u1');
        service.addListenedTime(songA, 3000, new Date(2026, 8, 2));
        service.addListenedTime(songB, 1000, new Date(2026, 8, 2));
        const p = service.flush();
        assert(db.commits.length === 1, 'flush lanza un único batch');
        const ops = db.commits[0].ops;
        const porPath = Object.fromEntries(ops.map(o => [o.path, o]));
        const base = 'users/u1/listeningStats/';
        assertEq(Object.keys(porPath).sort(), [`${base}2026-09`, `${base}2026-09-02`, `${base}total`],
            'escribe día, mes y total');
        const esperado = {
            totalMs: inc(4000),
            songs: { idA: inc(3000), idB: inc(1000) },
            artists: { 'Artista A': inc(3000), 'Artista B': inc(1000) },
            genres: { Rock: inc(3000), Pop: inc(1000) },
            sources: { Source1: inc(3000), Source2: inc(1000) }
        };
        assertEq(porPath[`${base}2026-09-02`].data, esperado, 'documento del día con increments');
        assertEq(porPath[`${base}total`].data, esperado, 'documento total con los mismos increments');
        assert(ops.every(o => o.options && o.options.merge === true), 'todas las escrituras son set(merge)');
        db.commits[0].d.resolve();
        assert((await p) === true, 'flush resuelve true al confirmar');
        assert(!service.hasUnsent(), 'tras confirmar no queda nada pendiente');
    }

    // 7. varios días en un flush: mes y total agregan ambos días
    {
        const { service, db } = makeEnv(mod);
        service.setUserId('u1');
        service.addListenedTime(songA, 1000, new Date(2026, 8, 1));
        service.addListenedTime(songA, 2000, new Date(2026, 8, 2));
        service.addListenedTime(songA, 4000, new Date(2026, 9, 1));
        service.flush();
        const ops = db.commits[0].ops;
        const porId = Object.fromEntries(ops.map(o => [o.path.split('/').pop(), o.data]));
        assertEq(Object.keys(porId).sort(), ['2026-09', '2026-09-01', '2026-09-02', '2026-10', '2026-10-01', 'total'],
            'un documento por día, por mes y el total');
        assert(porId['2026-09'].totalMs.inc === 3000 && porId['2026-10'].totalMs.inc === 4000
            && porId.total.totalMs.inc === 7000, 'mes y total suman sus días');
        db.commits[0].d.resolve();
    }

    // 8. no hay segundo flush mientras uno está en vuelo; lo nuevo espera
    {
        const { service, db } = makeEnv(mod);
        service.setUserId('u1');
        service.addListenedTime(songA, 1000, new Date(2026, 8, 2));
        const p1 = service.flush();
        service.addListenedTime(songA, 500, new Date(2026, 8, 2)); // suena mientras se envía
        const p2 = service.flush();
        assert(db.commits.length === 1, 'el segundo flush no lanza otro batch');
        assert((await p2) === false, 'el segundo flush devuelve false');
        db.commits[0].d.resolve();
        await p1;
        assert(service.hasUnsent(), 'lo que sonó durante el envío sigue pendiente');
        const p3 = service.flush();
        assert(db.commits.length === 2 && db.commits[1].ops.find(o => o.path.endsWith('/total')).data.totalMs.inc === 500,
            'el siguiente flush envía solo los 500 ms nuevos');
        db.commits[1].d.resolve();
        await p3;
    }

    // 9. fallo del commit: se conserva y se reintenta junto con lo nuevo, sin duplicar
    {
        const { service, db, logs } = makeEnv(mod);
        service.setUserId('u1');
        service.addListenedTime(songA, 1000, new Date(2026, 8, 2));
        const p1 = service.flush();
        db.commits[0].d.reject(new Error('unavailable'));
        assert((await p1) === false, 'flush resuelve false si falla el commit');
        assert(service.hasUnsent(), 'lo fallido sigue pendiente');
        assert(logs.some(l => l.includes('ERROR volcado')), 'el fallo queda registrado');
        service.addListenedTime(songA, 250, new Date(2026, 8, 2));
        const p2 = service.flush();
        const total = db.commits[1].ops.find(o => o.path.endsWith('/total')).data;
        assert(total.totalMs.inc === 1250 && total.songs.idA.inc === 1250, 'el reintento suma fallido + nuevo (1250 ms) una sola vez');
        db.commits[1].d.resolve();
        await p2;
        assert(!service.hasUnsent(), 'tras el reintento no queda nada');
    }

    // 10. persistencia: lo pendiente sobrevive a una "recarga" del mismo usuario
    {
        const storage = makeStorage();
        const env1 = makeEnv(mod, { storage });
        env1.service.setUserId('u1');
        env1.service.addListenedTime(songA, 1000, new Date(2026, 8, 2));
        const p = env1.service.flush(); // se queda en vuelo (la pestaña "muere" sin confirmación)
        const guardado = JSON.parse(storage.store[STORAGE_KEY]);
        assert(guardado.userId === 'u1' && guardado.inFlight && guardado.inFlight['2026-09-02'].totalMs === 1000,
            'el bloque en vuelo queda persistido');

        const env2 = makeEnv(mod, { storage });
        env2.service.setUserId('u1');
        assert(env2.db.commits.length === 1 && env2.db.commits[0].ops.find(o => o.path.endsWith('/total')).data.totalMs.inc === 1000,
            'al volver el mismo usuario se reenvía lo no confirmado');
        env2.db.commits[0].d.resolve();
        await tick();
        assert(storage.store[STORAGE_KEY] === undefined, 'tras confirmar se limpia localStorage');
        void p;
    }

    // 11. persistencia: el pendiente de otro usuario se descarta
    {
        const storage = makeStorage();
        storage.setItem(STORAGE_KEY, JSON.stringify({
            userId: 'otro', pending: { '2026-09-02': { songs: { x: 1 }, artists: {}, genres: {}, sources: {}, totalMs: 1 } }, inFlight: null
        }));
        const { service, db, logs } = makeEnv(mod, { storage });
        service.setUserId('u1');
        assert(db.commits.length === 0 && !service.hasUnsent(), 'no se envía ni se hereda el pendiente de otro uid');
        assert(logs.some(l => l.includes('otro usuario')), 'se registra el descarte');
    }

    // 12. logout: se vuelca lo del usuario anterior y se deja de contar
    {
        const { service, db, clock } = makeEnv(mod);
        service.setUserId('u1');
        service.beginSong(songA);
        service.onTimeUpdate(0);
        sonar(service, clock, 0, 2);
        service.setUserId(null);
        assert(db.commits.length === 1 && db.commits[0].ops[0].path.startsWith('users/u1/'), 'al salir se envía lo pendiente de u1');
        db.commits[0].d.resolve();
        service.onTimeUpdate(10);
        sonar(service, clock, 10, 2);
        assert(!service.hasUnsent() && service.getUserId() === null, 'sin sesión ya no se cuenta');
    }

    // 13. volcado periódico mientras suena
    {
        const { service, db, clock } = makeEnv(mod, { periodicFlushMs: 10000 });
        service.setUserId('u1');
        service.beginSong(songA);
        service.onTimeUpdate(0);
        sonar(service, clock, 0, 5); // 5 s → aún no toca
        assert(db.commits.length === 0, 'antes del intervalo no hay volcado');
        sonar(service, clock, 5, 6); // supera los 10 s
        assert(db.commits.length === 1, 'pasado el intervalo se vuelca solo');
        db.commits[0].d.resolve();
    }

    // 14. getPeriodStats: lee los documentos del periodo, suma lo no enviado y ordena
    {
        const { service, db, clock } = makeEnv(mod);
        service.setUserId('u1');
        const base = 'users/u1/listeningStats/';
        db.docs[`${base}total`] = { totalMs: 5000, songs: { idA: 2000, idB: 3000 }, artists: { 'Artista A': 2000, 'Artista B': 3000 }, genres: {}, sources: {} };
        db.docs[`${base}2026-09`] = { totalMs: 4000, songs: { idB: 4000 }, artists: {}, genres: {}, sources: {} };
        db.docs[`${base}2026-09-01`] = { totalMs: 700, songs: { idA: 700 }, artists: {}, genres: {}, sources: {} };
        db.docs[`${base}2026-08-20`] = { totalMs: 9999, songs: { idA: 9999 }, artists: {}, genres: {}, sources: {} }; // fuera de los 7 días
        service.addListenedTime(songA, 2500, new Date(clock.ms)); // no enviado, hoy (2026-09-02)

        const total = await service.getPeriodStats({ period: 'total' });
        assert(total.totalMs === 7500, `total suma Firestore + pendiente (${total.totalMs})`);
        assertEq(total.songs, [{ key: 'idA', ms: 4500 }, { key: 'idB', ms: 3000 }], 'canciones ordenadas de mayor a menor');

        const mes = await service.getPeriodStats({ period: 'month', month: '2026-09' });
        assert(mes.totalMs === 6500 && mes.songs[0].key === 'idB', 'mes: documento mensual + pendiente del mes');
        const agosto = await service.getPeriodStats({ period: 'month', month: '2026-08' });
        assert(agosto.totalMs === 0 && agosto.songs.length === 0, 'mes sin documento → vacío (el pendiente es de otro mes)');

        const semana = await service.getPeriodStats({ period: '7d' });
        assert(semana.totalMs === 3200, `7 días: solo días dentro de la ventana (${semana.totalMs})`);

        service.setUserId(null);
        assert((await service.getPeriodStats({ period: 'total' })) === null, 'sin usuario → null');
    }

    // 15. getFirstMonthKey: primer mes con datos, ignorando 'total' y con caché
    {
        const { service, db } = makeEnv(mod);
        service.setUserId('u1');
        const base = 'users/u1/listeningStats/';
        db.docs[`${base}total`] = { totalMs: 1 };
        db.docs[`${base}2026-07`] = { totalMs: 1 };
        db.docs[`${base}2026-07-15`] = { totalMs: 1 };
        db.docs[`${base}2026-09`] = { totalMs: 1 };
        assert((await service.getFirstMonthKey()) === '2026-07', 'devuelve el primer mes con datos');
        db.docs[`${base}2026-01`] = { totalMs: 1 };
        assert((await service.getFirstMonthKey()) === '2026-07', 'el resultado se cachea en la sesión');

        const vacio = makeEnv(mod);
        vacio.service.setUserId('u2');
        assert((await vacio.service.getFirstMonthKey()) === '2026-09', 'sin datos → mes actual');
    }

    // 17. la lectura no superpone un bloque en vuelo (Firestore ya lo incluye por
    //     compensación de latencia), pero sí uno que falló y espera reintento
    {
        const { service, db } = makeEnv(mod);
        service.setUserId('u1');
        service.addListenedTime(songA, 1000, new Date(2026, 8, 2));
        const p1 = service.flush(); // en vuelo
        let stats = await service.getPeriodStats({ period: 'total' });
        assert(stats.totalMs === 0, 'con el volcado en vuelo la lectura no lo suma otra vez');
        db.commits[0].d.reject(new Error('unavailable'));
        await p1;
        stats = await service.getPeriodStats({ period: 'total' });
        assert(stats.totalMs === 1000, 'un bloque fallido (pendiente de reintento) sí se suma');
        service.addListenedTime(songA, 500, new Date(2026, 8, 2));
        stats = await service.getPeriodStats({ period: 'total' });
        assert(stats.totalMs === 1500, 'lo pendiente sin enviar también se suma');
    }

    // 16. sin storage funciona solo en memoria
    {
        const { service, db } = makeEnv(mod, { storage: null });
        service.setUserId('u1');
        service.addListenedTime(songA, 100, new Date(2026, 8, 2));
        service.flush();
        assert(db.commits.length === 1, 'sin localStorage el flujo sigue funcionando');
        db.commits[0].d.resolve();
    }

    console.log(`\nTOTAL: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
    console.error('ERROR en el test:', err);
    process.exit(1);
});
