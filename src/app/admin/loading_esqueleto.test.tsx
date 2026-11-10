/* eslint-disable security/detect-non-literal-fs-filename -- lee archivos del propio repo */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Loading from './loading';
import LoadingHub from './loading-hub';
import { REDIRECCIONES_308 } from './guardas/redirecciones_308';
import { SECCIONES } from './rutas';

// R9 / Fase 1: cada ruta de primer nivel carga con el esqueleto de la página (forma real), nunca con un logo solo. En una ruta de HUB
// (pantalla con pestañas hermanas) la barra de pestañas persiste, así que el esqueleto NO repite el encabezado (`sinEncabezado`).
describe('esqueletos de carga de /admin', () => {
  it('la raíz y la variante de hub pintan el esqueleto accesible; la de hub no lleva encabezado', () => {
    const raiz = renderToStaticMarkup(<Loading />);
    const hub = renderToStaticMarkup(<LoadingHub />);
    for (const h of [raiz, hub]) {
      expect(h).toContain('data-carga="pagina"');
      expect(h).toContain('aria-busy="true"');
      expect(h).toContain('rv-kpi');
    }
    expect(raiz).toContain('rv-encabezado');
    expect(hub).not.toContain('rv-encabezado');
    expect(hub).toContain('data-sin-encabezado');
  });

  const ADMIN = join(process.cwd(), 'src/app/admin');
  const hubs = new Set(SECCIONES.flatMap((s) => s.items).filter((i) => (i.pestanas?.length ?? 0) >= 2).flatMap((i) => i.pestanas!.map((p) => p.href)));
  const rutas = readdirSync(ADMIN).filter((n) => statSync(join(ADMIN, n)).isDirectory() && existsSync(join(ADMIN, n, 'page.tsx')))
    .map((n) => `/admin/${n}`).filter((d) => !(d in REDIRECCIONES_308));

  it('toda ruta de primer nivel (no stub) trae su loading.tsx', () => {
    expect(rutas.length).toBeGreaterThan(30);
    expect(rutas.filter((d) => !existsSync(join(ADMIN, d.replace('/admin/', ''), 'loading.tsx')))).toEqual([]);
  });

  it('las rutas de hub re-exportan el esqueleto sin encabezado y las demás el de página entera', () => {
    const mal: string[] = [];
    for (const d of rutas) {
      const f = readFileSync(join(ADMIN, d.replace('/admin/', ''), 'loading.tsx'), 'utf8');
      const esperado = hubs.has(d) ? '../loading-hub' : '../loading';
      if (!f.includes(`'${esperado}'`)) mal.push(`${d}: debía usar ${esperado}`);
    }
    expect(mal).toEqual([]);
  });

  it('«Nuevo acceso» (segundo nivel, pestaña de Equipo) también carga como hub', () => {
    expect(readFileSync(join(ADMIN, 'usuarios/nuevo/loading.tsx'), 'utf8')).toContain("'../../loading-hub'");
  });
});
