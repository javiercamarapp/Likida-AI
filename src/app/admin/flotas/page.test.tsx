import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const d = vi.hoisted(() => ({ sup: vi.fn(), resumen: vi.fn(), onb: vi.fn(), tel: vi.fn(), planes: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => '/admin/flotas', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: d.sup }));
vi.mock('@/lib/admin/negocio', () => ({ getResumenNegocio: d.resumen }));
vi.mock('@/lib/admin/onboarding', () => ({ getOnboardingFlotas: d.onb }));
vi.mock('@/lib/likida/contactos', () => ({ telefonosJefe: d.tel }));
vi.mock('@/lib/saas/suscripcion', () => ({ getPlanes: d.planes }));
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
});

it('la tabla lleva plan, arranque "n de 6", viajes y los DOS paneles con su rol', async () => {
  const html = await render();
  expect(html).toContain('ACME');
  expect(html).toContain('>pro<');
  expect(html).toMatch(/\d de 6/);
  expect(html).toContain('/admin/flotas/tn-1');
  expect(html).toContain('/dashboard?tenant=tn-1&amp;rol=flota_admin');
  expect(html).toContain('/dashboard?tenant=tn-1&amp;rol=encargado');
});

it('un teléfono ilegible deja el arranque en "Sin dato", nunca "0 de 6"', async () => {
  d.tel.mockRejectedValue(new Error('caída'));
  const html = await render();
  expect(html).toContain('Sin dato');
  expect(html).not.toMatch(/0 de 6/);
});

it('el alta vive en un cajón («Nueva flota»), ofrece el plan y conserva su acción', async () => {
  const html = await render();
  expect(html).toContain('data-forma-cajon="alta-flota"');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).toContain('Nueva flota');
  expect(html).toContain('Dar de alta una flota');
  expect(html).toContain('Pro');
  expect(html).toContain('name="nombre"');
  expect(html).toContain('name="emailAdmin"');
  expect(html).not.toMatch(/<details/);
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
