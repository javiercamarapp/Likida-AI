import { beforeEach, describe, expect, it, vi } from 'vitest';

// A37-S07-04: la baja borra el OBJETO y luego la FILA; cualquier fallo LANZA.
const orden: string[] = [];
let filaRuta: string | null = 'ref/abc.jpg';
let errObjeto: { message: string } | null = null;
let errFila: { message: string } | null = null;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    storage: { from: (b: string) => ({ remove: async (rutas: string[]) => { orden.push(`remove:${b}:${rutas.join(',')}`); return { error: errObjeto }; } }) },
    from: () => {
      const api: Record<string, unknown> = {
        select: () => api, eq: () => api,
        maybeSingle: async () => ({ data: filaRuta ? { foto_ruta: filaRuta } : null, error: null }),
        delete: () => { orden.push('delete-fila'); return { eq: async () => ({ error: errFila }) }; },
      };
      return api;
    },
  }),
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: async <T,>(p: T) => p }));
vi.mock('@/lib/admin/qa-storage', () => ({ firmarRutas: async () => new Map() }));

const { borrarReferencia } = await import('./estudio');
const ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => { orden.length = 0; filaRuta = 'ref/abc.jpg'; errObjeto = null; errFila = null; });

describe('borrarReferencia', () => {
  it('borra primero el objeto y después la fila', async () => {
    await borrarReferencia(ID);
    expect(orden).toEqual(['remove:marketing_referencias:ref/abc.jpg', 'delete-fila']);
  });
  it('si falla el objeto NO toca la fila (reintentable) y lanza', async () => {
    errObjeto = { message: 'boom' };
    await expect(borrarReferencia(ID)).rejects.toThrow(/objeto/);
    expect(orden).not.toContain('delete-fila');
  });
  it('si falla la fila lanza', async () => {
    errFila = { message: 'boom' };
    await expect(borrarReferencia(ID)).rejects.toThrow(/fila/);
  });
  it('id inválido o referencia inexistente: error de dato, sin tocar Storage', async () => {
    await expect(borrarReferencia("x'; drop")).rejects.toThrow();
    filaRuta = null;
    await expect(borrarReferencia(ID)).rejects.toThrow(/ya no existe/);
    expect(orden).toEqual([]);
  });
});
