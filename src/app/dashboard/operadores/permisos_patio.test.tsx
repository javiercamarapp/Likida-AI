// ═══════════════════════════════════════════════════════════════════════════
// LOS PERMISOS DEL JEFE DE TRÁFICO EN OPERADORES (W2 «producto»).
//
// Se prueba por la PUERTA REAL: se renderiza la página, se sacan sus server
// actions de las props y se llaman como las llamaría un POST directo. Lo que
// importa:
//   · el jefe SIN patio corrige, da de baja y da de alta a toda la flota;
//   · el jefe CON patio solo toca lo de SU patio —el patio del registro sale de la
//     base, no del formulario— y crea siempre en el suyo;
//   · si el patio del jefe no se pudo leer, FALLA CERRADO;
//   · el contador y un rol desconocido no escriben nada;
//   · la bitácora/actor viajan.
// ═══════════════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactElement } from 'react';
import type { VistaOperadores } from './vista';

const NORTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OP_NORTE = '00000000-0000-4000-8000-0000000000a1';
const OP_SUR = '00000000-0000-4000-8000-0000000000a2';
const OP_SIN = '00000000-0000-4000-8000-0000000000a3';

const m = vi.hoisted(() => ({
  rol: 'encargado', userId: 'u-jefe', tenant: 't1',
  patioJefe: undefined as string | null | undefined,
  patioDe: {} as Record<string, string | null>,
  actualizar: vi.fn(async (..._a: unknown[]) => {}),
  crear: vi.fn(async (..._a: unknown[]) => 'nuevo'),
  invitar: vi.fn(async (..._a: unknown[]) => ({ enviadas: 1, fallidas: [], pendientesRestantes: 0, saltadas: 0 })),
  reintentar: vi.fn(async (..._a: unknown[]) => ({ enviadas: 0, fallidas: [], pendientesRestantes: 0, saltadas: 0 })),
  cargar: vi.fn(async (..._a: unknown[]) => ({ paso: 'previsualizar' })),
}));

vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('REDIRECT'); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({
  resolverTenantEfectivo: async () => ({ tenantId: m.tenant, rol: m.rol, userId: m.userId }),
}));
vi.mock('@/lib/likida/terminales', () => ({
  terminalDeUsuario: async () => m.patioJefe,
  terminalDeRegistro: async (_t: string, _tenant: string, id: string) =>
    id in m.patioDe ? { encontrado: true, terminalId: m.patioDe[id] } : { encontrado: false, terminalId: null },
  terminalesDeRegistros: async (_t: string, _tenant: string, ids: string[]) => new Map(ids.map((i) => [i, m.patioDe[i] ?? null])),
  getTerminales: async () => [{ id: NORTE, nombre: 'Patio Norte', ciudad: null }, { id: SUR, nombre: 'Patio Sur', ciudad: null }],
}));
vi.mock('@/lib/likida/administracion', () => ({
  actualizarOperador: (...a: unknown[]) => m.actualizar(...a),
  crearOperador: (...a: unknown[]) => m.crear(...a),
  mensajeParaPantalla: (e: unknown) => (e instanceof Error ? e.message : 'falló'),
  getOperadoresRegistro: async () => ({
    filas: [OP_NORTE, OP_SUR, OP_SIN].map((id) => ({ operadorId: id, nombre: `Op ${id.slice(-2)}`, telefono: '525500000001', numeroEmpleado: null, activo: true, viajes: 0, licencia: null, licenciaTipo: null, licenciaVence: null, rfc: null })),
    total: 3, filtrados: 3, pagina: 1, paginas: 1,
  }),
  getOperadoresConteos: async () => ({ total: 3, activos: 3, sinTelefono: 0, licenciasVencidas: 0, licenciasPorVencer: 0 }),
  OPERADORES_POR_PAGINA: 25,
}));
vi.mock('@/lib/likida/invitacion_operador', () => ({
  invitarOperadores: (...a: unknown[]) => m.invitar(...a),
  reintentarFallidas: (...a: unknown[]) => m.reintentar(...a),
  estadoInvitaciones: async () => new Map(),
  contarPendientes: async () => 0,
  contarConFallo: async () => 0,
  mensajeDeInvitacion: (r: { enviadas: number }) => ({ ok: true, mensaje: `Se enviaron ${r.enviadas}`, fallidas: [] }),
}));
vi.mock('@/lib/likida/importacion/panel', () => ({ cargarOperadoresDesdeArchivo: (...a: unknown[]) => m.cargar(...a) }));

