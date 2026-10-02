import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('./acciones-control', () => ({
  accionEncenderEmision: vi.fn(), accionApagarEmision: vi.fn(), accionCambiarLimites: vi.fn(),
  accionDecidirLote: vi.fn(), accionPromoverPortal: vi.fn(), accionDevolverPortal: vi.fn(),
}));
vi.mock('../../../admin/ui/notificaciones', () => ({ useNotificar: () => ({ notificar: vi.fn() }) }));

const { SeccionControlEmision } = await import('./control-emision');

const BASE = { maxMontoTicket: 1500, maxTicketsLote: 5, maxTicketsDia: 20, maxMontoDia: 20000 };
const lote = { id: 'l1', comercio: 'enerser', nombre: 'Enerser', tickets: 3, montoTotal: 1200, estado: 'propuesto', propuestoEn: '2026-10-02T10:00:00Z', expiraEn: '2026-10-04T10:00:00Z' };
const portal = (o = {}) => ({ clave: 'enerser', nombre: 'Enerser', verificacion: 'verificado' as const, fase: 'supervisada' as const, emisionesConfirmadas: 1, ...o });
const render = (o: Partial<Parameters<typeof SeccionControlEmision>[0]['datos']> = {}) =>
  renderToStaticMarkup(<SeccionControlEmision datos={{ control: { emisionReal: false, ...BASE }, lotes: [], portales: [], minimoParaAutonoma: 3, ...o }} />);

describe('SeccionControlEmision (0542)', () => {
  it('apagada: dice ensayo y ofrece ENCENDER (nunca «apagar»)', () => {
    const h = render();
    expect(h).toContain('Ensayo (llena el portal y no emite)');
    expect(h).toContain('Encender la emisión real');
    expect(h).not.toContain('Apagar la emisión real');
  });
  it('encendida: dice ENCENDIDA y ofrece apagar', () => {
    const h = render({ control: { emisionReal: true, ...BASE } });
    expect(h).toContain('Emisión real ENCENDIDA');
    expect(h).toContain('Apagar la emisión real');
  });
  it('sin fila: apagada con los límites por omisión editables', () => {
    const h = render({ control: 'sin_fila' });
    expect(h).toContain('Ensayo');
    expect(h).toContain('name="maxMontoTicket"');
  });
  it('lectura caída: lo dice y NO pinta controles que afirmen un estado', () => {
    const h = render({ control: null });
    expect(h).toContain('ciega');
    expect(h).not.toContain('Encender la emisión real');
    expect(h).not.toContain('Apagar la emisión real');
  });
  it('un lote propuesto se puede confirmar o rechazar; uno confirmado solo rechazar', () => {
    const p = render({ lotes: [lote] });
    expect(p).toContain('Confirmar lote'); expect(p).toContain('Rechazar'); expect(p).toContain('Enerser');
    const c = render({ lotes: [{ ...lote, estado: 'confirmado' }] });
    expect(c).not.toContain('Confirmar lote'); expect(c).toContain('Confirmado: sale en la próxima corrida');
  });
  it('lotes ilegibles se dice, no «ninguno»', () => {
    expect(render({ lotes: null })).toContain('No se pudieron leer los lotes');
  });
  it('portal supervisado con pocas emisiones: dice cuántas faltan para pasar a autónomo', () => {
    const h = render({ portales: [portal({ emisionesConfirmadas: 1 })] });
    expect(h).toContain('Pasar a autónomo'); expect(h).toContain('Faltan 2');
  });
  it('portal autónomo: ofrece volver a supervisado; un mapeo obsoleto se avisa', () => {
    const h = render({ portales: [portal({ fase: 'autonoma', emisionesConfirmadas: 4, verificacion: 'obsoleto' })] });
    expect(h).toContain('Volver a supervisado'); expect(h).toContain('hay que volver a verificarlo');
  });
});
