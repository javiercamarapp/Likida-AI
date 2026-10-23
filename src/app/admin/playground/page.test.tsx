import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
// A37-S05-01/S06-01: la página ahora llama su propia puerta; aquí la sesión es de superadmin.
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: vi.fn(async () => ({ rol: 'superadmin', tenantId: null, nombre: 'Prueba' })) }));

// ═══════════════════════════════════════════════════════════════════════════
// /admin/playground — página 100% estática. Su contrato: NO debe simular un
// chat/caja de prueba que aparente funcionar sin hacerlo (comentario propio
// del archivo) — debe seguir diciendo honestamente que el sandbox no existe
// y enlazar a las páginas de agente reales.
// ═══════════════════════════════════════════════════════════════════════════

import PlaygroundPage from './page';

it('dice honestamente que el sandbox no existe, y no simula un chat/caja de prueba', async () => {
  const html = renderToStaticMarkup(await PlaygroundPage());
  expect(html).toContain('Esta función no existe en Likida hoy');
  expect(html).not.toMatch(/<textarea|<input[^>]*type="text"/);
});

it('enlaza a las tres páginas de agente reales que SÍ existen', async () => {
  const html = renderToStaticMarkup(await PlaygroundPage());
  expect(html).toContain('href="/admin/agente-ocr"');
  expect(html).toContain('href="/admin/agente-cuadre"');
  expect(html).toContain('href="/admin/agente-whatsapp"');
});
