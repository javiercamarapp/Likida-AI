import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const respuestas = new Map<string, { data: unknown; error: { message: string } | null } | 'lanza'>();
const rpc = vi.fn(async (nombre: string, _args?: Record<string, unknown>) => {
  const r = respuestas.get(nombre);
  if (r === 'lanza') throw new Error('red caída');
  return r ?? { data: null, error: null };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc }) }));

const { mantenerLedgers, leerLedgers, PLAZOS_LEDGERS, TABLAS_LEDGERS } = await import('./retencion_ledgers');

const buena = {
  evento_seguridad: { borradas: 5, parcial: false },
  evento_stripe: { borradas: 1, parcial: false },
  vigia_evento: { borradas: 0, parcial: false },
  cp_documento_evento: { borradas: 2, parcial: true },
  buzon_entrega_evento: { borradas: 0, parcial: false },
  parcial: true,
  fallos: [],
};

beforeEach(() => { respuestas.clear(); rpc.mockClear(); Object.values(logger).forEach((f) => f.mockClear()); });

describe('mantenerLedgers', () => {
  it('llama mantener_ledgers con SUS plazos y purgar_autofactura con 180 días, y devuelve el conteo real de cada tabla', async () => {
    respuestas.set('mantener_ledgers', { data: buena, error: null });
    respuestas.set('purgar_autofactura', { data: { lotes: 4, cupos: 6 }, error: null });
    const r = await mantenerLedgers(new Date('2026-10-02T03:00:00Z'), new Date('2026-10-02T03:01:45Z'));
    expect(r.map((x) => [x.nombre, x.ok, x.filas, x.parcial])).toEqual([
      ['evento_seguridad', true, 5, false], ['evento_stripe', true, 1, false], ['vigia_evento', true, 0, false],
      ['cp_documento_evento', true, 2, true], ['buzon_entrega_evento', true, 0, false], ['autofactura', true, 10, false],
    ]);
    expect(rpc).toHaveBeenCalledWith('mantener_ledgers', {
      p_ahora: '2026-10-02T03:00:00.000Z', p_vence: '2026-10-02T03:01:45.000Z',
      p_dias_stripe: 400, p_dias_vigia: 365, p_dias_cp_documento: 730, p_dias_buzon: 365,
    });
    expect(rpc).toHaveBeenCalledWith('purgar_autofactura', { p_dias: 180 });
  });

  it('los plazos nunca bajan del piso de 30 días de la migración', () => {
    for (const v of Object.values(PLAZOS_LEDGERS)) expect(v).toBeGreaterThanOrEqual(30);
  });

  it('una tabla que la base reporta en `fallos` sale con ok:false y su error, y las demás siguen ok', async () => {
    respuestas.set('mantener_ledgers', { data: { ...buena, vigia_evento: undefined, fallos: ['vigia_evento: permission denied for table vigia_evento'] }, error: null });
    respuestas.set('purgar_autofactura', { data: { lotes: 0, cupos: 0 }, error: null });
    const r = await mantenerLedgers();
    expect(r.find((x) => x.nombre === 'vigia_evento')).toMatchObject({ ok: false, filas: null, error: 'permission denied for table vigia_evento' });
    expect(r.filter((x) => x.ok)).toHaveLength(5);
    expect(logger.error).toHaveBeenCalledWith('cron.purgar.ledgers_fallo', expect.objectContaining({ purga: 'vigia_evento' }));
  });

  it('error de la RPC, excepción o respuesta ilegible NO se leen como «cero filas» y no tumban la autofactura', async () => {
    respuestas.set('mantener_ledgers', { data: null, error: { message: 'boom' } });
    respuestas.set('purgar_autofactura', 'lanza');
    const r = await mantenerLedgers();
    expect(r).toEqual([
      { nombre: 'ledgers', ok: false, filas: null, parcial: false, error: 'boom' },
      { nombre: 'autofactura', ok: false, filas: null, parcial: false, error: 'red caída' },
    ]);

    respuestas.set('mantener_ledgers', 'lanza');
    respuestas.set('purgar_autofactura', { data: { lotes: 'x' }, error: null });
    const r2 = await mantenerLedgers();
    expect(r2[0]).toMatchObject({ nombre: 'ledgers', ok: false, error: 'red caída' });
    expect(r2[1]).toMatchObject({ nombre: 'autofactura', ok: false, error: 'respuesta_invalida' });
  });
});

describe('leerLedgers', () => {
  it('una tabla sin resultado ni fallo (la base no la trae) no se asume en cero', () => {
    const { vigia_evento: _omitida, ...resto } = buena;
    const r = leerLedgers(resto) ?? [];
    expect(r.find((x) => x.nombre === 'vigia_evento')).toMatchObject({ ok: false, error: 'respuesta_invalida' });
  });

  it('una respuesta que no es un objeto es null (el llamador la trata como inválida)', () => {
    expect(leerLedgers(null)).toBeNull();
    expect(leerLedgers([1])).toBeNull();
    expect(leerLedgers('x')).toBeNull();
  });

  it('cubre exactamente las cinco tablas que purga la 0680', () => {
    expect([...TABLAS_LEDGERS]).toEqual(['evento_seguridad', 'evento_stripe', 'vigia_evento', 'cp_documento_evento', 'buzon_entrega_evento']);
    const sql = readFileSync('supabase/migrations/0680_retencion_ledgers.sql', 'utf8');
    for (const t of TABLAS_LEDGERS) expect(sql).toContain(t);
  });
});
