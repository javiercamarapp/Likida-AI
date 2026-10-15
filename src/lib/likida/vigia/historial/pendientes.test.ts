import { describe, it, expect } from 'vitest';
import { pendientesDeHistorial, type EntradaPendientes } from './pendientes';

const m = (iso: string, rol: 'cliente' | 'equipo', texto: string, grupo?: string): EntradaPendientes => ({ enviadoEn: iso, rol, texto, grupo });

// Exportación sintética: 3 preguntas sin respuesta, 2 contestadas, 1 «gracias», 1 monitoreo.
const EXPORT = [
  m('2026-09-01T15:00:00Z', 'cliente', '¿Dónde va el viaje 101?', 'Grupo A'),
  m('2026-09-01T15:05:00Z', 'equipo', 'Va por Querétaro.'),
  m('2026-09-01T16:00:00Z', 'cliente', 'Necesito la factura del servicio', 'Grupo A'),
  m('2026-09-01T16:10:00Z', 'cliente', '¿A qué hora llega la unidad?', 'Grupo A'),
  m('2026-09-01T16:20:00Z', 'cliente', 'Es URGENTE el comprobante de entrega ASAP', 'Grupo B'),
  m('2026-09-01T16:25:00Z', 'cliente', 'gracias', 'Grupo B'),
  m('2026-09-01T16:30:00Z', 'cliente', 'UNIDAD 55 DETENIDA', 'Grupo B'),
  m('2026-09-02T09:00:00Z', 'cliente', '¿Me confirman la cita?', 'Grupo A'),
  m('2026-09-02T09:15:00Z', 'equipo', 'Confirmada.'),
  m('2026-09-02T18:00:00Z', 'equipo', 'Cierre del día.'),
];

describe('pendientes desde el chat exportado', () => {
  it('3 sin respuesta y 2 contestadas → 3 pendientes; «gracias» y monitoreo se ignoran', () => {
    const r = pendientesDeHistorial(EXPORT);
    expect(r.pendientes).toHaveLength(3);
    expect(r.pendientes.map((p) => p.texto)).not.toContain('gracias');
    expect(r.pendientes.some((p) => /DETENIDA/.test(p.texto))).toBe(false);
    expect(r.ignorados).toBe(2);
  });

  it('el ASAP/urgente va arriba; luego las preguntas (nivel alto) por antigüedad y al final los normales', () => {
    const r = pendientesDeHistorial(EXPORT);
    expect(r.pendientes[0].texto).toContain('URGENTE');
    expect(r.pendientes[0].nivel).toBe(2);
    expect(r.pendientes[0].motivos).toContain('urgencia');
    expect(r.pendientes[1].texto).toContain('hora llega');
    expect(r.pendientes[2].nivel).toBe(1);
    expect(r.pendientes[2].texto).toContain('factura');
  });

  it('la antigüedad se mide contra el último mensaje de la exportación, no contra hoy, y trae el grupo', () => {
    const r = pendientesDeHistorial(EXPORT);
    expect(r.fotoEn).toBe('2026-09-02T18:00:00Z');
    const urgente = r.pendientes[0];
    expect(urgente.antiguedadMin).toBe(25 * 60 + 40);
    expect(urgente.grupo).toBe('Grupo B');
  });

  it('una respuesta del equipo fuera de la ventana no cuenta como respuesta', () => {
    const r = pendientesDeHistorial([m('2026-09-01T10:00:00Z', 'cliente', '¿Ya salió mi carga?'), m('2026-09-01T13:00:00Z', 'equipo', 'Sí.')]);
    expect(r.pendientes).toHaveLength(1);
  });

  it('exportación vacía → sin pendientes y sin foto; solo equipo → sin pendientes', () => {
    expect(pendientesDeHistorial([])).toEqual({ pendientes: [], ignorados: 0, fotoEn: null });
    expect(pendientesDeHistorial([m('2026-09-01T10:00:00Z', 'equipo', 'Buen día')]).pendientes).toEqual([]);
  });

  it('no filtra autores ni teléfonos: la salida solo trae texto, nivel, motivos, antigüedad, fecha y grupo', () => {
    const r = pendientesDeHistorial(EXPORT);
    expect(Object.keys(r.pendientes[0]).sort()).toEqual(['antiguedadMin', 'enviadoEn', 'grupo', 'motivos', 'nivel', 'texto']);
  });

  it('recorta textos largos', () => {
    const r = pendientesDeHistorial([m('2026-09-01T10:00:00Z', 'cliente', `¿${'a'.repeat(900)}?`)]);
    expect(r.pendientes[0].texto.length).toBe(240);
  });
});
