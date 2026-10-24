import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeccionCcp } from './seccion_ccp';

const accion = async () => null;
const fila = (extra = {}) => ({ id: 'c1', uuid: 'UUID-SINTETICO-1', estado: 'pendiente_confirmacion' as const, destinoCorreo: 'cliente@ejemplo.test', respondidoEn: null, creadoEn: '2026-10-01T12:00:00Z', documentoId: 'd1', documentoNombre: 'orden.pdf', ...extra });
const html = (activa: boolean | 'sin_migracion', filas: ReturnType<typeof fila>[] | 'sin_migracion') =>
  renderToStaticMarkup(<SeccionCcp activa={activa} filas={filas} ver={{}} acciones={{ fijar: accion, confirmar: accion }} />);

describe('A37-A3-01: pantalla de CCP timbrados recibidos', () => {
  it('muestra el interruptor APAGADO por omisión y la fila pendiente con su botón de confirmar', () => {
    const h = html(false, [fila()]);
    expect(h).toContain('APAGADO');
    expect(h).toContain('Encender la respuesta');
    expect(h).toContain('UUID-SINTETICO-1');
    expect(h).toContain('Confirmar y responder al cliente');
  });
  it('un CCP ya respondido no ofrece confirmar', () => {
    const h = html(true, [fila({ estado: 'respondido' as never, respondidoEn: '2026-10-01T13:00:00Z' })]);
    expect(h).toContain('ENCENDIDO');
    expect(h).not.toContain('Confirmar y responder al cliente');
  });
  it('A37-P-04: cada CCP ofrece descargar su PDF y su XML por la ruta autenticada (con ?tenant= al ver como otra flota)', () => {
    const h = html(true, [fila({ id: '55555555-5555-4555-8555-555555555555' })]);
    expect(h).toContain('/api/export/carta-porte-docs?ccp=55555555-5555-4555-8555-555555555555&amp;archivo=pdf');
    expect(h).toContain('archivo=xml');
    expect(h).toContain('Descargar PDF');
    const ver = renderToStaticMarkup(<SeccionCcp activa filas={[fila()]} ver={{ tenant: 't-1' }} acciones={{ fijar: accion, confirmar: accion }} />);
    expect(ver).toContain('tenant=t-1');
  });
  it('sin CCP recibidos y sin migración lo dice', () => {
    expect(html(false, [])).toContain('Todavía no ha llegado ningún CCP timbrado');
    expect(html('sin_migracion', 'sin_migracion')).toContain('todavía no está disponible');
  });
});