const { default: PaginaOperadores } = await import('./page');
const props = async () =>
  (await PaginaOperadores({ searchParams: Promise.resolve({}) }) as ReactElement<ComponentProps<typeof VistaOperadores>>).props;

const fd = (campos: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(campos)) f.set(k, v); return f; };
const FORMA = { nombre: 'Juan Pérez', telefono: '5512345678', numeroEmpleado: '', licencia: '', licenciaTipo: '', licenciaVence: '', rfc: '' };

beforeEach(() => {
  m.rol = 'encargado'; m.userId = 'u-jefe'; m.patioJefe = null;
  m.patioDe = { [OP_NORTE]: NORTE, [OP_SUR]: SUR, [OP_SIN]: null };
  vi.clearAllMocks();
});

describe('qué se PINTA según el alcance', () => {
  it('el jefe SIN patio edita todas las filas', async () => {
    m.patioJefe = null;
    const p = await props();
    expect(p.puedeEditar).toBe(true);
    expect(p.filas.map((f) => f.editable)).toEqual([true, true, true]);
    expect(p.patioDelJefe).toBeNull();
  });

  it('el jefe CON patio edita SOLO su patio (lo de otro patio y lo sin patio no se pinta editable)', async () => {
    m.patioJefe = NORTE;
    const p = await props();
    expect(p.filas.map((f) => [f.operadorId, f.editable])).toEqual([[OP_NORTE, true], [OP_SUR, false], [OP_SIN, false]]);
    expect(p.patioDelJefe).toBe('Patio Norte');
  });

  it('si el patio del jefe NO se pudo leer: no edita nada (falla cerrado)', async () => {
    m.patioJefe = undefined;
    const p = await props();
    expect(p.puedeEditar).toBe(false);
  });

  it('el contador (no ve operadores) y un rol sin permiso no ven formas de edición', async () => {
    m.rol = 'contador';
    await expect(props()).rejects.toThrow('REDIRECT');
  });

  it('el dueño edita todo', async () => {
    m.rol = 'flota_admin';
    const p = await props();
    expect(p.filas.every((f) => f.editable)).toBe(true);
  });
});

