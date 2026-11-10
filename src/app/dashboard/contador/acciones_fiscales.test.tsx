// Fija, ANTES de migrar la pantalla del contador, lo que hacen las dos acciones que no tenían prueba: la declaración del estímulo de
// peaje (LIF 20-A) y la confirmación de la plantilla contable (CONTPAQi / SAP B1). El step-up del perfil fiscal vive en
// `timbrado_stepup.test.tsx`; la descarga SAT y el timbrado, en sus carpetas.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

const m = vi.hoisted(() => ({
  atado: { tenantId: 't1', rol: 'contador', userId: 'u1' } as null | { tenantId: string; rol: string; userId: string },
  veRuta: true,
  perfil: {} as unknown,
  perfilFalla: false,
  guardarPeaje: vi.fn(async (..._a: unknown[]) => {}),
  guardarErp: vi.fn(async (..._a: unknown[]) => {}),
  declarado: { contpaqi: null as unknown, sap_b1: null as unknown },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => ({ tenantId: 't1', rol: 'contador', userId: 'u1' }) }));
vi.mock('@/lib/auth/tenant-atado', () => ({ resolverTenantAtadoAccion: async () => m.atado, MENSAJE_FLOTA_CAMBIO: 'cambio de flota' }));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerRuta: () => m.veRuta }));
vi.mock('@/lib/likida/administracion', () => ({ mensajeParaPantalla: (e: unknown) => `fallo: ${String(e)}` }));
vi.mock('@/lib/likida/repo', () => ({
  getPerfilCrudo: async () => { if (m.perfilFalla) throw new Error('caída'); return m.perfil; },
  guardarDeclaracionEstimuloPeaje: (...a: unknown[]) => m.guardarPeaje(...a),
}));
vi.mock('@/lib/likida/contabilidad/perfiles', () => ({
  perfilExportacionDeclarado: async (_t: string, s: 'contpaqi' | 'sap_b1') => { if (m.perfilFalla) throw new Error('caída'); return m.declarado[s]; },
  guardarPerfilExportacionErp: (...a: unknown[]) => m.guardarErp(...a),
}));

const { EstimuloPeaje } = await import('./estimulo-peaje');
const { PerfilErp } = await import('./perfil-erp');

type Accion = (previo: unknown, fd: FormData) => Promise<{ ok?: string; error?: string }>;
function acciones(nodo: ReactNode, salida: Accion[] = []): Accion[] {
  if (Array.isArray(nodo)) { for (const n of nodo) acciones(n, salida); return salida; }
  if (!nodo || typeof nodo !== 'object') return salida;
  const p = (nodo as ReactElement<Record<string, unknown>>).props ?? {};
  if (typeof p.accion === 'function') salida.push(p.accion as Accion);
  acciones(p.children as ReactNode, salida);
  return salida;
}
const fd = (c: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };
const SP = {};

beforeEach(() => {
  vi.clearAllMocks();
  m.atado = { tenantId: 't1', rol: 'contador', userId: 'u1' };
  m.veRuta = true; m.perfil = {}; m.perfilFalla = false; m.declarado = { contpaqi: null, sap_b1: null };
});

