import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// LAS ACCIONES DEL TABLERO (server actions de la página):
//   · cada una VUELVE a resolver sesión, rol y tenant desde la cookie —el tenant
//     nunca sale de un campo del formulario—;
//   · decidir por los clientes: solo dueño y encargado; configurar, autorizar,
//     dar de baja y suprimir (ARCO): solo el dueño;
//   · los ids se validan como uuid antes de tocar nada;
//   · la supresión exige confirmación explícita; el alta exige la constancia de
//     consentimiento.
// Se llama la página, se toman las acciones de las props de la vista y se invocan.
// ═══════════════════════════════════════════════════════════════════════════

let sesion = { tenantId: 't-sesion', rol: 'encargado', userId: 'u-sesion' };
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: vi.fn(async () => sesion) }));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerRuta: (rol: string) => ['superadmin', 'flota_admin', 'encargado'].includes(rol) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((u: string) => { throw new Error(`REDIRECT ${u}`); }) }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/saludo', () => ({ ahoraMs: () => 1_000 }));
vi.mock('../../bloque', () => ({ vigilar: <T,>(p: T) => p }));
vi.mock('@/lib/likida/errores', () => ({ mensajeParaPantalla: (_e: unknown, que: string) => `No se pudo ${que}` }));

const repoMsg = vi.hoisted(() => vi.fn());
vi.mock('@/lib/likida/vigia/deps', () => ({ crearDepsVigia: () => ({ repo: { mensaje: repoMsg } }) }));

const cargarTablero = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ config: {} })));
const guardarConfigVigia = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => {}));
const altaContactoVigia = vi.hoisted(() => vi.fn());
const bajaManualContacto = vi.hoisted(() => vi.fn());
const suprimirContactoVigia = vi.hoisted(() => vi.fn());
vi.mock('@/lib/likida/vigia/repo', async () => {
  const real = await vi.importActual<typeof import('@/lib/likida/vigia/repo')>('@/lib/likida/vigia/repo').catch(() => ({} as Record<string, unknown>));
  return { ...real, cargarTablero, guardarConfigVigia, altaContactoVigia, bajaManualContacto, suprimirContactoVigia };
});
const aprobarMensaje = vi.hoisted(() => vi.fn());
const rechazarMensaje = vi.hoisted(() => vi.fn());
const tomarConversacion = vi.hoisted(() => vi.fn());
const devolverConversacion = vi.hoisted(() => vi.fn());
const responderComoHumano = vi.hoisted(() => vi.fn());
const cerrarConversacion = vi.hoisted(() => vi.fn());
vi.mock('@/lib/likida/vigia/servicio', () => ({ aprobarMensaje, rechazarMensaje, tomarConversacion, devolverConversacion, responderComoHumano, cerrarConversacion }));

const Pagina = (await import('./page')).default;

const ID = '12345678-1234-4234-8234-123456789abc';
const fd = (campos: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(campos)) f.append(k, v); return f; };

async function acciones() {
  const el = (await Pagina({ searchParams: Promise.resolve({}) })) as ReactElement<{ acciones: Record<string, (p: null, f: FormData) => Promise<{ ok: boolean; mensaje?: string; error?: string } | null>>; puedeDecidir: boolean; puedeAdministrar: boolean }>;
  return el.props;
}

beforeEach(() => {
  sesion = { tenantId: 't-sesion', rol: 'encargado', userId: 'u-sesion' };
  vi.clearAllMocks();
  const ok = { ok: true as const, mensaje: 'hecho' };
  [aprobarMensaje, rechazarMensaje, tomarConversacion, devolverConversacion, responderComoHumano, cerrarConversacion].forEach((m) => m.mockResolvedValue(ok));
  altaContactoVigia.mockResolvedValue({ ok: true, valor: { id: 'n' } });
  bajaManualContacto.mockResolvedValue(true);
  suprimirContactoVigia.mockResolvedValue({ mensajes: 3, conversaciones: 1 });
  repoMsg.mockResolvedValue({ id: ID, conversacionId: 'conv-1' });
});

