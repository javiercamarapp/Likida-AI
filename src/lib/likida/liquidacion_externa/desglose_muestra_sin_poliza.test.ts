import { describe, expect, it, vi } from 'vitest';
import type { DependenciasDesglose } from './desglose_recibir';
import { BITACORA_MUESTRA, PADRON_MUESTRA } from './desglose_muestra_tms.fixture';

// R7-B3 · una muestra SIN póliza (la muestra real no la trae) atraviesa `prepararMuestraTms` y el `recibirDesglose` REAL: queda en
// `sin_poliza`, abre su excepción y NO se inventa nada (ni póliza, ni liquidación, ni archivo, ni entregas). Dobles en memoria.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('la base no debe tocarse en estas pruebas'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { prepararMuestraTms, SISTEMA_ORIGEN_MUESTRA_TMS } = await import('./desglose_muestra_recepcion');
const { recibirDesglose } = await import('./desglose_recibir');
const { CONFIG_CORREO_POR_DEFECTO } = await import('./repo_correo');

function dobles() {
  const llamadas: string[] = [];
  const excepciones: Array<{ clave: string; tipo: string; detalle: Record<string, unknown> }> = [];
  const prohibido = (n: string) => async () => { llamadas.push(n); throw new Error(`${n} no debe llamarse sin póliza`); };
  const deps = {
    ahora: () => new Date('2026-11-06T12:00:00Z'),
    leerConfig: async () => ({ ...CONFIG_CORREO_POR_DEFECTO, canal: 'correo', activa: true }),
    buscarPorClave: async () => null,
    abrirExcepcion: async (_t: string, clave: string, tipo: string, detalle: Record<string, unknown>) => { excepciones.push({ clave, tipo, detalle }); return { id: excepciones.length, nueva: true }; },
    resolverOperador: prohibido('resolverOperador'), resolverViajeIds: prohibido('resolverViajeIds'), leerContacto: prohibido('leerContacto'),
    leerCoordinador: prohibido('leerCoordinador'), subirXlsx: prohibido('subirXlsx'), insertarLiquidacion: prohibido('insertarLiquidacion'),
    insertarDesglose: prohibido('insertarDesglose'), insertarEntregas: prohibido('insertarEntregas'), registrarEvento: prohibido('registrarEvento'),
    omitirPendientes: prohibido('omitirPendientes'),
  } as unknown as DependenciasDesglose;
  return { deps, llamadas, excepciones };
}

describe('muestra-tms sin póliza: no se inventa nada', () => {
  it('el convertidor deja la póliza en null (no la deduce de la bitácora ni de otro campo)', () => {
    const p = prepararMuestraTms({ formato: 'muestra-tms', version: 1, bitacoras: [BITACORA_MUESTRA] }, PADRON_MUESTRA);
    if (!p.ok) throw new Error(p.mensaje);
    expect(p.revisiones).toEqual([]);
    expect(p.desgloses).toHaveLength(1);
    expect(p.desgloses[0].poliza).toBeNull();
  });

  it('recibirDesglose real: sin_poliza + excepción; ninguna liquidación, archivo, entrega ni evento', async () => {
    const p = prepararMuestraTms({ formato: 'muestra-tms', version: 1, bitacoras: [BITACORA_MUESTRA] }, PADRON_MUESTRA);
    if (!p.ok) throw new Error(p.mensaje);
    const b = dobles();
    const r = await recibirDesglose('t-1', p.desgloses[0], b.deps, { sistemaOrigen: SISTEMA_ORIGEN_MUESTRA_TMS });
    expect(r).toEqual({ estado: 'sin_poliza', claveExterna: 'BIT-900001' });
    expect(b.excepciones).toHaveLength(1);
    expect(b.excepciones[0]).toMatchObject({ clave: 'BIT-900001', tipo: 'sin_poliza' });
    expect(b.llamadas).toEqual([]); // nada de lo prohibido se llamó (de lo contrario habría lanzado)
    // y el detalle de la excepción lleva la bitácora y la fecha, no nombres ni importes
    expect(JSON.stringify(b.excepciones[0].detalle)).not.toMatch(/Ficticio|4000|500\.5/);
  });

  it('una muestra con póliza presente en el cuerpo NO la usa: el campo no existe en el contrato y se ignora', () => {
    const p = prepararMuestraTms({ formato: 'muestra-tms', version: 1, bitacoras: [{ ...BITACORA_MUESTRA, Poliza: 'P-INVENTADA' }] }, PADRON_MUESTRA);
    if (!p.ok) throw new Error(p.mensaje);
    expect(p.desgloses[0].poliza).toBeNull();
  });
});
