import { beforeEach, describe, expect, it, vi } from 'vitest';

const d = vi.hoisted(() => ({
  sup: vi.fn(), paso: vi.fn(), rol: vi.fn(), baja: vi.fn(), react: vi.fn(), reenv: vi.fn(), ses: vi.fn(), rev: vi.fn(),
}));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: d.sup }));
vi.mock('next/cache', () => ({ revalidatePath: d.rev }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.test' }));
vi.mock('@/lib/admin/acciones_riesgo', async (i) => ({ ...(await i<typeof import('@/lib/admin/acciones_riesgo')>()), pasoExtraSuperadmin: d.paso }));
vi.mock('@/lib/auth/gestion_admin', () => ({
  cambiarRolDesdeAdmin: d.rol, darDeBajaDesdeAdmin: d.baja, reactivarDesdeAdmin: d.react, reenviarAccesoDesdeAdmin: d.reenv,
  cerrarSesionesDesdeAdmin: d.ses,
}));

import { DatoInvalido } from '@/lib/likida/errores';
import {
  accionCambiarRolUsuario, accionDarDeBajaUsuario, accionReactivarUsuario, accionReenviarAccesoUsuario, accionCerrarSesionesUsuario,
} from './acciones';

const fd = (c: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };
const TODAS = [accionCambiarRolUsuario, accionDarDeBajaUsuario, accionReactivarUsuario, accionReenviarAccesoUsuario, accionCerrarSesionesUsuario];

beforeEach(() => {
  vi.clearAllMocks();
  d.sup.mockResolvedValue({ userId: 'adm-1', tenantId: null, rol: 'superadmin' });
  d.paso.mockResolvedValue(null);
  d.rol.mockResolvedValue({ de: 'contador', a: 'encargado' });
  d.baja.mockResolvedValue({ sesionRevocada: true, llavesApiRevocadas: [], llavesApiSinRevocar: false });
  d.react.mockResolvedValue({ accesoRestaurado: true });
  d.reenv.mockResolvedValue({ enviado: true, email: 'p@f.test' });
  d.ses.mockResolvedValue({ sesionesCerradas: true });
});

describe('acciones de personas en /admin', () => {
  it('TODAS re-gatean con requireSuperadmin antes de tocar nada', async () => {
    d.sup.mockRejectedValue(new Error('REDIRECT:/dashboard'));
    for (const a of TODAS) await expect(a(null, fd({ id: 'u' }))).rejects.toThrow('REDIRECT');
    for (const m of [d.rol, d.baja, d.react, d.reenv, d.ses]) expect(m).not.toHaveBeenCalled();
  });

  it('cambiar rol: pasa el id, el rol y el actor; sin segundo factor no se ejecuta', async () => {
    const r = await accionCambiarRolUsuario(null, fd({ id: 'u-1', rol: 'encargado' }));
    expect(d.rol).toHaveBeenCalledWith('u-1', 'encargado', expect.objectContaining({ userId: 'adm-1' }));
    expect(r).toEqual({ ok: expect.stringContaining('Rol cambiado') });
    d.paso.mockResolvedValue('exige tu segundo factor');
    d.rol.mockClear();
    expect((await accionCambiarRolUsuario(null, fd({ id: 'u-1', rol: 'encargado' }))).error).toMatch(/segundo factor/);
    expect(d.rol).not.toHaveBeenCalled();
  });

  it('reactivar también pide el segundo factor (devuelve el rol que tenía)', async () => {
    d.paso.mockResolvedValue('exige tu segundo factor');
    expect((await accionReactivarUsuario(null, fd({ id: 'u-1' }))).error).toMatch(/segundo factor/);
    expect(d.react).not.toHaveBeenCalled();
  });

  it('baja: dice la verdad de las revocaciones; reactivar sin levantar el ban es error, no éxito', async () => {
    d.baja.mockResolvedValue({ sesionRevocada: false, llavesApiRevocadas: ['k1'], llavesApiSinRevocar: true });
    const b = await accionDarDeBajaUsuario(null, fd({ id: 'u-1' }));
    expect(b.ok).toMatch(/NO se pudo confirmar/);
    expect(b.ok).toMatch(/k1/);
    expect(b.ok).toMatch(/siguen vivas/);
    d.react.mockResolvedValue({ accesoRestaurado: false });
    expect((await accionReactivarUsuario(null, fd({ id: 'u-1' }))).error).toMatch(/no confirmó levantar el bloqueo/);
  });

  it('reenviar acceso: enviado → ok con vigencia; sin Resend → error que lo dice; no afirma entrega', async () => {
    expect((await accionReenviarAccesoUsuario(null, fd({ id: 'u-1' }))).ok).toMatch(/60 minutos/);
    d.reenv.mockResolvedValue({ enviado: false, motivo: 'sin_configurar', email: 'p@f.test' });
    const r = await accionReenviarAccesoUsuario(null, fd({ id: 'u-1' }));
    expect(r.ok).toBeUndefined();
    expect(r.error).toMatch(/Resend/);
  });

  it('cerrar sesiones: si la RPC falla se dice, no se finge', async () => {
    d.ses.mockResolvedValue({ sesionesCerradas: false });
    expect((await accionCerrarSesionesUsuario(null, fd({ id: 'u-1' }))).error).toMatch(/No se pudo confirmar/);
  });

  it('personal de Likida: el rechazo declarado de gestion_admin sale verbatim', async () => {
    d.rol.mockRejectedValue(new DatoInvalido('Esa cuenta es de Likida (superadmin o vendedor), no de una flota'));
    expect((await accionCambiarRolUsuario(null, fd({ id: 'u-1', rol: 'encargado' }))).error).toMatch(/cuenta es de Likida/);
  });
});
