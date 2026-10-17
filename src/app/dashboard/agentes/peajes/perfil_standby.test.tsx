/* eslint-disable security/detect-non-literal-fs-filename -- lee fuentes del propio repo */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaAgentePeajes } from './vista';
import { VistaConfiguracionPeajes } from './configuracion/vista';
import { SUPERFICIE_PEAJES_COMPLETA, SUPERFICIE_PEAJES_RESTRINGIDA } from '@/lib/likida/peajes/superficie_perfil';
import type { ResumenDesglose } from '@/lib/likida/intake/desglose_peaje';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

// T-A2-31: bajo el perfil `cinco_agentes` la pantalla de peajes NO pinta el stand-by (estímulo 50 %, CFDI/tickets,
// bitácoras del estímulo, evidencia GPS, cursos/geocercas) y SÍ pinta lo pedido. Sin perfil, igual que siempre.

const accion = async () => null;
const desglose: ResumenDesglose = {
  desgloseId: 'd1', proveedor: 'PROV', archivoNombre: 'corte.csv', periodoDesde: '2026-08-01', periodoHasta: '2026-08-10',
  creadoEn: '2026-08-11T00:00:00Z', total: 10, cuadra: 4, noCuadra: 0, sinContraparte: 6, pctCuadra: 40,
};
const vista = (superficie?: typeof SUPERFICIE_PEAJES_COMPLETA) => renderToStaticMarkup(
  <VistaAgentePeajes
    conciliacion={null} lineas={null} desgloses={null} peajeAcreditable={123} sufijo=""
    subirDesglose={accion} ejecutarAhora={accion}
    desglosesProveedor={[desglose]} desgloseSeleccionado={desglose}
    detalleSeleccionado={{ cuadra: [], noCuadra: [], sinContraparte: [] }}
    evidenciaGps={null} verificacion={null} importarDesglose={accion} conciliarDesglose={accion}
    superficie={superficie}
  />,
);

describe('pantalla del agente de peajes por perfil', () => {
  it('sin perfil (o sin prop): todo se pinta', () => {
    for (const html of [vista(), vista(SUPERFICIE_PEAJES_COMPLETA)]) {
      expect(html).toContain('El estímulo de peaje');
      expect(html).toContain('Subir estado de cuenta');
      expect(html).toContain('Esperan a un humano');
      expect(html).toContain('/api/export/bitacora-peaje');
      expect(html).toContain('/api/export/bitacora-conciliada');
    }
  });

  it('cinco_agentes: no hay estímulo, CFDI/tickets ni bitácoras del estímulo', () => {
    const html = vista(SUPERFICIE_PEAJES_RESTRINGIDA);
    expect(html).not.toContain('El estímulo de peaje');
    expect(html).not.toContain('9.1.8');
    expect(html).not.toContain('Subir estado de cuenta');
    expect(html).not.toContain('Esperan a un humano');
    expect(html).not.toContain('Estados de cuenta recibidos');
    expect(html).not.toContain('/api/export/bitacora-peaje');
    expect(html).not.toContain('/api/export/bitacora-conciliada');
    expect(html).not.toContain('Evidencia GPS');
  });

  it('cinco_agentes: lo que pidió la flota sigue (archivo decenal, vínculos, revisión, reclamación)', () => {
    const html = vista(SUPERFICIE_PEAJES_RESTRINGIDA);
    expect(html).toContain('Desglose del proveedor de peaje');
    expect(html).toContain('/api/export/peajes-vinculos?desglose=d1');
    expect(html).toContain('Revisión de cobros (candidatos)');
    expect(html).toContain('/dashboard/agentes/peajes/reclamacion');
  });
});

describe('configuración de peajes por perfil', () => {
  const cfg = (superficie?: typeof SUPERFICIE_PEAJES_COMPLETA) => renderToStaticMarkup(
    <VistaConfiguracionPeajes
      sufijo="" aviso={null} error={null} agenteApagado={null}
      tags={[]} unidades={[]} casetas={[]} geocercas={[]} cursos={[]} convenios={[]} mapeos={[]} archivos={[]}
      tiposGeocerca={['caseta']}
      buzon={{ estado: 'inactivo', rotacion: null, secretoConfigurado: false, puedeAdministrar: false, llave: null, url: 'https://x/api/peajes/ingesta', flotaId: 't' }}
      entradas={{ config: null, puedeAdministrar: false, direccionCorreo: null, cofreConfigurado: false }}
      acciones={new Proxy({}, { get: () => accion }) as never}
      superficie={superficie}
    />,
  );
  it('sin perfil: geocercas y cursos aparecen', () => {
    const html = cfg();
    expect(html).toContain('id="geocercas"');
    expect(html).toContain('id="cursos"');
  });
  it('cinco_agentes: ni geocercas ni cursos; el resto sigue', () => {
    const html = cfg(SUPERFICIE_PEAJES_RESTRINGIDA);
    expect(html).not.toContain('id="geocercas"');
    expect(html).not.toContain('id="cursos"');
    expect(html).toContain('id="casetas"');
  });
});

// Cableado en servidor: cada página resuelve la superficie desde el perfil y cada acción de stand-by la repite adentro.
const fuente = (ruta: string) => readFileSync(join(process.cwd(), 'src/app/dashboard/agentes/peajes', ruta), 'utf8');
const cuerpoAccion = (src: string, nombre: string) => {
  const i = src.indexOf(`async function ${nombre}(`);
  expect(i, `no existe ${nombre}`).toBeGreaterThan(-1);
  return src.slice(i, i + 1500);
};

describe('cableado en servidor', () => {
  it('la página del agente resuelve la superficie, no lee lo de stand-by y corta sus acciones', () => {
    const src = fuente('page.tsx');
    expect(src).toContain('superficiePeajesDeTenant(tenantId)');
    expect(src).toContain('superficie={superficie}');
    expect(cuerpoAccion(src, 'subirDesglose')).toContain('superficiePeajesDeTenant');
    expect(cuerpoAccion(src, 'ejecutarAhora')).toContain('superficiePeajesDeTenant');
    expect(src).toMatch(/superficie\.gps\s*\?[\s\S]{0,200}evidenciaGpsDeDesglose/);
    expect(src).toMatch(/superficie\.bitacoraEstimulo\s*\?[\s\S]{0,200}bitacoraConciliada/);
  });
  it('la reclamación no arma el reporte con GPS para una flota con perfil', () => {
    const src = fuente('reclamacion/page.tsx');
    expect(src).toContain('superficiePeajesDeTenant(tenantId)');
    expect(src).toMatch(/superficie\.gps\s*\?[\s\S]{0,120}reporteReclamacion/);
  });
  it('la configuración corta geocercas y cursos (lectura y acciones)', () => {
    const src = fuente('configuracion/page.tsx');
    expect(src).toContain('superficiePeajesDeTenant(tenantId)');
    for (const a of ['accionGuardarGeocerca', 'accionEstadoGeocerca', 'accionImportarCursos', 'accionImportarCursosDeTabla', 'accionEstadoCurso']) {
      expect(cuerpoAccion(src, a), a).toContain('puertaStandBy');
    }
    expect(src).toMatch(/superficie\.gps\s*\?[\s\S]{0,60}listarGeocercas/);
    expect(src).toMatch(/superficie\.cursos\s*\?[\s\S]{0,60}listarCursos/);
  });
});
