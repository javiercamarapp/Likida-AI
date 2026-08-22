import { describe, it, expect, vi, afterEach } from 'vitest';
import { faltantes, envHealth, appUrl } from './env';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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

describe('appUrl (A2): un solo accesor de la URL base', () => {
  const original = process.env.NEXT_PUBLIC_APP_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = original;
  });

  it('sin variable cae al dominio del software, no a cadena vacía ni a likida.ai', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(appUrl()).toBe('https://app.likida.ai');
  });

  it('un marcador ([SENSITIVE]) o un hueco cuentan como ausente', () => {
    process.env.NEXT_PUBLIC_APP_URL = '[SENSITIVE]';
    expect(appUrl()).toBe('https://app.likida.ai');
    process.env.NEXT_PUBLIC_APP_URL = '   ';
    expect(appUrl()).toBe('https://app.likida.ai');
  });

  it('respeta la variable y quita la barra final para poder concatenar `/ruta`', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.likida.ai/';
    expect(appUrl()).toBe('https://staging.likida.ai');
    expect(`${appUrl()}/dashboard/suscripcion`).toBe('https://staging.likida.ai/dashboard/suscripcion');
  });

  it('GUARDIA: el literal del dominio no vuelve a copiarse fuera de env.ts', () => {
    // Antes había 10 copias de `process.env.NEXT_PUBLIC_APP_URL || 'https://app.likida.ai'`
    // y una que caía a `''` (return_url relativa que Stripe rechaza). Olvidar una
    // copia no rompe el build; esto sí.
    const salida = execSync(
      `grep -rln "app.likida.ai'" src/ --include='*.ts' --include='*.tsx' || true`,
      { encoding: 'utf8' },
    ).split('\n').filter(Boolean);
    const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const fuera = salida
      .filter((f) => !f.endsWith('src/lib/env.ts') && !f.includes('.test.'))
      .filter((f) => /app\.likida\.ai'/.test(sinComentarios(readFileSync(f, 'utf8'))));
    expect(fuera, `estos archivos copian la URL base en vez de usar appUrl():\n${fuera.join('\n')}`).toEqual([]);
  });

  it('GUARDIA: nadie lee NEXT_PUBLIC_APP_URL directo salvo env.ts y los tres sitios deliberados', () => {
    // openrouter.ts: cabecera HTTP-Referer con suelo distinto a propósito.
    // openapi/route.ts y cron/facturar: caen al origen del request, no a un literal.
    // arranque.ts: solo nombra la variable en la alarma de configuración.
    const permitidos = ['src/lib/env.ts', 'src/lib/llm/openrouter.ts', 'src/app/api/v1/openapi/route.ts', 'src/app/api/cron/facturar/route.ts', 'src/lib/observability/arranque.ts'];
    const salida = execSync(
      `grep -rln "process.env.NEXT_PUBLIC_APP_URL" src/ --include='*.ts' --include='*.tsx' || true`,
      { encoding: 'utf8' },
    ).split('\n').filter(Boolean);
    const fuera = salida.filter((f) => !f.includes('.test.') && !permitidos.some((p) => f.endsWith(p)));
    expect(fuera, `estos archivos leen la variable a mano en vez de usar appUrl():\n${fuera.join('\n')}`).toEqual([]);
  });
});
