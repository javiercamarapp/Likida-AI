import { describe, it, expect } from 'vitest';
import nextConfig from '../../next.config';

// A37-L-seguridad-tenant-04
describe('CSP de /api: la página de baja de correo conserva su estilo', () => {
  it('la última regla que casa con /api/correo/baja permite estilo en línea y nada más', async () => {
    const reglas = await nextConfig.headers!();
    const csp = (fuente: string) => {
      const casan = reglas.filter((r) => r.source === fuente || r.source === '/api/:path*');
      const ultima = casan[casan.length - 1];
      return ultima.headers.find((h) => h.key === 'Content-Security-Policy')!.value;
    };
    const baja = csp('/api/correo/baja');
    expect(baja).toContain("style-src 'unsafe-inline'");
    expect(baja).not.toMatch(/script-src|img-src|connect-src/);
    expect(baja).toContain("default-src 'none'");
    expect(csp('/api/otra')).not.toContain('unsafe-inline');
  });
});
