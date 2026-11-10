import { beforeEach, describe, expect, it, vi } from 'vitest';

const d = vi.hoisted(() => ({
  filas: {} as Record<string, unknown>,
  errores: {} as Record<string, { message: string } | undefined>,
  rate: vi.fn(),
  prov: vi.fn(),
  anotar: vi.fn(),
  correo: vi.fn(),
  rol: vi.fn(), baja: vi.fn(), react: vi.fn(), reenv: vi.fn(), ses: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const q = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: d.errores[tabla] ? null : (d.filas[tabla] ?? null), error: d.errores[tabla] ?? null }),
      };
      return q;
    },
  }),
}));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: d.rate }));
vi.mock('@/lib/admin/acciones_riesgo', () => ({ anotarAccionAdmin: d.anotar }));
vi.mock('./provisionar', () => ({ provisionarUsuario: d.prov }));
vi.mock('./usuarios_escritura', () => ({
  cambiarRolUsuario: d.rol, desactivarUsuario: d.baja, reactivarUsuario: d.react, reenviarAcceso: d.reenv, cerrarSesionesUsuario: d.ses,
  enviarCorreoDeAcceso: d.correo,
}));

import { DatoInvalido } from '@/lib/likida/errores';
import {
  objetivoDeGestion, cambiarRolDesdeAdmin, darDeBajaDesdeAdmin, reactivarDesdeAdmin, cerrarSesionesDesdeAdmin, reenviarAccesoDesdeAdmin,
  altaDeUsuarioDesdeAdmin, fraseDeAlta, ROLES_ALTA_ADMIN,
} from './gestion_admin';

const U = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const ACTOR = { userId: 'adm-1' };

beforeEach(() => {
  vi.clearAllMocks();
  d.errores = {};
  d.filas = { app_user: { id: U, tenant_id: T, rol: 'contador', activo: true }, tenant: { nombre: 'ACME' } };
  d.rate.mockResolvedValue(true);
  d.prov.mockResolvedValue({ userId: U });
  d.anotar.mockResolvedValue(true);
  d.correo.mockResolvedValue({ enviado: true });
  d.rol.mockResolvedValue({ de: 'contador', a: 'encargado' });
  d.baja.mockResolvedValue({ sesionRevocada: true, llavesApiRevocadas: [], llavesApiSinRevocar: false });
  d.react.mockResolvedValue({ accesoRestaurado: true });
  d.ses.mockResolvedValue({ sesionesCerradas: true });
  d.reenv.mockResolvedValue({ enviado: true, email: 'x@y.test' });
});

describe('objetivoDeGestion — la flota sale de la BASE, no del formulario', () => {
  it('devuelve flota y rol de la persona', async () => {
    expect(await objetivoDeGestion(U)).toEqual({ id: U, tenantId: T, rol: 'contador', activo: true });
  });
  it('rechaza ids que no son UUID y personas que no existen', async () => {
    await expect(objetivoDeGestion('x')).rejects.toBeInstanceOf(DatoInvalido);
    d.filas.app_user = null;
    await expect(objetivoDeGestion(U)).rejects.toThrow(/No se reconoce esa cuenta/);
  });
  it('personal de Likida (superadmin, vendedor, tenant nulo): se rechaza DECLARANDO el motivo, sin tocar nada', async () => {
    for (const fila of [{ tenant_id: null, rol: 'superadmin' }, { tenant_id: null, rol: 'vendedor' }, { tenant_id: T, rol: 'superadmin' }]) {
      d.filas.app_user = { id: U, activo: true, ...fila };
      await expect(objetivoDeGestion(U)).rejects.toThrow(/cuenta es de Likida/);
    }
    await expect(cambiarRolDesdeAdmin(U, 'encargado', ACTOR)).rejects.toThrow(/cuenta es de Likida/);
    expect(d.rol).not.toHaveBeenCalled();
  });
  it('FALLA CERRADO: un error de la base se lanza, no se lee como «no existe»', async () => {
    d.errores.app_user = { message: 'conexión caída' };
    await expect(objetivoDeGestion(U)).rejects.toThrow(/conexión caída/);
  });
});

describe('las acciones reutilizan usuarios_escritura con la flota DE LA PERSONA', () => {
  it('cambiar rol, baja, reactivar y cerrar sesiones pasan (tenant leído, usuario, actor)', async () => {
    await cambiarRolDesdeAdmin(U, 'encargado', ACTOR);
    expect(d.rol).toHaveBeenCalledWith(T, U, 'encargado', { id: 'adm-1', email: null });
    await darDeBajaDesdeAdmin(U, ACTOR);
    expect(d.baja).toHaveBeenCalledWith(T, U, { id: 'adm-1', email: null });
    await reactivarDesdeAdmin(U, ACTOR);
    expect(d.react).toHaveBeenCalledWith(T, U, { id: 'adm-1', email: null });
    await cerrarSesionesDesdeAdmin(U, ACTOR);
    expect(d.ses).toHaveBeenCalledWith(T, U, { id: 'adm-1', email: null });
  });
  it('reenviar acceso: usa el nombre de la flota en el correo y respeta el tope por hora', async () => {
    await reenviarAccesoDesdeAdmin(U, ACTOR);
    expect(d.reenv).toHaveBeenCalledWith(T, U, { id: 'adm-1', email: null }, { flotaNombre: 'ACME', invitaNombre: null });
    expect(d.rate).toHaveBeenCalledWith(`invitar:${T}`, 20, 3_600_000);
    d.rate.mockResolvedValue(false);
    await expect(reenviarAccesoDesdeAdmin(U, ACTOR)).rejects.toThrow(/Demasiados correos/);
  });
});

