import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const d = vi.hoisted(() => ({ sup: vi.fn(), resumen: vi.fn(), onb: vi.fn(), tel: vi.fn(), planes: vi.fn(), techos: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => '/admin/flotas', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: d.sup }));
vi.mock('@/lib/admin/negocio', () => ({ getResumenNegocio: d.resumen }));
vi.mock('@/lib/admin/onboarding', () => ({ getOnboardingFlotas: d.onb }));
vi.mock('@/lib/likida/contactos', () => ({ telefonosJefe: d.tel }));
vi.mock('@/lib/saas/suscripcion', () => ({ getPlanes: d.planes }));
vi.mock('@/lib/admin/techo_ia', () => ({ getTechosIa: d.techos }));
vi.mock('./acciones', () => ({ accionCrearFlota: vi.fn(), accionFacilidad: vi.fn() }));

import FlotasPage from './page';

const FLOTA = { id: 'tn-1', nombre: 'ACME', plan: 'pro', viajes: 5, costoIaUsd: 10, politicaPropia: true, facilidad15: undefined };
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await FlotasPage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  vi.clearAllMocks();
  d.sup.mockResolvedValue({ userId: 'u-1' });
  d.resumen.mockResolvedValue({ flotas: [FLOTA], tenants: 1, viajesProcesados: 5 });
  d.tel.mockResolvedValue({ 'tn-1': '5512345678' });
  d.onb.mockResolvedValue(new Map());
  d.planes.mockResolvedValue([{ clave: 'pro', nombre: 'Pro' }]);
  d.techos.mockResolvedValue({ filas: [{ tenantId: 'tn-1', nombre: 'ACME', topeUsd: 5, origen: 'plan', declaradoUsd: null, usadoHoyUsd: 1.5, pctUsado: 30 }], pisoUsd: 1, truncado: false, gastoIlegible: false });
});

it('la tabla lleva plan, arranque "n de 6", viajes y la Vista rápida; los dos paneles viven en el cajón', async () => {
  const html = await render();
  expect(html).toContain('ACME');
  expect(html).toContain('>pro<');
  expect(html).toMatch(/\d de 6/);
  expect(html).toContain('/admin/flotas/tn-1');
  expect(html).toContain('Vista rápida');
  expect(html).toContain('ver=tn-1');
  // Una sola fila de acciones con dos botones: ya no hay tres por fila ni paneles en la tabla.
  expect(html).not.toContain('/dashboard?tenant=tn-1&amp;rol=flota_admin');
  const vr = await render({ ver: 'tn-1' });
  expect(vr).toContain('/dashboard?tenant=tn-1&amp;rol=flota_admin');
  expect(vr).toContain('/dashboard?tenant=tn-1&amp;rol=encargado');
});

it('lleva buscador y filtro de arranque, y filtra por nombre', async () => {
  const html = await render();
  expect(html).toContain('name="q"');
  expect(html).toContain('name="arranque"');
  expect(html).toContain('1 de 1');
  const sin = await render({ q: 'zzz' });
  expect(sin).toContain('Ninguna flota coincide con el filtro');
  expect(sin).toContain('0 de 1');
});

it('un teléfono ilegible deja el arranque en "Sin dato", nunca "0 de 6"', async () => {
  d.tel.mockRejectedValue(new Error('caída'));
  const html = await render();
  expect(html).toContain('Sin dato');
  expect(html).not.toMatch(/0 de 6/);
});

it('el alta es un bloque bajo la tabla («Dar de alta una flota»), ofrece el plan y conserva su acción', async () => {
  const html = await render();
  expect(html).toContain('id="alta-flota"');
  expect(html).toContain('Dar de alta una flota');
  expect(html).toContain('Pro');
  expect(html).toContain('name="nombre"');
  expect(html).toContain('name="emailAdmin"');
  expect(html).not.toContain('data-forma-cajon="alta-flota"');
  expect(html.indexOf('id="alta-flota"')).toBeGreaterThan(html.indexOf('ACME'));
});

it('planes ilegibles: el alta lo dice, no ofrece un selector vacío', async () => {
  d.planes.mockRejectedValue(new Error('x'));
  expect(await render()).toContain('No se pudieron leer los planes');
});

it('la lista caída es error con reintento, no "sin flotas"', async () => {
  d.resumen.mockRejectedValue(new Error('x'));
  const html = await render();
  expect(html).toContain('No se pudo leer la lista de flotas');
  expect(html).not.toContain('Sin flotas dadas de alta');
});

it('sin flotas dice qué falta', async () => {
  d.resumen.mockResolvedValue({ flotas: [], tenants: 0, viajesProcesados: 0 });
  d.tel.mockResolvedValue({});
  expect(await render()).toContain('Sin flotas dadas de alta');
});
