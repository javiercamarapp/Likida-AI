import { describe, it, expect, vi, beforeEach } from 'vitest';
import { barridoVigia } from './servicio';
import { escenario, RepoEnMemoria } from './repo.fixture';
import { AHORA, T1, T2 } from './datos.fixture';
import type { ContextoAvisosFlota, DepsVigia } from './puertos';
import type { AvisoParaEntrega, DepsEntrega, ResultadoEntrega } from './aviso/entrega';
import type { DepsGenerar, ResultadoGeneracion } from './aviso/generar';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const generar = vi.fn();
const entregar = vi.fn();
vi.mock('./aviso/generar', () => ({ generarAvisos: (...a: unknown[]) => generar(...a) }));
vi.mock('./aviso/entrega', () => ({ entregarAviso: (...a: unknown[]) => entregar(...a) }));

// La pasada de avisos DENTRO del barrido (T-A4-21): corre solo en el mantenimiento (minuto múltiplo de 5), va después del
// escalamiento, devuelve contadores, respeta el reloj y un error suyo no tumba el barrido.

const gen = (o: Partial<ResultadoGeneracion> = {}): ResultadoGeneracion => ({
  estado: 'ok', leidas: 0, yaTenian: 0, noListas: 0, muyTemprano: 0, citaPasada: 0, creados: 0, pendientesConfirmacion: 0,
  aprobados: 0, sinDestinatario: 0, duplicados: 0, omitidas: 0, acotada: false, ...o,
});
const aviso = (tenantId: string, n: number): AvisoParaEntrega => ({
  id: `a-${tenantId.slice(-1)}-${n}`, tenantId, filaId: `f-${n}`, clienteId: null, version: 1, estado: 'aprobado',
  canal: 'ejecutivo_copia', texto: 'texto sintético', datos: {},
});
const flota = (tenantId: string, avisos: AvisoParaEntrega[]): ContextoAvisosFlota => ({
  tenantId, generar: { marca: 'generar' } as unknown as DepsGenerar, entrega: { marca: 'entrega' } as unknown as DepsEntrega,
  aprobados: vi.fn(async () => avisos),
});

function armar(flotas: ContextoAvisosFlota[] | Error, repo: RepoEnMemoria = escenario().repo) {
  const puerto = { flotas: vi.fn(async () => { if (flotas instanceof Error) throw flotas; return flotas; }) };
  const deps: DepsVigia = { repo, ahora: () => AHORA, avisos: puerto };
  return { deps, puerto };
}

beforeEach(() => { generar.mockReset(); entregar.mockReset(); generar.mockResolvedValue(gen()); });

