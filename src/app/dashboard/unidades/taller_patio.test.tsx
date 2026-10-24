// A37-S20-01: las acciones del taller respetan el patio del jefe de tráfico.
// Se llaman como un POST directo (la action sale del árbol que pinta la sección).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

const NORTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U_NORTE = '00000000-0000-4000-8000-0000000000b1';
const U_SUR = '00000000-0000-4000-8000-0000000000b2';
const O_NORTE = '00000000-0000-4000-8000-0000000000c1';
const O_SUR = '00000000-0000-4000-8000-0000000000c2';

const m = vi.hoisted(() => ({
  rol: 'encargado', patioJefe: undefined as string | null | undefined,
  patioDe: {} as Record<string, string | null>,
  cerrar: vi.fn(async (..._a: unknown[]) => {}), abrir: vi.fn(async (..._a: unknown[]) => {}),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => ({ tenantId: 't1', rol: m.rol, userId: 'u-jefe' }) }));
vi.mock('@/lib/likida/terminales', () => ({
  terminalDeUsuario: async () => m.patioJefe,
  terminalDeRegistro: async (_t: string, _tenant: string, id: string) =>
    id in m.patioDe ? { encontrado: true, terminalId: m.patioDe[id] } : { encontrado: false, terminalId: null },
  terminalesDeRegistros: async (_t: string, _tenant: string, ids: string[]) => new Map(ids.map((i) => [i, m.patioDe[i] ?? null])),
}));
vi.mock('@/lib/likida/mantenimiento', () => ({
  getTaller: async () => ({
    ordenesAbiertas: [
      { id: O_NORTE, unidadId: U_NORTE, unidadEco: 'N1', tipo: 'preventivo', estado: 'abierta', descripcion: null, abiertaEn: '2026-10-01T00:00:00Z', deAveria: false, deRutina: null },
      { id: O_SUR, unidadId: U_SUR, unidadEco: 'S1', tipo: 'preventivo', estado: 'abierta', descripcion: null, abiertaEn: '2026-10-01T00:00:00Z', deAveria: false, deRutina: null },
    ],
    rutinas: [], propuestas: [],
  }),
  unidadDeOrden: async (_t: string, id: string) => ({ [O_NORTE]: U_NORTE, [O_SUR]: U_SUR } as Record<string, string>)[id] ?? null,
  validarRutina: vi.fn(), crearRutina: vi.fn(),
  abrirOrdenProgramada: (...a: unknown[]) => m.abrir(...a),
  cerrarOrden: (...a: unknown[]) => m.cerrar(...a),
}));
vi.mock('@/lib/likida/errores', async (original) => ({
  ...(await original<typeof import('@/lib/likida/errores')>()),
  mensajeParaPantalla: (e: unknown) => (e instanceof Error ? e.message : 'falló'),
}));

const { BloqueTaller } = await import('./taller');

type Accion = (previo: unknown, fd: FormData) => Promise<{ ok?: string; error?: string }>;
function acciones(nodo: ReactNode, salida: { accion: Accion; ordenId: string | null }[] = []) {
  if (Array.isArray(nodo)) { nodo.forEach((n) => acciones(n, salida)); return salida; }
  if (!nodo || typeof nodo !== 'object') return salida;
  const el = nodo as ReactElement<{ accion?: Accion; children?: ReactNode }>;
  if (typeof el.props?.accion === 'function') {
    const hidden = (Array.isArray(el.props.children) ? el.props.children : [el.props.children])
      .find((h) => (h as ReactElement<{ name?: string }> | null)?.props?.name === 'ordenId') as ReactElement<{ value?: string }> | undefined;
    salida.push({ accion: el.props.accion, ordenId: hidden?.props?.value ?? null });
  }
  acciones(el.props?.children, salida);
  return salida;
}
const fd = (c: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };
const pintar = async () => acciones(await BloqueTaller({ sp: {} }) as ReactNode);

beforeEach(() => {
  m.rol = 'encargado'; m.patioJefe = NORTE;
  m.patioDe = { [U_NORTE]: NORTE, [U_SUR]: SUR };
  vi.clearAllMocks();
});

describe('A37-S20-01 taller y patio', () => {
  it('el jefe del Patio Norte no cierra la orden del Patio Sur por POST directo', async () => {
    const [cualquiera] = await pintar();
    const r = await cualquiera.accion(null, fd({ ordenId: O_SUR, kmServicio: '9999999' }));
    expect(r.error).toBeTruthy();
    expect(m.cerrar).not.toHaveBeenCalled();
  });

  it('sí cierra la de su patio, y el formulario de la ajena no se pinta', async () => {
    const formas = await pintar();
    expect(formas.map((f) => f.ordenId)).toEqual([O_NORTE]);
    const r = await formas[0].accion(null, fd({ ordenId: O_NORTE, kmServicio: '100' }));
    expect(r.ok).toBeTruthy();
    expect(m.cerrar).toHaveBeenCalledWith('t1', O_NORTE, 100);
  });

  it('sin poder leer su patio, no cierra nada', async () => {
    const [accion] = await pintar();
    m.patioJefe = undefined;
    const r = await accion.accion(null, fd({ ordenId: O_NORTE }));
    expect(r.error).toBeTruthy();
    expect(m.cerrar).not.toHaveBeenCalled();
  });

  it('el dueño (flota entera) cierra cualquiera', async () => {
    m.rol = 'flota_admin';
    const formas = await pintar();
    const r = await formas[0].accion(null, fd({ ordenId: O_SUR }));
    expect(r.ok).toBeTruthy();
  });
});
