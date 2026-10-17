import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaReclamacionPeajes, type ExtrasReclamacion } from './vista';
import { revisarCobros, type LineaCobro } from '@/lib/likida/peajes/reglas_cobro';
import { detectarAtipicos } from '@/lib/likida/peajes/cruces_atipicos';
import { resumirSeguimiento } from '@/lib/likida/peajes/reclamos_seguimiento';
import type { ReporteRevision } from '@/lib/likida/peajes/revision_cobros';

const ID = '11111111-1111-4111-8111-111111111111';
const nada = async () => {};
const l = (indice: number, p: Partial<LineaCobro> = {}): LineaCobro => ({
  indice, fecha: '2026-03-05', hora: `10:${String(indice).padStart(2, '0')}:00`, caseta: 'Plaza Ejemplo Sur', tag: `TAG0000000${indice}`, unidad: 'TC9002', clase: 5, monto: 100, ...p,
});
const lineas = [l(0), l(1), l(2, { caseta: 'Caseta Ejemplo Norte' })];

function reporte(just: Map<number, string>): ReporteRevision {
  return {
    desgloseId: ID, proveedor: 'IAVE', archivoNombre: 'prueba.xlsx', periodoMedidoDesde: '2026-03-01', periodoMedidoHasta: '2026-03-10',
    periodoOficialDesde: '2026-03-01', periodoOficialHasta: '2026-03-10', periodoOrigen: 'nombre_archivo', noPeriodo: '801', calidad: null,
    revision: revisarCobros(lineas, { periodoDesde: '2026-03-01', casetasNoCruzar: new Set(['plaza ejemplo sur']), justificados: just }),
    atipicos: detectarAtipicos(lineas), rotulo: 'Candidato: validar con el proveedor',
  };
}
const pintar = (rep: ReporteRevision, conAccion: boolean) => {
  const e: ExtrasReclamacion = {
    revision: rep, mes: null, cierre: null, seguimiento: { reclamos: [], resumen: resumirSeguimiento([], '2026-03-20') },
    acciones: { crearReclamo: nada, marcarEnviado: nada, registrarNota: nada, rechazar: nada, ...(conAccion ? { justificarCruce: nada } : {}) },
  };
  return renderToStaticMarkup(<VistaReclamacionPeajes sufijo="?tenant=f-1" desglose={ID} estado="ok" reporte={null} extras={e} />);
};

describe('«justificar este cruce» en la revisión', () => {
  it('cada cruce de caseta prohibida sin justificar trae su botón y su motivo', () => {
    const html = pintar(reporte(new Map()), true);
    expect(html.match(/Justificar este cruce/g)).toHaveLength(2);
    expect(html).toContain('name="indice" value="0"');
    expect(html).toContain('name="indice" value="1"');
    expect(html).toContain(`name="desglose" value="${ID}"`);
    expect(html).toContain('name="motivo"');
  });

  it('un cruce justificado sigue en la lista, rotulado con su motivo y sin botón', () => {
    const html = pintar(reporte(new Map([[1, 'Salida de servicio autorizada']])), true);
    expect(html).toContain('Justificado');
    expect(html).toContain('Salida de servicio autorizada');
    expect(html.match(/Justificar este cruce/g)).toHaveLength(1);
    expect(html).toContain('Caseta que no debe cruzarse · 2');
  });

  it('otras categorías no llevan botón de justificar, y sin acción no se pinta', () => {
    expect(pintar(reporte(new Map()), false)).not.toContain('Justificar este cruce');
    const soloClase = { ...reporte(new Map()), revision: revisarCobros([l(0, { clase: 9, caseta: 'Caseta Ejemplo Norte' })], { periodoDesde: '2026-03-01' }) };
    expect(pintar(soloClase, true)).not.toContain('Justificar este cruce');
  });

  it('un motivo con HTML se escapa', () => {
    const html = pintar(reporte(new Map([[0, '<script>x</script>']])), true);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
