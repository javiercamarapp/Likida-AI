import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-S07-06 — el video (hasta 200 MB) o la foto ya está en Storage cuando el
// insert de la fila falla: sin limpieza queda un objeto con PII sin referencia.
const remove = vi.fn(async (_rutas: string[]) => ({ data: [], error: null }));
const from = vi.fn((_b: string) => ({ remove }));
let insertError: { message: string } | null = { message: 'boom' };
const insertChain = () => ({
  insert: () => ({ select: () => ({ single: async () => ({ data: insertError ? null : { id: 'x' }, error: insertError }) }) }),
});
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ storage: { from }, from: insertChain }),
}));
vi.mock('../presupuesto', () => ({ acotada: async <T,>(p: PromiseLike<T>) => p }));
vi.mock('@/lib/admin/qa-storage', () => ({ firmarRutas: vi.fn() }));

const { guardarHook, guardarReferencia, BUCKET_HOOKS, BUCKET_REFERENCIAS } = await import('./estudio');

const UUID = '123e4567-e89b-12d3-a456-426614174000';

beforeEach(() => { remove.mockClear(); from.mockClear(); insertError = { message: 'boom' }; });

describe('A37-S07-06 — huérfanos de marketing', () => {
  it('guardarHook: si el insert falla, borra el video subido y relanza el error', async () => {
    await expect(guardarHook({ videoRuta: `${UUID}.mp4`, hookTexto: 'hook', actorId: null })).rejects.toThrow(/guardarHook/);
    expect(from).toHaveBeenCalledWith(BUCKET_HOOKS);
    expect(remove).toHaveBeenCalledWith([`${UUID}.mp4`]);
  });

  it('guardarHook: si falta el texto del hook, también borra el video ya subido', async () => {
    await expect(guardarHook({ videoRuta: `${UUID}.webm`, hookTexto: '  ', actorId: null })).rejects.toThrow();
    expect(remove).toHaveBeenCalledWith([`${UUID}.webm`]);
  });

  it('guardarReferencia: nombre vacío o insert caído borra la foto ya subida', async () => {
    await expect(guardarReferencia({ tipo: 'lugar', nombre: ' ', etiqueta: null, fotoRuta: `${UUID}.png`, actorId: null })).rejects.toThrow();
    expect(from).toHaveBeenCalledWith(BUCKET_REFERENCIAS);
    expect(remove).toHaveBeenCalledWith([`${UUID}.png`]);
  });

  it('una ruta que no tiene la forma uuid.ext NO se borra (jamás borra rutas arbitrarias del cliente)', async () => {
    await expect(guardarHook({ videoRuta: '../otro/video.mp4', hookTexto: 'hook', actorId: null })).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
  });

  it('con éxito NO borra nada', async () => {
    insertError = null;
    await expect(guardarHook({ videoRuta: `${UUID}.mp4`, hookTexto: 'hook', actorId: null })).resolves.toBe('x');
    expect(remove).not.toHaveBeenCalled();
  });

  it('si el borrado falla, el error original sigue siendo el que sale (no se traga ni se reemplaza)', async () => {
    remove.mockRejectedValueOnce(new Error('storage caído'));
    await expect(guardarHook({ videoRuta: `${UUID}.mp4`, hookTexto: 'hook', actorId: null })).rejects.toThrow(/guardarHook: boom/);
  });
});
