import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaReferencia } from './vista';

const accion = async () => null;
const base = { clientes: [{ id: 'c1', nombre: 'Cliente Ejemplo' }], exigen: new Set(['c1']), folios: { v1: 'F-1' }, truncado: false, sufijo: '', ver: {}, acciones: { capturar: accion, exigencia: accion } };

describe('VistaReferencia (OLA1-A3)', () => {
  it('lista los pendientes por cliente con su folio y la forma para capturar', () => {
    const html = renderToStaticMarkup(<VistaReferencia {...base} tablero={{ total: 1, clientes: [{ clienteId: 'c1', clienteNombre: 'Cliente Ejemplo', pendientes: 1, masAntiguoHoras: 30, viajes: [{ viajeId: 'v1', cargaHechaEn: '2026-03-08T10:00:00Z', antiguedadHoras: 30 }] }] }} />);
    expect(html).toContain('Viaje F-1');
    expect(html).toContain('Cliente Ejemplo');
    expect(html).toContain('name="referencia"');
    expect(html).toContain('Dejar de exigir');
  });
  it('si la lectura falló lo dice, no pinta «sin pendientes»', () => {
    const html = renderToStaticMarkup(<VistaReferencia {...base} tablero={null} />);
    expect(html).toContain('No se pudieron leer');
    expect(html).not.toContain('No hay viajes cargados sin referencia');
  });
  it('sin clientes que la exijan lo explica', () => {
    const html = renderToStaticMarkup(<VistaReferencia {...base} exigen={new Set()} tablero={{ total: 0, clientes: [] }} />);
    expect(html).toContain('Ningún cliente exige referencia');
  });
});
