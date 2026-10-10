import { describe, it, expect, vi, beforeEach } from 'vitest';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));
const respuestas = new Map<string, { data: unknown; error: { message: string } | null } | 'lanza'>();
const rpc = vi.fn(async (nombre: string, _args?: Record<string, unknown>) => {
  const r = respuestas.get(nombre);
  if (r === 'lanza') throw new Error('red caída');
  return r ?? { data: 0, error: null };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc }) }));

const { mantenerDatosAgentes, PLAZOS_AGENTES } = await import('./retencion_agentes');

beforeEach(() => { respuestas.clear(); rpc.mockClear(); Object.values(logger).forEach((f) => f.mockClear()); });

describe('mantenerDatosAgentes', () => {
  it('llama las CUATRO purgas con su plazo y devuelve el conteo real de cada una', async () => {
    respuestas.set('purgar_wa_ventana_contacto', { data: 12, error: null });
    respuestas.set('purgar_wa_envio_registro', { data: 3, error: null });
    respuestas.set('purgar_liquidacion_externa', { data: { borradas: 2, pdfsEncolados: 2, parcial: false }, error: null });
    respuestas.set('purgar_peaje_archivos_fallidos', { data: { vaciados: 1, parcial: false }, error: null });
    const r = await mantenerDatosAgentes(new Date('2026-10-01T12:00:00Z'));
    expect(r.map((x) => [x.nombre, x.ok, x.filas])).toEqual([
      ['wa_ventana_contacto', true, 12], ['wa_envio_registro', true, 3], ['liquidacion_externa', true, 2], ['peaje_archivos_fallidos', true, 1],
    ]);
    expect(rpc).toHaveBeenCalledWith('purgar_wa_ventana_contacto', { p_dias: PLAZOS_AGENTES.waVentanaDias, p_limite: PLAZOS_AGENTES.limite });
    expect(rpc).toHaveBeenCalledWith('purgar_liquidacion_externa', { p_meses: 60, p_limite: 500, p_ahora: '2026-10-01T12:00:00.000Z' });
    expect(rpc).toHaveBeenCalledWith('purgar_peaje_archivos_fallidos', { p_dias: 30, p_limite: 500, p_ahora: '2026-10-01T12:00:00.000Z' });
  });

  it('el plazo de liquidaciones nunca baja del piso fiscal de la migración (24 meses) ni de cinco años', () => {
    expect(PLAZOS_AGENTES.liquidacionExternaMeses).toBeGreaterThanOrEqual(60);
  });

  it('marca parcial cuando la purga llenó su tope (queda trabajo para mañana)', async () => {
    respuestas.set('purgar_wa_ventana_contacto', { data: PLAZOS_AGENTES.limite, error: null });
    respuestas.set('purgar_liquidacion_externa', { data: { borradas: 500, parcial: true }, error: null });
    const r = await mantenerDatosAgentes();
    expect(r.find((x) => x.nombre === 'wa_ventana_contacto')?.parcial).toBe(true);
    expect(r.find((x) => x.nombre === 'liquidacion_externa')?.parcial).toBe(true);
    expect(r.find((x) => x.nombre === 'wa_envio_registro')?.parcial).toBe(false);
  });

  it('una purga que falla NO tumba a las demás y su error sale dicho (no un cero)', async () => {
    respuestas.set('purgar_wa_envio_registro', { data: null, error: { message: 'boom' } });
    respuestas.set('purgar_liquidacion_externa', 'lanza');
    respuestas.set('purgar_peaje_archivos_fallidos', { data: { vaciados: 0, parcial: false }, error: null });
    const r = await mantenerDatosAgentes();
    expect(r).toHaveLength(4);
    expect(r[1]).toMatchObject({ nombre: 'wa_envio_registro', ok: false, filas: null, error: 'boom' });
    expect(r[2]).toMatchObject({ nombre: 'liquidacion_externa', ok: false, filas: null, error: 'red caída' });
    expect(r[0].ok).toBe(true);
    expect(r[3].ok).toBe(true);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('una respuesta que no se entiende no se lee como «cero filas»', async () => {
    respuestas.set('purgar_wa_ventana_contacto', { data: 'raro', error: null });
    respuestas.set('purgar_peaje_archivos_fallidos', { data: {}, error: null });
    const r = await mantenerDatosAgentes();
    expect(r[0]).toMatchObject({ ok: false, error: 'respuesta_invalida', filas: null });
    expect(r[3]).toMatchObject({ ok: false, error: 'respuesta_invalida', filas: null });
  });
});
