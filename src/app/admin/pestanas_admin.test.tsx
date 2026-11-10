import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarcoPagina } from '../ui-v2/componentes/marco-pagina';

let ruta = '/admin/agente-ocr';
vi.mock('next/navigation', () => ({ usePathname: () => ruta }));
const { default: ProveedorMarcoAdmin, pestanasDeRuta, areaDeRutaAdmin } = await import('./pestanas-admin');

const pagina = () => renderToStaticMarkup(<ProveedorMarcoAdmin><p>contenido</p></ProveedorMarcoAdmin>);
const paginaConMarco = () => renderToStaticMarkup(<ProveedorMarcoAdmin><MarcoPagina titulo="OCR"><p>contenido</p></MarcoPagina></ProveedorMarcoAdmin>);

describe('ProveedorMarcoAdmin (PestanasHub del admin)', () => {
  it('pantalla sin MarcoPagina: pinta las pestañas del grupo como respaldo y marca la actual', () => {
    ruta = '/admin/agente-ocr';
    const html = pagina();
    expect(html).toContain('aria-label="Secciones de Agentes"');
    expect(html).toContain('href="/admin/agente-cuadre"');
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>OCR</);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
  it('pantalla con MarcoPagina: la barra va DENTRO del marco, bajo el encabezado', () => {
    ruta = '/admin/agente-ocr';
    const html = paginaConMarco();
    const marco = html.indexOf('<main');
    expect(html.indexOf('</header>')).toBeGreaterThan(marco);
    expect(html.indexOf('rv-marco__pestanas')).toBeGreaterThan(html.indexOf('</header>'));
    expect(html.indexOf('rv-marco__pestanas')).toBeLessThan(html.indexOf('</main>'));
    // El respaldo del SSR sigue en el HTML (lo oculta el CSS y lo retira el cliente al hidratar), pero el marco trae la suya.
    expect(html).toContain('Secciones de Agentes');
  });
  it('el área sale de SECCIONES (la misma etiqueta que el sidebar)', () => {
    ruta = '/admin/agente-ocr';
    expect(areaDeRutaAdmin('/admin/agente-ocr')).toBe('Agentes');
    expect(areaDeRutaAdmin('/admin/consumo')).toBe('Negocio');
    expect(areaDeRutaAdmin('/admin')).toBeNull();
    expect(paginaConMarco()).toContain('rv-encabezado__rotulo');
  });
  it('rutas con parámetro cuentan por prefijo y las pestañas sin dato no inventan conteo', () => {
    const v = pestanasDeRuta('/admin/qa/abc');
    expect(v?.actual).toBe('/admin/qa');
    expect(v?.pestanas.every((p) => p.conteo == null)).toBe(true);
  });
  it('no pinta nada en una página de grupo único o fuera de los grupos', () => {
    ruta = '/admin/soporte';
    expect(pagina()).not.toContain('<nav');
    ruta = '/admin';
    expect(pagina()).not.toContain('<nav');
  });
});