describe('guardarOperador — por POST directo', () => {
  it('el jefe sin patio corrige a cualquiera y firma con su id', async () => {
    const p = await props();
    const r = await p.guardarOperador(null, fd({ ...FORMA, operadorId: OP_SUR }));
    expect(r).toMatchObject({ ok: true });
    expect(m.actualizar).toHaveBeenCalledWith('t1', OP_SUR, expect.objectContaining({ nombre: 'Juan Pérez' }), { id: 'u-jefe' });
  });

  it('el jefe CON patio corrige a uno de su patio', async () => {
    m.patioJefe = NORTE;
    const p = await props();
    expect(await p.guardarOperador(null, fd({ ...FORMA, operadorId: OP_NORTE }))).toMatchObject({ ok: true });
    expect(m.actualizar).toHaveBeenCalledTimes(1);
  });

  it('el jefe CON patio NO corrige a uno de OTRO patio, ni a uno SIN patio, aunque mande el id a mano', async () => {
    m.patioJefe = NORTE;
    const p = await props();
    for (const id of [OP_SUR, OP_SIN]) {
      expect(await p.guardarOperador(null, fd({ ...FORMA, operadorId: id }))).toMatchObject({ ok: false, error: expect.stringMatching(/no es de tu patio/) });
    }
    expect(m.actualizar).not.toHaveBeenCalled();
  });

  it('un operador que no existe en la flota rebota sin escribir', async () => {
    const p = await props();
    expect(await p.guardarOperador(null, fd({ ...FORMA, operadorId: '00000000-0000-4000-8000-00000000ffff' }))).toMatchObject({ ok: false, error: expect.stringMatching(/No se encontró/) });
    expect(m.actualizar).not.toHaveBeenCalled();
  });

  it('el jefe CON patio no puede MOVER al operador a otro patio ni sacarlo del suyo', async () => {
    m.patioJefe = NORTE;
    const p = await props();
    for (const destino of [SUR, '']) {
      const r = await p.guardarOperador(null, fd({ ...FORMA, operadorId: OP_NORTE, terminalId: destino }));
      expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/mueve a un operador de patio/) });
    }
    expect(m.actualizar).not.toHaveBeenCalled();
  });

  it('el jefe SIN patio sí puede mover; el cambio de patio llega a actualizarOperador', async () => {
    const p = await props();
    await p.guardarOperador(null, fd({ ...FORMA, operadorId: OP_NORTE, terminalId: SUR }));
    expect(m.actualizar).toHaveBeenCalledWith('t1', OP_NORTE, expect.objectContaining({ terminalId: SUR }), expect.anything());
  });

  it('guardar SIN tocar el patio no manda terminalId (no pisa lo que hay)', async () => {
    const p = await props();
    await p.guardarOperador(null, fd({ ...FORMA, operadorId: OP_NORTE }));
    expect(m.actualizar.mock.calls[0][2]).not.toHaveProperty('terminalId');
  });

  it('la BAJA es una acción explícita: «baja» manda activo=false con su mensaje; guardar no toca el alta', async () => {
    const p = await props();
    const baja = await p.guardarOperador(null, fd({ ...FORMA, operadorId: OP_NORTE, accion: 'baja' }));
    expect(baja).toMatchObject({ ok: true, mensaje: expect.stringMatching(/dado de baja/) });
    expect(m.actualizar.mock.calls[0][2]).toMatchObject({ activo: false });
    m.actualizar.mockClear();
    await p.guardarOperador(null, fd({ ...FORMA, operadorId: OP_NORTE }));
    expect(m.actualizar.mock.calls[0][2]).not.toHaveProperty('activo');
    m.actualizar.mockClear();
    await p.guardarOperador(null, fd({ ...FORMA, operadorId: OP_NORTE, accion: 'reactivar' }));
    expect(m.actualizar.mock.calls[0][2]).toMatchObject({ activo: true });
  });

  it('el jefe CON patio puede dar de baja a uno de su patio, pero no a uno de otro', async () => {
    m.patioJefe = NORTE;
    const p = await props();
    expect(await p.guardarOperador(null, fd({ ...FORMA, operadorId: OP_NORTE, accion: 'baja' }))).toMatchObject({ ok: true });
    expect(await p.guardarOperador(null, fd({ ...FORMA, operadorId: OP_SUR, accion: 'baja' }))).toMatchObject({ ok: false });
    expect(m.actualizar).toHaveBeenCalledTimes(1);
  });

  it('REVOCACIÓN: la acción vuelve a comprobar el rol — un jefe degradado a contador después del render no escribe', async () => {
    const p = await props();
    m.rol = 'contador';
    expect(await p.guardarOperador(null, fd({ ...FORMA, operadorId: OP_NORTE }))).toMatchObject({ ok: false });
    expect(m.actualizar).not.toHaveBeenCalled();
  });

  it('si el patio del jefe no se puede leer al guardar, NO se guarda', async () => {
    const p = await props();
    m.patioJefe = undefined;
    expect(await p.guardarOperador(null, fd({ ...FORMA, operadorId: OP_NORTE }))).toMatchObject({ ok: false, error: expect.stringMatching(/No pude comprobar tu patio/) });
    expect(m.actualizar).not.toHaveBeenCalled();
  });
});

