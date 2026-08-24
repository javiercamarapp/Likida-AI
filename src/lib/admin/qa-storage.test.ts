import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  hashBytes, duplicadaPorHash, extensionDe, mismoDiaMx, asegurarBuckets,
  leerManifiesto, subirFotos, dataUrlDeFoto, firmarRuta,
  guardarCorrida, leerCorrida, listarCorridas, gastoHoyUsd,
  _olvidarBuckets, BUCKET_QA_FOTOS,
} from './qa-storage';
import type { CorridaQA, FotoBanco } from './qa-tipos';

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
let seq: number;

/** Las restricciones que la 0185 declara y este doble tiene que respetar. */
const UNICO: Record<string, string[]> = {
  qa_foto: ['hash'],
  qa_corrida: ['id'],
  qa_corrida_paso: ['corrida_id', 'n'],
};

const llaveDe = (tabla: string, f: Fila) => UNICO[tabla].map((c) => String(f[c])).join('|');

function insertarFila(tabla: string, f: Fila): ErrPg {
  const fila = { ...f };
  if (tabla === 'qa_foto') {
    fila.id ??= `foto-${++seq}`;
    fila.subido_en ??= new Date().toISOString();
    fila.ocr_esperado ??= null;
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
    const preds: Array<(f: Fila) => boolean> = [];

    const b: Record<string, unknown> = {};
    const yo = () => b;

    b.select = () => { seleccionando = true; return yo(); };
    b.eq = (c: string, v: unknown) => { preds.push((f) => f[c] === v); return yo(); };
    b.in = (c: string, vs: unknown[]) => { preds.push((f) => vs.includes(f[c])); return yo(); };
    b.gte = (c: string, v: string) => { preds.push((f) => String(f[c]) >= v); return yo(); };
    b.lte = (c: string, v: string) => { preds.push((f) => String(f[c]) <= v); return yo(); };
    b.order = (col: string, o?: { ascending?: boolean }) => { orden = { col, asc: o?.ascending !== false }; return yo(); };
    b.limit = (n: number) => { tope = n; return yo(); };

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
    }),
  };
  return { from, storage } as unknown as SupabaseClient;
}

const foto = (p: Partial<FotoBanco>): FotoBanco => ({
  id: 'f1', hash: 'h1', path: 'banco/f1.jpg', mime: 'image/jpeg',
  etiqueta: 'ticket', bytes: 10, subidoEn: '2026-08-16T12:00:00Z', ocrEsperado: null, ...p,
});

const corrida = (p: Partial<CorridaQA>): CorridaQA => ({
  id: 'c1', escenario: 'feliz', carril: 'rapido',
  parametros: { anticipo: 1000, rfcEmpresa: null, ruta: { origen: 'A', destino: 'B' }, politica: [], fotoIds: [], retencion: 'conservar' },
  estado: 'ok', motivo: null, tenantId: null, tenantNombre: 'ZZZ QA',
  creadaEn: new Date().toISOString(), inicio: null, fin: null,
  latidoEn: new Date().toISOString(), pasos: [], costoUsdTotal: 0,
  veredicto: null, turnos: [], pdfs: [], limpieza: null, ...p,
});

beforeEach(() => {
  tablas = { qa_foto: [], qa_corrida: [], qa_corrida_paso: [] };
  objetos = new Map(); buckets = new Set();
  fallaTabla = null; alInsertarFoto = null; errorInsertFoto = null; errorTabla = null; seq = 0;
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
    const url = await dataUrlDeFoto(db, m.datos[0]);
    expect(url).toBe(`data:image/jpeg;base64,${Buffer.from('pixeles').toString('base64')}`);
  });

  it('firmarRuta: url firmada si existe, null si no — el panel degrada sin reventar', async () => {
    const db = dbFalsa();
    await subirFotos(db, [{ nombre: 't.jpg', mime: 'image/jpeg', bytes: Buffer.from('x') }]);
    const m = await leerManifiesto(db);
    if (!m.ok) throw new Error('ilegible');
    expect(await firmarRuta(db, BUCKET_QA_FOTOS, m.datos[0].path)).toContain('https://firmada.example/');
    expect(await firmarRuta(db, BUCKET_QA_FOTOS, 'banco/no-existe.jpg')).toBeNull();
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
