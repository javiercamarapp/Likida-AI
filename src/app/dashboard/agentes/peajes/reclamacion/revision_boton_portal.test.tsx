import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeccionRevisionCobros } from './revision';
import { revisarCobros, type LineaCobro } from '@/lib/likida/peajes/reglas_cobro';
import { detectarAtipicos } from '@/lib/likida/peajes/cruces_atipicos';
import type { ReporteRevision } from '@/lib/likida/peajes/revision_cobros';

const ID = '11111111-1111-4111-8111-111111111111';
const lineas: LineaCobro[] = [{ indice: 0, fecha: '2026-03-05', hora: '10:00:00', caseta: 'Caseta Ejemplo Norte', tag: 'IMDM00000001', unidad: '101', clase: 9, monto: 400 }];
const revision: ReporteRevision = {
  desgloseId: ID, proveedor: 'Proveedor Ejemplo', archivoNombre: '01 A 10 DE MARZO.xlsx', periodoMedidoDesde: '2026-03-05', periodoMedidoHasta: '2026-03-05',
  periodoOficialDesde: '2026-03-01', periodoOficialHasta: '2026-03-10', periodoOrigen: 'nombre_archivo', noPeriodo: null, calidad: null,
  revision: revisarCobros(lineas, { periodoDesde: '2026-03-01' }), atipicos: detectarAtipicos(lineas), rotulo: 'Candidato: validar con el proveedor',
};

describe('el botón «Reporte para el portal del proveedor»', () => {
  it('enlaza al export de candidatos con el desglose y el contexto de la flota, y ofrece la variante sin reclamados y el CSV', () => {
    const html = renderToStaticMarkup(<SeccionRevisionCobros revision={revision} desglose={ID} sufijo="?tenant=f-1" />);
    expect(html).toContain('Reporte para el portal del proveedor');
    expect(html).toContain(`/api/export/peajes-candidatos?desglose=${ID}&amp;tenant=f-1`);
    expect(html).toContain(`/api/export/peajes-candidatos?desglose=${ID}&amp;excluirReclamados=1&amp;tenant=f-1`);
    expect(html).toContain(`/api/export/peajes-candidatos?desglose=${ID}&amp;formato=csv&amp;tenant=f-1`);
    // el Excel de la revisión de siempre sigue ahí
    expect(html).toContain(`/api/export/peajes-revision?desglose=${ID}&amp;tenant=f-1`);
  });
});
