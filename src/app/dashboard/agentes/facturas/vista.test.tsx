import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('./acciones-control', () => ({
  accionEncenderEmision: vi.fn(), accionApagarEmision: vi.fn(), accionCambiarLimites: vi.fn(),
  accionDecidirLote: vi.fn(), accionPromoverPortal: vi.fn(), accionDevolverPortal: vi.fn(),
}));
vi.mock('./acciones-vinculacion', () => ({}));
vi.mock('../../../admin/ui/notificaciones', () => ({ useNotificar: () => ({ notificar: vi.fn() }) }));

const { VistaAgenteFacturas } = await import('./vista');

const noop = vi.fn();
const pintar = (o: { emite?: boolean; conCfdi?: number | null } = {}) => renderToStaticMarkup(
  <VistaAgenteFacturas
    tickets={[]}
    extra={{ conCfdi: o.conCfdi === undefined ? 0 : o.conCfdi, emite: o.emite ?? false }}
    marcarFacturada={noop as never}
    portalesConAdaptador={[]}
    portales={[]}
    vinculosLeidos
    autorizarRelogin={noop as never}
    revocarRelogin={noop as never}
    control={{ control: { emisionReal: false, maxMontoTicket: 1500, maxTicketsLote: 5, maxTicketsDia: 20, maxMontoDia: 20000 }, lotes: [], portales: [], minimoParaAutonoma: 3, esDueno: true, flotaPintada: 'fp1.t-1.9999999999999.firma' }}
  />,
);

describe('VistaAgenteFacturas (v2)', () => {
  it('en ensayo lo dice ARRIBA, en un aviso; con emisión real no hay aviso de ensayo', () => {
    expect(pintar({ emite: false })).toContain('está en ensayo');
    expect(pintar({ emite: true })).not.toContain('está en ensayo');
  });

  it('sin tickets: ningún monto inventado y los vacíos dicen qué falta', () => {
    const h = pintar();
    expect(h).toContain('Hoy no te toca capturar nada');
    expect(h).toContain('Ningún gasto sin factura');
  });

  it('el acumulado ilegible se dice, no se pinta como cero', () => {
    const h = pintar({ conCfdi: null });
    expect(h).toContain('No se pudo leer el acumulado');
  });
});
