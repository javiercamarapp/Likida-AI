import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const respuestas = new Map<string, unknown[]>();
function builder(tabla: string) {
  const b: Record<string, unknown> = {};
  const resp = () => { const c = respuestas.get(tabla); return c && c.length ? c.shift() : { data: [], error: null }; };
  Object.assign(b, {
    select: () => b, eq: () => b, not: () => b, lt: () => b, order: () => b, limit: () => b,
    maybeSingle: () => Promise.resolve(resp()),
    then: (a: (x: unknown) => unknown, c: (e: unknown) => unknown) => Promise.resolve().then(resp).then(a, c),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));
const anotar = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: (...a: unknown[]) => anotar(...a) }));
const enviarCorreo = vi.fn(async (..._a: unknown[]): Promise<{ ok: boolean; motivo?: string }> => ({ ok: true }));
vi.mock('@/lib/correo/enviar', () => ({ enviarCorreo: (...a: unknown[]) => enviarCorreo(...a) }));
const enviarTexto = vi.fn(async (..._a: unknown[]): Promise<{ ok: boolean; error?: string }> => ({ ok: true }));
vi.mock('@/lib/meta/client', () => ({ enviarTexto: (...a: unknown[]) => enviarTexto(...a) }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.likida.ai' }));

const m = await import('./soporte-avisos');
const T = { ticketId: 't1', tenantId: 'x1', asunto: 'No me llega el PDF', prioridad: 'alta', flotaNombre: 'Flota Demo' };
const AMBOS = () => { process.env.ALERTA_EMAIL = 'op@likida.ai'; process.env.ALERTA_WA = '5215500000000'; };

beforeEach(() => {
  respuestas.clear(); anotar.mockClear(); enviarCorreo.mockClear(); enviarTexto.mockClear();
  logger.warn.mockClear(); delete process.env.ALERTA_EMAIL; delete process.env.ALERTA_WA;
});
afterEach(() => { delete process.env.ALERTA_EMAIL; delete process.env.ALERTA_WA; });

describe('avisos de soporte', () => {
  it('ticket nuevo: correo y WhatsApp, y deja el dedup en bitácora', async () => {
    AMBOS();
    const r = await m.avisarTicketNuevo(T);
    expect(r).toMatchObject({ avisado: true, correo: 'enviado', whatsapp: 'enviado', yaAvisado: false });
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
    expect(enviarTexto).toHaveBeenCalledTimes(1);
    expect(String(enviarTexto.mock.calls[0][1])).toContain('/admin/soporte?ticket=t1');
    expect(anotar.mock.calls[0][0]).toMatchObject({ accion: 'soporte.aviso_ticket_nuevo', entidadId: 't1', tenantId: 'x1' });
  });

  it('dedup: si ya se avisó, no manda nada', async () => {
    AMBOS();
    respuestas.set('bitacora_auditoria', [{ data: [{ id: 'b1' }], error: null }]);
    const r = await m.avisarTicketNuevo(T);
    expect(r.yaAvisado).toBe(true);
    expect(enviarCorreo).not.toHaveBeenCalled();
    expect(enviarTexto).not.toHaveBeenCalled();
    expect(anotar).not.toHaveBeenCalled();
  });

  it('sin canales configurados: no sale, se DECLARA y no se anota como avisado', async () => {
    const r = await m.avisarTicketNuevo(T);
    expect(r).toMatchObject({ avisado: false, correo: 'sin_configurar', whatsapp: 'sin_configurar' });
    expect(anotar).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('soporte.aviso_sin_salir', expect.objectContaining({ accion: 'soporte.aviso_ticket_nuevo' }));
  });

  it('si el correo falla pero el WhatsApp sale, cuenta como avisado y dice cuál falló', async () => {
    AMBOS();
    enviarCorreo.mockResolvedValueOnce({ ok: false, motivo: 'red' });
    const r = await m.avisarTicketNuevo(T);
    expect(r).toMatchObject({ avisado: true, correo: 'fallo', whatsapp: 'enviado' });
  });

  it('si ambos fallan: avisado=false, sin dedup (se reintentará)', async () => {
    AMBOS();
    enviarCorreo.mockResolvedValueOnce({ ok: false, motivo: 'red' });
    enviarTexto.mockResolvedValueOnce({ ok: false, error: 'x' });
    const r = await m.avisarTicketNuevo(T);
    expect(r).toMatchObject({ avisado: false, correo: 'fallo', whatsapp: 'fallo' });
    expect(anotar).not.toHaveBeenCalled();
  });

  it('dedup ilegible: avisa igual (mejor duplicado que silencio) y lo dice', async () => {
    AMBOS();
    respuestas.set('bitacora_auditoria', [{ data: null, error: { message: 'caída' } }]);
    const r = await m.avisarTicketNuevo(T);
    expect(r.avisado).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith('soporte.aviso_dedup_ilegible', expect.anything());
  });

  it('nunca lanza aunque el correo reviente', async () => {
    AMBOS();
    enviarCorreo.mockRejectedValueOnce(new Error('boom'));
    await expect(m.avisarRespuestaDelCliente(T, 'm1')).resolves.toMatchObject({ correo: 'fallo', whatsapp: 'enviado' });
  });

  it('la respuesta del cliente deduplica por MENSAJE, no por ticket', async () => {
    AMBOS();
    await m.avisarRespuestaDelCliente(T, 'm1');
    expect(anotar.mock.calls[0][0]).toMatchObject({ accion: 'soporte.aviso_respuesta_cliente', entidadId: 't1:m1' });
  });
});

describe('escalación por SLA', () => {
  const AHORA = Date.parse('2026-11-10T12:00:00Z');
  it('escala cada ticket vencido y respeta los ya avisados', async () => {
    AMBOS();
    respuestas.set('ticket_soporte', [{ data: [
      { id: 't1', tenant_id: 'x1', asunto: 'A', prioridad: 'alta', vence_en: '2026-11-10T00:00:00Z', tenant: { nombre: 'F1' } },
      { id: 't2', tenant_id: 'x2', asunto: 'B', prioridad: 'media', vence_en: '2026-11-09T00:00:00Z', tenant: null },
    ], error: null }]);
    // 1.ª consulta de dedup (t1): nada; 2.ª (t2): ya avisado.
    respuestas.set('bitacora_auditoria', [{ data: [], error: null }, { data: [{ id: 'b' }], error: null }]);
    const r = await m.escalarSlasVencidos(AHORA);
    expect(r).toEqual({ vencidos: 2, escalados: 1, yaAvisados: 1, sinSalir: 0 });
    expect(anotar.mock.calls[0][0]).toMatchObject({ accion: 'soporte.aviso_sla_vencido', entidadId: 't1' });
    expect(String(enviarTexto.mock.calls[0][1])).toContain('12 h');
  });

  it('si la cola no se puede leer, LANZA (no devuelve ceros)', async () => {
    respuestas.set('ticket_soporte', [{ data: null, error: { message: 'caída' } }]);
    await expect(m.escalarSlasVencidos(AHORA)).rejects.toThrow(/caída/);
  });
});