describe('barridoVigia · pasada de avisos', () => {
  it('suma creados / enviados / fallidos / omitidos de todas las flotas', async () => {
    const f1 = flota(T1, [aviso(T1, 1), aviso(T1, 2), aviso(T1, 3)]);
    const f2 = flota(T2, [aviso(T2, 1), aviso(T2, 2)]);
    generar.mockResolvedValueOnce(gen({ creados: 4 })).mockResolvedValueOnce(gen({ creados: 1 }));
    const res: ResultadoEntrega[] = [
      { estado: 'enviado', via: 'plantilla' }, { estado: 'avisado_ejecutivo', via: 'texto' },
      { estado: 'fallido', motivo: 'x', mensaje: 'y' },
      { estado: 'diferido', motivo: 'fuera_de_ventana' }, { estado: 'perdido' },
    ];
    for (const r of res) entregar.mockResolvedValueOnce(r);
    const { deps } = armar([f1, f2]);
    const r = await barridoVigia(deps, { mantenimiento: true });
    expect(r).toMatchObject({ avisosCreados: 5, avisosEnviados: 2, avisosFallidos: 1, avisosOmitidos: 2, avisosConError: false });
    expect(generar).toHaveBeenCalledWith(T1, AHORA, f1.generar);
    expect(generar).toHaveBeenCalledWith(T2, AHORA, f2.generar);
    expect(entregar).toHaveBeenCalledTimes(5);
    expect(entregar).toHaveBeenCalledWith(expect.objectContaining({ id: 'a-1-1' }), f1.entrega, 'automatico');
  });

  it('en minutos que no son múltiplo de 5 (mantenimiento apagado) no corre ni consulta nada', async () => {
    const { deps, puerto } = armar([flota(T1, [aviso(T1, 1)])]);
    const r = await barridoVigia(deps, { mantenimiento: false });
    expect(puerto.flotas).not.toHaveBeenCalled();
    expect(generar).not.toHaveBeenCalled();
    expect(entregar).not.toHaveBeenCalled();
    expect(r).toMatchObject({ avisosCreados: 0, avisosEnviados: 0, avisosFallidos: 0, avisosOmitidos: 0, avisosConError: false });
  });

  it('sin puerto de avisos el barrido es el de siempre', async () => {
    const r = await barridoVigia({ repo: escenario().repo, ahora: () => AHORA }, { mantenimiento: true });
    expect(r).toMatchObject({ avisosCreados: 0, avisosConError: false });
  });

  it('si el módulo de avisos lanza, el escalamiento y el mantenimiento ya corrieron y el resultado lo marca', async () => {
    const { repo } = escenario();
    const { deps } = armar(new Error('base de avisos caída'), repo);
    const r = await barridoVigia(deps, { mantenimiento: true });
    expect(repo.purgas).toBe(1);
    expect(r.avisosConError).toBe(true);
  });

  it('un error en una flota no impide la siguiente; un error en una entrega cuenta como fallida y sigue', async () => {
    const f1 = flota(T1, [aviso(T1, 1), aviso(T1, 2)]);
    const f2 = flota(T2, [aviso(T2, 1)]);
    generar.mockRejectedValueOnce(new Error('sin resolver')).mockResolvedValueOnce(gen({ creados: 1 }));
    entregar.mockResolvedValue({ estado: 'enviado', via: 'plantilla' });
    const { deps } = armar([f1, f2]);
    const r = await barridoVigia(deps, { mantenimiento: true });
    expect(r).toMatchObject({ avisosConError: true, avisosCreados: 1, avisosEnviados: 1 });
    expect(f1.aprobados).not.toHaveBeenCalled();

    generar.mockResolvedValue(gen());
    entregar.mockReset();
    entregar.mockRejectedValueOnce(new Error('meta')).mockResolvedValueOnce({ estado: 'enviado', via: 'texto' });
    const { deps: d2 } = armar([flota(T1, [aviso(T1, 1), aviso(T1, 2)])]);
    const r2 = await barridoVigia(d2, { mantenimiento: true });
    expect(r2).toMatchObject({ avisosFallidos: 1, avisosEnviados: 1, avisosConError: true });
  });

  it('respeta el reloj: con el tiempo vencido no genera ni entrega y marca el corte', async () => {
    const f = flota(T1, [aviso(T1, 1)]);
    const { deps } = armar([f]);
    const r = await barridoVigia(deps, { mantenimiento: true, vencePorReloj: Date.now() - 1 });
    expect(generar).not.toHaveBeenCalled();
    expect(entregar).not.toHaveBeenCalled();
    expect(r.cortadoPorReloj).toBe(true);
  });

  it('el reloj se vuelve a mirar entre avisos', async () => {
    const f = flota(T1, [aviso(T1, 1), aviso(T1, 2), aviso(T1, 3)]);
    const limite = Date.now() + 60_000;
    entregar.mockImplementationOnce(async () => { vi.setSystemTime(limite + 1); return { estado: 'enviado', via: 'texto' }; });
    vi.useFakeTimers();
    try {
      vi.setSystemTime(limite - 1000);
      const { deps } = armar([f]);
      const r = await barridoVigia(deps, { mantenimiento: true, vencePorReloj: limite });
      expect(entregar).toHaveBeenCalledTimes(1);
      expect(r).toMatchObject({ avisosEnviados: 1, cortadoPorReloj: true });
    } finally { vi.useRealTimers(); }
  });
});
