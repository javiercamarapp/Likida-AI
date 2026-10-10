import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// La caché de la ventana de 24 h (mig. 0368). La SQL se prueba contra un
// Postgres real en supabase/tests/0368_ventana_wa.sh; aquí, el lado TypeScript:
// que se registre lo correcto (hora de Meta, el más reciente del lote, hora
// futura recortada) y que NADA lance — es una caché, no un requisito.

const rpc = vi.hoisted(() => vi.fn());
const insert = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc, from: () => ({ insert }) }) }));
vi.mock('./presupuesto', () => ({ acotada: (q: unknown) => q }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger }));

const {
  normalizarTelefonoWa, estadoDeVentana, ventanaDeContacto, registrarEntrantesWhatsApp, registrarDecisionEnvio, VENTANA_HORAS,
} = await import('./wa_ventana');

const AHORA = new Date('2026-10-01T12:00:00Z');
const hace = (h: number) => new Date(AHORA.getTime() - h * 3_600_000);

beforeEach(() => { rpc.mockReset(); insert.mockReset(); Object.values(logger).forEach((f) => f.mockReset()); });

describe('normalización (misma regla que la SQL y destinatarioWhatsApp)', () => {
  it.each([
    ['5219993700779', '529993700779'],
    ['+52 1 (999) 370-0779', '529993700779'],
    ['529993700779', '529993700779'],
    ['+1 415 555 0100', '14155550100'],
    ['', ''],
  ])('%s → %s', (entrada, esperado) => expect(normalizarTelefonoWa(entrada)).toBe(esperado));

  it('la SQL implementa la misma regla (521 + 10 dígitos → 52 + 10)', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0368_wa_ventana_24h.sql'), 'utf8');
    expect(sql).toContain("'^521[0-9]{10}$'");
    expect(sql).toContain("'52' || substr(");
  });
});

describe('decisión pura de ventana', () => {
  it('abierta, cerrada, frontera de 24 h exactas y sin dato', () => {
    expect(estadoDeVentana(hace(2), AHORA).estado).toBe('abierta');
    expect(estadoDeVentana(hace(23.99), AHORA).estado).toBe('abierta');
    expect(estadoDeVentana(hace(VENTANA_HORAS), AHORA).estado).toBe('cerrada');
    expect(estadoDeVentana(hace(48), AHORA).estado).toBe('cerrada');
    expect(estadoDeVentana(null, AHORA)).toEqual({ estado: 'desconocida', ultimoEntranteEn: null, expiraEn: null });
    expect(estadoDeVentana(new Date('x'), AHORA).estado).toBe('desconocida');
  });
  it('expira 24 h después del último entrante', () => {
    expect(estadoDeVentana(hace(2), AHORA).expiraEn).toBe(hace(-22).toISOString());
  });
});

