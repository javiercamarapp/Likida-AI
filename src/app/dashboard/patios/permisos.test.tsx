// LOS PATIOS: ver es del jefe, ADMINISTRAR es del dueño (W2). Se prueba por la
// puerta real: se renderiza la página y se llaman sus server actions como un POST
// directo. Un jefe de tráfico que pudiera cambiar patios o asignarse uno distinto
// se estaría ampliando el alcance a sí mismo.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactElement } from 'react';
import type { VistaPatios } from './vista';

const NORTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JEFE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const m = vi.hoisted(() => ({
  rol: 'flota_admin', userId: 'u-dueno', patioJefe: null as string | null | undefined,
  crear: vi.fn(async (..._a: unknown[]) => 'nuevo'), editar: vi.fn(async (..._a: unknown[]) => {}),
  eliminar: vi.fn(async (..._a: unknown[]) => ({ operadores: 2, unidades: 3, jefes: 0 })),
  jefeAsignar: vi.fn(async (..._a: unknown[]) => {}), sinPatio: vi.fn(async (..._a: unknown[]) => 4),
}));

vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('REDIRECT'); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => ({ tenantId: 't1', rol: m.rol, userId: m.userId }) }));
vi.mock('@/lib/likida/errores', async (original) => ({
  ...(await original<typeof import('@/lib/likida/errores')>()),
  mensajeParaPantalla: (e: unknown) => (e instanceof Error ? e.message : 'falló'),
}));
vi.mock('@/lib/likida/terminales', () => ({
  terminalDeUsuario: async () => m.patioJefe,
  getTerminalesConConteos: async () => [{ id: NORTE, nombre: 'Patio Norte', ciudad: 'Monterrey', operadores: 2, unidades: 3, jefes: 1 }],
  getJefesDeTrafico: async () => [{ userId: JEFE, nombre: 'Ana', email: 'ana@flota.mx', terminalId: NORTE }],
  contarSinPatio: async () => ({ operadores: 4, unidades: 0 }),
  crearTerminal: (...a: unknown[]) => m.crear(...a),
  editarTerminal: (...a: unknown[]) => m.editar(...a),
  eliminarTerminal: (...a: unknown[]) => m.eliminar(...a),
  asignarTerminalJefe: (...a: unknown[]) => m.jefeAsignar(...a),
  asignarSinPatio: (...a: unknown[]) => m.sinPatio(...a),
}));

const { default: PaginaPatios } = await import('./page');
const props = async () => (await PaginaPatios({ searchParams: Promise.resolve({}) }) as ReactElement<ComponentProps<typeof VistaPatios>>).props;
const fd = (campos: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(campos)) f.set(k, v); return f; };

beforeEach(() => { m.rol = 'flota_admin'; m.userId = 'u-dueno'; m.patioJefe = null; vi.clearAllMocks(); });

describe('qué ve cada rol', () => {
  it('el dueño ve y administra: patios con conteos, jefes y lo que quedó sin patio', async () => {
    const p = await props();
    expect(p.puedeAdministrar).toBe(true);
    expect(p.patios).toEqual([{ id: NORTE, nombre: 'Patio Norte', ciudad: 'Monterrey', operadores: 2, unidades: 3, jefes: 1 }]);
    expect(p.jefes).toEqual([{ userId: JEFE, etiqueta: 'Ana (ana@flota.mx)', terminalId: NORTE }]);
    expect(p.sinPatio).toEqual({ operadores: 4, unidades: 0 });
  });

  it('el jefe de tráfico VE los patios (y su propio patio), pero no administra ni lee jefes ni pendientes', async () => {
    m.rol = 'encargado'; m.patioJefe = NORTE;
    const p = await props();
    expect(p.puedeAdministrar).toBe(false);
    expect(p.jefes).toBeNull();
    expect(p.sinPatio).toBeNull();
    expect(p.patioDelJefe).toBe('Patio Norte');
  });

  it('el contador no ve la pantalla', async () => {
    m.rol = 'contador';
    await expect(props()).rejects.toThrow('REDIRECT');
  });
});

