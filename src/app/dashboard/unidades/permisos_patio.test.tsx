// LOS PERMISOS DEL JEFE DE TRÁFICO EN UNIDADES (W2): por la puerta real, llamando
// las server actions como un POST directo. Mismo molde que operadores.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactElement } from 'react';
import type { VistaUnidades } from './vista';

const NORTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U_NORTE = '00000000-0000-4000-8000-0000000000b1';
const U_SUR = '00000000-0000-4000-8000-0000000000b2';
const U_SIN = '00000000-0000-4000-8000-0000000000b3';

const m = vi.hoisted(() => ({
  rol: 'encargado', userId: 'u-jefe', patioJefe: undefined as string | null | undefined,
  patioDe: {} as Record<string, string | null>,
  crear: vi.fn(async (..._a: unknown[]) => 'nueva'), editar: vi.fn(async (..._a: unknown[]) => {}), estado: vi.fn(async (..._a: unknown[]) => {}),
  cargar: vi.fn(async (..._a: unknown[]) => ({ paso: 'previsualizar' })),
}));

vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('REDIRECT'); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => ({ tenantId: 't1', rol: m.rol, userId: m.userId }) }));
vi.mock('@/lib/likida/terminales', () => ({
  terminalDeUsuario: async () => m.patioJefe,
  terminalDeRegistro: async (_t: string, _tenant: string, id: string) =>
    id in m.patioDe ? { encontrado: true, terminalId: m.patioDe[id] } : { encontrado: false, terminalId: null },
  terminalesDeRegistros: async (_t: string, _tenant: string, ids: string[]) => new Map(ids.map((i) => [i, m.patioDe[i] ?? null])),
  getTerminales: async () => [{ id: NORTE, nombre: 'Patio Norte', ciudad: null }, { id: SUR, nombre: 'Patio Sur', ciudad: null }],
}));
const fila = (id: string) => ({ id, numeroEconomico: `T-${id.slice(-2)}`, placas: 'AB-1', marca: null, modelo: null, anio: null, polizaVence: null, permisoSictVence: null, verificacionVence: null, estado: 'disponible', activo: true, kmActual: null, ordenesAbiertas: 0, diasAlVencimiento: null, queVence: null, gpsProveedor: null, gpsDeviceId: null, gpsVistoEn: null });
vi.mock('@/lib/likida/administracion', () => ({
  getUnidadesRegistro: async (_t: string, _h: string, o: { activo: boolean }) => (o.activo
    ? { filas: [fila(U_NORTE), fila(U_SUR), fila(U_SIN)], total: 3, pagina: 1, paginas: 1 }
    : { filas: [], total: 0, pagina: 1, paginas: 1 }),
  getUnidadesConteos: async () => ({ total: 3, activas: 3, bajas: 0, vencidos: 0, porVencer: 0, vigentes: 0, sinDato: 3 }),
  UNIDADES_POR_PAGINA: 25,
}));
vi.mock('@/lib/likida/operacion', () => ({
  validarUnidad: (v: Record<string, string>) => ({ ...v, numeroEconomico: v.numeroEconomico }),
  crearUnidad: (...a: unknown[]) => m.crear(...a),
  editarUnidad: (...a: unknown[]) => m.editar(...a),
  cambiarEstadoUnidad: (...a: unknown[]) => m.estado(...a),
  ESTADOS_UNIDAD: { disponible: 'Disponible', taller: 'En taller', baja: 'Dada de baja' },
}));
vi.mock('@/lib/likida/errores', async (original) => ({
  ...(await original<typeof import('@/lib/likida/errores')>()),
  mensajeParaPantalla: (e: unknown) => (e instanceof Error ? e.message : 'falló'),
}));
vi.mock('@/lib/likida/importacion/panel', () => ({ cargarUnidadesDesdeArchivo: (...a: unknown[]) => m.cargar(...a) }));
vi.mock('@/lib/likida/conectores/gps', () => ({ CONECTORES_GPS: [] }));
vi.mock('./taller', () => ({ BloqueTaller: () => null }));

const { default: PaginaUnidades } = await import('./page');
const props = async () => {
  const r = await PaginaUnidades({ searchParams: Promise.resolve({}) }) as ReactElement<{ children?: unknown }>;
  // La página devuelve <> <VistaUnidades .../> <BloqueTaller/> </>
  const hijos = (r.props.children as ReactElement<ComponentProps<typeof VistaUnidades>>[]);
  return hijos[0].props;
};
const fd = (campos: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(campos)) f.set(k, v); return f; };
const FORMA = { numeroEconomico: '47', placas: 'AB-123' };

beforeEach(() => {
  m.rol = 'encargado'; m.userId = 'u-jefe'; m.patioJefe = null;
  m.patioDe = { [U_NORTE]: NORTE, [U_SUR]: SUR, [U_SIN]: null };
  vi.clearAllMocks();
});

