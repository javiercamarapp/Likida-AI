import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ═══════════════════════════════════════════════════════════════════════════
// TABLEROS AL DÍA (28-ago-2026) — la pantalla que decía «no existe pipeline»
// mientras `evento_seguridad` (0133) llevaba semanas escribiéndose desde
// siete detectores. Estas pruebas defienden los tres contratos de la casa en
// la pantalla nueva: la lectura caída SE DICE (≠ cero eventos), el vacío de
// verdad se explica («el silencio aquí es bueno»), y la lista declara
// «mostrando N de M» con la M exacta contada en la base.
// ═══════════════════════════════════════════════════════════════════════════

// `EstadoError` usa router.refresh() — mismo router de mentiras que
// bloque.test.tsx: aquí se mira QUÉ se pinta, no a dónde navega.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

const getEventosSeguridad = vi.fn();
const resumenEventosSeguridad = vi.fn();
vi.mock('@/lib/seguridad/eventos', () => ({
  getEventosSeguridad: (...a: unknown[]) => getEventosSeguridad(...a),
  resumenEventosSeguridad: (...a: unknown[]) => resumenEventosSeguridad(...a),
}));

import TrustSafetyPage from './page';

function evento(sobre: Record<string, unknown> = {}) {
  return {
    id: 'ev-1', origen: 'wa_webhook', tipo: 'firma_invalida', severidad: 'alta',
    tenantId: null, actor: '5215550000001', detalle: null,
    creadoEn: '2026-08-28T12:00:00.000Z',
    ...sobre,
  };
}

describe('/admin/trust-safety — la pantalla dice lo medido', () => {
  it('base caída: lo DICE en las dos zonas, sin pintar ceros ni tabla vacía', async () => {
    getEventosSeguridad.mockRejectedValue(new Error('base caída'));
    resumenEventosSeguridad.mockRejectedValue(new Error('base caída'));
    const html = renderToStaticMarkup(await TrustSafetyPage());
    expect(html).toContain('NO significa que haya cero eventos');
    expect(html).toContain('no es lo mismo que «no hay eventos»');
  });

  it('vacío de verdad: se explica por qué el silencio es bueno', async () => {
    getEventosSeguridad.mockResolvedValue([]);
    resumenEventosSeguridad.mockResolvedValue({ total: 0, d30: { alta: 0, media: 0, info: 0 } });
    const html = renderToStaticMarkup(await TrustSafetyPage());
    expect(html).toContain('el silencio aquí es bueno de verdad');
    expect(html).toContain('detectores están cableados');
  });

  it('con eventos: la lista declara «mostrando N de M» con la M contada en la base', async () => {
    getEventosSeguridad.mockResolvedValue([evento(), evento({ id: 'ev-2', severidad: 'media', tipo: 'rate_limit' })]);
    resumenEventosSeguridad.mockResolvedValue({ total: 137, d30: { alta: 3, media: 20, info: 40 } });
    const html = renderToStaticMarkup(await TrustSafetyPage());
    expect(html).toContain('de 137 eventos históricos');
    expect(html).toContain('firma invalida');
    // Los conteos por severidad de 30 días llegan a sus tarjetas.
    expect(html).toContain('Severidad alta · 30 días');
  });

  it('resumen caído pero lista viva: la M ausente se declara, jamás se inventa', async () => {
    getEventosSeguridad.mockResolvedValue([evento()]);
    resumenEventosSeguridad.mockRejectedValue(new Error('timeout'));
    const html = renderToStaticMarkup(await TrustSafetyPage());
    expect(html).toContain('el total histórico no se pudo contar ahora mismo');
  });

  it('lo que NO hay sigue dicho: mitigación no es detección', async () => {
    getEventosSeguridad.mockResolvedValue([]);
    resumenEventosSeguridad.mockResolvedValue({ total: 0, d30: { alta: 0, media: 0, info: 0 } });
    const html = renderToStaticMarkup(await TrustSafetyPage());
    expect(html).toContain('eso es mitigación, no detección');
    expect(html).toContain('jailbreak');
  });
});
