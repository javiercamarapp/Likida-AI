import { beforeEach, describe, expect, it, vi } from 'vitest';

type Sesion = {
  userId: string;
  tenantId: string | null;
  rol: string;
  nombre: string | null;
  operadorId: string | null;
  avatarUrl: string | null;
};

let sesion: Sesion | null = null;
let veredicto: 'ok' | 'inscribir' | 'retar' | 'no_verificable' = 'ok';

const revalidatePath = vi.fn();
const cambiarEstadoProspecto = vi.fn(async () => undefined);
const asignarProspecto = vi.fn(async () => undefined);
const actualizarNotasProspecto = vi.fn(async () => undefined);
const redactarCorreoFrio = vi.fn(async () => ({ asunto: 'Asunto', aviso: null }));
const validarProspecto = vi.fn((entrada: Record<string, string>) => ({
  ...entrada,
  empresa: entrada.empresa || 'Empresa',
  vendedorId: entrada.vendedorId || null,
}));
const crearProspecto = vi.fn(async () => undefined);
const invitarVendedor = vi.fn(async () => ({ userId: 'u-nuevo', email: 'vendedor@example.com' }));
const anotarAccionVendedor = vi.fn(async () => undefined);
let correoListo = true;
let envioOk = true;
const enviarAccesoVendedor = vi.fn(async () => (envioOk ? { enviado: true as const } : { enviado: false as const, motivo: 'fallo' as const }));
const asignarPendientes = vi.fn(async () => ({
  apagado: false,
  sinVendedores: false,
  pendientes: 0,
  repartidos: 0,
  porVendedor: [],
}));
const consultarMfa = vi.fn(async () => veredicto);

vi.mock('@/lib/auth/session', () => ({ getSessionTenant: async () => sesion }));
vi.mock('@/lib/auth/superadmin-mfa', () => ({
  veredictoMfaDeSesion: () => consultarMfa(),
}));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://likida.test' }));
vi.mock('@/lib/likida/vendedores', () => ({
  cambiarEstadoProspecto,
  asignarProspecto,
  actualizarNotasProspecto,
  validarProspecto,
  crearProspecto,
  invitarVendedor,
  asignarPendientes,
}));
vi.mock('@/lib/likida/vendedores_registro', () => ({
  anotarAccionVendedor,
  correoDeAccesoDisponible: () => correoListo,
  enviarAccesoVendedor,
  MENSAJE_SIN_CORREO: 'sin correo',
}));
vi.mock('@/lib/likida/agentes/redactor', () => ({ redactarCorreoFrio }));
vi.mock('@/lib/auth/invitar', () => ({ descifrarErrorProvision: () => null }));
vi.mock('@/lib/likida/errores', () => ({
  mensajeParaPantalla: (error: unknown, operacion: string) => `${operacion}: ${String(error)}`,
}));

const {
  accionMover,
  accionAsignar,
  accionNota,
  accionRedactar,
  accionCrearProspecto,
  accionInvitar,
  accionRepartir,
} = await import('./acciones');

const efectos = [
  cambiarEstadoProspecto,
  asignarProspecto,
  actualizarNotasProspecto,
  redactarCorreoFrio,
  validarProspecto,
  crearProspecto,
  invitarVendedor,
  asignarPendientes,
];

async function ejecutarLasSiete() {
  const prospecto = new FormData();
  prospecto.set('empresa', 'Empresa');
  const invitacion = new FormData();
  invitacion.set('email', 'vendedor@example.com');

  return Promise.all([
    accionMover('p-1', 'contactado'),
    accionAsignar('p-1', 'v-1'),
    accionNota('p-1', 'nota'),
    accionRedactar('p-1'),
    accionCrearProspecto(null, prospecto),
    accionInvitar(null, invitacion),
    accionRepartir(),
  ]);
}

describe('las siete acciones de /admin/vendedores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sesion = {
      userId: 'u-super',
      tenantId: null,
      rol: 'superadmin',
      nombre: 'Javier',
      operadorId: null,
      avatarUrl: null,
    };
    veredicto = 'ok';
    correoListo = true;
    envioOk = true;
  });

  it.each(['inscribir', 'retar', 'no_verificable'] as const)(
    'superadmin con MFA %s: rechaza y produce cero validación/LLM/DB/Auth',
    async (resultadoMfa) => {
      veredicto = resultadoMfa;
      const resultados = await ejecutarLasSiete();

      expect(resultados.every((r) => r?.ok === false)).toBe(true);
      for (const efecto of efectos) expect(efecto).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
      expect(consultarMfa).toHaveBeenCalledTimes(7);
    },
  );

  it('superadmin AAL2 ejecuta cada efecto una vez y solo después de la puerta', async () => {
    await ejecutarLasSiete();

    for (const efecto of efectos) expect(efecto).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledTimes(7);
    expect(consultarMfa).toHaveBeenCalledTimes(7);
    expect(consultarMfa.mock.invocationCallOrder[0]).toBeLessThan(
      cambiarEstadoProspecto.mock.invocationCallOrder[0],
    );
  });

  it.each(['flota_admin', 'contador', 'encargado', 'vendedor', 'operador', 'sin_rol'])(
    'rol %s: rechaza las siete con cero efectos y ni consulta MFA',
    async (rol) => {
      sesion = { ...sesion!, rol };
      const resultados = await ejecutarLasSiete();

      expect(resultados.every((r) => r?.ok === false)).toBe(true);
      for (const efecto of efectos) expect(efecto).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
      expect(consultarMfa).not.toHaveBeenCalled();
    },
  );

  it('invitar: sin correo saliente falla cerrada, declara la causa y no crea la cuenta', async () => {
    correoListo = false;
    const fd = new FormData();
    fd.set('email', 'vendedor@example.com');
    const r = await accionInvitar(null, fd);
    expect(r).toEqual({ ok: false, error: 'sin correo' });
    expect(invitarVendedor).not.toHaveBeenCalled();
    expect(enviarAccesoVendedor).not.toHaveBeenCalled();
  });

  it('invitar: si el correo no sale, la cuenta existe pero NO se pinta verde', async () => {
    envioOk = false;
    const fd = new FormData();
    fd.set('email', 'vendedor@example.com');
    const r = await accionInvitar(null, fd);
    expect(r?.ok).toBe(false);
    expect(invitarVendedor).toHaveBeenCalledTimes(1);
  });

  it('mover y nota dejan huella en la bitácora; la nota solo con su largo', async () => {
    await accionMover('p-1', 'contactado');
    await accionNota('p-1', 'hola');
    expect(anotarAccionVendedor).toHaveBeenCalledWith(expect.anything(), 'prospecto.movido', 'p-1', { a: 'contactado' });
    expect(anotarAccionVendedor).toHaveBeenCalledWith(expect.anything(), 'prospecto.nota', 'p-1', { largo: 4 });
  });
});
