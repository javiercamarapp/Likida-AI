import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaConfiguracionPeajes, type AccionesConfiguracion, type BuzonVista } from './vista';
import type { EntradasVista } from './entradas';

const nada = async () => {};
const acciones: AccionesConfiguracion = {
  activarBuzon: nada, desactivarBuzon: nada, rotarLlave: nada, reintentarArchivo: nada, altaTag: nada, bajaTag: nada, importarTags: nada,
  importarCasetas: nada, estadoCaseta: nada, guardarGeocerca: nada, estadoGeocerca: nada, importarCursos: nada, importarCursosDeTabla: nada, estadoCurso: nada, guardarMapeo: nada, borrarMapeo: nada,
  activarCorreo: nada, desactivarCorreo: nada, rotarCorreo: nada, guardarRemitentes: nada, guardarPull: nada, apagarPull: nada, borrarCredencialPull: nada,
};
const entradasBase: EntradasVista = { config: null, puedeAdministrar: true, direccionCorreo: null, cofreConfigurado: true };

const buzon: BuzonVista = { estado: 'inactivo', rotacion: 0, secretoConfigurado: false, puedeAdministrar: true, llave: null, url: 'https://app.likida.ai/api/peajes/ingesta', flotaId: 'f-1' };

const pintar = (tags: Parameters<typeof VistaConfiguracionPeajes>[0]['tags']) => renderToStaticMarkup(
  <VistaConfiguracionPeajes
    sufijo="" aviso={null} error={null} agenteApagado={null}
    tags={tags} unidades={[{ id: 'u1', numeroEconomico: 'TC9001', placas: null }]} casetas={[]} geocercas={[]} cursos={[]} convenios={[]} mapeos={[]} archivos={[]}
    tiposGeocerca={['origen']} buzon={buzon} entradas={entradasBase} acciones={acciones}
  />,
);

describe('TAGs: baja con fecha y motivo (T-A2-10)', () => {
  it('un TAG en uso ofrece dar de baja con fecha obligatoria y motivo', () => {
    const html = pintar([{ id: 't1', tag: 'IMDM00000001', tagOriginal: 'IMDM 00000001', unidadId: 'u1', unidadEconomico: 'TC9001', proveedor: null, activo: true }]);
    expect(html).toContain('Dar de baja');
    expect(html).toContain('name="fecha"');
    expect(html).toContain('type="date"');
    expect(html).toContain('name="motivo"');
    expect(html).toContain('Eliminar el TAG IMDM00000001');
  });
  it('un TAG dado de baja muestra fecha y motivo, y no vuelve a ofrecer la baja', () => {
    const html = pintar([{ id: 't1', tag: 'IMDM00000001', tagOriginal: 'IMDM 00000001', unidadId: 'u1', unidadEconomico: 'TC9001', proveedor: null, activo: false, bajaEn: '2026-03-05', bajaMotivo: 'Unidad siniestrada' }]);
    expect(html).toContain('Baja desde el 2026-03-05');
    expect(html).toContain('Unidad siniestrada');
    expect(html).not.toContain('name="motivo"');
  });
});
