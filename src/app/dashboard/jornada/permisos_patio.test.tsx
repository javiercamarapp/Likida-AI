// LOS PERMISOS DEL JEFE DE TRÁFICO EN LA JORNADA (W2): corregir, capturar y cerrar
// son del dueño y del jefe de SU patio (con firma y bitácora); los umbrales de la
// flota siguen siendo solo del dueño.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactElement } from 'react';
import type { VistaJornada } from './vista';

const NORTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OP_NORTE = '00000000-0000-4000-8000-0000000000a1';
const OP_SUR = '00000000-0000-4000-8000-0000000000a2';
const J_NORTE = '00000000-0000-4000-8000-0000000000c1';
const J_SUR = '00000000-0000-4000-8000-0000000000c2';
const A_NORTE = '00000000-0000-4000-8000-0000000000d1';
const A_SUR = '00000000-0000-4000-8000-0000000000d2';

const m = vi.hoisted(() => ({
  rol: 'encargado', userId: 'u-jefe', patioJefe: undefined as string | null | undefined,
  patioDeJornada: {} as Record<string, string | null>, patioDeAsiento: {} as Record<string, string | null>,
  anular: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })),
  asentar: vi.fn(async (..._a: unknown[]) => 'ok' as string),
  cerrar: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })),
  politica: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })),
  bitacora: vi.fn(async (..._a: unknown[]) => true),
}));

vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('REDIRECT'); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => ({ tenantId: 't1', rol: m.rol, userId: m.userId }) }));
vi.mock('@/lib/likida/terminales', () => ({
  terminalDeUsuario: async () => m.patioJefe,
  terminalDeJornada: async (_t: string, ref: { jornadaId?: string; asientoId?: string }) => {
    const mapa = ref.asientoId ? m.patioDeAsiento : m.patioDeJornada;
    const id = (ref.asientoId ?? ref.jornadaId) as string;
    return id in mapa ? { encontrado: true, terminalId: mapa[id] } : { encontrado: false, terminalId: null };
  },
  terminalesDeRegistros: async (_t: string, _tenant: string, ids: string[]) => new Map(ids.map((i) => [i, i === OP_NORTE ? NORTE : i === OP_SUR ? SUR : null])),
}));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: (...a: unknown[]) => m.bitacora(...a) }));
vi.mock('@/lib/likida/jornada/firma', () => ({ correoDelUsuario: async () => 'jefe@flota.mx' }));
vi.mock('@/lib/likida/jornada/repo', () => ({
  JornadaIlegible: class extends Error {},
  leerJornadas: async () => ({
    truncada: false,
    dias: [
      { id: J_NORTE, operadorId: OP_NORTE, dia: '2026-10-01', estado: 'abierto', cerradoPorEmail: null, conformeOperadorEn: null, asientos: [] },
      { id: J_SUR, operadorId: OP_SUR, dia: '2026-10-01', estado: 'abierto', cerradoPorEmail: null, conformeOperadorEn: null, asientos: [] },
    ],
  }),
  leerPolitica: async () => null,
  nombresDeOperadores: async () => new Map([[OP_NORTE, { nombre: 'Juan Norte' }], [OP_SUR, { nombre: 'Luis Sur' }]]),
  catalogoDeOperadores: async () => [],
  anularAsiento: (...a: unknown[]) => m.anular(...a),
  cerrarDia: (...a: unknown[]) => m.cerrar(...a),
  asentarMarca: (...a: unknown[]) => m.asentar(...a),
  guardarPolitica: (...a: unknown[]) => m.politica(...a),
}));

const { default: PaginaJornada } = await import('./page');
const props = async () =>
  (await PaginaJornada({ searchParams: Promise.resolve({}) }) as ReactElement<ComponentProps<typeof VistaJornada>>).props;
const fd = (campos: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(campos)) f.set(k, v); return f; };

beforeEach(() => {
  m.rol = 'encargado'; m.userId = 'u-jefe'; m.patioJefe = null;
  m.patioDeJornada = { [J_NORTE]: NORTE, [J_SUR]: SUR };
  m.patioDeAsiento = { [A_NORTE]: NORTE, [A_SUR]: SUR };
  vi.clearAllMocks();
});

describe('qué se pinta', () => {
  it('el dueño y el jefe sin patio corrigen todo; el jefe con patio solo las jornadas de sus operadores', async () => {
    m.rol = 'flota_admin';
    expect((await props()).filas!.map((f) => f.editable)).toEqual([true, true]);
    m.rol = 'encargado'; m.patioJefe = null;
    expect((await props()).filas!.map((f) => f.editable)).toEqual([true, true]);
    m.patioJefe = NORTE;
    expect((await props()).filas!.map((f) => [f.operadorNombre, f.editable])).toEqual([['Juan Norte', true], ['Luis Sur', false]]);
  });

  it('el jefe puede corregir (rol) pero NO declarar los umbrales; solo el dueño', async () => {
    const jefe = await props();
    expect(jefe.puedeCorregir).toBe(true);
    expect(jefe.puedeDeclararPolitica).toBe(false);
    m.rol = 'flota_admin';
    expect((await props()).puedeDeclararPolitica).toBe(true);
  });

  it('el contador no ve la jornada (área de operación)', async () => {
    m.rol = 'contador';
    await expect(props()).rejects.toThrow('REDIRECT');
  });
});

