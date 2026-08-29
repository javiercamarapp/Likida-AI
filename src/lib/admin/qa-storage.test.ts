import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  hashBytes, duplicadaPorHash, extensionDe, mismoDiaMx, asegurarBuckets,
  leerManifiesto, subirFotos, dataUrlDeFoto, firmarRuta, firmarRutas,
  guardarCorrida, leerCorrida, listarCorridas, gastoHoyUsd,
  confirmarVerdadTerreno, guardarLectura, leerUltimasLecturas, gastoLecturasHoyUsd,
  guardarLecturaDeCorrida, leerLecturasDeCorrida,
  _olvidarBuckets, BUCKET_QA_FOTOS,
} from './qa-storage';
import type { CorridaQA, FotoBanco, VerdadTerreno } from './qa-tipos';
import { medir, ocrVacio, type OcrLeido } from './qa-verdad';

// ═══════════════════════════════════════════════════════════════════════════
// LA CAPA DE ALMACENAMIENTO DEL PANEL DE QA — ahora contra TABLAS (mig. 0185).
//
// El arnés cambió con el módulo: la Fase A guardaba JSON en Storage y el
// doble era un Storage en memoria; hoy el índice vive en la base y el doble
// es un Postgres de juguete que RESPETA LAS RESTRICCIONES QUE IMPORTAN —el
// `unique` de qa_foto.hash y la PK (corrida_id, n)—, porque son justamente la
// garantía que la migración vino a dar. Un doble que las ignorara probaría el
// doble, no el contrato.
//
// Lo que se fija sigue siendo el CONTRATO: banco sin estrenar = 0 fotos DE
// VERDAD, cualquier otro fallo se dice (jamás un "0" sobre una base
// ilegible), dedup por el MISMO sha256 de producción, un HEIC rechazado no
// tira el lote, y el gasto diario suma solo el día de México. Se le suman los
// dos casos que el JSON no podía tener: la CARRERA de dos subidas de la misma
// foto, y el paso reescrito que no se duplica.
// ═══════════════════════════════════════════════════════════════════════════

type Fila = Record<string, unknown>;
type ErrPg = { code?: string; message: string } | null;

let tablas: Record<string, Fila[]>;
let objetos: Map<string, { bytes: Buffer; contentType: string }>;
let buckets: Set<string>;
let fallaTabla: string | null;          // tabla cuya lectura debe reventar
let alInsertarFoto: (() => void) | null; // gancho para provocar la carrera
let errorInsertFoto: ErrPg;              // error que devuelve el insert de qa_foto
let errorTabla: ErrPg;                   // error que devuelve CUALQUIER lectura
let errorUpdateFoto: ErrPg;              // error que devuelve el update de qa_foto
let seq: number;
let fallosDescarga: number;              // N descargas rebotan con la saturación del 28-ago
let lotesFirmados: string[][];           // cada createSignedUrls que el doble atendió

/** Las restricciones que la 0185 declara y este doble tiene que respetar. */
const UNICO: Record<string, string[]> = {
  qa_foto: ['hash'],
  qa_corrida: ['id'],
  qa_corrida_paso: ['corrida_id', 'n'],
  qa_foto_lectura: ['id'],
};

const llaveDe = (tabla: string, f: Fila) => UNICO[tabla].map((c) => String(f[c])).join('|');

function insertarFila(tabla: string, f: Fila): ErrPg {
  const fila = { ...f };
  if (tabla === 'qa_foto') {
    fila.id ??= `foto-${++seq}`;
    fila.subido_en ??= new Date().toISOString();
    fila.ocr_esperado ??= null;
  }
  if (tabla === 'qa_foto_lectura') {
    fila.id ??= `lec-${++seq}`;
    fila.corrida_en ??= new Date().toISOString();
  }
  if (tabla === 'qa_corrida') {
    fila.creada_en ??= new Date().toISOString();
    fila.latido_en ??= new Date().toISOString();
    fila.carril ??= 'rapido';
  }
  const llave = llaveDe(tabla, fila);
  if (tablas[tabla].some((r) => llaveDe(tabla, r) === llave)) {
    return { code: '23505', message: `duplicate key value violates unique constraint on ${tabla}` };
  }
  // El índice único PARCIAL de la 0246: una corrida no mide la misma foto dos
  // veces; las lecturas sueltas (corrida_id null) se apilan libres. El doble
  // lo respeta porque es exactamente la garantía que se está probando.
  if (tabla === 'qa_foto_lectura' && fila.corrida_id != null
    && tablas[tabla].some((r) => r.corrida_id === fila.corrida_id && r.foto_id === fila.foto_id)) {
    return { code: '23505', message: 'duplicate key value violates unique constraint "qa_foto_lectura_una_por_corrida"' };
  }
  tablas[tabla].push(fila);
  return null;
}

