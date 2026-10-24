import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
// A37-S05-01/S06-01: la página ahora llama su propia puerta; aquí la sesión es de superadmin.
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: vi.fn(async () => ({ rol: 'superadmin', tenantId: null, nombre: 'Prueba' })) }));

// ═══════════════════════════════════════════════════════════════════════════
// /admin/comunicacion — CERO cobertura. Página síncrona, sin datos ni server
// actions, gateada sólo por admin/layout.tsx. Su único contrato real es el
// rótulo honesto: NO existe broadcast interno hoy, y no debe confundirse con
// el estudio de marketing (crecimiento hacia afuera), que es un dominio
// distinto.
// ═══════════════════════════════════════════════════════════════════════════

import ComunicacionPage from './page';

it('declara honestamente que no hay sistema de comunicación masiva interna', async () => {
  const html = renderToStaticMarkup(await ComunicacionPage());
  expect(html).toContain('Likida no tiene un sistema de comunicación masiva INTERNA hoy');
  expect(html).toContain('bot de WhatsApp conversando 1 a 1');
});

it('distingue este dominio del estudio de marketing (crecimiento hacia afuera), con su liga', async () => {
  const html = renderToStaticMarkup(await ComunicacionPage());
  expect(html).toContain('href="/admin/marketing"');
  expect(html).toContain('un dominio distinto');
});