describe('qué se pinta', () => {
  it('el jefe sin patio edita todo; con patio, solo lo de su patio; sin poder leer su patio, nada', async () => {
    expect(Object.values((await props()).editablePorUnidad)).toEqual([true, true, true]);
    m.patioJefe = NORTE;
    const p = await props();
    expect(p.editablePorUnidad).toEqual({ [U_NORTE]: true, [U_SUR]: false, [U_SIN]: false });
    expect(p.patioDelJefe).toBe('Patio Norte');
    m.patioJefe = undefined;
    expect((await props()).puedeEditar).toBe(false);
  });
});

describe('guardar (alta y edición)', () => {
  it('el jefe CON patio crea SIEMPRE en el suyo y firma', async () => {
    m.patioJefe = NORTE;
    const p = await props();
    expect(await p.guardar(null, fd({ ...FORMA, terminalId: SUR }))).toMatchObject({ ok: true });
    expect(m.crear).toHaveBeenCalledWith('t1', expect.objectContaining({ terminalId: NORTE }), { id: 'u-jefe' });
  });

  it('el dueño crea donde pida', async () => {
    m.rol = 'flota_admin';
    const p = await props();
    await p.guardar(null, fd({ ...FORMA, terminalId: SUR }));
    expect(m.crear).toHaveBeenCalledWith('t1', expect.objectContaining({ terminalId: SUR }), expect.anything());
  });

  it('el jefe CON patio edita una de su patio y NO una de otro patio ni una sin patio', async () => {
    m.patioJefe = NORTE;
    const p = await props();
    expect(await p.guardar(null, fd({ ...FORMA, id: U_NORTE }))).toMatchObject({ ok: true });
    expect(m.editar).toHaveBeenCalledTimes(1);
    for (const id of [U_SUR, U_SIN]) {
      expect(await p.guardar(null, fd({ ...FORMA, id }))).toMatchObject({ ok: false, error: expect.stringMatching(/no es de tu patio/) });
    }
    expect(m.editar).toHaveBeenCalledTimes(1);
  });

  it('no puede MOVER la unidad a otro patio', async () => {
    m.patioJefe = NORTE;
    const p = await props();
    expect(await p.guardar(null, fd({ ...FORMA, id: U_NORTE, terminalId: SUR }))).toMatchObject({ ok: false, error: expect.stringMatching(/mueve una unidad de patio/) });
    expect(m.editar).not.toHaveBeenCalled();
  });

  it('el contador no escribe; revocación después del render también rebota', async () => {
    const p = await props();
    m.rol = 'contador';
    expect(await p.guardar(null, fd(FORMA))).toMatchObject({ ok: false });
    expect(await p.cambiarEstado(null, fd({ unidadId: U_NORTE, estado: 'baja' }))).toMatchObject({ ok: false });
    expect(m.crear).not.toHaveBeenCalled();
    expect(m.estado).not.toHaveBeenCalled();
  });
});

describe('cambiarEstado (taller, baja, regreso)', () => {
  it('el jefe sin patio da de baja a cualquiera, con su id en la bitácora', async () => {
    const p = await props();
    expect(await p.cambiarEstado(null, fd({ unidadId: U_SUR, estado: 'baja' }))).toMatchObject({ ok: true });
    expect(m.estado).toHaveBeenCalledWith('t1', U_SUR, 'baja', { id: 'u-jefe' });
  });

  it('el jefe CON patio solo da de baja / manda a taller las de su patio', async () => {
    m.patioJefe = NORTE;
    const p = await props();
    expect(await p.cambiarEstado(null, fd({ unidadId: U_NORTE, estado: 'taller' }))).toMatchObject({ ok: true });
    expect(await p.cambiarEstado(null, fd({ unidadId: U_SUR, estado: 'baja' }))).toMatchObject({ ok: false, error: expect.stringMatching(/no es de tu patio/) });
    expect(m.estado).toHaveBeenCalledTimes(1);
  });

  it('una unidad que no es de la flota rebota sin tocar nada', async () => {
    const p = await props();
    expect(await p.cambiarEstado(null, fd({ unidadId: '00000000-0000-4000-8000-00000000ffff', estado: 'baja' }))).toMatchObject({ ok: false, error: expect.stringMatching(/No se encontró/) });
    expect(m.estado).not.toHaveBeenCalled();
  });
});

describe('cargarUnidades', () => {
  it('manda el alcance y el actor; el contador no carga', async () => {
    m.patioJefe = NORTE;
    const p = await props();
    const datos = fd({ paso: 'previsualizar' });
    await p.cargarUnidades(null, datos);
    expect(m.cargar).toHaveBeenCalledWith({ tenantId: 't1', alcance: { tipo: 'patio', terminalId: NORTE }, actor: { id: 'u-jefe' }, datos });
    m.cargar.mockClear();
    m.rol = 'contador';
    expect(await p.cargarUnidades(null, fd({}))).toMatchObject({ error: expect.stringMatching(/rol/) });
    expect(m.cargar).not.toHaveBeenCalled();
  });
});
