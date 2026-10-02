import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════════════
// OLA 9 · CSP CON NONCE (auditoría ola 1 #5). Las rutas con sesión dejan de
// llevar `script-src 'unsafe-inline'`: nonce por petición + 'strict-dynamic' +
// el hash del único script inline propio (el del tema). Las públicas, estáticas,
// no cambian. Estas pruebas fijan el contrato Y las condiciones de las que
// depende (rutas dinámicas, ningún otro <script> inline), porque un nonce en una
// página estática o un script inline nuevo sin hash rompería la pantalla en
// producción sin que ninguna prueba de render lo notara.
// ═══════════════════════════════════════════════════════════════════════════

let usuario: { id: string } | null = { id: 'u-1' };
let refrescarSesion = false;
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: { setAll: (l: { name: string; value: string; options?: object }[]) => void } }) => ({
    auth: {
      getUser: async () => {
        // El SDK refresca el token a media vida: escribe la cookie nueva y `proxy` rehace su respuesta.
        if (refrescarSesion) opts.cookies.setAll([{ name: 'sb-proyecto-auth-token', value: 'token-nuevo', options: { path: '/' } }]);
        return { data: { user: usuario } };
      },
    },
  }),
}));

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
beforeEach(() => { usuario = { id: 'u-1' }; refrescarSesion = false; });

async function pedir(path: string) {
  const { NextRequest } = await import('next/server');
  const { proxy } = await import('./proxy');
  return proxy(new NextRequest(`https://app.likida.ai${path}`));
}
const scriptSrc = (csp: string | null) => (csp ?? '').split('; ').find((d) => d.startsWith('script-src')) ?? '';
const nonceDe = (csp: string | null) => /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp ?? '')?.[1];

describe('proxy · CSP con nonce en las rutas con sesión', () => {
  it.each(['/dashboard', '/dashboard/gastos', '/admin', '/admin/consumo', '/vendedor'])('%s: script-src con nonce + strict-dynamic + hash del tema, sin unsafe-inline', async (ruta) => {
    const res = await pedir(ruta);
    const src = scriptSrc(res.headers.get('Content-Security-Policy'));
    expect(src).toMatch(/'nonce-[A-Za-z0-9+/=]{20,}'/);
    expect(src).toContain("'strict-dynamic'");
    expect(src).toMatch(/'sha256-[A-Za-z0-9+/]{43}='/);
    expect(src).not.toContain("'unsafe-inline'");
    expect(src).not.toContain('unsafe-eval'); // NODE_ENV=test: ni dev ni producción lo necesitan
  });

  it('el MISMO nonce viaja en la petición (Next lo lee de ahí) y en la respuesta (el navegador lo obedece)', async () => {
    const res = await pedir('/dashboard');
    const csp = res.headers.get('Content-Security-Policy');
    const nonce = nonceDe(csp);
    expect(nonce).toBeTruthy();
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(res.headers.get('x-middleware-override-headers')).toContain('content-security-policy');
  });

  it('un refresco de sesión a media petición NO tira el nonce: la respuesta rehecha lo conserva Y lleva la cookie nueva', async () => {
    refrescarSesion = true;
    const res = await pedir('/dashboard');
    const csp = res.headers.get('Content-Security-Policy');
    expect(nonceDe(csp)).toBeTruthy();
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonceDe(csp));
    expect(res.headers.get('x-middleware-request-cookie')).toContain('token-nuevo');
    expect(res.cookies.get('sb-proyecto-auth-token')?.value).toBe('token-nuevo');
  });

  it('el nonce es nuevo en cada petición (jamás reutilizado)', async () => {
    const nonces = new Set<string | undefined>();
    for (let i = 0; i < 25; i++) nonces.add(nonceDe((await pedir('/dashboard')).headers.get('Content-Security-Policy')));
    expect(nonces.size).toBe(25);
  });

  it('el redirect a /login por falta de sesión también lleva la política (con nonce) y las demás directivas', async () => {
    usuario = null;
    const res = await pedir('/admin');
    expect(res.status).toBe(307);
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(nonceDe(csp)).toBeTruthy();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it('las demás directivas no se aflojan con el nonce', async () => {
    const csp = (await pedir('/dashboard')).headers.get('Content-Security-Policy') ?? '';
    for (const d of ["default-src 'self'", "connect-src 'self'", "frame-src 'none'", "base-uri 'self'", "form-action 'self'", "img-src 'self' data: https://*.supabase.co"]) {
      expect(csp).toContain(d);
    }
  });

  it('en desarrollo conserva unsafe-eval (Fast Refresh) también con nonce; en producción jamás', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    expect(scriptSrc((await pedir('/dashboard')).headers.get('Content-Security-Policy'))).toContain("'unsafe-eval'");
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    expect((await pedir('/dashboard')).headers.get('Content-Security-Policy')).not.toContain('unsafe-eval');
  });
});

