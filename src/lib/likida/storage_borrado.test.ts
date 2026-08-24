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

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({
      select: (_columnas: string, opciones?: { head?: boolean }) => opciones?.head
        ? {
            is: () => ({ eq: () => Promise.resolve({ count: 0, error: null }) }),
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
      from: () => ({ remove: () => Promise.resolve(removeDevuelve) }),
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./presupuesto', () => ({ acotada: <T>(p: T) => p }));

const { borrarStorageMarcado } = await import('./storage_borrado');

beforeEach(() => { sellados.length = 0; });

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
    // La API borró uno y calló sobre el otro.
    removeDevuelve = { data: [{ name: 'a.jpg' }], error: null };
    const r = await borrarStorageMarcado();
    expect(sellados[0].nombres).toEqual(['a.jpg']);
    expect(r.borrados).toBe(1);
    expect(r.fallidos).toBe(1);
  });
});
