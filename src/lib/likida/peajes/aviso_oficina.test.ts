import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-S51-03 y A37-S51-04: el aviso de peajes a la oficina no se reenvía ni cuando el sello falla después de enviar ni
// cuando el envío quedó en el outbox. Todo sintético.

const estado = { anulado: false, avisoEn: null as string | null, intentos: 0, proveedor: 'Proveedor Uno', periodoDesde: '2026-10-01', periodoHasta: '2026-10-07' };
const sello = vi.fn(async (..._a: unknown[]) => true);
const agotar = vi.fn(async (..._a: unknown[]) => true);
vi.mock('./datos', () => ({
  MAX_INTENTOS_AVISO: 5,
  leerEstadoAvisoDesglose: vi.fn(async () => ({ ...estado })),
  reclamarIntentoAviso: vi.fn(async () => true),
  marcarAvisoEnviado: (...a: unknown[]) => sello(...a),
  agotarIntentosAviso: (...a: unknown[]) => agotar(...a),
  avisosPendientesPeajes: vi.fn(async () => []),
}));
vi.mock('./bitacora_conciliada', () => ({
  bitacoraConciliada: vi.fn(async () => ({ filas: [{ gps: 'no coincide' }], resumen: { sinRespaldo: 1, porVerificar: 0 } })),
}));
vi.mock('../contactos', () => ({ telefonoParaDineroDe: vi.fn(async () => '5215500000000') }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.ejemplo.test' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/meta/aviso_oficina', () => ({ avisarOficina: vi.fn(), parametrosAvisoOficina: (a: string, b: string, c: string) => [a, b, c] }));

const { avisarDesgloseConciliado, contarParaAviso, COBERTURA_MINIMA_TICKETS } = await import('./aviso_oficina');
const { SUPERFICIE_PEAJES_COMPLETA, SUPERFICIE_PEAJES_RESTRINGIDA } = await import('./superficie_perfil');
const { bitacoraConciliada } = await import('./bitacora_conciliada');
type Deps = Parameters<typeof avisarDesgloseConciliado>[2];
const avisar = vi.fn();
const deps = { telefono: async () => '5215500000000', avisar, superficie: async () => SUPERFICIE_PEAJES_COMPLETA } as unknown as Deps;

beforeEach(() => { sello.mockReset(); sello.mockResolvedValue(true); agotar.mockReset(); agotar.mockResolvedValue(true); avisar.mockReset(); });

describe('avisarDesgloseConciliado', () => {
  it('A37-S51-03: si el sello falla después de enviar, se reintenta una vez; si sigue fallando se agotan los intentos (no se reenvía)', async () => {
    avisar.mockResolvedValue({ ok: true, via: 'texto', id: 'w' });
    sello.mockResolvedValue(false);
    expect(await avisarDesgloseConciliado('t1', 'd1', deps)).toBe('enviado');
    expect(sello).toHaveBeenCalledTimes(2);
    expect(agotar).toHaveBeenCalledWith('t1', 'd1', 5);
  });

  it('A37-S51-03: con el sello bien no se agotan los intentos; un solo fallo del sello se salva con el reintento', async () => {
    avisar.mockResolvedValue({ ok: true, via: 'texto', id: 'w' });
    sello.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await avisarDesgloseConciliado('t1', 'd1', deps)).toBe('enviado');
    expect(agotar).not.toHaveBeenCalled();
  });

  it('A37-S51-04: un envío no-ok pero ENCOLADO (reintentable o token vencido) se sella como enviado, no se reintenta', async () => {
    for (const r of [{ reintentable: true }, { reintentable: false, encolado: true }]) {
      sello.mockClear();
      avisar.mockResolvedValue({ ok: false, motivo: 'x', codigo: 190, fueraDeVentana: false, ...r });
      expect(await avisarDesgloseConciliado('t1', 'd1', deps)).toBe('enviado');
      expect(sello).toHaveBeenCalledTimes(1);
    }
  });

  it('un rechazo definitivo (ni reintentable ni encolado) sigue siendo «rechazado» y no sella', async () => {
    avisar.mockResolvedValue({ ok: false, motivo: 'número inválido', codigo: 131026, fueraDeVentana: false, reintentable: false });
    expect(await avisarDesgloseConciliado('t1', 'd1', deps)).toBe('rechazado');
    expect(sello).not.toHaveBeenCalled();
  });
});