function dbFalsa(): SupabaseClient {
  const from = (tabla: string) => {
    tablas[tabla] ??= [];
    let filas: Fila[] | null = null;      // resultado a devolver
    let error: ErrPg = null;
    let seleccionando = false;
    let orden: { col: string; asc: boolean } | null = null;
    let tope: number | null = null;
    // El UPDATE es PEREZOSO: en postgrest los filtros llegan DESPUÉS
    // (`.update(x).eq('id', …).select()`), así que aquí sólo se guarda el
    // parche y se aplica en `then`, cuando los predicados ya están puestos.
    let parche: Fila | null = null;
    const preds: Array<(f: Fila) => boolean> = [];

    const b: Record<string, unknown> = {};
    const yo = () => b;

    b.select = () => { seleccionando = true; return yo(); };
    b.eq = (c: string, v: unknown) => { preds.push((f) => f[c] === v); return yo(); };
    b.in = (c: string, vs: unknown[]) => { preds.push((f) => vs.includes(f[c])); return yo(); };
    // Comparación por INSTANTE, no por texto: `creada_en` sale de
    // `new Date().toISOString()` (siempre en 'Z') y `gastoHoyUsd` filtra con
    // fronteras en '-06:00' (`inicioDiaMx`/`finDiaMx`). Dos ISO válidos del
    // MISMO instante se ven distintos como texto en cuanto el offset difiere,
    // y la comparación lexicográfica los ordena mal — se rompía sola pasadas
    // las 18:00 hora MX, en cuanto el día de UTC ya había rodado. `Date.parse`
    // entiende el offset; comparar los epoch resultantes es correcto siempre.
    const comoInstante = (v: unknown) => {
      const t = Date.parse(String(v));
      return Number.isNaN(t) ? null : t;
    };
    b.gte = (c: string, v: string) => {
      const limite = comoInstante(v);
      preds.push((f) => {
        const t = comoInstante(f[c]);
        return limite === null || t === null ? String(f[c]) >= v : t >= limite;
      });
      return yo();
    };
    b.lte = (c: string, v: string) => {
      const limite = comoInstante(v);
      preds.push((f) => {
        const t = comoInstante(f[c]);
        return limite === null || t === null ? String(f[c]) <= v : t <= limite;
      });
      return yo();
    };
    b.order = (col: string, o?: { ascending?: boolean }) => { orden = { col, asc: o?.ascending !== false }; return yo(); };
    b.limit = (n: number) => { tope = n; return yo(); };

    b.update = (f: Fila) => {
      if (tabla === 'qa_foto' && errorUpdateFoto) { error = errorUpdateFoto; filas = []; }
      parche = f;
      return yo();
    };

    b.insert = (f: Fila) => {
      if (tabla === 'qa_foto') alInsertarFoto?.();
      if (tabla === 'qa_foto' && errorInsertFoto) {
        error = errorInsertFoto; filas = []; return yo();
      }
      const antes = tablas[tabla].length;
      error = insertarFila(tabla, f);
      filas = error ? [] : tablas[tabla].slice(antes);
      return yo();
    };

    b.upsert = (f: Fila | Fila[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
      for (const fila of Array.isArray(f) ? f : [f]) {
        const llave = llaveDe(tabla, fila);
        const i = tablas[tabla].findIndex((r) => llaveDe(tabla, r) === llave);
        if (i >= 0) {
          if (!o?.ignoreDuplicates) tablas[tabla][i] = { ...tablas[tabla][i], ...fila };
          continue;
        }
        const err = insertarFila(tabla, fila);
        if (err) { error = err; break; }
      }
      filas = [];
      return yo();
    };

    b.then = (res: (r: { data: unknown; error: ErrPg }) => void) => {
      if (errorTabla) return res({ data: null, error: errorTabla });
      if (fallaTabla === tabla) return res({ data: null, error: { message: 'fetch failed' } });
      if (error || filas !== null) return res({ data: filas, error });
      let out = tablas[tabla].filter((f) => preds.every((p) => p(f)));
      if (parche) out = out.map((f) => Object.assign(f, parche));
      if (orden) {
        const { col, asc } = orden;
        out = [...out].sort((x, y) => String(x[col]).localeCompare(String(y[col])) * (asc ? 1 : -1));
      }
      if (tope !== null) out = out.slice(0, tope);
      return res({ data: seleccionando ? out : [], error: null });
    };
    return b;
  };

  const storage = {
    getBucket: async (bk: string) => ({ data: buckets.has(bk) ? { name: bk } : null, error: null }),
    createBucket: async (bk: string) => { buckets.add(bk); return { data: { name: bk }, error: null }; },
    from: (bucket: string) => ({
      upload: async (path: string, bytes: Buffer, opts?: { upsert?: boolean; contentType?: string }) => {
        const llave = `${bucket}/${path}`;
        if (!opts?.upsert && objetos.has(llave)) return { error: { message: 'The resource already exists' } };
        objetos.set(llave, { bytes: Buffer.from(bytes), contentType: opts?.contentType ?? '' });
        return { error: null };
      },
      remove: async (paths: string[]) => { paths.forEach((p) => objetos.delete(`${bucket}/${p}`)); return { error: null }; },
      download: async (path: string) => {
        // La saturación del incidente 28-ago-2026: los primeros N intentos
        // rebotan con el mensaje LITERAL que storage-api devolvió.
        if (fallosDescarga > 0) {
          fallosDescarga -= 1;
          return { data: null as never, error: { message: 'Too many connections issued to the database' } };
        }
        const o = objetos.get(`${bucket}/${path}`);
        if (!o) return { data: null as never, error: { message: 'Object not found' } };
        return {
          data: {
            text: async () => o.bytes.toString('utf8'),
            arrayBuffer: async () => o.bytes.buffer.slice(o.bytes.byteOffset, o.bytes.byteOffset + o.bytes.byteLength),
          } as Blob,
          error: null,
        };
      },
      createSignedUrl: async (path: string, _s: number) => (
        objetos.has(`${bucket}/${path}`)
          ? { data: { signedUrl: `https://firmada.example/${bucket}/${path}` }, error: null }
          : { data: null, error: { message: 'Object not found' } }
      ),
      // El endpoint de LOTE de storage-js: N rutas, UN request. Se registra
      // cada llamada para poder afirmar cuántos requests costó una firma.
      createSignedUrls: async (paths: string[], _s: number) => {
        lotesFirmados.push([...paths]);
        return {
          data: paths.map((p) => (objetos.has(`${bucket}/${p}`)
            ? { path: p, signedUrl: `https://firmada.example/${bucket}/${p}`, signedURL: `/${p}`, error: null }
            : { path: p, signedUrl: null, signedURL: null, error: 'Object not found' })),
          error: null,
        };
      },
    }),
  };
  return { from, storage } as unknown as SupabaseClient;
}

const foto = (p: Partial<FotoBanco>): FotoBanco => ({
  id: 'f1', hash: 'h1', path: 'banco/f1.jpg', mime: 'image/jpeg',
  etiqueta: 'ticket', bytes: 10, subidoEn: '2026-08-16T12:00:00Z',
  ocrEsperado: null, confirmadoEn: null, ...p,
});

const corrida = (p: Partial<CorridaQA>): CorridaQA => ({
  id: 'c1', escenario: 'feliz', carril: 'rapido',
  parametros: { anticipo: 1000, rfcEmpresa: null, ruta: { origen: 'A', destino: 'B' }, politica: [], fotoIds: [], retencion: 'conservar' },
  estado: 'ok', motivo: null, tenantId: null, tenantNombre: 'ZZZ QA',
  creadaEn: new Date().toISOString(), inicio: null, fin: null,
  latidoEn: new Date().toISOString(), pasos: [], costoUsdTotal: 0,
  veredicto: null, turnos: [], pdfs: [], limpieza: null,
  fase: 'terminada', corte: null, pasadas: 0, pasadaEnVuelo: null, memoria: null,
  avance: null, ...p,
});

beforeEach(() => {
  tablas = { qa_foto: [], qa_corrida: [], qa_corrida_paso: [], qa_foto_lectura: [] };
  objetos = new Map(); buckets = new Set();
  fallaTabla = null; alInsertarFoto = null; errorInsertFoto = null; errorTabla = null; seq = 0;
  errorUpdateFoto = null;
  fallosDescarga = 0; lotesFirmados = [];
  _olvidarBuckets();
});

describe('los puros', () => {
  it('hashBytes es el MISMO sha256 hex que el dedup de producción', () => {
    expect(hashBytes(Buffer.from('hola'))).toBe('b221d9dbb083a7f33428d7c2a3c3198ae925614d70210e28716ccaa7cd4ddb79');
  });
  it('duplicadaPorHash encuentra por hash exacto o null', () => {
    const f = foto({ hash: 'abc' });
    expect(duplicadaPorHash([f], 'abc')).toBe(f);
    expect(duplicadaPorHash([f], 'otro')).toBeNull();
  });
  it('extensionDe: los 3 formatos del flujo real; HEIC y basura → null', () => {
    expect(extensionDe('image/jpeg')).toBe('jpg');
    expect(extensionDe('image/png')).toBe('png');
    expect(extensionDe('image/webp')).toBe('webp');
    expect(extensionDe('image/heic')).toBeNull();
    expect(extensionDe('')).toBeNull();
  });
  it('mismoDiaMx compara el día CALENDARIO de México, no UTC', () => {
    // 04:30Z del 17 = 22:30 del 16 en CDMX (UTC-6): mismo día MX que el mediodía del 16.
    expect(mismoDiaMx('2026-08-17T04:30:00Z', '2026-08-16T18:00:00Z')).toBe(true);
    expect(mismoDiaMx('2026-08-17T18:00:00Z', '2026-08-16T18:00:00Z')).toBe(false);
    expect(mismoDiaMx('no-es-fecha', '2026-08-16T18:00:00Z')).toBe(false);
  });
});

describe('el banco de fotos', () => {
  it('banco sin estrenar = 0 fotos DE VERDAD (tabla vacía no es error)', async () => {
    const r = await leerManifiesto(dbFalsa());
    expect(r).toEqual({ ok: true, datos: [] });
  });

  it('cualquier OTRO fallo se dice — jamás un "0" sobre una base ilegible', async () => {
    fallaTabla = 'qa_foto';
    const r = await leerManifiesto(dbFalsa());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('fetch failed');
  });

  it('si la migración 0185 no está aplicada, lo DICE con el número — no un error de Postgres', async () => {
    // Un panel abierto antes de aplicar la migración diría `relation
    // "public.qa_foto" does not exist` y parecería roto. Lo único que pasa es
    // que falta un paso conocido, y el panel tiene que poder nombrarlo.
    errorTabla = { code: '42P01', message: 'relation "public.qa_foto" does not exist' };
    const r = await leerManifiesto(dbFalsa());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/migración 0185/);
      expect(r.error).toMatch(/qa_foto/);
    }
  });

  it('subirFotos: nueva + duplicada + HEIC rechazado en UN lote — el rechazo no tira el resto', async () => {
    const db = dbFalsa();
    const bytes = Buffer.from('foto-real');
    const primera = await subirFotos(db, [{ nombre: 'a.jpg', mime: 'image/jpeg', bytes }]);
    expect(primera.ok).toBe(true);
    const lote = await subirFotos(db, [
      { nombre: 'repetida.jpg', mime: 'image/jpeg', bytes },                       // dup byte a byte
      { nombre: 'nueva.png', mime: 'image/png', bytes: Buffer.from('otra') },      // entra
      { nombre: 'crudo.heic', mime: 'image/heic', bytes: Buffer.from('heic') },    // rechazada con motivo
      { nombre: 'vacia.jpg', mime: 'image/jpeg', bytes: Buffer.alloc(0) },         // rechazada
    ]);
    expect(lote.ok).toBe(true);
    if (lote.ok) {
      const [dup, nueva, heic, vacia] = lote.datos.resultados;
      expect(dup.duplicadoDe).toBe('a.jpg');
      expect(nueva.id).not.toBeNull();
      expect(heic.error).toMatch(/no permitido/);
      expect(heic.error).toMatch(/sips/);
      expect(vacia.error).toMatch(/vac/);
      expect(lote.datos.fotos).toHaveLength(2); // a.jpg + nueva.png; nada más entró
    }
    expect(tablas.qa_foto).toHaveLength(2);
  });

  it('LA CARRERA: si otro proceso inserta la misma foto entre la lectura y el insert, se reporta duplicado — no se pierde ni revienta', async () => {
    // Esto es exactamente lo que el manifiesto en JSON no podía hacer: allí la
    // segunda escritura pisaba a la primera y una foto desaparecía del índice.
    const db = dbFalsa();
    const bytes = Buffer.from('la-misma-foto');
    const hash = hashBytes(bytes);
    alInsertarFoto = () => {
      alInsertarFoto = null;                        // solo la primera vez
      insertarFila('qa_foto', { hash, path: `banco/${hash}.jpg`, mime: 'image/jpeg', etiqueta: 'la ganadora', bytes: bytes.length });
    };
    const r = await subirFotos(db, [{ nombre: 'la-perdedora.jpg', mime: 'image/jpeg', bytes }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.datos.resultados[0].error).toBeNull();
      expect(r.datos.resultados[0].duplicadoDe).toBe('la ganadora');
    }
    expect(tablas.qa_foto).toHaveLength(1);   // una foto, una fila
  });

  it('si el registro en tabla falla, los bytes recién subidos NO se quedan huérfanos en el bucket', async () => {
    // Subir bytes y no poder registrarlos deja un objeto que nadie referencia:
    // basura que el barrido de la 0165 tendría que ir a cazar después. Se
    // retira en el momento, por la Storage API (el único camino que Supabase
    // permite).
    const db = dbFalsa();
    const bytes = Buffer.from('bytes-sin-dueno');
    const path = `banco/${hashBytes(bytes)}.jpg`;
    errorInsertFoto = { code: '23502', message: 'null value in column "etiqueta"' };

    const r = await subirFotos(db, [{ nombre: 'x.jpg', mime: 'image/jpeg', bytes }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.datos.resultados[0].id).toBeNull();
      expect(r.datos.resultados[0].error).toMatch(/no se pudo registrar en el banco/);
    }
    expect(tablas.qa_foto).toHaveLength(0);
    expect(objetos.has(`${BUCKET_QA_FOTOS}/${path}`)).toBe(false);   // retirado
  });

  it('dataUrlDeFoto arma el data-URL desde los bytes del banco (jamás del cliente)', async () => {
    const db = dbFalsa();
    await subirFotos(db, [{ nombre: 't.jpg', mime: 'image/jpeg', bytes: Buffer.from('pixeles') }]);
    const m = await leerManifiesto(db);
    if (!m.ok) throw new Error('banco ilegible');
    const { dataUrl, reintentos } = await dataUrlDeFoto(db, m.datos[0]);
    expect(dataUrl).toBe(`data:image/jpeg;base64,${Buffer.from('pixeles').toString('base64')}`);
    expect(reintentos).toBe(0);   // salió a la primera, y se DICE
  });

  // ── EL INCIDENTE DEL 28-AGO-2026, EN CHICO ────────────────────────────────
  // 10 de 90 fotos quedaron 'bad' con «Too many connections issued to the
  // database»: la saturación transitoria del pool de Storage. Estas pruebas
  // fijan el segundo cinturón: esa firma —y SOLO esa— se reintenta con espera
  // exponencial, y el reintento queda declarado, nunca mudo.
  it('dataUrlDeFoto reintenta la saturación con espera exponencial y lo DECLARA', async () => {
    const db = dbFalsa();
    await subirFotos(db, [{ nombre: 't.jpg', mime: 'image/jpeg', bytes: Buffer.from('pixeles') }]);
    const m = await leerManifiesto(db);
    if (!m.ok) throw new Error('banco ilegible');
    // Las 2 primeras descargas rebotan con la firma medida del incidente.
    fallosDescarga = 2;
    const esperas: number[] = [];
    const { dataUrl, reintentos } = await dataUrlDeFoto(db, m.datos[0], {
      dormir: async (ms) => { esperas.push(ms); },
    });
    expect(dataUrl).toBe(`data:image/jpeg;base64,${Buffer.from('pixeles').toString('base64')}`);
    expect(reintentos).toBe(2);              // contado
    expect(esperas).toEqual([400, 1200]);    // exponencial (400 × 3ⁿ), no martilleo
  });

  it('dataUrlDeFoto: agotados los reintentos, el error DICE cuántos intentos costó', async () => {
    const db = dbFalsa();
    await subirFotos(db, [{ nombre: 't.jpg', mime: 'image/jpeg', bytes: Buffer.from('x') }]);
    const m = await leerManifiesto(db);
    if (!m.ok) throw new Error('banco ilegible');
    fallosDescarga = 99;   // la saturación no cede
    await expect(dataUrlDeFoto(db, m.datos[0], { dormir: async () => {} }))
      .rejects.toThrow(/tras 3 intentos con espera exponencial.*Too many connections/);
  });

  it('dataUrlDeFoto NO reintenta un 404 — fallaría igual y esconderia el error real', async () => {
    const db = dbFalsa();
    let descargas = 0;
    const original = (db as unknown as { storage: { from: (b: string) => { download: (p: string) => Promise<unknown> } } }).storage.from;
    (db as unknown as { storage: { from: unknown } }).storage.from = (b: string) => {
      const bucket = original(b);
      return {
        ...bucket,
        download: async (p: string) => { descargas += 1; return bucket.download(p); },
      };
    };
    await expect(dataUrlDeFoto(db, foto({ path: 'banco/no-existe.jpg' }), { dormir: async () => {} }))
      .rejects.toThrow(/Object not found/);
    expect(descargas).toBe(1);   // un solo intento: el objeto no va a aparecer
  });

  it('firmarRuta: url firmada si existe, null si no — el panel degrada sin reventar', async () => {
    const db = dbFalsa();
    await subirFotos(db, [{ nombre: 't.jpg', mime: 'image/jpeg', bytes: Buffer.from('x') }]);
    const m = await leerManifiesto(db);
    if (!m.ok) throw new Error('ilegible');
    expect(await firmarRuta(db, BUCKET_QA_FOTOS, m.datos[0].path)).toContain('https://firmada.example/');
    expect(await firmarRuta(db, BUCKET_QA_FOTOS, 'banco/no-existe.jpg')).toBeNull();
  });

  it('firmarRutas firma N rutas en UN solo request — la causa raíz del 28-ago (90 firmas por poll) no puede volver', async () => {
    const db = dbFalsa();
    await subirFotos(db, [
      { nombre: 'a.jpg', mime: 'image/jpeg', bytes: Buffer.from('a') },
      { nombre: 'b.jpg', mime: 'image/jpeg', bytes: Buffer.from('b') },
      { nombre: 'c.jpg', mime: 'image/jpeg', bytes: Buffer.from('c') },
    ]);
    const m = await leerManifiesto(db);
    if (!m.ok) throw new Error('ilegible');
    const rutas = m.datos.map((f) => f.path);
    const urls = await firmarRutas(db, BUCKET_QA_FOTOS, [...rutas, 'banco/no-existe.jpg']);
    // UN request para las 4 rutas, no 4 requests:
    expect(lotesFirmados).toHaveLength(1);
    expect(lotesFirmados[0]).toHaveLength(4);
    for (const r of rutas) expect(urls.get(r)).toContain('https://firmada.example/');
    // El contrato por ruta es el de firmarRuta: la que no existe degrada a null.
    expect(urls.get('banco/no-existe.jpg')).toBeNull();
  });

  it('firmarRutas con lista vacía no viaja a Storage, y con duplicados firma una sola vez', async () => {
    const db = dbFalsa();
    expect((await firmarRutas(db, BUCKET_QA_FOTOS, [])).size).toBe(0);
    expect(lotesFirmados).toHaveLength(0);
    await subirFotos(db, [{ nombre: 'a.jpg', mime: 'image/jpeg', bytes: Buffer.from('a') }]);
    const m = await leerManifiesto(db);
    if (!m.ok) throw new Error('ilegible');
    const p = m.datos[0].path;
    const urls = await firmarRutas(db, BUCKET_QA_FOTOS, [p, p, p]);
    expect(lotesFirmados).toHaveLength(1);
    expect(lotesFirmados[0]).toEqual([p]);
    expect(urls.get(p)).toContain('https://firmada.example/');
  });
});