describe('la página', () => {
  it('lo que ve cada rol: el encargado decide pero no administra; el dueño hace ambas', async () => {
    expect(await acciones()).toMatchObject({ puedeDecidir: true, puedeAdministrar: false });
    sesion = { ...sesion, rol: 'flota_admin' };
    expect(await acciones()).toMatchObject({ puedeDecidir: true, puedeAdministrar: true });
  });
  it('un rol sin la pantalla rebota (el contador no entra)', async () => {
    sesion = { ...sesion, rol: 'contador' };
    await expect(acciones()).rejects.toThrow(/REDIRECT \/dashboard/);
  });
  it('carga el tablero con el tenant de la SESIÓN', async () => {
    await acciones();
    expect(cargarTablero).toHaveBeenCalledWith('t-sesion');
  });
});

describe('decidir (aprobar / rechazar / tomar)', () => {
  it('aprobar usa el tenant y el usuario de la SESIÓN, aunque el formulario traiga otros', async () => {
    const { acciones: a } = await acciones();
    const r = await a.decidir(null, fd({ id: ID, accion: 'aprobar', texto: '', tenantId: 't-ajeno', tenant_id: 't-ajeno', userId: 'u-ajeno' }));
    expect(r).toEqual({ ok: true, mensaje: 'hecho' });
    expect(aprobarMensaje).toHaveBeenCalledWith({ tenantId: 't-sesion', userId: 'u-sesion' }, ID, expect.anything(), {});
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/agentes/vigia');
  });
  it('aprobar con el texto editado lo pasa como edición', async () => {
    const { acciones: a } = await acciones();
    await a.decidir(null, fd({ id: ID, accion: 'aprobar', texto: 'Hola, va en camino.' }));
    expect(aprobarMensaje).toHaveBeenCalledWith(expect.anything(), ID, expect.anything(), { textoEditado: 'Hola, va en camino.' });
  });
  it('rechazar y tomar; «tomar» resuelve el hilo DENTRO de la flota de la sesión', async () => {
    const { acciones: a } = await acciones();
    await a.decidir(null, fd({ id: ID, accion: 'rechazar' }));
    expect(rechazarMensaje).toHaveBeenCalledTimes(1);
    await a.decidir(null, fd({ id: ID, accion: 'tomar' }));
    expect(repoMsg).toHaveBeenCalledWith('t-sesion', ID);
    expect(tomarConversacion).toHaveBeenCalledWith({ tenantId: 't-sesion', userId: 'u-sesion' }, 'conv-1', expect.anything());
  });
  it('tomar un mensaje que no es de la flota: «no encuentro», sin tocar nada', async () => {
    repoMsg.mockResolvedValue(null);
    const { acciones: a } = await acciones();
    const r = await a.decidir(null, fd({ id: ID, accion: 'tomar' }));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('No encuentro') });
    expect(tomarConversacion).not.toHaveBeenCalled();
  });
  it('id que no es uuid o acción inventada: se rechaza antes de llamar al servicio', async () => {
    const { acciones: a } = await acciones();
    expect(await a.decidir(null, fd({ id: "1'; drop table", accion: 'aprobar' }))).toMatchObject({ ok: false });
    expect(await a.decidir(null, fd({ id: ID, accion: 'borrar_todo' }))).toMatchObject({ ok: false, error: 'Acción no válida.' });
    expect(await a.decidir(null, fd({ accion: 'aprobar' }))).toMatchObject({ ok: false });
    expect(aprobarMensaje).not.toHaveBeenCalled();
  });
  it('un rol que perdió el permiso entre el render y el clic (superadmin «viendo como», contador): no decide', async () => {
    const { acciones: a } = await acciones();
    for (const rol of ['contador', 'superadmin', 'vendedor']) {
      sesion = { ...sesion, rol };
      const r = await a.decidir(null, fd({ id: ID, accion: 'aprobar' }));
      expect(r, rol).toMatchObject({ ok: false, error: expect.stringContaining('dueño o el encargado') });
    }
    expect(aprobarMensaje).not.toHaveBeenCalled();
  });
  it('el servicio dice que ya estaba atendido: se muestra tal cual', async () => {
    aprobarMensaje.mockResolvedValue({ ok: false, motivo: 'ya_atendido', mensaje: 'Ese mensaje ya estaba atendido (enviado).' });
    const { acciones: a } = await acciones();
    expect(await a.decidir(null, fd({ id: ID, accion: 'aprobar' }))).toEqual({ ok: false, error: 'Ese mensaje ya estaba atendido (enviado).' });
  });
  it('un fallo inesperado se contesta, no se traga ni se filtra', async () => {
    aprobarMensaje.mockRejectedValue(new Error('select * from vigia_mensaje: password=hunter2'));
    const { acciones: a } = await acciones();
    const r = await a.decidir(null, fd({ id: ID, accion: 'aprobar' }));
    expect(r).toEqual({ ok: false, error: 'No se pudo atender al cliente' });
  });
});

