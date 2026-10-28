import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeccionCruceViajes } from './cruce-viajes';

const nada = async () => {};
const acciones = { guardarCruceViajes: nada };

describe('SeccionCruceViajes (A2 ola 1)', () => {
  it('apagado y sin viajes: lo dice, avisa que todo saldría «sin viaje» y ofrece encender', () => {
    const html = renderToStaticMarkup(<SeccionCruceViajes datos={{ activo: false, fuente: { viajes: 0, viajesConDespacho: 0, posicionesConDespacho: 0 }, puedeAdministrar: true, acciones }} />);
    expect(html).toContain('apagado');
    expect(html).toContain('Todavía no hay viajes cargados');
    expect(html).toContain('Encender el cruce');
    expect(html).toMatch(/name="activo" value="1"/);
  });
  it('encendido: ofrece apagar y cuenta lo cargado', () => {
    const html = renderToStaticMarkup(<SeccionCruceViajes datos={{ activo: true, fuente: { viajes: 12, viajesConDespacho: 10, posicionesConDespacho: 340 }, puedeAdministrar: true, acciones }} />);
    expect(html).toContain('encendido');
    expect(html).toContain('12 viaje(s) cargado(s), 10 con Icident, y 340 posición(es)');
    expect(html).toContain('Apagar el cruce');
    expect(html).toMatch(/name="activo" value="0"/);
    expect(html).not.toContain('Todavía no hay viajes cargados');
  });
  it('sin permiso de administrar no hay botón', () => {
    const html = renderToStaticMarkup(<SeccionCruceViajes datos={{ activo: false, fuente: null, puedeAdministrar: false, acciones }} />);
    expect(html).not.toContain('<button');
    expect(html).toContain('No se pudo leer cuántos viajes');
  });
  it('una lectura fallida del estado no afirma nada', () => {
    const html = renderToStaticMarkup(<SeccionCruceViajes datos={{ activo: null, fuente: null, puedeAdministrar: true, acciones }} />);
    expect(html).toContain('No se pudo leer el estado del cruce');
    expect(html).not.toContain('<button');
  });
});
