import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CabeceraAdmin, { ProveedorRequiereAccion, etiquetaCampana } from './cabecera-admin';
import { PieAdmin } from './sidebar-nav';

// Antes /admin no tenía cabecera: al plegar el sidebar a riel no había ningún control para volver a abrirlo.
describe('CabeceraAdmin: la misma barra superior del dashboard (como Rovaq: sin botón de plegar)', () => {
  const html = renderToStaticMarkup(<CabeceraAdmin />);
  it('NO trae botón de plegar: vive solo en la marca del sidebar, como Rovaq (un único control)', () => {
    expect(html).not.toContain('rv-cab-esc__plegar');
    expect(html).not.toMatch(/aria-label="(Plegar|Expandir) el menú"/);
  });
  it('ya no trae la campana ni la fecha de hoy: la campana vive como «Avisos» en el pie', () => {
    expect(html).not.toContain('href="/admin/notificaciones"');
    expect(html).not.toContain('rv-cab-esc__fecha');
    expect(html).not.toContain('Notificaciones');
  });
  it('usa las clases del sistema (.rv-cab-esc), no estilos propios', () => {
    expect(html).toContain('class="rv-cab-esc"');
    expect(html).not.toMatch(/style=/);
  });
});

// «Avisos» lleva el dato real de «requiere acción»; lectura caída = «sin dato», nunca 0.
describe('«Avisos» del pie de /admin: el contador real', () => {
  const con = (pendientes: number | null, hayUrgente = false) => renderToStaticMarkup(
    <ProveedorRequiereAccion valor={{ pendientes, hayUrgente }}><PieAdmin nombre="Ana Pérez" avatarUrl={null} flotas={[]} /></ProveedorRequiereAccion>,
  );
  it('con 0 pendientes no pinta cifra y lo dice', () => {
    const html = con(0);
    expect(html).not.toContain('rv-contador');
    expect(html).not.toContain('data-estado="sin-dato"');
    expect(html).toContain('aria-label="Avisos: nada pendiente"');
  });
  it('con 3 pendientes pinta el 3', () => {
    const html = con(3);
    expect(html).toMatch(/data-urgente="no"[^>]*>3</);
    expect(html).toContain('aria-label="Avisos: 3 pendientes"');
  });
  it('con 12 pendientes y algo urgente pinta el 12 en modo urgente', () => {
    const html = con(12, true);
    expect(html).toMatch(/data-urgente="si"[^>]*>12</);
    expect(html).toContain('12 pendientes, hay algo urgente');
  });
  it('más de 99 se topa', () => { expect(con(250)).toMatch(/>99\+</); });
  it('con la lectura caída dice «sin dato» y nunca pinta 0', () => {
    const html = con(null);
    expect(html).toContain('aria-label="Avisos: sin dato"');
    expect(html).toContain('data-estado="sin-dato"');
    expect(html).not.toMatch(/>0</);
  });
  it('sin proveedor (render de prueba) no inventa ninguna cifra y sigue llevando a las notificaciones', () => {
    const html = renderToStaticMarkup(<PieAdmin nombre="Ana Pérez" avatarUrl={null} flotas={[]} />);
    expect(html).toContain('href="/admin/notificaciones"');
    expect(html).toContain('aria-label="Avisos"');
    expect(html).not.toContain('rv-contador');
  });
  it('la etiqueta mantiene el contrato de siempre (singular, sin dato)', () => {
    expect(etiquetaCampana({ pendientes: 1, hayUrgente: false })).toBe('Notificaciones: 1 pendiente');
    expect(etiquetaCampana({ pendientes: null, hayUrgente: false })).toBe('Notificaciones: sin dato');
  });
});
