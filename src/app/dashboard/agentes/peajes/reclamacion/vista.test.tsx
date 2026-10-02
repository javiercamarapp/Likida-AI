import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaReclamacionPeajes } from './vista';
import { LEYENDAS_RECLAMACION, type ReporteReclamacion } from '@/lib/likida/peajes/reclamacion';

const ID = '11111111-1111-4111-8111-111111111111';
const reporte = (o: Partial<ReporteReclamacion> = {}): ReporteReclamacion => ({
  desgloseId: ID, proveedor: 'PASE', periodoDesde: '2026-08-05', periodoHasta: '2026-08-07', leyendas: LEYENDAS_RECLAMACION,
  resumen: {
    lineas: 3, reclamables: 1, montoReclamable: 100, confirmadas: 1, sinDatos: 1, sinEvaluar: 0,
    porMotivo: { gps_lejos_de_caseta: { n: 1, monto: 100 }, unidad_en_zona_no_autorizada: { n: 0, monto: 0 }, doble_cobro: { n: 0, monto: 0 } },
  },
  cruces: [{
    indice: 1, fecha: '2026-08-05', hora: '11:30:00', caseta: 'Caseta Ejemplo Sur', casetaCatalogo: 'Caseta Ejemplo Sur', tag: 'IMDM10000002', unidad: 'C2-09', monto: 100,
    motivo: 'gps_lejos_de_caseta', confianza: 'alta', porQue: 'La unidad C2-09 no estaba en la caseta <b>x</b>.', distanciaM: 22000, radioCasetaM: 300,
    evidencia: [{ en: '2026-08-05T17:28:00.000Z', lat: 19.2, lng: -99, minutosDelPase: -2, distanciaCasetaM: 22000 }], zona: null, duplicadoDeLinea: null,
  }],
  ...o,
});
const pintar = (estado: Parameters<typeof VistaReclamacionPeajes>[0]['estado'], r: ReporteReclamacion | null = reporte()) =>
  renderToStaticMarkup(<VistaReclamacionPeajes sufijo="?tenant=f-1" desglose={ID} estado={estado} reporte={r} />);

describe('la pantalla del reporte de reclamación', () => {
  it('enseña el cruce con fecha, hora, caseta, TAG, unidad, monto, el porqué y la evidencia', () => {
    const html = pintar('ok');
    for (const t of ['2026-08-05', '11:30:00', 'Caseta Ejemplo Sur', 'IMDM10000002', 'C2-09', '$100.00', 'GPS lejos de la caseta · alta', 'a 22000 m de la caseta']) expect(html).toContain(t);
    expect(html).toContain('1 cruce para pedir revisión');
    expect(html).toContain('$100.00');
  });

  it('un texto del proveedor/flota se escapa, no se inyecta', () => {
    const html = pintar('ok');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });

  it('los enlaces de descarga llevan el desglose, el formato y el contexto de la flota', () => {
    const html = pintar('ok');
    expect(html).toContain(`/api/export/peajes-reclamacion?desglose=${ID}&amp;formato=xlsx&amp;tenant=f-1`);
    expect(html).toContain(`/api/export/peajes-reclamacion?desglose=${ID}&amp;formato=pdf&amp;tenant=f-1`);
  });

  it('declara que lo SIN datos no se reclama y trae las leyendas de qué NO afirma', () => {
    const html = pintar('ok');
    expect(html).toContain('No se reclaman (sin evidencia en contra del cobro)');
    expect(html).toContain('Sin datos no es evidencia en contra de nadie');
    expect(html).toContain('La decisión de reclamar es de la flota');
  });

  it('sin cruces reclamables lo dice y no pinta una tabla vacía con cara de reporte', () => {
    const vacio = reporte({ cruces: [], resumen: { ...reporte().resumen, reclamables: 0, montoReclamable: 0 } });
    const html = pintar('ok', vacio);
    expect(html).toContain('Sin cruces para reclamar');
    expect(html).not.toContain('<table');
  });

  it('si no se pudo leer NO dice «nada que reclamar»: dice que falló', () => {
    const html = pintar('error', null);
    expect(html).toContain('No es que no haya nada que reclamar');
    expect(html).not.toContain('Sin cruces para reclamar');
  });

  it('desglose inexistente y sin desglose se dicen distinto', () => {
    expect(pintar('no_existe', null)).toContain('no existe en tu flota');
    expect(pintar('sin_desglose', null)).toContain('Elige un desglose');
  });
});
