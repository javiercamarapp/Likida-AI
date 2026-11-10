import { beforeEach, expect, it, vi } from 'vitest';

// Stub 308 de /admin/playground (Fase 1): la pantalla se retiró y su dirección vieja sigue sirviendo, hacia /admin/agentes. Contrato que se fija:
// (1) la puerta de superadmin se llama ANTES de redirigir, (2) la redirección es permanente (308, no 307) y (3) conserva la consulta.
const dobles = vi.hoisted(() => ({ requireSuperadmin: vi.fn(), permanente: vi.fn((destino: string): never => { throw new Error(`NEXT_REDIRECT:${destino}`); }) }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('next/navigation', () => ({ permanentRedirect: dobles.permanente, redirect: vi.fn() }));

import Pagina from './page';

beforeEach(() => { vi.clearAllMocks(); dobles.requireSuperadmin.mockResolvedValue({ rol: 'superadmin', tenantId: null, nombre: 'Prueba' }); });

it('redirige de forma permanente a /admin/agentes', async () => {
  await expect(Pagina({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT:/admin/agentes');
  expect(dobles.permanente).toHaveBeenCalledTimes(1);
});

it('conserva la consulta de la dirección vieja', async () => {
  await expect(Pagina({ searchParams: Promise.resolve({ tenant: 't-1' }) })).rejects.toThrow('NEXT_REDIRECT:/admin/agentes?tenant=t-1');
});

it('llama la puerta de superadmin antes de redirigir; sin sesión no redirige', async () => {
  dobles.requireSuperadmin.mockRejectedValue(new Error('NEXT_REDIRECT:/login'));
  await expect(Pagina({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT:/login');
  expect(dobles.permanente).not.toHaveBeenCalled();
});
