import { describe, it, expect, vi, beforeEach } from 'vitest';

// OLA 10 · A2P-05: `sin_destinatario` y la ventana de 24 h cerrada NO consumen intentos del aviso a la oficina.

const estado = { anulado: false, avisoEn: null as string | null, intentos: 2, proveedor: 'Proveedor Uno', periodoDesde: '2026-10-01', periodoHasta: '2026-10-07' };
const reclamar = vi.fn(async (..._a: unknown[]) => true);
const devolver = vi.fn(async (..._a: unknown[]) => true);
const requerido = vi.fn(async (..._a: unknown[]) => {});
const posponer = vi.fn(async (..._a: unknown[]) => ({ esperas: 1, salioDeLaCola: false }) as { esperas: number; salioDeLaCola: boolean } | null);
vi.mock('./datos', () => ({
  MAX_INTENTOS_AVISO: 5,
  leerEstadoAvisoDesglose: vi.fn(async () => ({ ...estado })),
  reclamarIntentoAviso: (...a: unknown[]) => reclamar(...a),
  devolverIntentoAviso: (...a: unknown[]) => devolver(...a),
  marcarAvisoRequerido: (...a: unknown[]) => requerido(...a),
  posponerAviso: (...a: unknown[]) => posponer(...a),
  marcarAvisoEnviado: vi.fn(async () => true),
  agotarIntentosAviso: vi.fn(async () => true),
  avisosPendientesPeajes: vi.fn(async () => []),
}));
vi.mock('./bitacora_conciliada', () => ({
  bitacoraConciliada: vi.fn(async () => ({ filas: [{ gps: 'no coincide' }], resumen: { sinRespaldo: 1, porVerificar: 0 } })),
}));
vi.mock('../contactos', () => ({ telefonoParaDineroDe: vi.fn(async () => '5215500000000') }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.ejemplo.test' }));
const logError = vi.fn();
const logWarn = vi.fn();
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: (...a: unknown[]) => logWarn(...a), error: (...a: unknown[]) => logError(...a) } }));
vi.mock('@/lib/meta/aviso_oficina', () => ({ avisarOficina: vi.fn(), parametrosAvisoOficina: (a: string, b: string, c: string) => [a, b, c] }));

const { avisarDesgloseConciliado } = await import('./aviso_oficina');
const { SUPERFICIE_PEAJES_COMPLETA } = await import('./superficie_perfil');
type Deps = Parameters<typeof avisarDesgloseConciliado>[2];
const avisar = vi.fn();
const base = { avisar, superficie: async () => SUPERFICIE_PEAJES_COMPLETA };

beforeEach(() => { reclamar.mockClear(); devolver.mockClear(); avisar.mockReset(); posponer.mockClear(); logError.mockClear(); logWarn.mockClear(); });

describe('A2P-05: intentos del aviso a la oficina', () => {
  it('sin teléfono configurado no se consume ningún intento (y avisa cuando se configure)', async () => {
    const deps = { ...base, telefono: async () => null } as unknown as Deps;
    for (let i = 0; i < 8; i++) expect(await avisarDesgloseConciliado('t1', 'd1', deps)).toBe('sin_destinatario');
    expect(reclamar).not.toHaveBeenCalled();
    expect(avisar).not.toHaveBeenCalled();
    // ...pero queda marcado como pendiente para que el barrido lo encuentre al configurar el teléfono
    expect(requerido).toHaveBeenCalledWith('t1', 'd1');
  });

  it('con la ventana de 24 h cerrada y la plantilla sin aprobar, el intento se devuelve', async () => {
    avisar.mockResolvedValue({ ok: false, motivo: 'plantilla no aprobada', codigo: 132001, fueraDeVentana: true, reintentable: false });
    const deps = { ...base, telefono: async () => '5215500000000' } as unknown as Deps;
    expect(await avisarDesgloseConciliado('t1', 'd1', deps)).toBe('rechazado');
    expect(reclamar).toHaveBeenCalledWith('t1', 'd1', 2);
    expect(devolver).toHaveBeenCalledWith('t1', 'd1', 2);
  });

  it('un rechazo definitivo con la ventana abierta SÍ consume el intento', async () => {
    avisar.mockResolvedValue({ ok: false, motivo: 'número inválido', codigo: 131026, fueraDeVentana: false, reintentable: false });
    const deps = { ...base, telefono: async () => '5215500000000' } as unknown as Deps;
    expect(await avisarDesgloseConciliado('t1', 'd1', deps)).toBe('rechazado');
    expect(devolver).not.toHaveBeenCalled();
  });

  // H759-1: un desglose bloqueado por configuración se APARTA (backoff + tope) para no acaparar la cola global de todas las flotas.
  it('sin teléfono: el desglose se aparta con backoff (posponerAviso) en vez de quedar siempre elegible', async () => {
    const deps = { ...base, telefono: async () => null } as unknown as Deps;
    expect(await avisarDesgloseConciliado('t1', 'd1', deps)).toBe('sin_destinatario');
    expect(posponer).toHaveBeenCalledTimes(1);
    expect(posponer).toHaveBeenCalledWith('t1', 'd1');
    expect(avisar).not.toHaveBeenCalled();
  });

  it('plantilla sin aprobar (fuera de ventana): se aparta, no es un error de Sentry y el intento se devuelve', async () => {
    avisar.mockResolvedValue({ ok: false, motivo: 'plantilla no aprobada', codigo: 132001, fueraDeVentana: true, reintentable: false });
    const deps = { ...base, telefono: async () => '5215500000000' } as unknown as Deps;
    expect(await avisarDesgloseConciliado('t1', 'd1', deps)).toBe('rechazado');
    expect(posponer).toHaveBeenCalledWith('t1', 'd1');
    expect(devolver).toHaveBeenCalledTimes(1);
    expect(logError).not.toHaveBeenCalled();
  });

  it('un rechazo definitivo con la ventana abierta NO se aparta (consume el intento y sigue siendo error)', async () => {
    avisar.mockResolvedValue({ ok: false, motivo: 'número inválido', codigo: 131026, fueraDeVentana: false, reintentable: false });
    const deps = { ...base, telefono: async () => '5215500000000' } as unknown as Deps;
    await avisarDesgloseConciliado('t1', 'd1', deps);
    expect(posponer).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalled();
  });

  it('al salir de la cola por el tope se deja constancia una vez', async () => {
    posponer.mockResolvedValueOnce({ esperas: 12, salioDeLaCola: true });
    const deps = { ...base, telefono: async () => null } as unknown as Deps;
    await avisarDesgloseConciliado('t1', 'd1', deps);
    expect(logWarn).toHaveBeenCalledWith('peajes.aviso_bloqueado_sale_de_la_cola', expect.objectContaining({ desglose: 'd1', esperas: 12 }));
  });
});
