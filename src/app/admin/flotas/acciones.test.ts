import { beforeEach, expect, it, vi } from 'vitest';

const d = vi.hoisted(() => ({
  sup: vi.fn(), crear: vi.fn(), facil: vi.fn(), rev: vi.fn(), paso: vi.fn(), alta: vi.fn(), plan: vi.fn(),
}));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: d.sup }));
vi.mock('next/cache', () => ({ revalidatePath: d.rev }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.test' }));
vi.mock('@/lib/admin/acciones_riesgo', () => ({ pasoExtraSuperadmin: d.paso }));
vi.mock('@/lib/likida/administracion', async (i) => ({ ...(await i<typeof import('@/lib/likida/administracion')>()), crearFlota: d.crear }));
vi.mock('@/lib/likida/repo', () => ({ actualizarFacilidad15: d.facil }));
vi.mock('@/lib/saas/asignar-plan', () => ({ gestionarSuscripcionDeFlota: d.plan }));
vi.mock('@/lib/auth/gestion_admin', async (i) => ({ ...(await i<typeof import('@/lib/auth/gestion_admin')>()), altaDeUsuarioDesdeAdmin: d.alta }));

import { accionCrearFlota, accionFacilidad } from './acciones';

type A = (p: unknown, f: FormData) => Promise<{ ok?: string; error?: string }>;
const crear = accionCrearFlota as unknown as A;
const facilidad = accionFacilidad as unknown as A;
const fd = (c: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };
const FISCAL = { rfc: 'ACM010101AB1', razonSocial: 'ACME SA', regimenFiscal: '601', codigoPostalFiscal: '97000', usoCfdi: 'G03' };

beforeEach(() => {
  vi.clearAllMocks();
  d.sup.mockResolvedValue({ userId: 'u-1', email: null });
  d.paso.mockResolvedValue(null);
  d.crear.mockResolvedValue({ tenantId: 't-1' });
  d.alta.mockResolvedValue({ userId: 'n', tenantId: 't-1', correo: { enviado: true }, bitacora: true });
  d.plan.mockResolvedValue({ planClave: 'pro' });
});

it('re-gatea antes de crear', async () => {
  d.sup.mockRejectedValueOnce(new Error('REDIRECT:/dashboard'));
  await expect(crear(null, fd({ nombre: 'Nueva' }))).rejects.toThrow('REDIRECT');
  expect(d.crear).not.toHaveBeenCalled();
});

it('crea con el actor de la SESIÓN y da de alta al dueño por la ruta con correo y bitácora', async () => {
  const r = await crear(null, fd({ nombre: 'Nueva Flota', emailAdmin: 'x@x.com', nombreAdmin: 'Juan', ...FISCAL }));
  expect(d.crear).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Nueva Flota' }), { id: 'u-1' });
  expect(d.crear.mock.calls[0][0].emailAdmin).toBeUndefined();
  expect(d.alta).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-1', rol: 'flota_admin', email: 'x@x.com' }));
  expect(r.ok).toContain('le mandamos el correo de acceso');
  expect(r.ok).not.toContain('no factura ni un ticket');
});

it('sin los 5 datos fiscales avisa que no puede facturar', async () => {
  const r = await crear(null, fd({ nombre: 'Nueva Flota', emailAdmin: 'x@x.com' }));
  expect(r.ok).toContain('no factura ni un ticket');
});

it('sin administrador dice que nadie puede entrar', async () => {
  const r = await crear(null, fd({ nombre: 'Nueva Flota' }));
  expect(d.alta).not.toHaveBeenCalled();
  expect(r.ok).toContain('Todavía no tiene a nadie que pueda entrar');
});

it('si el dueño falla, la flota YA existe: error rojo que dice que no se repita el formulario', async () => {
  d.alta.mockRejectedValue(new Error('boom'));
  const r = await crear(null, fd({ nombre: 'Nueva Flota', emailAdmin: 'x@x.com' }));
  expect(r.error).toContain('dada de alta');
  expect(r.error).toContain('no repitas el formulario');
});

it('el correo que no salió es aviso rojo, no verde', async () => {
  d.alta.mockResolvedValue({ userId: 'n', tenantId: 't-1', correo: { enviado: false, motivo: 'sin_configurar' }, bitacora: true });
  const r = await crear(null, fd({ nombre: 'Nueva Flota', emailAdmin: 'x@x.com' }));
  expect(r.error).toContain('NO salió');
});

it('con plan elegido lo asigna; si falla lo dice y no pierde la flota', async () => {
  let r = await crear(null, fd({ nombre: 'Nueva Flota', planClave: 'pro' }));
  expect(d.plan).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-1', operacion: 'asignar', planClave: 'pro' }));
  expect(r.ok).toContain('Plan pro asignado');
  d.plan.mockRejectedValue(new Error('x'));
  r = await crear(null, fd({ nombre: 'Otra Flota', planClave: 'pro' }));
  expect(r.error).toContain('No se pudo asignar el plan');
});

it('el segundo factor faltante frena TODO antes de crear la flota', async () => {
  d.paso.mockResolvedValue('Falta el segundo factor.');
  expect(await crear(null, fd({ nombre: 'Nueva', planClave: 'pro' }))).toEqual({ error: 'Falta el segundo factor.' });
  expect(d.crear).not.toHaveBeenCalled();
});

it('un rechazo de captura al crear sale verbatim y no sigue', async () => {
  d.crear.mockRejectedValue(new Error('x'));
  const r = await crear(null, fd({ nombre: 'Nueva', emailAdmin: 'x@x.com' }));
  expect(r.error).toBeTruthy();
  expect(d.alta).not.toHaveBeenCalled();
});

it('facilidad: sin flota error; traduce si/no/vacío y manda el actor', async () => {
  expect(await facilidad(null, fd({ flotaId: '' }))).toEqual({ error: 'Falta la flota.' });
  d.facil.mockResolvedValue(undefined);
  expect(await facilidad(null, fd({ flotaId: 't', ded: 'si', reg: 'no' }))).toEqual({ ok: 'Declaración del 15% actualizada.' });
  expect(d.facil).toHaveBeenCalledWith('t', true, false, 'u-1');
  expect(await facilidad(null, fd({ flotaId: 't', ded: '', reg: '' }))).toEqual({ ok: 'Declaración del 15% borrada (sin declarar).' });
  expect(d.facil).toHaveBeenLastCalledWith('t', undefined, undefined, 'u-1');
});