describe('altaOperador', () => {
  it('el jefe CON patio da de alta SIEMPRE en el suyo, pida lo que pida el formulario', async () => {
    m.patioJefe = NORTE;
    const p = await props();
    await p.altaOperador(null, fd({ nombre: 'Nuevo Chofer', telefono: '5512345678', terminalId: SUR }));
    expect(m.crear).toHaveBeenCalledWith('t1', expect.objectContaining({ terminalId: NORTE }), { id: 'u-jefe' });
  });

  it('el dueño da de alta donde pida; vacío es sin patio', async () => {
    m.rol = 'flota_admin';
    const p = await props();
    await p.altaOperador(null, fd({ nombre: 'Nuevo Chofer', telefono: '5512345678', terminalId: SUR }));
    await p.altaOperador(null, fd({ nombre: 'Otro Chofer', telefono: '5512345679', terminalId: '' }));
    expect(m.crear.mock.calls.map((c) => (c[1] as { terminalId: string | null }).terminalId)).toEqual([SUR, null]);
  });

  it('un teléfono duplicado se dice con las palabras de quien capturó (el mensaje del motor, verbatim)', async () => {
    m.crear.mockRejectedValueOnce(new Error('Ese teléfono ya está registrado en OTRA flota.'));
    const p = await props();
    expect(await p.altaOperador(null, fd({ nombre: 'Nuevo Chofer', telefono: '5512345678' }))).toEqual({ ok: false, error: 'Ese teléfono ya está registrado en OTRA flota.' });
  });

  it('el contador no da de alta', async () => {
    const p = await props();
    m.rol = 'contador';
    expect(await p.altaOperador(null, fd({ nombre: 'Nuevo Chofer', telefono: '5512345678' }))).toMatchObject({ ok: false });
    expect(m.crear).not.toHaveBeenCalled();
  });
});

describe('cargarOperadores e invitar', () => {
  it('la carga masiva recibe el alcance del jefe y su id como actor', async () => {
    m.patioJefe = NORTE;
    const p = await props();
    const datos = fd({ paso: 'previsualizar' });
    await p.cargarOperadores(null, datos);
    expect(m.cargar).toHaveBeenCalledWith({ tenantId: 't1', alcance: { tipo: 'patio', terminalId: NORTE }, actor: { id: 'u-jefe' }, datos });
  });

  it('el contador no carga ni invita', async () => {
    const p = await props();
    m.rol = 'contador';
    expect(await p.cargarOperadores(null, fd({}))).toMatchObject({ error: expect.stringMatching(/rol/) });
    expect(await p.invitar(null, fd({ modo: 'pendientes' }))).toMatchObject({ ok: false });
    expect(m.cargar).not.toHaveBeenCalled();
    expect(m.invitar).not.toHaveBeenCalled();
  });

  it('invitar: «uno» manda el id pedido con el alcance del jefe; «fallidas» reintenta; el resto son los pendientes', async () => {
    m.patioJefe = NORTE;
    const p = await props();
    await p.invitar(null, fd({ modo: 'uno', operadorId: OP_NORTE }));
    expect(m.invitar).toHaveBeenLastCalledWith('t1', { ids: [OP_NORTE], alcance: { tipo: 'patio', terminalId: NORTE }, actor: { id: 'u-jefe' } });
    await p.invitar(null, fd({ modo: 'fallidas' }));
    expect(m.reintentar).toHaveBeenCalledWith('t1', { alcance: { tipo: 'patio', terminalId: NORTE }, actor: { id: 'u-jefe' } });
    await p.invitar(null, fd({ modo: 'pendientes' }));
    expect(m.invitar).toHaveBeenLastCalledWith('t1', { alcance: { tipo: 'patio', terminalId: NORTE }, actor: { id: 'u-jefe' } });
  });
});