describe('altaDeUsuarioDesdeAdmin', () => {
  const base = { tenantId: T, email: '  Persona@Flota.TEST ', nombre: 'Pat', rol: 'contador', actor: ACTOR };

  it('crea, asienta usuario.provisionado (sin correo ni teléfono en el detalle) y manda la invitación con el nombre de la flota', async () => {
    const r = await altaDeUsuarioDesdeAdmin(base);
    expect(r).toEqual({ userId: U, tenantId: T, correo: { enviado: true }, bitacora: true });
    expect(d.prov).toHaveBeenCalledWith(T, 'persona@flota.test', 'Pat', 'contador', undefined);
    expect(d.anotar).toHaveBeenCalledWith({
      actor: ACTOR, tenantId: T, accion: 'usuario.provisionado', entidad: 'app_user', entidadId: U, detalle: { rol: 'contador', origen: 'admin' },
    });
    expect(d.correo).toHaveBeenCalledWith('persona@flota.test', 'contador', { flotaNombre: 'ACME', invitaNombre: null });
  });

  it('lista blanca vigente: superadmin, vendedor y nomina NO se dan de alta desde aquí (y no se crea nada)', async () => {
    expect([...ROLES_ALTA_ADMIN]).toEqual(['flota_admin', 'encargado', 'contador']);
    for (const rol of ['superadmin', 'vendedor', 'nomina', 'operador', '']) {
      await expect(altaDeUsuarioDesdeAdmin({ ...base, rol })).rejects.toThrow(/Superadmin y vendedor no se dan de alta/);
    }
    expect(d.prov).not.toHaveBeenCalled();
  });

  it('flota inexistente o ilegible: no se crea nada', async () => {
    d.filas.tenant = null;
    await expect(altaDeUsuarioDesdeAdmin(base)).rejects.toThrow(/flota ya no existe/);
    d.errores.tenant = { message: 'caída' };
    await expect(altaDeUsuarioDesdeAdmin(base)).rejects.toThrow(/caída/);
    expect(d.prov).not.toHaveBeenCalled();
  });

  it('tope por hora de la flota (la misma llave del panel del dueño)', async () => {
    d.rate.mockResolvedValue(false);
    await expect(altaDeUsuarioDesdeAdmin(base)).rejects.toThrow(/Demasiadas altas/);
    expect(d.prov).not.toHaveBeenCalled();
  });

  it('correo duplicado: el error de Auth se traduce y sale verbatim; sin cuenta no hay asiento ni correo', async () => {
    d.prov.mockRejectedValue(new Error('A user with this email address has already been registered'));
    await expect(altaDeUsuarioDesdeAdmin(base)).rejects.toThrow(/ya tiene una cuenta registrada/);
    expect(d.anotar).not.toHaveBeenCalled();
    expect(d.correo).not.toHaveBeenCalled();
  });

  it('un fallo técnico del alta se propaga tal cual (la pantalla lo vuelve genérico)', async () => {
    d.prov.mockRejectedValue(new Error('boom'));
    await expect(altaDeUsuarioDesdeAdmin(base)).rejects.toThrow('boom');
  });

  it('sin Resend / correo caído: la cuenta y el asiento quedan y el resultado DECLARA que no hubo invitación', async () => {
    d.correo.mockResolvedValue({ enviado: false, motivo: 'sin_configurar' });
    const r = await altaDeUsuarioDesdeAdmin(base);
    expect(r.correo).toEqual({ enviado: false, motivo: 'sin_configurar' });
    expect(d.anotar).toHaveBeenCalledTimes(1);
  });

  it('bitácora caída: la cuenta existe y el resultado lo declara', async () => {
    d.anotar.mockResolvedValue(false);
    expect((await altaDeUsuarioDesdeAdmin(base)).bitacora).toBe(false);
  });
});

describe('fraseDeAlta — nunca «le llegó» sin `enviado`', () => {
  it('enviado: ok, con la vigencia del enlace', () => {
    const f = fraseDeAlta('a@b.test', { correo: { enviado: true }, bitacora: true }, 'https://app.test');
    expect(f.ok).toBe(true);
    expect(f.texto).toMatch(/60 minutos/);
  });
  it('sin configurar y fallo se distinguen, ninguno es ok', () => {
    const a = fraseDeAlta('a@b.test', { correo: { enviado: false, motivo: 'sin_configurar' }, bitacora: true }, 'https://app.test');
    const b = fraseDeAlta('a@b.test', { correo: { enviado: false, motivo: 'fallo' }, bitacora: true }, 'https://app.test');
    expect(a.ok).toBe(false); expect(b.ok).toBe(false);
    expect(a.texto).toMatch(/Resend/); expect(b.texto).toMatch(/falló/);
  });
  it('sin asiento de bitácora se avisa', () => {
    expect(fraseDeAlta('a@b.test', { correo: { enviado: true }, bitacora: false }, 'u').texto).toMatch(/NO se pudo escribir en la bitácora/);
  });
});
