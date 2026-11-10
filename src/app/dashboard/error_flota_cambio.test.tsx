import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { default: DashboardError } = await import('./error');
const { FlotaCambioError } = await import('@/lib/auth/tenant-atado');
const { MENSAJE_FLOTA_CAMBIO, DIGEST_FLOTA_CAMBIO, esErrorFlotaCambio } = await import('@/lib/auth/flota_cambio');

describe('FlotaCambioError llega al usuario como mensaje claro (MX-002)', () => {
  it('la clase fija el digest que Next conserva en producción (el mensaje y el nombre se pierden)', () => {
    const e = new FlotaCambioError();
    expect(e.digest).toBe(DIGEST_FLOTA_CAMBIO);
    expect(esErrorFlotaCambio(e)).toBe(true);
    // Como llega al cliente en producción: sin nombre ni mensaje, solo el digest.
    expect(esErrorFlotaCambio({ digest: DIGEST_FLOTA_CAMBIO })).toBe(true);
    expect(esErrorFlotaCambio({ digest: '1234567890' })).toBe(false);
    expect(esErrorFlotaCambio(null)).toBe(false);
  });

  it('el boundary de /dashboard dice «cambiaste de flota, recarga», no el genérico', () => {
    const html = renderToStaticMarkup(<DashboardError error={Object.assign(new Error('An error occurred'), { digest: DIGEST_FLOTA_CAMBIO })} reset={() => {}} />);
    expect(html).toContain('Cambiaste de flota');
    expect(html).toContain(MENSAJE_FLOTA_CAMBIO.replace(/'/g, '&#x27;'));
    expect(html).toContain('Recargar');
    expect(html).not.toContain('No se pudo cargar el panel');
    expect(html).not.toContain('Reintentar');
  });

  it('cualquier otro error sigue mostrando el genérico con su código de incidente', () => {
    const html = renderToStaticMarkup(<DashboardError error={Object.assign(new Error('x'), { digest: '4471093821' })} reset={() => {}} />);
    expect(html).toContain('No se pudo cargar el panel');
    expect(html).toContain('4471093821');
    expect(html).not.toContain('Cambiaste de flota');
  });
});
