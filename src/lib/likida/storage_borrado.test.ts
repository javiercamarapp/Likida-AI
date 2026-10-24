// ═══════════════════════════════════════════════════════════════════════════
// El borrador de Storage: que vacíe la cola, y que NO mienta cuando falla.
//
// Lo que importa probar aquí no es el camino feliz sino el sello: `borrado_en`
// solo puede ponerse cuando la API confirmó. Marcar como borrado un archivo que
// sigue en el bucket es peor que no borrarlo — deja una constancia ARCO que
// afirma algo falso.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';

let colaDevuelta: Array<{ bucket: string; nombre: string; motivo: string }> = [];
let removeDevuelve: { data: Array<{ name: string }> | null; error: { message: string } | null } = { data: [], error: null };
const sellados: Array<{ bucket: string; nombres: string[] }> = [];
/** A37-S57-07: qué responde `exists` por nombre (`true`/`false`, o `'error'` = la API no pudo contestar). */
let existe: Record<string, boolean | 'error'> = {};
let conteoError: { message: string } | null = null;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({
      select: (_columnas: string, opciones?: { head?: boolean }) => opciones?.head
        ? {
            is: () => ({ eq: () => Promise.resolve(conteoError ? { count: null, error: conteoError } : { count: 0, error: null }) }),
          }
        : {
            is: () => ({
              eq: () => ({
                order: () => ({
                  order: () => ({ limit: () => Promise.resolve({ data: colaDevuelta, error: null }) }),
                }),
              }),
            }),
          },
      update: () => ({
        eq: (_c: string, bucket: string) => ({
          in: (_col: string, nombres: string[]) => {
            sellados.push({ bucket, nombres });
            return Promise.resolve({ error: null });
          },
        }),
      }),
    }),
    storage: {
      from: () => ({
        remove: () => Promise.resolve(removeDevuelve),
        exists: (n: string) => Promise.resolve(
          existe[n] === 'error' ? { data: false, error: { message: 'sin respuesta' } } : { data: existe[n] === true, error: null },
        ),
      }),
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./presupuesto', () => ({ acotada: <T>(p: T) => p }));

const { borrarStorageMarcado } = await import('./storage_borrado');

beforeEach(() => { sellados.length = 0; existe = {}; conteoError = null; });

describe('El borrado de Storage sella solo lo que de verdad se borró', () => {
  it('cola vacía: no llama a la API ni sella nada', async () => {
    colaDevuelta = [];
    const r = await borrarStorageMarcado();
    expect(r).toEqual({ intentados: 0, borrados: 0, fallidos: 0, pendientes: 0 });
    expect(sellados).toHaveLength(0);
  });

  it('borra y sella lo confirmado por la API', async () => {
    colaDevuelta = [
      { bucket: 'comprobantes', nombre: 'a.jpg', motivo: 'arco' },
      { bucket: 'comprobantes', nombre: 'b.jpg', motivo: 'huerfano' },
    ];
    removeDevuelve = { data: [{ name: 'a.jpg' }, { name: 'b.jpg' }], error: null };
    const r = await borrarStorageMarcado();
    expect(r.borrados).toBe(2);
    expect(r.fallidos).toBe(0);
    expect(sellados[0].nombres).toEqual(['a.jpg', 'b.jpg']);
  });

  it('SI LA API FALLA no sella nada: la corrida siguiente lo reintenta entero', async () => {
    colaDevuelta = [{ bucket: 'comprobantes', nombre: 'a.jpg', motivo: 'arco' }];
    removeDevuelve = { data: null, error: { message: 'bucket no disponible' } };
    const r = await borrarStorageMarcado();
    expect(r.borrados).toBe(0);
    expect(r.fallidos).toBe(1);
    expect(sellados).toHaveLength(0); // ← lo que de verdad importa
  });

  it('sella solo los que la API confirmó, no el lote entero', async () => {
    colaDevuelta = [
      { bucket: 'comprobantes', nombre: 'a.jpg', motivo: 'arco' },
      { bucket: 'comprobantes', nombre: 'b.jpg', motivo: 'arco' },
    ];
    // La API borró uno y calló sobre el otro, que SIGUE en el bucket.
    removeDevuelve = { data: [{ name: 'a.jpg' }], error: null };
    existe = { 'b.jpg': true };
    const r = await borrarStorageMarcado();
    expect(sellados[0].nombres).toEqual(['a.jpg']);
    expect(r.borrados).toBe(1);
    expect(r.fallidos).toBe(1);
  });

  // A37-S57-07: `remove` devuelve SOLO lo que borró. Un archivo que ya no existía
  // (borrado a mano, duplicado) no viene en la respuesta; sin sellarlo, las filas
  // más viejas de la cola ocupaban para siempre la cabeza del LIMIT 200 y las
  // solicitudes ARCO posteriores nunca se procesaban.
  it('A37-S57-07: en un lote MIXTO, el archivo que ya no existe se sella (se confirma su ausencia) y no atasca la cola', async () => {
    colaDevuelta = [
      { bucket: 'comprobantes', nombre: 'a.jpg', motivo: 'arco' },
      { bucket: 'comprobantes', nombre: 'fantasma.jpg', motivo: 'huerfano' },
    ];
    removeDevuelve = { data: [{ name: 'a.jpg' }], error: null };
    existe = { 'fantasma.jpg': false };
    const r = await borrarStorageMarcado();
    expect(sellados[0].nombres).toEqual(['a.jpg', 'fantasma.jpg']);
    expect(r.borrados).toBe(2);
    expect(r.fallidos).toBe(0);
  });

  it('A37-S57-07: si no se puede confirmar la ausencia (la API de exists falla) NO se sella — una constancia ARCO no afirma lo no comprobado', async () => {
    colaDevuelta = [{ bucket: 'comprobantes', nombre: 'dudoso.jpg', motivo: 'arco' }];
    removeDevuelve = { data: [], error: null };
    existe = { 'dudoso.jpg': 'error' };
    const r = await borrarStorageMarcado();
    expect(sellados).toHaveLength(0);
    expect(r.fallidos).toBe(1);
  });

  it('A37-S57-07: si el conteo de pendientes falla, lo DICE (pendientes null + log), no devuelve 0 ni lo ignora', async () => {
    colaDevuelta = [{ bucket: 'comprobantes', nombre: 'a.jpg', motivo: 'arco' }];
    removeDevuelve = { data: [{ name: 'a.jpg' }], error: null };
    conteoError = { message: 'timeout' };
    const r = await borrarStorageMarcado();
    expect(r.pendientes).toBeNull();
    const { logger } = await import('@/lib/logger');
    expect(logger.error).toHaveBeenCalledWith('storage.pendientes_ilegible', expect.anything());
  });
});
