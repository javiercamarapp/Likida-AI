import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
// A37-S05-01/S06-01: la página ahora llama su propia puerta; aquí la sesión es de superadmin.
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: vi.fn(async () => ({ rol: 'superadmin', tenantId: null, nombre: 'Prueba' })) }));

// ═══════════════════════════════════════════════════════════════════════════
// /admin/agente-whatsapp — CERO cobertura. Sin server actions, gate en
// admin/layout.tsx. Real a vigilar: cero gasto/llamadas cuando no hay fase
// 'whatsapp' es un CERO MEDIDO, no un relleno; el recorte de
// TOPE_CONVERSACIONES se declara contra el total real (FE-9); "sin
// conversaciones activas" sólo aparece con la lista de verdad vacía.
// ═══════════════════════════════════════════════════════════════════════════

const dobles = vi.hoisted(() => ({
  getResumenNegocio: vi.fn(),
  getConversacionesActivas: vi.fn(),
  contarConversacionesActivas: vi.fn(),
}));

vi.mock('@/lib/admin/negocio', async (importar) => ({
  ...(await importar<typeof import('@/lib/admin/negocio')>()),
  getCostoPorFaseModelo: vi.fn(async () => []),
  getResumenNegocio: dobles.getResumenNegocio,
  getConversacionesActivas: dobles.getConversacionesActivas,
  contarConversacionesActivas: dobles.contarConversacionesActivas,
}));

import AgenteWhatsappPage from './page';

const RESUMEN_SIN_WA = { porFase: [{ fase: 'ocr', n: 10, costoUsd: 5 }], porDia: [] };

beforeEach(() => {
  vi.clearAllMocks();
  dobles.getResumenNegocio.mockResolvedValue(RESUMEN_SIN_WA);
  dobles.getConversacionesActivas.mockResolvedValue([]);
  dobles.contarConversacionesActivas.mockResolvedValue(0);
});

async function renderizar() { return renderToStaticMarkup(await AgenteWhatsappPage()); }

it('sin fase "whatsapp" en llm_costo: gasto y llamadas son CERO medido, no un fallo silencioso', async () => {
  const html = await renderizar();
  expect(html).toContain('US$0.00');
  expect(html).toContain('Gastado en WhatsApp');
});

it('con fase "whatsapp" real: usa esas cifras exactas, no las de otra fase', async () => {
  dobles.getResumenNegocio.mockResolvedValue({ porFase: [{ fase: 'whatsapp', n: 42, costoUsd: 7.5 }, { fase: 'ocr', n: 999, costoUsd: 999 }], porDia: [] });
  const html = await renderizar();
  expect(html).toContain('US$7.50');
  expect(html).not.toContain('999');
});

it('muestra CUÁNTAS conversaciones hay activas y enlaza a la única lista; si el conteo cae, lo dice (no es cero)', async () => {
  dobles.contarConversacionesActivas.mockResolvedValue(30);
  let html = await renderizar();
  expect(html).toContain('Conversaciones activas');
  expect(html).toContain('/admin/conversaciones');
  dobles.contarConversacionesActivas.mockResolvedValue(null);
  html = await renderizar();
  expect(html).toContain('No disponible ahora. No es cero.');
});

it('declara honestamente qué falta (entrega, ventana 24h, opt-ins) — no lo simula', async () => {
  const html = await renderizar();
  expect(html).toContain('requiere integrar la Meta WhatsApp Business API');
});

it('ya no lista conversaciones ni teléfonos: la lista enmascarada vive solo en /admin/conversaciones (su prueba R9 está allá)', async () => {
  dobles.contarConversacionesActivas.mockResolvedValue(1);
  const html = await renderizar();
  expect(dobles.getConversacionesActivas).not.toHaveBeenCalled();
  expect(html).not.toMatch(/\d{10}/);
});

it('declara el número de prueba de Meta', async () => {
  expect(await renderizar()).toContain('número de prueba de Meta');
});