describe('anularMarca', () => {
  const MOTIVO = 'La unidad salió a las 6:00, no a las 8:00';
  it('el jefe CON patio anula una marca de su patio; queda la firma y la bitácora', async () => {
    m.patioJefe = NORTE;
    const p = await props();
    expect(await p.anularMarca({ ok: false }, fd({ asientoId: A_NORTE, motivo: MOTIVO, jornadaId: J_NORTE }))).toMatchObject({ ok: true });
    expect(m.anular).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', asientoId: A_NORTE, motivo: MOTIVO, usuarioId: 'u-jefe', usuarioEmail: 'jefe@flota.mx' }));
    expect(m.bitacora).toHaveBeenCalledWith(expect.objectContaining({ accion: 'jornada.marca_anulada', actor: { id: 'u-jefe', email: 'jefe@flota.mx' } }), expect.anything());
  });

  it('NO anula una marca de OTRO patio, aunque mande el id a mano: el patio sale de la base', async () => {
    m.patioJefe = NORTE;
    const p = await props();
    expect(await p.anularMarca({ ok: false }, fd({ asientoId: A_SUR, motivo: MOTIVO }))).toMatchObject({ ok: false, error: expect.stringMatching(/no es de tu patio/) });
    expect(m.anular).not.toHaveBeenCalled();
    expect(m.bitacora).not.toHaveBeenCalled();
  });

  it('una marca que no existe en la flota rebota sin escribir', async () => {
    const p = await props();
    expect(await p.anularMarca({ ok: false }, fd({ asientoId: '00000000-0000-4000-8000-00000000ffff', motivo: MOTIVO }))).toMatchObject({ ok: false, error: expect.stringMatching(/no existe en tu flota/) });
    expect(m.anular).not.toHaveBeenCalled();
  });

  it('sin motivo no se anula (una corrección sin explicación no sirve)', async () => {
    const p = await props();
    expect(await p.anularMarca({ ok: false }, fd({ asientoId: A_NORTE, motivo: 'x' }))).toMatchObject({ ok: false });
    expect(m.anular).not.toHaveBeenCalled();
  });

  it('el jefe CON patio y patio ilegible NO corrige nada (falla cerrado)', async () => {
    const p = await props();
    m.patioJefe = undefined;
    expect(await p.anularMarca({ ok: false }, fd({ asientoId: A_NORTE, motivo: MOTIVO }))).toMatchObject({ ok: false, error: expect.stringMatching(/No pude comprobar tu patio/) });
    expect(m.anular).not.toHaveBeenCalled();
  });
});

describe('capturarMarca y cerrarElDia', () => {
  const MARCA = { tipo: 'inicio_jornada', momento: '2026-10-01T06:00' };
  it('capturar: del patio del jefe sí; de otro patio no', async () => {
    m.patioJefe = NORTE;
    const p = await props();
    expect(await p.capturarMarca({ ok: false }, fd({ jornadaId: J_NORTE, ...MARCA }))).toMatchObject({ ok: true });
    expect(m.asentar).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', jornadaId: J_NORTE, procedencia: 'capturado_contralor', registradoPor: 'u-jefe' }));
    expect(await p.capturarMarca({ ok: false }, fd({ jornadaId: J_SUR, ...MARCA }))).toMatchObject({ ok: false, error: expect.stringMatching(/no es de tu patio/) });
    expect(m.asentar).toHaveBeenCalledTimes(1);
  });

  it('cerrar el día: del patio sí; de otro no', async () => {
    m.patioJefe = NORTE;
    const p = await props();
    expect(await p.cerrarElDia({ ok: false }, fd({ jornadaId: J_NORTE }))).toMatchObject({ ok: true });
    expect(await p.cerrarElDia({ ok: false }, fd({ jornadaId: J_SUR }))).toMatchObject({ ok: false });
    expect(m.cerrar).toHaveBeenCalledTimes(1);
  });

  it('el contador no captura ni cierra (revocación después del render incluida)', async () => {
    const p = await props();
    m.rol = 'contador';
    expect(await p.capturarMarca({ ok: false }, fd({ jornadaId: J_NORTE, ...MARCA }))).toMatchObject({ ok: false });
    expect(await p.cerrarElDia({ ok: false }, fd({ jornadaId: J_NORTE }))).toMatchObject({ ok: false });
    expect(m.asentar).not.toHaveBeenCalled();
    expect(m.cerrar).not.toHaveBeenCalled();
  });
});

describe('declararPolitica — configuración de la cuenta: solo el dueño', () => {
  it('el jefe de tráfico NO declara umbrales; el dueño sí', async () => {
    const p = await props();
    expect(await p.declararPolitica({ ok: false }, fd({ horasMaxJornada: '8' }))).toMatchObject({ ok: false, error: expect.stringMatching(/administra la flota declara/) });
    expect(m.politica).not.toHaveBeenCalled();
    m.rol = 'flota_admin';
    expect(await p.declararPolitica({ ok: false }, fd({ horasMaxJornada: '8' }))).toMatchObject({ ok: true });
    expect(m.politica).toHaveBeenCalledTimes(1);
  });
});