describe('ventanaDeContacto', () => {
  it('lee la fila del RPC', async () => {
    rpc.mockResolvedValue({ data: [{ estado: 'abierta', ultimo_entrante_en: 'a', expira_en: 'b' }], error: null });
    expect(await ventanaDeContacto('5219993700779', AHORA)).toEqual({ estado: 'abierta', ultimoEntranteEn: 'a', expiraEn: 'b' });
    expect(rpc).toHaveBeenCalledWith('ventana_estado_wa', { p_telefono: '5219993700779', p_ahora: AHORA.toISOString() });
  });
  it('error del RPC, excepción, respuesta rara o teléfono basura = desconocida (NUNCA cerrada ni lanza)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'caída' } });
    expect((await ventanaDeContacto('5219993700779')).estado).toBe('desconocida');
    rpc.mockRejectedValue(new Error('boom'));
    expect((await ventanaDeContacto('5219993700779')).estado).toBe('desconocida');
    rpc.mockResolvedValue({ data: [{ estado: 'inventada' }], error: null });
    expect((await ventanaDeContacto('5219993700779')).estado).toBe('desconocida');
    rpc.mockResolvedValue({ data: [], error: null });
    expect((await ventanaDeContacto('5219993700779')).estado).toBe('desconocida');
    rpc.mockClear();
    expect((await ventanaDeContacto('n/a')).estado).toBe('desconocida');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('registrarEntrantesWhatsApp', () => {
  const ahoraMs = () => AHORA.getTime();
  it('usa la hora de META (timestampMs), normaliza el teléfono y manda el wamid', async () => {
    rpc.mockResolvedValue({ data: 'x', error: null });
    const r = await registrarEntrantesWhatsApp([{ from: '5219993700779', timestampMs: hace(3).getTime(), waMessageId: 'wamid.1' }], ahoraMs);
    expect(r).toEqual({ registrados: 1, fallidos: 0 });
    expect(rpc).toHaveBeenCalledWith('registrar_entrante_wa', { p_telefono: '529993700779', p_en: hace(3).toISOString(), p_wamid: 'wamid.1' });
  });
  it('fuera de orden y duplicados en el lote: UN rpc por contacto, con el más reciente', async () => {
    rpc.mockResolvedValue({ data: 'x', error: null });
    await registrarEntrantesWhatsApp([
      { from: '5219993700779', timestampMs: hace(1).getTime(), waMessageId: 'wamid.nuevo' },
      { from: '529993700779', timestampMs: hace(5).getTime(), waMessageId: 'wamid.viejo' },
      { from: '5219993700779', timestampMs: hace(1).getTime(), waMessageId: 'wamid.nuevo' },
      { from: '5215500000000', timestampMs: hace(2).getTime(), waMessageId: 'wamid.otro' },
    ], ahoraMs);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('registrar_entrante_wa', expect.objectContaining({ p_telefono: '529993700779', p_wamid: 'wamid.nuevo', p_en: hace(1).toISOString() }));
  });
  it('sin timestampMs usa recibidoMs; sin ninguno, ahora', async () => {
    rpc.mockResolvedValue({ data: 'x', error: null });
    await registrarEntrantesWhatsApp([{ from: '529993700779', recibidoMs: hace(4).getTime() }], ahoraMs);
    expect(rpc).toHaveBeenLastCalledWith('registrar_entrante_wa', expect.objectContaining({ p_en: hace(4).toISOString() }));
    await registrarEntrantesWhatsApp([{ from: '529993700779' }], ahoraMs);
    expect(rpc).toHaveBeenLastCalledWith('registrar_entrante_wa', expect.objectContaining({ p_en: AHORA.toISOString() }));
  });
  it('hostil: hora futura se recorta a ahora; NaN/negativa cae a ahora', async () => {
    rpc.mockResolvedValue({ data: 'x', error: null });
    await registrarEntrantesWhatsApp([{ from: '529993700779', timestampMs: AHORA.getTime() + 10 * 86_400_000 }], ahoraMs);
    expect(rpc).toHaveBeenLastCalledWith('registrar_entrante_wa', expect.objectContaining({ p_en: AHORA.toISOString() }));
    await registrarEntrantesWhatsApp([{ from: '529993700779', timestampMs: Number.NaN }, { from: '529993700779', timestampMs: -5 }], ahoraMs);
    expect(rpc).toHaveBeenLastCalledWith('registrar_entrante_wa', expect.objectContaining({ p_en: AHORA.toISOString() }));
  });
  it('teléfonos inválidos se omiten sin llamar a la base', async () => {
    const r = await registrarEntrantesWhatsApp([{ from: 'abc' }, { from: '' }, { from: '123' }], ahoraMs);
    expect(r).toEqual({ registrados: 0, fallidos: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('un fallo o excepción de la base no lanza y se cuenta', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'caída' } }).mockRejectedValueOnce(new Error('boom'));
    const r = await registrarEntrantesWhatsApp([{ from: '529993700779' }, { from: '525500000000' }], ahoraMs);
    expect(r).toEqual({ registrados: 0, fallidos: 2 });
  });
});

describe('registrarDecisionEnvio', () => {
  it('guarda SOLO los últimos 4 dígitos del teléfono', async () => {
    insert.mockResolvedValue({ error: null });
    await registrarDecisionEnvio({ contexto: 'x', telefono: '5219993700779', ventana: 'cerrada', canal: 'plantilla', motivo: 'ventana_cerrada', plantilla: 'p', ok: true });
    const fila = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(fila.contacto_ult4).toBe('0779');
    expect(JSON.stringify(fila)).not.toContain('9993700779');
  });
  it('nunca lanza', async () => {
    insert.mockRejectedValue(new Error('boom'));
    await expect(registrarDecisionEnvio({ contexto: 'x', telefono: '1', ventana: 'abierta', canal: 'texto', motivo: 'm', ok: true })).resolves.toBeUndefined();
    insert.mockResolvedValue({ error: { message: 'x' } });
    await expect(registrarDecisionEnvio({ contexto: 'x', telefono: '1', ventana: 'abierta', canal: 'texto', motivo: 'm', ok: true })).resolves.toBeUndefined();
  });
});
