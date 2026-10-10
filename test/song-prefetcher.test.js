// Test unitario de js/song-prefetcher.js (sin navegador).
// Ejecutar:  node test/song-prefetcher.test.js
//
// El módulo es ES6 y el package.json es "commonjs", así que se carga vía
// import() de una data: URL (no tiene imports relativos, se le inyectan
// todas sus dependencias).

const fs = require('fs');
const path = require('path');

async function loadModule() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'song-prefetcher.js'), 'utf8');
    const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
    return mod.default;
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

function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const tick = () => new Promise(r => setTimeout(r, 0));

/**
 * Crea un entorno falso: fetch controlable, URLs de objeto contadas, etc.
 * Cada llamada a fetch queda registrada en `calls` con su deferred para poder
 * resolverla/rechazarla desde el test.
 */
function makeEnv(SongPrefetcher, options = {}) {
    const calls = [];
    const revoked = [];
    let blobCounter = 0;

    const fetchImpl = (url, init = {}) => {
        const d = deferred();
        const call = { url, signal: init.signal, d };
        calls.push(call);
        if (init.signal) {
            init.signal.addEventListener('abort', () => {
                const err = new Error('aborted');
                err.name = 'AbortError';
                d.reject(err);
            });
        }
        return d.promise;
    };

    const okResponse = (bytes = 3) => ({
        ok: true,
        status: 200,
        blob: async () => new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' })
    });

    const prefetcher = new SongPrefetcher({
        resolveAudioUrl: async (audioPath) => `https://storage/${audioPath}`,
        resolveCoverUrl: async (coverPath) => `https://storage/${coverPath}`,
        fetchImpl,
        createObjectURL: () => `blob:${++blobCounter}`,
        revokeObjectURL: (url) => revoked.push(url),
        retryDelayMs: 0,
        ...options
    });

    return { prefetcher, calls, revoked, okResponse };
}

const songA = { id: 'A', title: 'A', audioPath: 'Audios/A.mp3', coverPath: 'Covers/A.jpg' };
const songB = { id: 'B', title: 'B', audioPath: 'Audios/B.mp3', coverPath: 'Covers/B.jpg' };
const songSinCover = { id: 'C', title: 'C', audioPath: 'Audios/C.mp3' };

