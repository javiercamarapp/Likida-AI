import { describe, it, expect, vi, afterEach } from 'vitest';
import { faltantes, envHealth } from './env';

// El inventario de configuración dura. Lo que importa probar no es que sepa
// mirar `process.env`, es que **nombre la variable**: un `{ llm: false }` obliga
// a abrir el código para saber cuál de las cuatro falta, y eso se hace a las 3
// a.m. o no se hace.

const TODAS = [
  'OPENROUTER_API_KEY',
  'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET',
  'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
];

function ponerTodas() {
  for (const v of TODAS) vi.stubEnv(v, 'x');
}

afterEach(() => { vi.unstubAllEnvs(); });

describe('faltantes', () => {
  it('con todo puesto no reporta nada', () => {
    ponerTodas();
    expect(faltantes()).toEqual({});
  });

  it('nombra la variable, no solo el grupo', () => {
    ponerTodas();
    vi.stubEnv('WHATSAPP_APP_SECRET', '');
    expect(faltantes()).toEqual({ whatsapp: ['WHATSAPP_APP_SECRET'] });
  });

  it('agrupa varias ausencias del mismo grupo', () => {
    ponerTodas();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(faltantes().supabase).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  });

  it('nombra NEXT_PUBLIC_SUPABASE_ANON_KEY: sin ella el proxy tira 500 en cada /dashboard', () => {
    // La usan `proxy.ts` y `supabase/server.ts`. Antes del login por usuario no
    // era carga estructural; ahora `createServerClient` lanza dentro del
    // middleware y el panel entero deja de servirse.
    ponerTodas();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    expect(faltantes().supabase).toEqual(['NEXT_PUBLIC_SUPABASE_ANON_KEY']);
  });

  it('una cadena vacía cuenta como ausente', () => {
    // En Vercel se puede crear una variable sin valor. `process.env.X` devuelve
    // `''`, que pasa cualquier comprobación de existencia y falla en el uso.
    ponerTodas();
    vi.stubEnv('OPENROUTER_API_KEY', '');
    expect(faltantes().llm).toEqual(['OPENROUTER_API_KEY']);
  });
});

describe('envHealth', () => {
  it('sigue devolviendo los tres grupos como booleanos', () => {
    // Lo consume `GET /api/demo`, que es público: la forma no cambia y no se
    // añaden grupos nuevos ahí. Lo que un anónimo puede preguntar sigue siendo
    // lo mismo que antes.
    ponerTodas();
    expect(envHealth()).toEqual({ llm: true, whatsapp: true, supabase: true });
    vi.stubEnv('OPENROUTER_API_KEY', '');
    expect(envHealth().llm).toBe(false);
  });
});
