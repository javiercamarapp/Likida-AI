import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';

// T-A4-26: la acción `servicio` de la pantalla. Solo el dueño (patrón 0677); el tenant sale de la sesión, nunca de un campo.

let sesion = { tenantId: 't-sesion', rol: 'flota_admin', userId: 'u-dueno' };
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => sesion }));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerRuta: () => true }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/saludo', () => ({ ahoraMs: () => 1_000 }));
vi.mock('../../bloque', () => ({ vigilar: <T,>(p: T) => p }));
vi.mock('@/lib/likida/errores', () => ({ mensajeParaPantalla: (_e: unknown, que: string) => `No se pudo ${que}` }));
vi.mock('@/lib/likida/vigia/deps', () => ({ crearDepsVigia: () => ({ repo: {} }) }));
const guardarServicioVigia = vi.hoisted(() => vi.fn());
const quitarServicioVigia = vi.hoisted(() => vi.fn());
vi.mock('@/lib/likida/vigia/repo', async () => {
  const real = await vi.importActual<typeof import('@/lib/likida/vigia/repo')>('@/lib/likida/vigia/repo').catch(() => ({} as Record<string, unknown>));
  return { ...real, cargarTablero: vi.fn(async () => ({ config: {} })), guardarServicioVigia, quitarServicioVigia };
});
vi.mock('@/lib/likida/vigia/servicio', () => ({
  aprobarMensaje: vi.fn(), rechazarMensaje: vi.fn(), tomarConversacion: vi.fn(), devolverConversacion: vi.fn(), responderComoHumano: vi.fn(), cerrarConversacion: vi.fn(),
}));

const Pagina = (await import('./page')).default;
const ID = '12345678-1234-4234-8234-123456789abc';
const fd = (campos: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(campos)) f.append(k, v); return f; };
type Acc = (p: null, f: FormData) => Promise<{ ok: boolean; mensaje?: string; error?: string } | null>;
async function servicio(): Promise<Acc> {
  const el = (await Pagina({ searchParams: Promise.resolve({}) })) as ReactElement<{ acciones: { servicio: Acc } }>;
  return el.props.acciones.servicio;
}
const ok = { nombre: 'Ana Pérez', telefono: '2899900001', correo: '', clienteId: '', activo: 'on' };

beforeEach(() => {
  sesion = { tenantId: 't-sesion', rol: 'flota_admin', userId: 'u-dueno' };
  vi.clearAllMocks();
  guardarServicioVigia.mockResolvedValue({ ok: true, valor: { id: 'n' } });
  quitarServicioVigia.mockResolvedValue(true);
});

describe('T-A4-26 · acción servicio', () => {
  it('el dueño da de alta, corrige y quita; el tenant es el de la sesión aunque el formulario traiga otro', async () => {
    const a = await servicio();
    expect(await a(null, fd({ accion: 'guardar', ...ok, tenantId: 'otra-flota' }))).toEqual({ ok: true, mensaje: 'Agregado a servicio al cliente.' });
    expect(guardarServicioVigia).toHaveBeenCalledWith('t-sesion', 'u-dueno', null, { clienteId: null, nombre: 'Ana Pérez', telefono: '522899900001', correo: null, activo: true });
    expect(await a(null, fd({ accion: 'guardar', id: ID, ...ok }))).toEqual({ ok: true, mensaje: 'Cambios guardados.' });
    expect(guardarServicioVigia).toHaveBeenLastCalledWith('t-sesion', 'u-dueno', ID, expect.anything());
    expect(await a(null, fd({ accion: 'quitar', id: ID }))).toEqual({ ok: true, mensaje: 'Quitado de servicio al cliente.' });
    expect(quitarServicioVigia).toHaveBeenCalledWith('t-sesion', ID);
  });
  it('entradas inválidas no llegan a la base', async () => {
    const a = await servicio();
    expect(await a(null, fd({ accion: 'guardar', ...ok, telefono: '', correo: '' }))).toMatchObject({ ok: false });
    expect(await a(null, fd({ accion: 'guardar', ...ok, clienteId: 'no-uuid' }))).toMatchObject({ ok: false });
    expect(await a(null, fd({ accion: 'quitar', id: "1'; drop" }))).toMatchObject({ ok: false, error: 'Persona no válida.' });
    expect(await a(null, fd({ accion: 'quitar' }))).toMatchObject({ ok: false });
    expect(await a(null, fd({ accion: 'borrar_todo', id: ID }))).toMatchObject({ ok: false, error: 'Acción no válida.' });
    expect(guardarServicioVigia).not.toHaveBeenCalled();
    expect(quitarServicioVigia).not.toHaveBeenCalled();
  });
  it('el tope de 10 y los errores de la base llegan a la pantalla sin filtrar secretos', async () => {
    const a = await servicio();
    guardarServicioVigia.mockResolvedValue({ ok: false, error: 'Ya hay 10 personas en servicio al cliente' });
    expect(await a(null, fd({ accion: 'guardar', ...ok }))).toEqual({ ok: false, error: 'Ya hay 10 personas en servicio al cliente' });
    quitarServicioVigia.mockResolvedValue(false);
    expect(await a(null, fd({ accion: 'quitar', id: ID }))).toMatchObject({ ok: false, error: expect.stringContaining('No encontré') });
    guardarServicioVigia.mockRejectedValue(new Error('rpc: password=hunter2'));
    const r = await a(null, fd({ accion: 'guardar', ...ok }));
    expect(JSON.stringify(r)).not.toContain('hunter2');
  });
  it('solo el dueño: encargado y otros roles no escriben', async () => {
    for (const rol of ['encargado', 'contador', 'operador']) {
      sesion = { ...sesion, rol };
      const a = await servicio();
      expect(await a(null, fd({ accion: 'guardar', ...ok })), rol).toMatchObject({ ok: false, error: expect.stringContaining('dueño') });
      expect(await a(null, fd({ accion: 'quitar', id: ID })), rol).toMatchObject({ ok: false });
    }
    expect(guardarServicioVigia).not.toHaveBeenCalled();
    expect(quitarServicioVigia).not.toHaveBeenCalled();
  });
});
