import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

// CT-SEG-20: /api/v1 (JSON con datos del tenant) y /dashboard no deben quedar en caches compartidas.
async function cabecerasDe(ruta: string): Promise<Record<string, string>> {
  const reglas = await nextConfig.headers!();
  const salida: Record<string, string> = {};
  for (const r of reglas) {
    const base = r.source.replace(/\/:path\*$/, '');
    const coincide = r.source === '/:path*' || ruta === base || ruta.startsWith(`${base}/`);
    if (coincide) for (const h of r.headers) salida[h.key.toLowerCase()] = h.value;
  }
  return salida;
}

describe('Cache-Control no-store (CT-SEG-20)', () => {
  it.each(['/api/v1/viajes', '/api/v1/ccp-timbrado', '/dashboard', '/dashboard/agentes/proveedores'])('%s lleva no-store', async (ruta) => {
    const c = await cabecerasDe(ruta);
    expect(c['cache-control']).toMatch(/no-store/);
  });
});
