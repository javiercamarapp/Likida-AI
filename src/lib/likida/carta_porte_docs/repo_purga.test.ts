import { beforeEach, describe, expect, it, vi } from 'vitest';

// El repo REAL contra un cliente grabador: se ve QUÉ columnas vacía la purga (el fixture en memoria no puede probarlo).
interface Llamada { tabla: string; op: string; valores?: Record<string, unknown>; filtros: Array<[string, unknown]> }
let llamadas: Llamada[] = [];

function constructor(tabla: string) {
  const l: Llamada = { tabla, op: 'select', filtros: [] };
  const b: Record<string, unknown> = {};
  b.update = (v: Record<string, unknown>) => { l.op = 'update'; l.valores = v; return b; };
  b.eq = (c: string, v: unknown) => { l.filtros.push([c, v]); return b; };
  b.is = (c: string, v: unknown) => { l.filtros.push([`is:${c}`, v]); return b; };
  b.select = () => b;
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => { llamadas.push(l); return Promise.resolve({ data: [{ id: 'd1' }], error: null }).then(ok, ko); };
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => constructor(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { marcarPurgado } = await import('./repo');
beforeEach(() => { llamadas = []; });

describe('marcarPurgado · qué se vacía (A37-S32-01)', () => {
  it('vacía archivo, texto, extracción, validación, remitente y asunto, y las correcciones, siempre con tenant', async () => {
    expect(await marcarPurgado('t1', 'd1')).toBe(true);
    const corr = llamadas.find((l) => l.tabla === 'cp_correccion')!;
    expect(corr.valores).toEqual({ valor_antes: null, valor_despues: null });
    expect(corr.filtros).toContainEqual(['tenant_id', 't1']);
    expect(corr.filtros).toContainEqual(['documento_id', 'd1']);
    const doc = llamadas.find((l) => l.tabla === 'cp_documento')!;
    expect(doc.valores).toMatchObject({ storage_ruta: null, texto_extracto: null, extraccion: null, validacion: null, remitente: null, asunto: null });
    expect(doc.valores?.purgado_en).toEqual(expect.any(String));
    expect(doc.filtros).toContainEqual(['tenant_id', 't1']);
    expect(doc.filtros).toContainEqual(['is:purgado_en', null]);
    // las correcciones van ANTES: si el segundo paso falla, el reintento aún encuentra el documento sin purgar
    expect(llamadas.map((l) => l.tabla)).toEqual(['cp_correccion', 'cp_documento']);
  });
});
