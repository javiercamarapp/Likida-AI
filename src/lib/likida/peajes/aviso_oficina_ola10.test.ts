import { describe, it, expect, vi, beforeEach } from 'vitest';

// OLA 10 · A2P-05: `sin_destinatario` y la ventana de 24 h cerrada NO consumen intentos del aviso a la oficina.

const estado = { anulado: false, avisoEn: null as string | null, intentos: 2, proveedor: 'Proveedor Uno', periodoDesde: '2026-10-01', periodoHasta: '2026-10-07' };
const reclamar = vi.fn(async (..._a: unknown[]) => true);
const devolver = vi.fn(async (..._a: unknown[]) => true);
const requerido = vi.fn(async (..._a: unknown[]) => {});
vi.mock('./datos', () => ({
  MAX_INTENTOS_AVISO: 5,
  leerEstadoAvisoDesglose: vi.fn(async () => ({ ...estado })),
  reclamarIntentoAviso: (...a: unknown[]) => reclamar(...a),
  devolverIntentoAviso: (...a: unknown[]) => devolver(...a),
  marcarAvisoRequerido: (...a: unknown[]) => requerido(...a),
  marcarAvisoEnviado: vi.fn(async () => true),
  agotarIntentosAviso: vi.fn(async () => true),
  avisosPendientesPeajes: vi.fn(async () => []),
}));
vi.mock('./bitacora_conciliada', () => ({
  bitacoraConciliada: vi.fn(async () => ({ filas: [{ gps: 'no coincide' }], resumen: { sinRespaldo: 1, porVerificar: 0 } })),
}));
vi.mock('../contactos', () => ({ telefonoParaDineroDe: vi.fn(async () => '5215500000000') }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.ejemplo.test' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/meta/aviso_oficina', () => ({ avisarOficina: vi.fn(), parametrosAvisoOficina: (a: string, b: string, c: string) => [a, b, c] }));

const { avisarDesgloseConciliado } = await import('./aviso_oficina');
const { SUPERFICIE_PEAJES_COMPLETA } = await import('./superficie_perfil');
type Deps = Parameters<typeof avisarDesgloseConciliado>[2];
const avisar = vi.fn();
const base = { avisar, superficie: async () => SUPERFICIE_PEAJES_COMPLETA };

beforeEach(() => { reclamar.mockClear(); devolver.mockClear(); avisar.mockReset(); });

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
});