describe('las acciones son del dueño (POST directo)', () => {
  it('el jefe de tráfico no crea, edita, borra, asigna jefes ni mueve lo sin patio', async () => {
    const p = await props();
    m.rol = 'encargado';
    expect(await p.crear(null, fd({ nombre: 'Patio Sur' }))).toMatchObject({ ok: false });
    expect(await p.editar(null, fd({ terminalId: NORTE, nombre: 'X' }))).toMatchObject({ ok: false });
    expect(await p.eliminar(null, fd({ terminalId: NORTE }))).toMatchObject({ ok: false });
    expect(await p.asignarJefe(null, fd({ userId: JEFE, terminalId: '' }))).toMatchObject({ ok: false });
    expect(await p.asignarSinPatio(null, fd({ tabla: 'operador', terminalId: NORTE }))).toMatchObject({ ok: false });
    for (const f of [m.crear, m.editar, m.eliminar, m.jefeAsignar, m.sinPatio]) expect(f).not.toHaveBeenCalled();
  });

  it('el dueño crea, edita, borra y asigna, con su id como actor', async () => {
    const p = await props();
    expect(await p.crear(null, fd({ nombre: ' Patio   Sur ', ciudad: 'CDMX' }))).toMatchObject({ ok: true, mensaje: expect.stringContaining('«Patio Sur»') });
    expect(m.crear).toHaveBeenCalledWith('t1', { nombre: ' Patio   Sur ', ciudad: 'CDMX' }, { id: 'u-dueno' });
    expect(await p.editar(null, fd({ terminalId: NORTE, nombre: 'Patio Norte 2', ciudad: '' }))).toMatchObject({ ok: true });
    expect(m.editar).toHaveBeenCalledWith('t1', NORTE, { nombre: 'Patio Norte 2', ciudad: '' }, { id: 'u-dueno' });
    expect(await p.eliminar(null, fd({ terminalId: NORTE }))).toMatchObject({ ok: true, mensaje: expect.stringMatching(/2 operadores y 3 unidades quedaron sin patio/) });
  });

  it('asignar un jefe: a un patio, o a «toda la flota» (vacío) con su mensaje', async () => {
    const p = await props();
    expect(await p.asignarJefe(null, fd({ userId: JEFE, terminalId: NORTE }))).toMatchObject({ ok: true, mensaje: expect.stringMatching(/solo corrige lo de ese patio/) });
    expect(m.jefeAsignar).toHaveBeenLastCalledWith('t1', JEFE, NORTE, { id: 'u-dueno' });
    expect(await p.asignarJefe(null, fd({ userId: JEFE, terminalId: '' }))).toMatchObject({ ok: true, mensaje: expect.stringMatching(/toda la flota/) });
    expect(m.jefeAsignar).toHaveBeenLastCalledWith('t1', JEFE, null, { id: 'u-dueno' });
  });

  it('asignar lo sin patio solo acepta operador o unidad (una tabla inventada no llega al motor)', async () => {
    const p = await props();
    expect(await p.asignarSinPatio(null, fd({ tabla: 'usuario', terminalId: NORTE }))).toMatchObject({ ok: false });
    expect(await p.asignarSinPatio(null, fd({ tabla: 'unidad;drop', terminalId: NORTE }))).toMatchObject({ ok: false });
    expect(m.sinPatio).not.toHaveBeenCalled();
    expect(await p.asignarSinPatio(null, fd({ tabla: 'operador', terminalId: NORTE }))).toMatchObject({ ok: true, mensaje: expect.stringMatching(/4 operadores pasaron/) });
  });

  it('el error del motor sale verbatim (un patio con jefes no se borra)', async () => {
    m.eliminar.mockRejectedValueOnce(new Error('El patio «Patio Norte» tiene 1 jefe de tráfico asignado.'));
    const p = await props();
    expect(await p.eliminar(null, fd({ terminalId: NORTE }))).toEqual({ ok: false, error: 'El patio «Patio Norte» tiene 1 jefe de tráfico asignado.' });
  });
});
