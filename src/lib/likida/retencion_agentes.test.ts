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
  it('llama las SIETE purgas con su plazo y devuelve el conteo real de cada una', async () => {
    respuestas.set('purgar_wa_ventana_contacto', { data: 12, error: null });
    respuestas.set('purgar_wa_envio_registro', { data: 3, error: null });
    respuestas.set('purgar_liquidacion_externa', { data: { borradas: 2, pdfsEncolados: 2, parcial: false }, error: null });
    respuestas.set('purgar_peaje_archivos_fallidos', { data: { vaciados: 1, parcial: false }, error: null });
    respuestas.set('purgar_liquidacion_entrega_correo', { data: { purgadas: 4, archivosEncolados: 3, parcial: false }, error: null });
    respuestas.set('purgar_liquidacion_entrega_correo_residuos', { data: { limpiadas: 2, atascadasCerradas: 1, archivosEncolados: 1, parcial: false }, error: null });
    respuestas.set('purgar_programa_despacho', { data: { cambios: 5, comentariosVaciados: 2, cargas: 1, parcial: false }, error: null });
    const r = await mantenerDatosAgentes(new Date('2026-10-01T12:00:00Z'));
    expect(r.map((x) => [x.nombre, x.ok, x.filas])).toEqual([
      ['wa_ventana_contacto', true, 12], ['wa_envio_registro', true, 3], ['liquidacion_externa', true, 2], ['peaje_archivos_fallidos', true, 1], ['liquidacion_entrega_correo', true, 4],
      ['liquidacion_entrega_correo_residuos', true, 3], ['programa_despacho', true, 8],
    ]);
    expect(rpc).toHaveBeenCalledWith('purgar_liquidacion_entrega_correo_residuos', { p_meses: 13, p_limite: 500, p_ahora: '2026-10-01T12:00:00.000Z' });
    expect(rpc).toHaveBeenCalledWith('purgar_programa_despacho', { p_meses: PLAZOS_AGENTES.programaDespachoMeses, p_limite: 1000, p_ahora: '2026-10-01T12:00:00.000Z' });
    expect(rpc).toHaveBeenCalledWith('purgar_wa_ventana_contacto', { p_dias: PLAZOS_AGENTES.waVentanaDias, p_limite: PLAZOS_AGENTES.limite });
    expect(rpc).toHaveBeenCalledWith('purgar_liquidacion_externa', { p_meses: 60, p_limite: 500, p_ahora: '2026-10-01T12:00:00.000Z' });
    expect(rpc).toHaveBeenCalledWith('purgar_peaje_archivos_fallidos', { p_dias: 30, p_limite: 500, p_ahora: '2026-10-01T12:00:00.000Z' });
    expect(rpc).toHaveBeenCalledWith('purgar_liquidacion_entrega_correo', { p_meses: 13, p_limite: 500, p_ahora: '2026-10-01T12:00:00.000Z' });
  });

  it('la entrega por correo se retiene ≈1 año (piso 12 de la migración) y NO acorta liquidacion_externa', () => {
    expect(PLAZOS_AGENTES.liquidacionEntregaCorreoMeses).toBeGreaterThanOrEqual(12);
    expect(PLAZOS_AGENTES.liquidacionEntregaCorreoMeses).toBeLessThanOrEqual(15);
    expect(PLAZOS_AGENTES.liquidacionExternaMeses).toBeGreaterThanOrEqual(60);
  });

  it('la purga de la entrega por correo marca parcial si llenó su tope y su fallo no tumba a las otras', async () => {
    respuestas.set('purgar_liquidacion_entrega_correo', { data: { purgadas: 500, archivosEncolados: 500, parcial: true }, error: null });
    let r = await mantenerDatosAgentes();
    expect(r.find((x) => x.nombre === 'liquidacion_entrega_correo')).toMatchObject({ ok: true, filas: 500, parcial: true });
    respuestas.set('purgar_liquidacion_externa', { data: { borradas: 0, parcial: false }, error: null });
    respuestas.set('purgar_peaje_archivos_fallidos', { data: { vaciados: 0, parcial: false }, error: null });
    respuestas.set('purgar_liquidacion_entrega_correo', { data: null, error: { message: 'no existe la función' } });
    respuestas.set('purgar_liquidacion_entrega_correo_residuos', { data: { limpiadas: 0, atascadasCerradas: 0, parcial: false }, error: null });
    respuestas.set('purgar_programa_despacho', { data: { cambios: 0, comentariosVaciados: 0, cargas: 0, parcial: false }, error: null });
    r = await mantenerDatosAgentes();
    expect(r.find((x) => x.nombre === 'liquidacion_entrega_correo')).toMatchObject({ ok: false, filas: null, error: 'no existe la función' });
    expect(r.filter((x) => x.ok)).toHaveLength(6);
    respuestas.set('purgar_liquidacion_entrega_correo', { data: {}, error: null });
    r = await mantenerDatosAgentes();
    expect(r.find((x) => x.nombre === 'liquidacion_entrega_correo')).toMatchObject({ ok: false, error: 'respuesta_invalida' });
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
    expect(r).toHaveLength(7);
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

  it('A37-S62-07/08: las purgas nuevas (0890) marcan parcial, suman todas sus partes y una respuesta incompleta no es «cero»', async () => {
    respuestas.set('purgar_liquidacion_entrega_correo_residuos', { data: { limpiadas: 500, atascadasCerradas: 0, parcial: true }, error: null });
    respuestas.set('purgar_programa_despacho', { data: { cambios: 1000, comentariosVaciados: 0, cargas: 0, parcial: true }, error: null });
    let r = await mantenerDatosAgentes();
    expect(r.find((x) => x.nombre === 'liquidacion_entrega_correo_residuos')).toMatchObject({ ok: true, filas: 500, parcial: true });
    expect(r.find((x) => x.nombre === 'programa_despacho')).toMatchObject({ ok: true, filas: 1000, parcial: true });
    respuestas.set('purgar_liquidacion_entrega_correo_residuos', { data: { limpiadas: 3 }, error: null });
    respuestas.set('purgar_programa_despacho', { data: { cambios: 2, cargas: 1 }, error: null });
    r = await mantenerDatosAgentes();
    expect(r.find((x) => x.nombre === 'liquidacion_entrega_correo_residuos')).toMatchObject({ ok: false, error: 'respuesta_invalida' });
    expect(r.find((x) => x.nombre === 'programa_despacho')).toMatchObject({ ok: false, error: 'respuesta_invalida' });
  });

  it('A37-S62-07: el programa de despacho se retiene al menos 6 meses (piso de la función) y no más de 24', () => {
    expect(PLAZOS_AGENTES.programaDespachoMeses).toBeGreaterThanOrEqual(6);
    expect(PLAZOS_AGENTES.programaDespachoMeses).toBeLessThanOrEqual(24);
  });
});
