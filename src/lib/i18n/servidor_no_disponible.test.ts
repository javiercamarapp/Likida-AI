import { describe, it, expect, vi } from 'vitest';

// Con IDIOMA_EN_DISPONIBLE = false (estado actual), quien guardó 'en' antes ve español, no un inglés a medias.
const cookieGet = vi.fn<(n: string) => { value: string } | undefined>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: cookieGet }) }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: { user_metadata: { idioma: 'en' } } } }) } }) }));

const { idiomaActual } = await import('./servidor');
const { IDIOMA_EN_DISPONIBLE } = await import('./idioma');

describe('idiomaActual con el inglés aún no disponible', () => {
  it.skipIf(IDIOMA_EN_DISPONIBLE)('cookie en inglés → se sirve español', async () => {
    cookieGet.mockReturnValue({ value: 'en' });
    expect(await idiomaActual()).toBe('es');
  });
});
