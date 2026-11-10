import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CabeceraAdmin from './cabecera-admin';

// Antes /admin no tenía cabecera: al plegar el sidebar a riel no había ningún control para volver a abrirlo.
describe('CabeceraAdmin: la misma barra superior del dashboard', () => {
  const html = renderToStaticMarkup(<CabeceraAdmin />);
  it('trae el botón de plegar/expandir el menú, accesible y con su estado', () => {
    expect(html).toContain('rv-cab-esc__plegar');
    expect(html).toMatch(/aria-label="(Plegar|Expandir) el menú"/);
    expect(html).toContain('aria-expanded');
  });
  it('trae la campana hacia las notificaciones del admin y la fecha de hoy', () => {
    expect(html).toContain('href="/admin/notificaciones"');
    expect(html).toContain('rv-cab-esc__fecha');
  });
  it('usa las clases del sistema (.rv-cab-esc), no estilos propios', () => {
    expect(html).toContain('class="rv-cab-esc"');
    expect(html).not.toMatch(/style=/);
  });
});