describe('proxy · las rutas públicas NO cambian (son estáticas: no pueden llevar nonce por petición)', () => {
  it.each(['/', '/login', '/blog/algo', '/demo', '/aviso/x'])('%s conserva unsafe-inline, sin nonce y sin tocar la petición', async (ruta) => {
    const res = await pedir(ruta);
    const csp = res.headers.get('Content-Security-Policy');
    expect(scriptSrc(csp)).toBe("script-src 'self' 'unsafe-inline'");
    expect(nonceDe(csp)).toBeUndefined();
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBeNull();
    expect(res.headers.get('x-middleware-request-x-nonce')).toBeNull();
  });
});

describe('proxy · palanca de reversa LIKIDA_CSP_NONCE=0', () => {
  it('devuelve las rutas con sesión a la política anterior, sin tocar la petición', async () => {
    vi.stubEnv('LIKIDA_CSP_NONCE', '0');
    vi.resetModules();
    const res = await pedir('/dashboard');
    expect(scriptSrc(res.headers.get('Content-Security-Policy'))).toBe("script-src 'self' 'unsafe-inline'");
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBeNull();
  });

  it('cualquier otro valor (incluido vacío) deja el nonce encendido: la reversa es explícita', async () => {
    vi.stubEnv('LIKIDA_CSP_NONCE', '');
    vi.resetModules();
    expect(nonceDe((await pedir('/dashboard')).headers.get('Content-Security-Policy'))).toBeTruthy();
  });
});

// ── Las condiciones de las que depende el nonce ─────────────────────────────
function fuentes(dir: string): string[] {
  const salida: string[] = [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = `${dir}/${e.name}`;
    if (e.isDirectory()) salida.push(...fuentes(ruta));
    else if (/\.(tsx|ts)$/.test(e.name) && !/\.(test|fixture)\./.test(e.name)) salida.push(ruta);
  }
  return salida;
}

describe('contrato: el nonce solo funciona si estas condiciones se mantienen', () => {
  it('el hash de la CSP es el SHA-256 EXACTO del string que el layout inyecta', async () => {
    const { SCRIPT_TEMA } = await import('@/lib/seguridad/script_tema');
    const { HASH_SCRIPT_TEMA } = await import('@/lib/seguridad/csp');
    expect(HASH_SCRIPT_TEMA).toBe(`'sha256-${createHash('sha256').update(SCRIPT_TEMA, 'utf8').digest('base64')}'`);
    const layout = readFileSync('src/app/layout.tsx', 'utf8');
    expect(layout).toContain("from '@/lib/seguridad/script_tema'");
    expect(layout).toContain('__html: SCRIPT_TEMA');
  });

  it('cada sección con sesión tiene un layout que fuerza render dinámico (sin él Next no puede poner el nonce)', async () => {
    const { RUTAS_CON_SESION } = await import('./proxy');
    for (const r of RUTAS_CON_SESION) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const layout = readFileSync(`src/app${r}/layout.tsx`, 'utf8');
      expect(layout, `src/app${r}/layout.tsx debe exportar dynamic = 'force-dynamic'`).toMatch(/export const dynamic = 'force-dynamic'/);
    }
  });

  it('el ÚNICO <script> inline del repo es el del tema (cualquier otro necesitaría nonce o su propio hash)', () => {
    const inline: string[] = [];
    for (const f of fuentes('src/app')) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const src = readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      if (/<script[\s>]/.test(src) || /from 'next\/script'/.test(src)) inline.push(f);
    }
    expect(inline).toEqual(['src/app/layout.tsx']);
  });

  it('ninguna ruta de sesión inyecta HTML crudo con dangerouslySetInnerHTML salvo el SVG del QR de WhatsApp (imagen, no script)', () => {
    const usos: string[] = [];
    for (const f of fuentes('src/app')) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      if (/dangerouslySetInnerHTML/.test(readFileSync(f, 'utf8'))) usos.push(f);
    }
    expect(usos.sort()).toEqual(['src/app/dashboard/whatsapp/vista.tsx', 'src/app/layout.tsx']);
  });
});