describe('las corridas (el ledger en tablas, mig. 0185)', () => {
  it('guardar → leer: el roundtrip conserva la corrida con sus pasos y sella latidoEn', async () => {
    const db = dbFalsa();
    await guardarCorrida(db, corrida({
      id: 'c-round',
      pasos: [
        { n: 2, nombre: 'cuadre', estado: 'ok', costoUsd: 0.02 },
        { n: 1, nombre: 'intake', estado: 'ok', costoUsd: 0.01, detalle: 'dos fotos' },
      ],
    }));
    const r = await leerCorrida(db, 'c-round');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.datos?.id).toBe('c-round');
      expect(typeof r.datos?.latidoEn).toBe('string');
      expect(r.datos?.pasos.map((p) => p.n)).toEqual([1, 2]);   // ordenados por n
      expect(r.datos?.pasos[0].detalle).toBe('dos fotos');
    }
  });

  it('EL PASO REESCRITO NO SE DUPLICA: pendiente → corriendo → ok es UNA fila', async () => {
    // El motor guarda la corrida entera en cada transición. Con el ledger en
    // JSON eso reescribía el archivo; en tabla, la PK (corrida_id, n) es la
    // que impide que el historial de la pantalla muestre el paso tres veces.
    const db = dbFalsa();
    const c = corrida({ id: 'c-pasos', pasos: [{ n: 1, nombre: 'intake', estado: 'pendiente', costoUsd: 0 }] });
    await guardarCorrida(db, c);
    c.pasos[0].estado = 'corriendo';
    await guardarCorrida(db, c);
    c.pasos[0].estado = 'ok';
    c.pasos[0].costoUsd = 0.05;
    await guardarCorrida(db, c);

    expect(tablas.qa_corrida_paso).toHaveLength(1);
    const r = await leerCorrida(db, 'c-pasos');
    if (!r.ok || !r.datos) throw new Error('ilegible');
    expect(r.datos.pasos).toHaveLength(1);
    expect(r.datos.pasos[0].estado).toBe('ok');
    expect(r.datos.pasos[0].costoUsd).toBe(0.05);
  });

  it('corrida inexistente = null honesto; fallo de lectura = error dicho', async () => {
    const db = dbFalsa();
    const nada = await leerCorrida(db, 'no-existe');
    expect(nada).toEqual({ ok: true, datos: null });
    fallaTabla = 'qa_corrida';
    const rota = await leerCorrida(db, 'da-igual');
    expect(rota.ok).toBe(false);
  });

  it('los pasos ilegibles NO se leen como "corrida sin pasos"', async () => {
    const db = dbFalsa();
    await guardarCorrida(db, corrida({ id: 'c-x', pasos: [{ n: 1, nombre: 'intake', estado: 'ok', costoUsd: 0 }] }));
    fallaTabla = 'qa_corrida_paso';
    const r = await leerCorrida(db, 'c-x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/pasos/);
  });

  it('listarCorridas: más nuevas primero, respetando el límite', async () => {
    const db = dbFalsa();
    await guardarCorrida(db, corrida({ id: 'vieja', creadaEn: '2026-08-15T10:00:00Z' }));
    await guardarCorrida(db, corrida({ id: 'nueva', creadaEn: '2026-08-16T10:00:00Z' }));
    const r = await listarCorridas(db, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.datos).toHaveLength(1);
      expect(r.datos[0].id).toBe('nueva');
    }
  });

  it('gastoHoyUsd suma SOLO las corridas del día de México, redondeado a 4 decimales', async () => {
    const db = dbFalsa();
    await guardarCorrida(db, corrida({ id: 'hoy-1', costoUsdTotal: 0.03211 }));
    await guardarCorrida(db, corrida({ id: 'hoy-2', costoUsdTotal: 0.0100999 }));
    await guardarCorrida(db, corrida({ id: 'ayer', creadaEn: '2026-08-10T10:00:00Z', costoUsdTotal: 99 }));
    const r = await gastoHoyUsd(db);
    expect(r).toEqual({ ok: true, datos: 0.0422 });
  });

  it('el gasto del día NO se lee como $0 si la base falla — el tope diario no puede fallar abierto', async () => {
    const db = dbFalsa();
    fallaTabla = 'qa_corrida';
    const r = await gastoHoyUsd(db);
    expect(r.ok).toBe(false);
  });
});