describe('conversación (tomar, devolver, cerrar, responder)', () => {
  it('cada acción llama a su servicio con el actor de la sesión', async () => {
    const { acciones: a } = await acciones();
    await a.conversacion(null, fd({ id: ID, accion: 'tomar' }));
    await a.conversacion(null, fd({ id: ID, accion: 'devolver' }));
    await a.conversacion(null, fd({ id: ID, accion: 'cerrar' }));
    await a.conversacion(null, fd({ id: ID, accion: 'responder', texto: 'Hola' }));
    const actor = { tenantId: 't-sesion', userId: 'u-sesion' };
    expect(tomarConversacion).toHaveBeenCalledWith(actor, ID, expect.anything());
    expect(devolverConversacion).toHaveBeenCalledWith(actor, ID, expect.anything());
    expect(cerrarConversacion).toHaveBeenCalledWith(actor, ID, expect.anything());
    expect(responderComoHumano).toHaveBeenCalledWith(actor, ID, 'Hola', expect.anything());
  });
  it('validaciones y permisos', async () => {
    const { acciones: a } = await acciones();
    expect(await a.conversacion(null, fd({ id: 'x', accion: 'tomar' }))).toMatchObject({ ok: false });
    expect(await a.conversacion(null, fd({ id: ID, accion: 'x' }))).toMatchObject({ ok: false });
    sesion = { ...sesion, rol: 'contador' };
    expect(await a.conversacion(null, fd({ id: ID, accion: 'tomar' }))).toMatchObject({ ok: false });
    expect(tomarConversacion).not.toHaveBeenCalled();
  });
});