async function main() {
    const SongPrefetcher = await loadModule();

    // 1. prefetch descarga y deja la canción lista; take la entrega y la consume
    {
        const { prefetcher, calls, okResponse } = makeEnv(SongPrefetcher);
        const p = prefetcher.prefetch(songA);
        await tick();
        assert(calls.length === 1 && calls[0].url === 'https://storage/Audios/A.mp3',
            'prefetch() descarga la URL resuelta del audio');
        assert(prefetcher.has(songA.audioPath) && !prefetcher.isReady(songA.audioPath),
            'mientras descarga: has() = true, isReady() = false');
        calls[0].d.resolve(okResponse());
        const result = await p;
        assert(result === true, 'prefetch() resuelve true al terminar');
        assert(prefetcher.isReady(songA.audioPath), 'tras descargar: isReady() = true');

        const taken = prefetcher.take(songA);
        assert(taken && taken.blobUrl === 'blob:1' && taken.coverUrl === 'https://storage/Covers/A.jpg'
            && taken.audioPath === songA.audioPath,
            'take() devuelve blobUrl y coverUrl pre-resuelta');
        assert(!prefetcher.isReady(songA.audioPath) && prefetcher.take(songA) === null,
            'take() consume la entrada (segundo take → null)');
    }

    // 2. take de otra canción devuelve null y no consume la que está lista
    {
        const { prefetcher, calls, okResponse } = makeEnv(SongPrefetcher);
        const p = prefetcher.prefetch(songA);
        await tick();
        calls[0].d.resolve(okResponse());
        await p;
        assert(prefetcher.take(songB) === null, 'take() de otra canción → null');
        assert(prefetcher.isReady(songA.audioPath), 'take() de otra canción no consume la lista');
    }

    // 3. prefetch de otra canción aborta la descarga en curso
    {
        const { prefetcher, calls, okResponse } = makeEnv(SongPrefetcher);
        const pA = prefetcher.prefetch(songA);
        await tick();
        const pB = prefetcher.prefetch(songB);
        await tick();
        assert(calls[0].signal.aborted === true, 'prefetch(B) aborta la descarga en curso de A');
        assert(calls.length === 2 && calls[1].url.endsWith('B.mp3'), 'prefetch(B) lanza la descarga de B');
        assert((await pA) === false, 'la promesa de A resuelve false al abortarse');
        calls[1].d.resolve(okResponse());
        assert((await pB) === true && prefetcher.isReady(songB.audioPath), 'B queda lista');
        assert(!prefetcher.has(songA.audioPath), 'A ya no figura ni en curso ni lista');
    }

    // 4. prefetch de otra canción libera el blob que ya estaba listo
    {
        const { prefetcher, calls, revoked, okResponse } = makeEnv(SongPrefetcher);
        const pA = prefetcher.prefetch(songA);
        await tick();
        calls[0].d.resolve(okResponse());
        await pA;
        const pB = prefetcher.prefetch(songB);
        await tick();
        assert(revoked.includes('blob:1'), 'prefetch(B) revoca el blob de A que estaba listo');
        calls[1].d.resolve(okResponse());
        await pB;
        assert(prefetcher.take(songB).blobUrl === 'blob:2', 'B lista con su propio blob');
    }

    // 5. prefetch repetido de la misma canción no descarga dos veces
    {
        const { prefetcher, calls, okResponse } = makeEnv(SongPrefetcher);
        const p1 = prefetcher.prefetch(songA);
        await tick();
        const p2 = prefetcher.prefetch(songA);
        await tick();
        assert(calls.length === 1, 'prefetch(A) en curso + prefetch(A) → una sola descarga');
        calls[0].d.resolve(okResponse());
        await Promise.all([p1, p2]);
        const p3 = await prefetcher.prefetch(songA);
        assert(p3 === true && calls.length === 1, 'prefetch(A) ya lista → true sin descargar');
    }

    // 6. reintenta tras un fallo de red
    {
        const { prefetcher, calls, okResponse } = makeEnv(SongPrefetcher, { maxAttempts: 3 });
        const p = prefetcher.prefetch(songA);
        await tick();
        calls[0].d.reject(new TypeError('Failed to fetch'));
        // esperar a que se programe el reintento
        for (let i = 0; i < 5 && calls.length < 2; i++) await tick();
        assert(calls.length === 2, 'tras un fallo se reintenta la descarga');
        calls[1].d.resolve(okResponse());
        assert((await p) === true && prefetcher.isReady(songA.audioPath), 'el reintento deja la canción lista');
    }

    // 7. se rinde tras maxAttempts sin crear blobs
    {
        const { prefetcher, calls, revoked } = makeEnv(SongPrefetcher, { maxAttempts: 2 });
        const originalWarn = console.warn;
        console.warn = () => {};
        const p = prefetcher.prefetch(songA);
        await tick();
        calls[0].d.reject(new TypeError('Failed to fetch'));
        for (let i = 0; i < 5 && calls.length < 2; i++) await tick();
        calls[1].d.reject(new TypeError('Failed to fetch'));
        const result = await p;
        console.warn = originalWarn;
        assert(result === false && calls.length === 2, 'tras maxAttempts fallos resuelve false y deja de intentar');
        assert(!prefetcher.has(songA.audioPath) && revoked.length === 0, 'nada queda en curso ni lista');
    }

    // 8. respuesta HTTP no-ok cuenta como fallo
    {
        const { prefetcher, calls } = makeEnv(SongPrefetcher, { maxAttempts: 1 });
        const originalWarn = console.warn;
        console.warn = () => {};
        const p = prefetcher.prefetch(songA);
        await tick();
        calls[0].d.resolve({ ok: false, status: 404, blob: async () => new Blob([]) });
        const result = await p;
        console.warn = originalWarn;
        assert(result === false && !prefetcher.isReady(songA.audioPath), 'HTTP 404 → no queda lista');
    }

    // 9. sin coverPath → coverUrl null; si resolver la cover falla no rompe la precarga
    {
        const { prefetcher, calls, okResponse } = makeEnv(SongPrefetcher, {
            resolveCoverUrl: async () => { throw new Error('sin cover'); }
        });
        const p1 = prefetcher.prefetch(songSinCover);
        await tick();
        calls[0].d.resolve(okResponse());
        await p1;
        assert(prefetcher.take(songSinCover).coverUrl === null, 'sin coverPath → coverUrl null');

        const p2 = prefetcher.prefetch(songA);
        await tick();
        calls[1].d.resolve(okResponse());
        await p2;
        const taken = prefetcher.take(songA);
        assert(taken !== null && taken.coverUrl === null, 'fallo al resolver la cover no impide la precarga');
    }

    // 10. cancel() aborta lo que esté en curso y libera lo que esté listo
    {
        const { prefetcher, calls, revoked, okResponse } = makeEnv(SongPrefetcher);
        const pA = prefetcher.prefetch(songA);
        await tick();
        calls[0].d.resolve(okResponse());
        await pA;
        prefetcher.cancel();
        assert(revoked.includes('blob:1') && !prefetcher.has(songA.audioPath), 'cancel() libera el blob listo');

        const pB = prefetcher.prefetch(songB);
        await tick();
        prefetcher.cancel();
        assert(calls[1].signal.aborted && (await pB) === false && !prefetcher.has(songB.audioPath),
            'cancel() aborta la descarga en curso');
    }

    // 11. release() revoca la URL entregada por take()
    {
        const { prefetcher, calls, revoked, okResponse } = makeEnv(SongPrefetcher);
        const p = prefetcher.prefetch(songA);
        await tick();
        calls[0].d.resolve(okResponse());
        await p;
        const { blobUrl } = prefetcher.take(songA);
        prefetcher.release(blobUrl);
        assert(revoked.includes(blobUrl), 'release() revoca la URL del blob');
        prefetcher.release(null);
        assert(true, 'release(null) no lanza');
    }

    // 12. una canción sin audioPath no se precarga
    {
        const { prefetcher, calls } = makeEnv(SongPrefetcher);
        const r = await prefetcher.prefetch({ id: 'X', title: 'X' });
        assert(r === false && calls.length === 0, 'sin audioPath → false y sin descargas');
    }

    // 13. resolver la URL del audio falla → reintenta y se rinde sin lanzar
    {
        let intentos = 0;
        const { prefetcher, calls } = makeEnv(SongPrefetcher, {
            maxAttempts: 2,
            resolveAudioUrl: async () => { intentos++; throw new Error('storage/object-not-found'); }
        });
        const originalWarn = console.warn;
        console.warn = () => {};
        const r = await prefetcher.prefetch(songA);
        console.warn = originalWarn;
        assert(r === false && intentos === 2 && calls.length === 0, 'fallo al resolver URL → reintenta y resuelve false');
    }

    console.log(`\nTOTAL: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
    console.error('ERROR en el test:', err);
    process.exit(1);
});