describe('asegurarBuckets', () => {
  it('es idempotente y jamás truena — el flag de módulo hace no-op las llamadas siguientes', async () => {
    const db = dbFalsa();
    await expect(asegurarBuckets(db)).resolves.toBeUndefined();
    expect(buckets.has(BUCKET_QA_FOTOS)).toBe(true);
    await expect(asegurarBuckets(db)).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL ORÁCULO HUMANO Y LAS LECTURAS DEL OCR (mig. 0239)
//
// Lo que se fija:
//  · confirmar escribe las TRES columnas juntas (`ocr_esperado`,
//    `confirmado_por`, `confirmado_en`): el CHECK de la 0185 hace rebotar la
//    fila si falta la firma, así que separarlas no es una opción.
//  · una etiqueta que NO cumple el contrato se rechaza ANTES de tocar la base,
//    con el motivo largo — no con el mensaje de un CHECK de Postgres.
//  · leer una etiqueta corrupta que ya estuviera guardada la degrada a null
//    ("no se puede medir"), jamás mide contra algo que no cumple el contrato.
//  · una foto que no existe NO es un éxito silencioso.
//  · las lecturas son un apéndice; la última por foto es la más nueva; y el
//    gasto de lecturas del día se suma acotado al día de México.
// ═══════════════════════════════════════════════════════════════════════════

const VERDAD: VerdadTerreno = {
  comercioClave: 'capufe',
  emisor: 'Caminos y Puentes Federales',
  rfcEmisor: 'CPF890101AAA',
  folio: '000123',
  monto: 1234.5,
  fecha: '2026-07-31',
  sucursal: 'Caseta Palmillas',
  dominioFacturacion: 'facturacioncapufe.com.mx',
  ilegibles: [],
  noAplica: [],
  clase: 'ticket',
  notas: null,
};

const LEIDO: OcrLeido = {
  emisor: 'Caminos y Puentes Federales', rfcEmisor: 'CPF890101AAA', folio: '000123',
  monto: 1234.5, fecha: '2026-07-31', sucursal: 'Caseta Palmillas',
  dominioFacturacion: 'facturacioncapufe.com.mx',
};

/** Mete una foto directamente en la tabla del doble. */
function sembrarFoto(id = 'foto-1', extra: Record<string, unknown> = {}) {
  tablas.qa_foto.push({
    id, hash: `h-${id}`, path: `banco/${id}.jpg`, mime: 'image/jpeg',
    etiqueta: `${id}.jpg`, bytes: 10, subido_en: '2026-08-16T12:00:00Z',
    ocr_esperado: null, confirmado_en: null, ...extra,
  });
}

describe('confirmarVerdadTerreno — el oráculo humano', () => {
  it('escribe la etiqueta, el firmante y el instante EN EL MISMO update', async () => {
    sembrarFoto();
    const db = dbFalsa();
    const r = await confirmarVerdadTerreno(db, 'foto-1', VERDAD, 'u-javier');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.ocrEsperado).toEqual(VERDAD);
    expect(r.datos.confirmadoEn).not.toBeNull();
    const fila = tablas.qa_foto[0];
    expect(fila.confirmado_por).toBe('u-javier');
    // El CHECK qa_foto_confirmacion_completa exige los dos: ni uno solo.
    expect(fila.ocr_esperado).not.toBeNull();
    expect(fila.confirmado_en).not.toBeNull();
  });

  it('un firmante null es un dato honesto (ingesta por script), no un inventado', async () => {
    sembrarFoto();
    const r = await confirmarVerdadTerreno(dbFalsa(), 'foto-1', VERDAD, null);
    expect(r.ok).toBe(true);
    expect(tablas.qa_foto[0].confirmado_por).toBeNull();
    expect(tablas.qa_foto[0].confirmado_en).not.toBeNull();
  });

  it('una etiqueta que rompe el invariante se rechaza SIN tocar la base', async () => {
    sembrarFoto();
    const mala = { ...VERDAD, folio: null } as VerdadTerreno;   // null sin clasificar
    const r = await confirmarVerdadTerreno(dbFalsa(), 'foto-1', mala, 'u-javier');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no cumple el contrato/);
    expect(tablas.qa_foto[0].ocr_esperado).toBeNull();
  });

  it('una foto que no está en el banco NO es un éxito silencioso', async () => {
    const r = await confirmarVerdadTerreno(dbFalsa(), 'foto-que-no-existe', VERDAD, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no está en el banco/);
  });

  it('el rebote del CHECK de la 0239 se traduce a algo accionable', async () => {
    sembrarFoto();
    errorUpdateFoto = { code: '23514', message: 'new row violates check constraint "qa_foto_verdad_terreno_completa"' };
    const r = await confirmarVerdadTerreno(dbFalsa(), 'foto-1', VERDAD, null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/0239/);
      expect(r.error).toMatch(/ilegibles/);
    }
  });

  it('el rebote del CHECK de la 0185 (firma faltante) también se explica', async () => {
    sembrarFoto();
    errorUpdateFoto = { code: '23514', message: 'violates check constraint "qa_foto_confirmacion_completa"' };
    const r = await confirmarVerdadTerreno(dbFalsa(), 'foto-1', VERDAD, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/0185/);
  });
});

describe('leer la verdad-de-terreno del banco', () => {
  it('la etiqueta buena viaja tipada, con confirmadoEn', async () => {
    sembrarFoto('foto-1', { ocr_esperado: VERDAD, confirmado_en: '2026-08-20T10:00:00Z' });
    const r = await leerManifiesto(dbFalsa());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos[0].ocrEsperado).toEqual(VERDAD);
    expect(r.datos[0].confirmadoEn).toBe('2026-08-20T10:00:00Z');
  });

  it('una etiqueta CORRUPTA guardada se degrada a null: no se mide contra ella', async () => {
    // Un `folio: null` sin clasificar — el caso exacto que corrompería la
    // medición si se leyera como si fuera bueno.
    sembrarFoto('foto-1', {
      ocr_esperado: { ...VERDAD, folio: null },
      confirmado_en: '2026-08-20T10:00:00Z',
    });
    const r = await leerManifiesto(dbFalsa());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos[0].ocrEsperado).toBeNull();
  });

  it('sin etiqueta, ocrEsperado y confirmadoEn son null (no "está bien")', async () => {
    sembrarFoto();
    const r = await leerManifiesto(dbFalsa());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos[0].ocrEsperado).toBeNull();
    expect(r.datos[0].confirmadoEn).toBeNull();
  });
});

