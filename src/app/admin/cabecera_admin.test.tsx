import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CabeceraAdmin, { ProveedorRequiereAccion, etiquetaCampana } from './cabecera-admin';

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

// La campana lleva el dato real de «requiere acción»; lectura caída = «sin dato», nunca 0.
describe('CabeceraAdmin: la campana con el contador real', () => {
  const con = (pendientes: number | null, hayUrgente = false) => renderToStaticMarkup(<CabeceraAdmin requiereAccion={{ pendientes, hayUrgente }} />);
  it('con 0 pendientes no pinta insignia y lo dice', () => {
    const html = con(0);
    expect(html).not.toContain('rv-campana__cuenta');
    expect(html).not.toContain('rv-campana__sin-dato');
    expect(html).toContain('aria-label="Notificaciones: nada pendiente"');
  });
  it('con 3 pendientes pinta el 3', () => {
    const html = con(3);
    expect(html).toContain('rv-campana__cuenta');
    expect(html).toMatch(/data-urgente="no"[^>]*>3</);
    expect(html).toContain('aria-label="Notificaciones: 3 pendientes"');
  });
  it('con 12 pendientes y algo urgente pinta el 12 en modo urgente', () => {
    const html = con(12, true);
    expect(html).toMatch(/data-urgente="si"[^>]*>12</);
    expect(html).toContain('12 pendientes, hay algo urgente');
  });
  it('un solo pendiente va en singular y más de 99 se topa', () => {
    expect(etiquetaCampana({ pendientes: 1, hayUrgente: false })).toBe('Notificaciones: 1 pendiente');
    expect(con(250)).toMatch(/>99\+</);
  });
  it('con la lectura caída dice «sin dato» y nunca pinta 0', () => {
    const html = con(null);
    expect(html).toContain('aria-label="Notificaciones: sin dato"');
    expect(html).toContain('data-estado="sin-dato"');
    expect(html).not.toMatch(/>0</);
  });
  it('el dato también llega por el proveedor del layout, sin props', () => {
    const html = renderToStaticMarkup(<ProveedorRequiereAccion valor={{ pendientes: 3, hayUrgente: false }}><CabeceraAdmin /></ProveedorRequiereAccion>);
    expect(html).toContain('aria-label="Notificaciones: 3 pendientes"');
  });
  it('la campana sigue llevando a las notificaciones y sin dato de entrada no inventa nada', () => {
    const html = renderToStaticMarkup(<CabeceraAdmin />);
    expect(html).toContain('href="/admin/notificaciones"');
    expect(html).not.toContain('rv-campana__cuenta');
    expect(html).not.toContain('rv-campana__sin-dato');
  });
});