// ── A2 ola 1 (riesgo latente): el aviso no miraba el perfil ni la cobertura de tickets ──
describe('contarParaAviso: qué se avisa de verdad', () => {
  const b = (o: { filas?: Array<{ gps?: string }>; total: number; cuadra: number; sinRespaldo: number; porVerificar?: number }) =>
    ({ filas: o.filas ?? [], resumen: { total: o.total, cuadra: o.cuadra, sinRespaldo: o.sinRespaldo, porVerificar: o.porVerificar ?? 0 } });

  it('un solo ticket de caseta en el periodo y miles de cobros: NO se avisa de «miles sin respaldo» (no hay contra qué comparar)', () => {
    const r = contarParaAviso(b({ total: 9635, cuadra: 1, sinRespaldo: 9634 }), SUPERFICIE_PEAJES_COMPLETA);
    expect(r.conteo).toEqual({ gpsNoCoincide: 0, sinRespaldo: 0, porVerificar: 0 });
    expect(r.motivoOmitido).toBe('sin_cobertura_de_tickets');
  });
  it('con cobertura razonable (>= 5 % cuadró con un ticket) sí se avisa lo que falta', () => {
    expect(COBERTURA_MINIMA_TICKETS).toBe(0.05);
    const r = contarParaAviso(b({ total: 1000, cuadra: 600, sinRespaldo: 40, porVerificar: 3 }), SUPERFICIE_PEAJES_COMPLETA);
    expect(r.conteo).toEqual({ gpsNoCoincide: 0, sinRespaldo: 40, porVerificar: 3 });
    expect(r.motivoOmitido).toBeNull();
    expect(contarParaAviso(b({ total: 1000, cuadra: 50, sinRespaldo: 950 }), SUPERFICIE_PEAJES_COMPLETA).conteo.sinRespaldo).toBe(950); // justo en el umbral
  });
  it('perfil cinco_agentes: ni tickets ni GPS son de la flota (stand-by): no se avisa de ninguno', () => {
    const r = contarParaAviso(b({ filas: [{ gps: 'no coincide' }, { gps: 'confirma' }], total: 1000, cuadra: 900, sinRespaldo: 100, porVerificar: 5 }), SUPERFICIE_PEAJES_RESTRINGIDA);
    expect(r.conteo).toEqual({ gpsNoCoincide: 0, sinRespaldo: 0, porVerificar: 0 });
    expect(r.motivoOmitido).toBe('perfil_sin_tickets');
  });
  it('sin perfil el GPS «no coincide» se cuenta como siempre', () => {
    const r = contarParaAviso(b({ filas: [{ gps: 'no coincide' }, { gps: 'no coincide' }, { gps: 'confirma' }], total: 3, cuadra: 3, sinRespaldo: 0 }), SUPERFICIE_PEAJES_COMPLETA);
    expect(r.conteo.gpsNoCoincide).toBe(2);
  });
  it('un archivo vacío no divide entre cero', () => {
    expect(contarParaAviso(b({ total: 0, cuadra: 0, sinRespaldo: 0 }), SUPERFICIE_PEAJES_COMPLETA).conteo).toEqual({ gpsNoCoincide: 0, sinRespaldo: 0, porVerificar: 0 });
  });
});

describe('avisarDesgloseConciliado: respeta el perfil y la cobertura', () => {
  const conBitacora = (o: { filas?: Array<{ gps: string }>; total: number; cuadra: number; sinRespaldo: number }) =>
    vi.mocked(bitacoraConciliada).mockResolvedValueOnce({ filas: o.filas ?? [], resumen: { total: o.total, cuadra: o.cuadra, sinRespaldo: o.sinRespaldo, porVerificar: 0 } } as never);

  it('el caso real de A2: un solo gasto de caseta y ~9 600 cobros → «no_requerido», NO manda el aviso', async () => {
    conBitacora({ total: 9635, cuadra: 1, sinRespaldo: 9634 });
    expect(await avisarDesgloseConciliado('t1', 'd1', deps)).toBe('no_requerido');
    expect(avisar).not.toHaveBeenCalled();
  });
  it('flota con perfil cinco_agentes: tampoco avisa de tickets aunque cuadre bien', async () => {
    conBitacora({ total: 1000, cuadra: 900, sinRespaldo: 100 });
    const restringida = { ...deps, superficie: async () => SUPERFICIE_PEAJES_RESTRINGIDA } as unknown as Deps;
    expect(await avisarDesgloseConciliado('t1', 'd1', restringida)).toBe('no_requerido');
    expect(avisar).not.toHaveBeenCalled();
  });
  it('con cobertura real sí avisa, y el texto cuenta solo lo que se avisa', async () => {
    avisar.mockResolvedValue({ ok: true, via: 'texto', id: 'w' });
    conBitacora({ total: 1000, cuadra: 600, sinRespaldo: 12 });
    expect(await avisarDesgloseConciliado('t1', 'd1', deps)).toBe('enviado');
    expect(avisar.mock.calls[0][1]).toContain('12 cobros sin respaldo');
  });
});