describe('qa_foto_lectura — la historia de la medición', () => {
  it('guarda la lectura con sus tres contadores derivados de la medición', async () => {
    sembrarFoto();
    const medicion = medir(VERDAD, LEIDO);
    const r = await guardarLectura(dbFalsa(), {
      fotoId: 'foto-1', modelo: 'google/gemini-flash', ocrLeido: LEIDO,
      medicion, costoUsd: 0.0031, motivo: null,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.camposOk).toBe(7);
    expect(r.datos.camposMal).toBe(0);
    expect(r.datos.camposNoMedidos).toBe(0);
    expect(r.datos.costoUsd).toBeCloseTo(0.0031, 6);
    // Y los tres suman 7, igual que el CHECK de la 0239.
    expect(r.datos.camposOk + r.datos.camposMal + r.datos.camposNoMedidos).toBe(7);
  });

  it('es un APÉNDICE: dos corridas de la misma foto son dos filas, no un upsert', async () => {
    sembrarFoto();
    const db = dbFalsa();
    const medicion = medir(VERDAD, LEIDO);
    await guardarLectura(db, { fotoId: 'foto-1', modelo: 'm1', ocrLeido: LEIDO, medicion, costoUsd: 0.001, motivo: null });
    await guardarLectura(db, { fotoId: 'foto-1', modelo: 'm2', ocrLeido: LEIDO, medicion, costoUsd: 0.002, motivo: null });
    expect(tablas.qa_foto_lectura).toHaveLength(2);
  });

  it('la tabla ausente manda a la 0239, no a la 0185', async () => {
    errorTabla = { code: 'PGRST205', message: "Could not find the table 'public.qa_foto_lectura' in the schema cache" };
    const r = await guardarLectura(dbFalsa(), {
      fotoId: 'foto-1', modelo: 'm', ocrLeido: ocrVacio(),
      medicion: medir(VERDAD, ocrVacio()), costoUsd: 0, motivo: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/0239/);
      expect(r.error).not.toMatch(/0185/);
    }
  });

  it('leerUltimasLecturas se queda con la MÁS NUEVA de cada foto', async () => {
    sembrarFoto('foto-1');
    sembrarFoto('foto-2');
    tablas.qa_foto_lectura.push(
      { id: 'l1', foto_id: 'foto-1', corrida_en: '2026-08-20T10:00:00Z', modelo: 'viejo', ocr_leido: LEIDO, medicion: medir(VERDAD, LEIDO), campos_ok: 7, campos_mal: 0, campos_no_medidos: 0, costo_usd: 0.001, motivo: null },
      { id: 'l2', foto_id: 'foto-1', corrida_en: '2026-08-21T10:00:00Z', modelo: 'nuevo', ocr_leido: LEIDO, medicion: medir(VERDAD, LEIDO), campos_ok: 7, campos_mal: 0, campos_no_medidos: 0, costo_usd: 0.002, motivo: null },
      { id: 'l3', foto_id: 'foto-2', corrida_en: '2026-08-19T10:00:00Z', modelo: 'otro', ocr_leido: LEIDO, medicion: medir(VERDAD, LEIDO), campos_ok: 7, campos_mal: 0, campos_no_medidos: 0, costo_usd: 0.003, motivo: null },
    );
    const r = await leerUltimasLecturas(dbFalsa());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.size).toBe(2);
    expect(r.datos.get('foto-1')!.modelo).toBe('nuevo');
    expect(r.datos.get('foto-2')!.modelo).toBe('otro');
  });

  it('sin lecturas = mapa vacío DE VERDAD; base caída se dice', async () => {
    const vacio = await leerUltimasLecturas(dbFalsa());
    expect(vacio.ok).toBe(true);
    if (vacio.ok) expect(vacio.datos.size).toBe(0);

    fallaTabla = 'qa_foto_lectura';
    const caida = await leerUltimasLecturas(dbFalsa());
    expect(caida.ok).toBe(false);
  });

  it('guardarLecturaDeCorrida escribe con su corrida y la SEGUNDA rebota como "ya medida" — con la fila original, no con un error', async () => {
    sembrarFoto();
    const db = dbFalsa();
    const medicion = medir(VERDAD, LEIDO);
    const primera = await guardarLecturaDeCorrida(db, 'corrida-1', {
      fotoId: 'foto-1', modelo: 'm1', ocrLeido: LEIDO, medicion, costoUsd: 0.001, motivo: null,
    });
    expect(primera.ok).toBe(true);
    if (primera.ok) {
      expect(primera.yaMedida).toBe(false);
      expect(primera.datos.corridaId).toBe('corrida-1');
    }
    // El "if previo" no existe: el segundo intento va directo al insert y es
    // el índice de la 0246 el que rebota (23505) — aquí se lee como la verdad
    // que es: esa foto ya está medida en esta corrida.
    const segunda = await guardarLecturaDeCorrida(db, 'corrida-1', {
      fotoId: 'foto-1', modelo: 'm2-que-no-debe-pisar', ocrLeido: LEIDO, medicion, costoUsd: 0.009, motivo: null,
    });
    expect(segunda.ok).toBe(true);
    if (segunda.ok) {
      expect(segunda.yaMedida).toBe(true);
      expect(segunda.datos.modelo).toBe('m1');   // la fila ORIGINAL, intacta
    }
    expect(tablas.qa_foto_lectura).toHaveLength(1);
  });

  it('la misma foto en OTRA corrida sí entra, y las lecturas sueltas siguen apilándose', async () => {
    sembrarFoto();
    const db = dbFalsa();
    const medicion = medir(VERDAD, LEIDO);
    const base = { fotoId: 'foto-1', modelo: 'm', ocrLeido: LEIDO, medicion, costoUsd: 0, motivo: null };
    await guardarLecturaDeCorrida(db, 'corrida-1', base);
    const otra = await guardarLecturaDeCorrida(db, 'corrida-2', base);
    expect(otra.ok && !otra.yaMedida).toBe(true);
    // Comparar dos corridas es justo lo que hace útil la medición: la nueva
    // NO borra a la anterior.
    expect(tablas.qa_foto_lectura).toHaveLength(2);
    // Y el carril suelto del banco (sin corrida) se apila libre — es historial.
    await guardarLectura(db, base);
    await guardarLectura(db, base);
    expect(tablas.qa_foto_lectura).toHaveLength(4);
  });

  it('leerLecturasDeCorrida trae SOLO las de esa corrida, y una base caída se dice', async () => {
    sembrarFoto();
    const db = dbFalsa();
    const medicion = medir(VERDAD, LEIDO);
    const base = { fotoId: 'foto-1', modelo: 'm', ocrLeido: LEIDO, medicion, costoUsd: 0, motivo: null };
    await guardarLecturaDeCorrida(db, 'corrida-1', base);
    await guardarLecturaDeCorrida(db, 'corrida-2', base);
    await guardarLectura(db, base);   // suelta, sin corrida
    const r = await leerLecturasDeCorrida(dbFalsa(), 'corrida-1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.datos).toHaveLength(1);
      expect(r.datos[0].corridaId).toBe('corrida-1');
    }
    fallaTabla = 'qa_foto_lectura';
    const caida = await leerLecturasDeCorrida(dbFalsa(), 'corrida-1');
    expect(caida.ok).toBe(false);
  });

  it('la columna corrida_id ausente manda a la 0246, no a la 0239', async () => {
    errorTabla = { code: '42703', message: 'column qa_foto_lectura.corrida_id does not exist' };
    const r = await leerLecturasDeCorrida(dbFalsa(), 'corrida-1');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/0246/);
      expect(r.error).not.toMatch(/0239/);
    }
  });

  it('el gasto de lecturas suma SOLO el día de México y falla por valor', async () => {
    // El instante ACTUAL cae siempre dentro del día de México en curso —
    // fijar una hora UTC concreta se rompe sola pasadas las 18:00 hora MX,
    // que es el mismo error que el comentario de `comoInstante` documenta.
    tablas.qa_foto_lectura.push(
      { id: 'l1', foto_id: 'f', corrida_en: new Date().toISOString(), modelo: 'm', ocr_leido: {}, medicion: {}, campos_ok: 0, campos_mal: 0, campos_no_medidos: 7, costo_usd: 0.25, motivo: null },
      { id: 'l2', foto_id: 'f', corrida_en: '2020-01-01T18:00:00Z', modelo: 'm', ocr_leido: {}, medicion: {}, campos_ok: 0, campos_mal: 0, campos_no_medidos: 7, costo_usd: 99, motivo: null },
    );
    const r = await gastoLecturasHoyUsd(dbFalsa());
    expect(r).toEqual({ ok: true, datos: 0.25 });

    fallaTabla = 'qa_foto_lectura';
    const caida = await gastoLecturasHoyUsd(dbFalsa());
    expect(caida.ok).toBe(false);
    // Jamás un 0 sobre una lectura que falló: eso autorizaría a gastar a ciegas.
    if (!caida.ok) expect(caida.error).toMatch(/gasto de lecturas/);
  });
});