describe('contador: declaración del estímulo de peaje', () => {
  const cargar = async () => acciones(await EstimuloPeaje({ searchParams: SP, tenantExiste: true }) as ReactNode)[0];

  it('sin flota (tenantExiste=false) no pinta nada', async () => {
    expect(await EstimuloPeaje({ searchParams: SP, tenantExiste: false })).toBeNull();
  });
  it('un rol sin la ruta de dinero queda rechazado y no guarda', async () => {
    const a = await cargar();
    m.veRuta = false;
    expect((await a(null, fd({ ingresos: 'menor', parte: 'no' }))).error).toMatch(/no puede declarar/);
    expect(m.guardarPeaje).not.toHaveBeenCalled();
  });
  it('si la sesión ya no es la de la flota pintada, avisa y no guarda', async () => {
    const a = await cargar();
    m.atado = null;
    expect((await a(null, fd({ ingresos: 'menor', parte: 'no' }))).error).toBe('cambio de flota');
    expect(m.guardarPeaje).not.toHaveBeenCalled();
  });
  it('exige las dos respuestas y no adivina una', async () => {
    const a = await cargar();
    expect((await a(null, fd({ ingresos: '', parte: 'no' }))).error).toMatch(/\$300 millones/);
    expect((await a(null, fd({ ingresos: 'menor', parte: '' }))).error).toMatch(/parte relacionada/);
    expect(m.guardarPeaje).not.toHaveBeenCalled();
  });
  it('menor y no relacionada: guarda (true, false) con el usuario y dice que se acredita', async () => {
    const a = await cargar();
    const r = await a(null, fd({ ingresos: 'menor', parte: 'no' }));
    expect(m.guardarPeaje).toHaveBeenCalledWith('t1', true, false, 'u1');
    expect(r.ok).toMatch(/50% de peaje se acreditará/);
  });
  it('mayor o relacionada: guarda y dice que NO califica (estímulo en $0)', async () => {
    const a = await cargar();
    const r = await a(null, fd({ ingresos: 'mayor', parte: 'no' }));
    expect(m.guardarPeaje).toHaveBeenCalledWith('t1', false, false, 'u1');
    expect(r.ok).toMatch(/no califica/);
    const r2 = await a(null, fd({ ingresos: 'menor', parte: 'si' }));
    expect(r2.ok).toMatch(/no califica/);
  });
  it('un fallo al guardar regresa el error, no un éxito', async () => {
    m.guardarPeaje.mockRejectedValueOnce(new Error('base'));
    const a = await cargar();
    expect((await a(null, fd({ ingresos: 'menor', parte: 'no' }))).error).toMatch(/fallo/);
  });
  it('si no se pudo leer el perfil, NO ofrece el formulario (no reescribir una declaración real)', async () => {
    m.perfilFalla = true;
    expect(acciones(await EstimuloPeaje({ searchParams: SP, tenantExiste: true }) as ReactNode)).toHaveLength(0);
  });
});

describe('contador: plantilla de exportación contable', () => {
  const cargar = async () => acciones(await PerfilErp({ searchParams: SP, tenantExiste: true }) as ReactNode);

  it('hay una acción por formato y sin lectura confiable no se ofrece ninguna', async () => {
    expect(await cargar()).toHaveLength(2);
    m.perfilFalla = true;
    expect(await cargar()).toHaveLength(0);
  });
  it('CONTPAQi: rol sin ruta rechazado; guarda con tipo, número, separador y encabezado partido por comas', async () => {
    const [cp] = await cargar();
    m.veRuta = false;
    expect((await cp(null, fd({}))).error).toMatch(/no puede confirmar/);
    expect(m.guardarErp).not.toHaveBeenCalled();
    m.veRuta = true;
    const r = await cp(null, fd({ tipo: 'Dr', numeroInicial: '5', separador: ',', encabezado: 'A, B ,C' }));
    expect(r.ok).toMatch(/CONTPAQi confirmada/);
    expect(m.guardarErp).toHaveBeenCalledWith('t1', 'contpaqi', { tipo: 'Dr', numeroInicial: 5, separador: ',', encabezado: ['A', 'B', 'C'] }, 'u1');
  });
  it('SAP B1: guarda las cuatro filas como listas', async () => {
    const [, sap] = await cargar();
    const r = await sap(null, fd({ cabeceraTecnica: 'a,b', cabeceraVisible: 'c,d', lineasTecnica: 'e', lineasVisible: 'f' }));
    expect(r.ok).toMatch(/SAP Business One/);
    expect(m.guardarErp).toHaveBeenCalledWith('t1', 'sap_b1', { cabeceraTecnica: ['a', 'b'], cabeceraVisible: ['c', 'd'], lineasTecnica: ['e'], lineasVisible: ['f'] }, 'u1');
  });
  it('un fallo de la base o un cambio de flota no se disfrazan de éxito', async () => {
    const [cp, sap] = await cargar();
    m.guardarErp.mockRejectedValueOnce(new Error('rechazada'));
    expect((await cp(null, fd({ numeroInicial: '1' }))).error).toMatch(/fallo/);
    m.atado = null;
    expect((await sap(null, fd({}))).error).toBe('cambio de flota');
  });
});
