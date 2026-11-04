import { describe, it, expect } from 'vitest';
import { construirCsp, nonceActivo, nuevoNonce, origenSupabase, HASH_SCRIPT_TEMA } from './csp';
import nextConfig from '../../../next.config';

describe('construirCsp', () => {
  it('sin nonce es la política pública de siempre (unsafe-inline), con las 11 directivas', () => {
    const csp = construirCsp(null, false);
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp.split('; ')).toHaveLength(12);
    expect(csp).not.toContain('strict-dynamic');
  });

  it('con nonce: nonce + hash del tema + strict-dynamic y NINGÚN unsafe-inline en script-src', () => {
    const csp = construirCsp('AAAAAAAAAAAAAAAAAAAAAA==', false);
    const src = csp.split('; ').find((d) => d.startsWith('script-src'));
    expect(src).toBe(`script-src 'self' 'nonce-AAAAAAAAAAAAAAAAAAAAAA==' ${HASH_SCRIPT_TEMA} 'strict-dynamic'`);
    // style-src conserva unsafe-inline a propósito (atributos style={{…}}); no es script-src.
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it('unsafe-eval solo con dev=true', () => {
    expect(construirCsp('x', true)).toContain("'unsafe-eval'");
    expect(construirCsp('x', false)).not.toContain('unsafe-eval');
    expect(construirCsp(null, true)).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
  });
});

describe('img-src (ronda 15)', () => {
  const imgSrc = (n: string | null) => construirCsp(n, false).split('; ').find((d) => d.startsWith('img-src'))!.split(' ').slice(1);

  it('admite los tiles de OpenStreetMap (mapa de prospectos) y blob: (vista previa del avatar), con y sin nonce', () => {
    for (const n of [null, 'bm9uY2U=']) {
      expect(imgSrc(n)).toEqual(expect.arrayContaining(["'self'", 'data:', 'blob:', 'https://*.supabase.co', 'https://tile.openstreetmap.org']));
    }
  });

  it('solo esos orígenes: nada de https: genérico, comodines de OSM ni http:', () => {
    expect(imgSrc('bm9uY2U=')).toHaveLength(5);
    expect(imgSrc('bm9uY2U=').some((o) => o === 'https:' || o === 'http:' || o === '*' || o.includes('*.openstreetmap'))).toBe(false);
  });
});

describe('nuevoNonce', () => {
  it('es base64 válido de 16 bytes y distinto cada vez', () => {
    const a = nuevoNonce();
    const b = nuevoNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(Buffer.from(a, 'base64')).toHaveLength(16);
    expect(a).not.toBe(b);
  });

  it('cabe en lo que Next acepta como nonce (get-script-nonce-from-header)', () => {
    expect(`'nonce-${nuevoNonce()}'`).toMatch(/^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/);
  });
});

describe('nonceActivo', () => {
  it('solo LIKIDA_CSP_NONCE=0 lo apaga', () => {
    expect(nonceActivo({})).toBe(true);
    expect(nonceActivo({ LIKIDA_CSP_NONCE: '1' })).toBe(true);
    expect(nonceActivo({ LIKIDA_CSP_NONCE: '' })).toBe(true);
    expect(nonceActivo({ LIKIDA_CSP_NONCE: '0' })).toBe(false);
  });
});

// CT-SEG-18 · La CSP acotada al proyecto de Supabase. Este bloque VIGILA que acotar no rompa Storage: la subida directa del
// navegador (`uploadToSignedUrl`) es un fetch al proyecto y necesita connect-src; las fotos/video/audio, img-src y media-src.
describe('CT-SEG-18 · CSP acotada al proyecto de Supabase', () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://abcdwxyz.supabase.co' };
  const dir = (csp: string, nombre: string) => csp.split('; ').find((d) => d.startsWith(nombre))!.split(' ').slice(1);

  it('img-src, media-src y connect-src llevan el host exacto del proyecto y ningun comodin *.supabase.co', () => {
    for (const n of [null, 'bm9uY2U=']) {
      const csp = construirCsp(n, false, env);
      expect(dir(csp, 'img-src')).toContain('https://abcdwxyz.supabase.co');
      expect(dir(csp, 'media-src')).toContain('https://abcdwxyz.supabase.co');
      expect(dir(csp, 'connect-src')).toEqual(["'self'", 'https://abcdwxyz.supabase.co']);
      expect(csp).not.toContain('*.supabase.co');
    }
  });

  it('connect-src admite el proyecto (subida directa a Storage) pero no abre https: ni comodines ni wss', () => {
    const c = dir(construirCsp('bm9uY2U=', false, env), 'connect-src');
    expect(c.some((o) => o === 'https:' || o === '*' || o.startsWith('wss:') || o.includes('*'))).toBe(false);
  });

  it('sin la variable o con una URL invalida cae al comodin de antes (no rompe imagenes ni subidas)', () => {
    for (const e of [{}, { NEXT_PUBLIC_SUPABASE_URL: 'no es url' }, { NEXT_PUBLIC_SUPABASE_URL: 'http://evil.example' }]) {
      const csp = construirCsp(null, false, e);
      expect(dir(csp, 'img-src')).toContain('https://*.supabase.co');
      expect(dir(csp, 'connect-src')).toContain('https://*.supabase.co');
    }
  });

  it('origenSupabase: solo el origen (sin ruta), https siempre y http solo en localhost', () => {
    expect(origenSupabase({ NEXT_PUBLIC_SUPABASE_URL: 'https://abcdwxyz.supabase.co/rest/v1/' })).toBe('https://abcdwxyz.supabase.co');
    expect(origenSupabase({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' })).toBe('http://127.0.0.1:54321');
    expect(origenSupabase({ NEXT_PUBLIC_SUPABASE_URL: 'http://otro.example' })).toBeNull();
  });

  it('COOP same-origin-allow-popups en todo y CORP same-origin solo en export y /v1; nunca COEP', async () => {
    const reglas = await nextConfig.headers!();
    const valor = (fuente: string, clave: string) => reglas.find((r) => r.source === fuente)?.headers.find((h) => h.key === clave)?.value;
    expect(valor('/:path*', 'Cross-Origin-Opener-Policy')).toBe('same-origin-allow-popups');
    expect(valor('/api/export/:path*', 'Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(valor('/api/v1/:path*', 'Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(reglas.some((r) => r.headers.some((h) => h.key === 'Cross-Origin-Embedder-Policy'))).toBe(false);
  });
});
