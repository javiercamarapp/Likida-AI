import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToReadableStream } from 'react-dom/server';
import type { CifrasPesosCincoAgentes } from './cinco-agentes-cifras-modelo';
import { cifrasSinDato } from './cinco-agentes-cifras-modelo';

// LA PUERTA REAL: aquí NO se mockea `inicio-cinco-lectores`. Solo se sustituye el lector de #777 (que lee archivos) y lo de abajo.
// Un rol sin dinero recibe datos de pesos «a mano» del lector y aun así el render no debe contener ninguna cifra ni «IAVE».
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useSearchParams: () => new URLSearchParams(''), useRouter: () => ({ refresh() {}, replace() {}, push() {} }) }));
vi.mock('./sin-flota', () => ({ AvisoSinFlota: () => null }));
const d = vi.hoisted(() => ({ cifras: vi.fn(), datos: vi.fn() }));
vi.mock('./cinco-agentes-cifras', () => ({ leerCifrasPesosCincoAgentes: (...a: unknown[]) => d.cifras(...a) }));
vi.mock('@/lib/likida/agentes/corridas', () => ({ ultimasCorridas: async () => [] }));
vi.mock('@/lib/likida/analytics', () => ({ contarViajes: async () => 2 }));
vi.mock('./resumen-datos', async () => ({ ...(await import('./resumen-modelo')), leerDatosResumen: (...a: unknown[]) => d.datos(...a) }));
vi.mock('@/lib/likida/asistente/senales', () => ({ leerSenalesAsistente: async () => ({ tms: null, archivosRecibidos: null, correoPlataforma: null, correoDesglose: null, operadores: null, unidadesActivas: null, patios: null, coordinadores: null, supervisores: null, revisorCartaPorte: null }) }));

const PESOS: CifrasPesosCincoAgentes = {
  importeDecena: { valor: 3306107, valorTexto: '$3.3 M', periodo: '1 al 10 de octubre de 2026', fuente: 'Reporte IAVE', sello: 'Medido', decenasFaltantes: [], decenasSinCruces: [], rotulo: 'r', reintentar: false, motivo: null, cruces: 9177, anterior: null },
  extemporaneos: { valor: 12511, valorTexto: '$12,511', periodo: 'octubre de 2026', fuente: 'Reporte IAVE', sello: 'Estimado', decenasFaltantes: [], decenasSinCruces: [], rotulo: '26 candidatos', reintentar: false, motivo: null, n: 26 },
};
const DATOS = { rango: '30', hoy: '2026-10-31', veDinero: false, peajes: null, porTipo: null, kpis: { viajesLiquidados: 4, montoComprobado: 0, diferenciaDetectada: 0, conDiferencias: 0, porRevisar: 1, tasaCuadre: 100 }, cartaPorte: { completas: 1, total: 2 }, cierres: [], hechos: [], escalados: 0 };

const { InicioCincoV2 } = await import('./inicio-cinco-v2');
async function html(rol: string): Promise<string> {
  const el = await InicioCincoV2({ tenantId: 't-1', userId: 'u-1', tenantNombre: null, nombre: 'Ana', tenantExiste: true, sufijo: '', soloLectura: false, veAsistente: false, rol } as never);
  const f = await renderToReadableStream(el);
  await f.allReady;
  return (await new Response(f).text()).replace(/<script[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, ' ');
}

beforeEach(() => { d.cifras.mockReset().mockResolvedValue(PESOS); d.datos.mockReset().mockResolvedValue(DATOS); });

describe('la puerta REAL de pesos del Inicio', () => {
  for (const rol of ['encargado', 'nomina', 'vendedor', 'rol-desconocido']) {
    it(`${rol}: aunque el lector devuelva pesos, no hay cifra ni IAVE, y ni siquiera se consulta`, async () => {
      const t = await html(rol);
      expect(d.cifras).not.toHaveBeenCalled();
      expect(t).not.toMatch(/\$\s?\d/);
      expect(t).not.toContain('IAVE');
      expect(t).not.toContain('3,306,107');
      expect(t).not.toContain('Cobros extemporáneos');
    });
  }
  it('el dueño sí pasa la puerta y ve los pesos', async () => {
    const t = await html('flota_admin');
    expect(d.cifras).toHaveBeenCalledTimes(1);
    expect(t).toContain('$3,306,107');
  });
});

describe('cache por flota (unstable_cache activado en la prueba)', () => {
  const memo = new Map<string, unknown>();
  const llaves: string[] = [];
  async function cargar() {
    vi.resetModules();
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.doMock('next/cache', () => ({
      unstable_cache: (fn: (...a: never[]) => Promise<unknown>, kp: string[]) => async (...args: never[]) => {
        const k = JSON.stringify([kp, args]);
        llaves.push(k);
        if (memo.has(k)) return memo.get(k);
        const v = await fn(...args); // si lanza (fallo o Sin dato) NO se memoriza, como en Next
        memo.set(k, v);
        return v;
      },
    }));
    return import('./inicio-cinco-lectores');
  }
  beforeEach(() => { memo.clear(); llaves.length = 0; });

  it('la llave es solo la flota; flotas distintas no se mezclan y la misma flota lee una vez', async () => {
    const { leerPesosInicio } = await cargar();
    await leerPesosInicio('t-A', 'flota_admin'); await leerPesosInicio('t-A', 'superadmin'); await leerPesosInicio('t-B', 'flota_admin');
    expect(d.cifras).toHaveBeenCalledTimes(2);
    expect(d.cifras.mock.calls.map((c) => c[0])).toEqual(['t-A', 't-B']);
    expect(llaves.every((k) => !/flota_admin|superadmin|contador/.test(k))).toBe(true);
  });
  it('un rol sin dinero jamás llega al cache', async () => {
    const { leerPesosInicio } = await cargar();
    for (const rol of ['encargado', 'nomina', 'vendedor']) expect(await leerPesosInicio('t-A', rol)).toBeNull();
    expect(llaves).toEqual([]);
    expect(d.cifras).not.toHaveBeenCalled();
  });
  it('un fallo y un «Sin dato» (falta el archivo) NO se cachean: la siguiente lectura vuelve a leer', async () => {
    const { leerPesosInicio } = await cargar();
    d.cifras.mockResolvedValueOnce(cifrasSinDato('No se pudo leer el estado de cuenta.', true)).mockResolvedValueOnce(cifrasSinDato('No hay estado de cuenta IAVE cargado.', false)).mockResolvedValueOnce(PESOS);
    expect((await leerPesosInicio('t-A', 'flota_admin'))?.cifras.importeDecena.reintentar).toBe(true);
    expect((await leerPesosInicio('t-A', 'flota_admin'))?.cifras.importeDecena.motivo).toContain('No hay estado');
    expect((await leerPesosInicio('t-A', 'flota_admin'))?.cifras.importeDecena.valor).toBe(3306107);
    expect(d.cifras).toHaveBeenCalledTimes(3);
  });
  it('si solo falla UNA cifra, conserva la buena y no se cachea', async () => {
    const { leerPesosInicio } = await cargar();
    const mixto = { ...PESOS, extemporaneos: { ...cifrasSinDato('x', true).extemporaneos } };
    d.cifras.mockResolvedValueOnce(mixto);
    const r = await leerPesosInicio('t-A', 'flota_admin');
    expect(r?.cifras.importeDecena.valor).toBe(3306107);
    expect(r?.cifras.extemporaneos).toMatchObject({ valor: null, reintentar: true });
  });
});
