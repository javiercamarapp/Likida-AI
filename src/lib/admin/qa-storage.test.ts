import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  hashBytes, duplicadaPorHash, extensionDe, mismoDiaMx, asegurarBuckets,
  leerManifiesto, subirFotos, dataUrlDeFoto, firmarRuta,
  guardarCorrida, leerCorrida, listarCorridas, gastoHoyUsd,
  BUCKET_QA_FOTOS, BUCKET_QA_EVIDENCIA,
} from './qa-storage';
import type { CorridaQA, FotoBanco } from './qa-tipos';

// ═══════════════════════════════════════════════════════════════════════════
// LA CAPA DE ALMACENAMIENTO DEL PANEL DE QA — la auditoría del 16-ago la
// encontró con 4 de 16 funciones cubiertas. El arnés es un Storage EN MEMORIA
// con la misma superficie que usa el módulo (getBucket/createBucket/upload/
// download/list/createSignedUrl); lo que se fija es el CONTRATO: banco sin
// estrenar = 0 fotos DE VERDAD, cualquier otro fallo se dice (jamás un "0"
// sobre una base ilegible), dedup por el MISMO sha256 de producción, un HEIC
// rechazado no tira el lote, y el gasto diario suma solo el día de México.
// ═══════════════════════════════════════════════════════════════════════════

type Objeto = { bytes: Buffer; contentType: string };
let objetos: Map<string, Objeto>;      // `${bucket}/${path}` → objeto
let buckets: Set<string>;
let fallaDescarga: string | null;      // mensaje de error a inyectar en download
let fallaSubida: boolean;

function dbFalsa(): SupabaseClient {
  const storage = {
    getBucket: async (b: string) => ({ data: buckets.has(b) ? { name: b } : null, error: null }),
    createBucket: async (b: string) => { buckets.add(b); return { data: { name: b }, error: null }; },
    from: (bucket: string) => ({
      upload: async (path: string, bytes: Buffer, opts?: { upsert?: boolean; contentType?: string }) => {
        if (fallaSubida) return { error: { message: 'storage caído' } };
        const llave = `${bucket}/${path}`;
        if (!opts?.upsert && objetos.has(llave)) return { error: { message: 'The resource already exists' } };
        objetos.set(llave, { bytes: Buffer.from(bytes), contentType: opts?.contentType ?? '' });
        return { error: null };
      },
      download: async (path: string) => {
        if (fallaDescarga) return { data: null as never, error: { message: fallaDescarga } };
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
      list: async (prefijo: string) => {
        const nombres = new Set<string>();
        for (const llave of objetos.keys()) {
          if (!llave.startsWith(`${bucket}/${prefijo}/`)) continue;
          nombres.add(llave.slice(`${bucket}/${prefijo}/`.length).split('/')[0]);
        }
        // carpeta = entrada sin id (el contrato que usa listarCorridas)
        return { data: [...nombres].map((name) => ({ name, id: null })), error: null };
      },
      createSignedUrl: async (path: string, _s: number) => (
        objetos.has(`${bucket}/${path}`)
          ? { data: { signedUrl: `https://firmada.example/${bucket}/${path}` }, error: null }
          : { data: null, error: { message: 'Object not found' } }
      ),
    }),
  };
  return { storage } as unknown as SupabaseClient;
}

const foto = (p: Partial<FotoBanco>): FotoBanco => ({
  id: 'f1', hash: 'h1', path: 'banco/f1.jpg', mime: 'image/jpeg',
  etiqueta: 'ticket', bytes: 10, subidoEn: '2026-08-16T12:00:00Z', ocrEsperado: null, ...p,
});
const corrida = (p: Partial<CorridaQA>): CorridaQA => ({
  id: p.id ?? 'c1', escenario: 'feliz', estado: 'terminada', creadaEn: p.creadaEn ?? new Date().toISOString(),
  latidoEn: null, params: {}, pasos: [], veredictos: [], costoUsdTotal: p.costoUsdTotal ?? 0,
  tenant: null, error: null, limpieza: null,
} as unknown as CorridaQA);

beforeEach(() => {
  objetos = new Map(); buckets = new Set(); fallaDescarga = null; fallaSubida = false;
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
  it('banco sin estrenar = 0 fotos DE VERDAD (objeto inexistente no es error)', async () => {
    const r = await leerManifiesto(dbFalsa());
    expect(r).toEqual({ ok: true, datos: [] });
    expect(buckets.has(BUCKET_QA_FOTOS)).toBe(true); // asegurarBuckets corrió
  });

  it('cualquier OTRO fallo se dice — jamás un "0" sobre una base ilegible', async () => {
    fallaDescarga = 'fetch failed';
    const r = await leerManifiesto(dbFalsa());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('fetch failed');
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
  });

  it('dataUrlDeFoto arma el data-URL desde los bytes del banco (jamás del cliente)', async () => {
    const db = dbFalsa();
    await subirFotos(db, [{ nombre: 't.jpg', mime: 'image/jpeg', bytes: Buffer.from('pixeles') }]);
    const m = await leerManifiesto(db);
    if (!m.ok) throw new Error('manifiesto ilegible');
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

describe('las corridas (el ledger en archivos de Fase A)', () => {
  it('guardar → leer: el roundtrip conserva la corrida y sella latidoEn', async () => {
    const db = dbFalsa();
    await guardarCorrida(db, corrida({ id: 'c-round' }));
    const r = await leerCorrida(db, 'c-round');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.datos?.id).toBe('c-round');
      expect(typeof r.datos?.latidoEn).toBe('string');
    }
  });

  it('corrida inexistente = null honesto; fallo de lectura = error dicho', async () => {
    const db = dbFalsa();
    const nada = await leerCorrida(db, 'no-existe');
    expect(nada).toEqual({ ok: true, datos: null });
    fallaDescarga = 'timeout';
    const rota = await leerCorrida(db, 'da-igual');
    expect(rota.ok).toBe(false);
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
});

describe('asegurarBuckets', () => {
  it('es idempotente y jamás truena — el flag de módulo hace no-op las llamadas siguientes', async () => {
    // La CREACIÓN real ya quedó afirmada en el primer test del banco (el
    // manifiesto la dispara y el Set la observó); aquí se fija que repetirla
    // no lanza aunque el estado externo cambie — el `bucketsListos` de módulo
    // absorbe la llamada, que es exactamente su trabajo.
    const db = dbFalsa();
    await expect(asegurarBuckets(db)).resolves.toBeUndefined();
    await expect(asegurarBuckets(db)).resolves.toBeUndefined();
  });
});