describe('configuración, alta y contactos: solo el dueño', () => {
  const valida = { habilitado: 'on', modoAprobacion: 'siempre', autoenviarMinAprobaciones: '5', slaRespuestaMin: '30', escalarNivel2Min: '60', retencionDias: '180', avisoPrivacidadUrl: '' };

  it('el encargado NO configura, autoriza, da de baja ni suprime', async () => {
    const { acciones: a } = await acciones();
    expect(await a.config(null, fd(valida))).toMatchObject({ ok: false, error: expect.stringContaining('dueño') });
    expect(await a.alta(null, fd({ clienteId: ID, telefono: '5511110001', consentimiento: 'on' }))).toMatchObject({ ok: false });
    expect(await a.contacto(null, fd({ id: ID, accion: 'baja' }))).toMatchObject({ ok: false });
    expect(await a.contacto(null, fd({ id: ID, accion: 'suprimir', confirmo: 'on' }))).toMatchObject({ ok: false });
    expect(guardarConfigVigia).not.toHaveBeenCalled();
    expect(altaContactoVigia).not.toHaveBeenCalled();
    expect(bajaManualContacto).not.toHaveBeenCalled();
    expect(suprimirContactoVigia).not.toHaveBeenCalled();
  });

  it('el dueño guarda la configuración validada, con SU tenant y SU usuario', async () => {
    sesion = { tenantId: 't-sesion', rol: 'flota_admin', userId: 'u-dueno' };
    const { acciones: a } = await acciones();
    const r = await a.config(null, fd({ ...valida, tenantId: 't-ajeno' }));
    expect(r).toMatchObject({ ok: true });
    expect(guardarConfigVigia).toHaveBeenCalledWith('t-sesion', 'u-dueno', expect.objectContaining({ habilitado: true, slaRespuestaMin: 30, modoAprobacion: 'siempre' }));
  });
  it('un valor inválido no guarda nada y dice por qué', async () => {
    sesion = { ...sesion, rol: 'flota_admin' };
    const { acciones: a } = await acciones();
    const r = await a.config(null, fd({ ...valida, slaRespuestaMin: '2' }));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('5 y 1,440') });
    expect(guardarConfigVigia).not.toHaveBeenCalled();
  });
  it('sin marcar «encendido» queda APAGADO (y se dice)', async () => {
    sesion = { ...sesion, rol: 'flota_admin' };
    const { acciones: a } = await acciones();
    const { habilitado: _h, ...sinHabilitar } = valida;
    const r = await a.config(null, fd(sinHabilitar));
    expect(r).toMatchObject({ ok: true, mensaje: expect.stringContaining('apagado') });
    expect(guardarConfigVigia).toHaveBeenCalledWith('t-sesion', 'u-sesion', expect.objectContaining({ habilitado: false }));
  });

  it('alta: pasa la constancia de consentimiento tal cual (sin marcar, el repo la rechaza)', async () => {
    sesion = { ...sesion, rol: 'flota_admin' };
    const { acciones: a } = await acciones();
    await a.alta(null, fd({ clienteId: ID, telefono: '55 1111 0001', nombre: 'María', gerenteUserId: '', consentimiento: 'on' }));
    expect(altaContactoVigia).toHaveBeenCalledWith('t-sesion', 'u-sesion', { clienteId: ID, telefono: '55 1111 0001', nombre: 'María', gerenteUserId: null, consentimiento: true });
    altaContactoVigia.mockResolvedValue({ ok: false, error: 'Confirma que el cliente autorizó' });
    const r = await a.alta(null, fd({ clienteId: ID, telefono: '5511110001' }));
    expect(altaContactoVigia).toHaveBeenLastCalledWith('t-sesion', 'u-sesion', expect.objectContaining({ consentimiento: false }));
    expect(r).toEqual({ ok: false, error: 'Confirma que el cliente autorizó' });
  });
  it('alta con ids que no son uuid: se rechaza', async () => {
    sesion = { ...sesion, rol: 'flota_admin' };
    const { acciones: a } = await acciones();
    expect(await a.alta(null, fd({ clienteId: 'abc', telefono: '5511110001', consentimiento: 'on' }))).toMatchObject({ ok: false });
    expect(await a.alta(null, fd({ clienteId: ID, gerenteUserId: 'abc', telefono: '5511110001', consentimiento: 'on' }))).toMatchObject({ ok: false });
    expect(altaContactoVigia).not.toHaveBeenCalled();
  });

  it('baja manual y supresión ARCO (esta exige la casilla de confirmación)', async () => {
    sesion = { ...sesion, rol: 'flota_admin' };
    const { acciones: a } = await acciones();
    expect(await a.contacto(null, fd({ id: ID, accion: 'baja' }))).toMatchObject({ ok: true });
    expect(bajaManualContacto).toHaveBeenCalledWith('t-sesion', 'u-sesion', ID);
    expect(await a.contacto(null, fd({ id: ID, accion: 'suprimir' }))).toMatchObject({ ok: false, error: expect.stringContaining('confirmar') });
    expect(suprimirContactoVigia).not.toHaveBeenCalled();
    const r = await a.contacto(null, fd({ id: ID, accion: 'suprimir', confirmo: 'on' }));
    expect(r).toMatchObject({ ok: true, mensaje: expect.stringContaining('3 mensaje(s) y 1 conversación(es)') });
    expect(suprimirContactoVigia).toHaveBeenCalledWith('t-sesion', ID);
  });
  it('baja o supresión de un contacto que no es de la flota: «no encontré»', async () => {
    sesion = { ...sesion, rol: 'flota_admin' };
    bajaManualContacto.mockResolvedValue(false);
    suprimirContactoVigia.mockResolvedValue(null);
    const { acciones: a } = await acciones();
    expect(await a.contacto(null, fd({ id: ID, accion: 'baja' }))).toMatchObject({ ok: false, error: expect.stringContaining('No encontré') });
    expect(await a.contacto(null, fd({ id: ID, accion: 'suprimir', confirmo: 'on' }))).toMatchObject({ ok: false, error: expect.stringContaining('No encontré') });
  });
});
