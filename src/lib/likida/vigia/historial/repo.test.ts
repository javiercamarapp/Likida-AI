// A37-S58-03: el rollback de una importación fallida no puede tragarse su error ni dejar un histórico a medias que
// la huella sha256 marque como «ya subido».
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Res = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };
const guion: Record<string, Res[]> = {};
const bitacora: string[] = [];

function constructor(tabla: string) {
  let op = 'select';
  const b: Record<string, unknown> = {};
  for (const m of ['eq', 'select', 'order', 'limit']) b[m] = () => b;
  b.insert = () => { op = 'insert'; return b; };
  b.delete = () => { op = 'delete'; return b; };
  const resolver = (): Promise<Res> => {
    const clave = `${tabla}:${op}`;
    bitacora.push(clave);
    const r = (guion[clave] ?? []).shift() ?? { data: null, error: null };
    return Promise.resolve({ data: null, error: null, ...r });
  };
  b.single = resolver;
  b.maybeSingle = resolver;
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => resolver().then(ok, ko);
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => constructor(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../presupuesto', () => ({ acotada: (q: unknown) => q }));

const { guardarImportacion } = await import('./repo');
const MSG = { enviadoEn: '2026-10-01T10:00:00.000Z', rol: 'cliente' as const, autorHash: 'h', texto: 'hola' };
const ENTRADA = { grupoId: 'g-1', sha256: 'a'.repeat(64), usuarioId: null, mensajes: [MSG, { ...MSG, rol: 'equipo' as const }] };
const VIEJA = new Date(Date.now() - 3_600_000).toISOString();

beforeEach(() => { for (const k of Object.keys(guion)) delete guion[k]; bitacora.length = 0; });

describe('guardarImportacion · rollback honesto', () => {
  it('si fallan los mensajes y el borrado también, el error del borrado NO se traga: el fallo dice que quedó a medias', async () => {
    guion['vigia_historial_import:insert'] = [{ data: { id: 'imp-1' } }];
    guion['vigia_historial_mensaje:insert'] = [{ error: { message: 'caída' } }];
    guion['vigia_historial_import:delete'] = [{ error: { message: 'sigue caída' } }, { error: { message: 'sigue caída' } }];
    await expect(guardarImportacion('t-1', ENTRADA)).rejects.toThrow(/quedó a medias/);
    expect(bitacora.filter((x) => x === 'vigia_historial_import:delete')).toHaveLength(2); // reintenta una vez
  });

  it('resubir un archivo cuya importación quedó a medias (menos mensajes que los declarados) la rehace en vez de decir «ya se había subido»', async () => {
    guion['vigia_historial_import:insert'] = [{ error: { message: 'dup', code: '23505' } }, { data: { id: 'imp-2' } }];
    guion['vigia_historial_import:select'] = [{ data: { id: 'imp-1', mensajes: 2, created_at: VIEJA } }];
    guion['vigia_historial_mensaje:select'] = [{ count: 1 }];
    const r = await guardarImportacion('t-1', ENTRADA);
    expect(r).toEqual({ ok: true, id: 'imp-2' });
    expect(bitacora).toContain('vigia_historial_import:delete');
  });

  it('una importación completa sigue siendo duplicada', async () => {
    guion['vigia_historial_import:insert'] = [{ error: { message: 'dup', code: '23505' } }];
    guion['vigia_historial_import:select'] = [{ data: { id: 'imp-1', mensajes: 2, created_at: VIEJA } }];
    guion['vigia_historial_mensaje:select'] = [{ count: 2 }];
    expect(await guardarImportacion('t-1', ENTRADA)).toEqual({ ok: false, duplicada: true });
    expect(bitacora).not.toContain('vigia_historial_import:delete');
  });

  it('una importación reciente a medias puede estar en curso: no se toca', async () => {
    guion['vigia_historial_import:insert'] = [{ error: { message: 'dup', code: '23505' } }];
    guion['vigia_historial_import:select'] = [{ data: { id: 'imp-1', mensajes: 2, created_at: new Date().toISOString() } }];
    guion['vigia_historial_mensaje:select'] = [{ count: 1 }];
    expect(await guardarImportacion('t-1', ENTRADA)).toEqual({ ok: false, duplicada: true });
    expect(bitacora).not.toContain('vigia_historial_import:delete');
  });
});
