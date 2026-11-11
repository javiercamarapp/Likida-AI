import { describe, it, expect, vi, beforeEach } from 'vitest';

const cookieGet = vi.fn<(n: string) => { value: string } | undefined>();
const getUser = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: cookieGet }) }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ auth: { getUser } }) }));
// Estas pruebas fijan la PRECEDENCIA (cookie > preferencia > es) con el inglés disponible; la puerta de disponibilidad
// (inglés aún sin traducción completa → se sirve español) la fija servidor_no_disponible.test.ts.
vi.mock('./idioma', async (original) => ({ ...(await original<typeof import('./idioma')>()), idiomaServible: (i: 'es' | 'en') => i }));

const { idiomaActual, getT, datosParaProveedor } = await import('./servidor');

beforeEach(() => { cookieGet.mockReset(); getUser.mockReset(); });

describe('idiomaActual (servidor)', () => {
  it('cookie válida: manda y NO consulta a Supabase', async () => {
    cookieGet.mockReturnValue({ value: 'en' });
    expect(await idiomaActual()).toBe('en');
    expect(getUser).not.toHaveBeenCalled();
  });
  it('sin cookie: usa user_metadata.idioma', async () => {
    cookieGet.mockReturnValue(undefined);
    getUser.mockResolvedValue({ data: { user: { user_metadata: { idioma: 'en' } } } });
    expect(await idiomaActual()).toBe('en');
  });
  it('cookie inválida: se ignora y cae a la preferencia', async () => {
    cookieGet.mockReturnValue({ value: 'fr' });
    getUser.mockResolvedValue({ data: { user: { user_metadata: { idioma: 'en' } } } });
    expect(await idiomaActual()).toBe('en');
  });
  it('sin cookie, sin preferencia o con Supabase caído: es', async () => {
    cookieGet.mockReturnValue(undefined);
    getUser.mockResolvedValueOnce({ data: { user: null } });
    expect(await idiomaActual()).toBe('es');
    getUser.mockRejectedValueOnce(new Error('red'));
    expect(await idiomaActual()).toBe('es');
    getUser.mockResolvedValueOnce({ data: { user: { user_metadata: { idioma: 'klingon' } } } });
    expect(await idiomaActual()).toBe('es');
  });
});

describe('getT y datosParaProveedor', () => {
  it('getT traduce con el idioma activo', async () => {
    cookieGet.mockReturnValue({ value: 'en' });
    const { t } = await getT('shell');
    expect(t('pie.cuenta.salir')).toBe('Sign out');
  });
  it('en español el proveedor no recibe diccionarios (no viaja texto al navegador)', async () => {
    cookieGet.mockReturnValue({ value: 'es' });
    expect(await datosParaProveedor(['shell'])).toEqual({ idioma: 'es', diccionarios: {} });
  });
  it('en inglés recibe SOLO el namespace pedido', async () => {
    cookieGet.mockReturnValue({ value: 'en' });
    const d = await datosParaProveedor(['shell']);
    expect(d.idioma).toBe('en');
    expect(Object.keys(d.diccionarios)).toEqual(['shell']);
  });
});
