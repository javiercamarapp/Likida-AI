import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaAgentePeajes } from './vista';
import type { ResumenDesglose } from '@/lib/likida/intake/desglose_peaje';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

// T-A2-22: la pantalla del agente enlaza el archivo «casetas ligadas a viaje» del desglose abierto
// (cableado: sin este enlace la ruta de export no la alcanzaría nadie).

const accionOk = async () => null;
const desglose: ResumenDesglose = {
  desgloseId: 'd1', proveedor: 'PASE', archivoNombre: 'corte.csv', periodoDesde: '2026-08-01', periodoHasta: '2026-08-10',
  creadoEn: '2026-08-11T00:00:00Z', total: 10, cuadra: 0, noCuadra: 0, sinContraparte: 10, pctCuadra: 0,
};
const pintar = (sufijo = '') => renderToStaticMarkup(
  <VistaAgentePeajes
    conciliacion={null} lineas={null} desgloses={null} peajeAcreditable={null} sufijo={sufijo}
    subirDesglose={accionOk} ejecutarAhora={accionOk}
    desglosesProveedor={[desglose]} desgloseSeleccionado={desglose}
    detalleSeleccionado={{ cuadra: [], noCuadra: [], sinContraparte: [] }}
    evidenciaGps={null} verificacion={null} importarDesglose={accionOk} conciliarDesglose={accionOk}
  />,
);

describe('enlace «casetas ligadas a viaje»', () => {
  it('aparece para el desglose abierto', () => {
    const html = pintar();
    expect(html).toContain('/api/export/peajes-vinculos?desglose=d1');
    expect(html).toContain('Casetas ligadas a viaje');
  });
  it('arrastra el tenant del superadmin', () => {
    expect(pintar('?tenant=t-9')).toContain('/api/export/peajes-vinculos?desglose=d1&amp;tenant=t-9');
  });
});
