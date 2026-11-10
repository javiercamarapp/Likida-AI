import { beforeEach, describe, expect, it, vi } from 'vitest';

const d = vi.hoisted(() => ({ sup: vi.fn(), paso: vi.fn(), gestionar: vi.fn(), revalidar: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: d.sup }));
vi.mock('next/cache', () => ({ revalidatePath: d.revalidar }));
vi.mock('@/lib/admin/acciones_riesgo', async (i) => ({ ...(await i<typeof import('@/lib/admin/acciones_riesgo')>()), pasoExtraSuperadmin: d.paso }));
vi.mock('@/lib/saas/asignar-plan', async (i) => ({ ...(await i<typeof import('@/lib/saas/asignar-plan')>()), gestionarSuscripcionDeFlota: d.gestionar }));

import { DatoInvalido } from '@/lib/likida/errores';
import { accionGestionarPlan } from './acciones-plan';

const fd = (c: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };
const OK = { operacion: 'asignar', cambio: true, suscripcionId: 's', planClave: 'flota', estadoAntes: null, estadoDespues: 'prueba', bitacora: true };

beforeEach(() => {
  vi.clearAllMocks();
  d.sup.mockResolvedValue({ userId: 'u-1', tenantId: null, rol: 'superadmin' });
  d.paso.mockResolvedValue(null);
  d.gestionar.mockResolvedValue(OK);
});

describe('accionGestionarPlan', () => {
  it('la puerta del superadmin corre primero: sin ella no se lee ni el formulario', async () => {
    d.sup.mockRejectedValue(new Error('REDIRECT:/dashboard'));
    await expect(accionGestionarPlan(null as never, fd({ tenantId: 't', operacion: 'asignar' }))).rejects.toThrow('REDIRECT');
    expect(d.gestionar).not.toHaveBeenCalled();
  });

  it('operación fuera del catálogo: se rechaza antes de pedir el segundo factor o tocar la base', async () => {
    const r = await accionGestionarPlan(null as never, fd({ tenantId: 't', operacion: 'borrar' }));
    expect(r.error).toMatch(/Elige qué hacer/);
    expect(d.paso).not.toHaveBeenCalled();
    expect(d.gestionar).not.toHaveBeenCalled();
  });

  it('sin segundo factor reciente: no se ejecuta', async () => {
    d.paso.mockResolvedValue('exige tu segundo factor');
    const r = await accionGestionarPlan(null as never, fd({ tenantId: 't', operacion: 'cancelar' }));
    expect(r.error).toMatch(/segundo factor/);
    expect(d.gestionar).not.toHaveBeenCalled();
  });

  it('pasa el actor, la flota y el plan; el mensaje de asignar dice que queda en «prueba»', async () => {
    const r = await accionGestionarPlan(null as never, fd({ tenantId: 'tn-1', operacion: 'asignar', planClave: 'flota' }));
    expect(d.gestionar).toHaveBeenCalledWith({ tenantId: 'tn-1', operacion: 'asignar', planClave: 'flota', actor: expect.objectContaining({ userId: 'u-1' }) });
    expect(r.ok).toMatch(/«prueba»/);
    expect(d.revalidar).toHaveBeenCalledWith('/admin/flotas/tn-1');
  });

  it('idempotente: «sin cambios» y no repinta mentiras', async () => {
    d.gestionar.mockResolvedValue({ ...OK, cambio: false });
    expect((await accionGestionarPlan(null as never, fd({ tenantId: 'tn-1', operacion: 'asignar', planClave: 'flota' }))).ok).toMatch(/Sin cambios/);
  });

  it('un rechazo de negocio (plan sin price) sale con su texto; un fallo técnico, con el genérico honesto', async () => {
    d.gestionar.mockRejectedValueOnce(new DatoInvalido('El plan "Flota" no tiene un price de Stripe ligado'));
    expect((await accionGestionarPlan(null as never, fd({ tenantId: 'tn-1', operacion: 'asignar', planClave: 'flota' }))).error).toMatch(/price de Stripe ligado/);
    d.gestionar.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.1'));
    const r = await accionGestionarPlan(null as never, fd({ tenantId: 'tn-1', operacion: 'pausar' }));
    expect(r.error).toBeTruthy();
    expect(r.error).not.toMatch(/ECONNREFUSED/);
  });

  it('si la bitácora no escribió, el acto se dice hecho y se avisa', async () => {
    d.gestionar.mockResolvedValue({ ...OK, operacion: 'activar', estadoAntes: 'prueba', estadoDespues: 'activa', bitacora: false });
    const r = await accionGestionarPlan(null as never, fd({ tenantId: 'tn-1', operacion: 'activar' }));
    expect(r.ok).toMatch(/Suscripción activa/);
    expect(r.ok).toMatch(/NO se pudo escribir en la bitácora/);
  });
});
