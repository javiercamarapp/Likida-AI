import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaAgentePeajes } from './vista';
import type { ResumenDesglose } from '@/lib/likida/intake/desglose_peaje';

// Los botones de subir/conciliar llaman `useRouter()`; el render estático no monta el App Router.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

// El estado conciliado en pantalla: las tres cubetas con su dinero, la liga a la
// bitácora conciliada y a la configuración, y la honestidad del texto — «sin
// respaldo» no es una acusación y lo que el dato no alcanza se dice.

const accionOk = async () => null;
const desglose: ResumenDesglose = {
  desgloseId: 'd1', proveedor: 'PASE', archivoNombre: 'corte.csv', periodoDesde: '2026-08-01', periodoHasta: '2026-08-10',
  creadoEn: '2026-08-11T00:00:00Z', total: 10, cuadra: 6, noCuadra: 1, sinContraparte: 3, pctCuadra: 60,
};

function pintar(verificacion: Parameters<typeof VistaAgentePeajes>[0]['verificacion'], sufijo = '') {
  return renderToStaticMarkup(
    <VistaAgentePeajes
      conciliacion={null} lineas={null} desgloses={null} peajeAcreditable={null} sufijo={sufijo}
      subirDesglose={accionOk} ejecutarAhora={accionOk}
      desglosesProveedor={[desglose]} desgloseSeleccionado={desglose}
      detalleSeleccionado={{ cuadra: [], noCuadra: [], sinContraparte: [] }}
      evidenciaGps={null} verificacion={verificacion}
      importarDesglose={accionOk} conciliarDesglose={accionOk}
    />,
  );
}

describe('el estado conciliado en la ventana del agente', () => {
  const v = {
    resumen: { total: 10, cuadra: 6, sinRespaldo: 1, porVerificar: 3, montoCuadra: 1134, montoSinRespaldo: 300, montoPorVerificar: 700.5 },
    sinEvaluarGps: 0,
  };

  it('muestra las tres cubetas con su conteo y su dinero', () => {
    const html = pintar(v);
    expect(html).toContain('Cuadran');
    expect(html).toContain('Por verificar');
    expect(html).toContain('Sin respaldo');
    expect(html).toContain('$1,134.00');
    expect(html).toContain('$300.00');
    expect(html).toContain('$700.50');
  });

  it('«sin respaldo» dice que NO es acusación', () => {
    expect(pintar(v)).toContain('no es acusación');
  });

  it('enlaza la bitácora conciliada del desglose abierto y la configuración, arrastrando el tenant del superadmin', () => {
    const html = pintar(v, '?tenant=t-9');
    expect(html).toContain('/api/export/bitacora-conciliada?desglose=d1&amp;tenant=t-9');
    expect(html).toContain('/dashboard/agentes/peajes/configuracion?tenant=t-9');
  });

  it('la bitácora conciliada se puede bajar aunque NINGUNA línea cuadre (es justo cuando más se necesita)', () => {
    const html = renderToStaticMarkup(
      <VistaAgentePeajes
        conciliacion={null} lineas={null} desgloses={null} peajeAcreditable={null} sufijo=""
        subirDesglose={accionOk} ejecutarAhora={accionOk}
        desglosesProveedor={[{ ...desglose, cuadra: 0, sinContraparte: 10, noCuadra: 0, pctCuadra: 0 }]}
        desgloseSeleccionado={{ ...desglose, cuadra: 0, sinContraparte: 10, noCuadra: 0, pctCuadra: 0 }}
        detalleSeleccionado={{ cuadra: [], noCuadra: [], sinContraparte: [] }}
        evidenciaGps={null} verificacion={null} importarDesglose={accionOk} conciliarDesglose={accionOk}
      />,
    );
    expect(html).toContain('/api/export/bitacora-conciliada?desglose=d1');
    expect(html).toContain('La bitácora RMF 9.1.8 se habilita cuando al menos una línea cuadre');
  });

  it('avisa cuántas líneas no tienen evaluación GPS (cruce anterior) y qué hacer', () => {
    const html = pintar({ ...v, sinEvaluarGps: 4 });
    expect(html).toMatch(/4 líneas no tienen evaluación GPS/);
    expect(html).toContain('Conciliar');
  });

  it('si no se pudo calcular, lo dice — no pinta ceros', () => {
    const html = pintar(null);
    expect(html).toContain('No se pudo calcular el estado conciliado');
    expect(html).not.toContain('Sin respaldo</div>');
  });

  it('ya no promete el GPS «v2»: el texto describe lo que sí hace y lo que no acusa', () => {
    const html = pintar(v);
    expect(html).not.toContain('es v2');
    expect(html).toContain('lo que el dato');
    expect(html).toContain('no alcanza a afirmar no se acusa');
  });
});
