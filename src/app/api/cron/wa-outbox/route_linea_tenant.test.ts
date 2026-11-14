// ═══════════════════════════════════════════════════════════════════════════
// wa-outbox por LÍNEA de tenant (paquete O): cada salida sale por la línea que quedó
// fijada al encolar; el token vencido de una línea NO frena la cola global ni las
// salidas de otros tenants; una línea que no se resuelve nunca cae a otra.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/likida/interruptores', () => ({ leerInterruptor: async () => 'encendido' }));
const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/admin/salud', () => ({ registrarLatido: vi.fn(async () => {}), puertaCron: async () => null }));
const alertarOperador = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => true));
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador }));
vi.mock('@/lib/saas/salidas_flota', () => ({ veredictoSalidasHaciaTelefono: async () => ({ salen: true }) }));

const lineas: Record<string, { phoneNumberId: string; token: string; origen: 'tenant'; lineaId: string }> = {
  PNID_A: { phoneNumberId: 'PNID_A', token: 'TOKEN_A', origen: 'tenant', lineaId: 'linea-a' },
  PNID_B: { phoneNumberId: 'PNID_B', token: 'TOKEN_B', origen: 'tenant', lineaId: 'linea-b' },
};
const marcarVencida = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => {}));
vi.mock('@/lib/meta/canal', () => ({
  canalPorPhoneNumberId: async (id: string) => (lineas[id] ? { canal: lineas[id], tenantId: `t-${id}` } : null),
  resolverCanal: vi.fn(),
  marcarLineaTokenVencido: marcarVencida,
}));

/** El veredicto del sondeo se decide por línea desde la prueba; por omisión todo sirve. */
const sondeo = vi.hoisted(() => ({ vencidas: new Set<string>() }));
vi.mock('@/lib/meta/client', async (importar) => ({
  ...(await importar<typeof import('@/lib/meta/client')>()),
  sondearTokenWhatsApp: async (_ahora?: number, canal?: { phoneNumberId: string }) => (
    canal && sondeo.vencidas.has(canal.phoneNumberId) ? { estado: 'vencido', codigo: 190, status: 400 } : { estado: 'ok' }
  ),
}));

let salidas: Array<{ id: string; payload: unknown; intentos: number; leaseToken: string }> = [];
const finalizar = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ ok: true, muerta: false })));
vi.mock('@/lib/likida/wa_outbox', () => ({
  reconciliarReceiptsWhatsApp: async () => 0,
  purgarReceiptsWhatsApp: async () => 0,
  vencerSalidasWhatsApp: async () => [],
  reclamarSalidasWhatsApp: async () => salidas,
  finalizarSalidaWhatsApp: (...a: unknown[]) => finalizar(...a),
  encolarSalidaWhatsApp: vi.fn(async () => {}),
}));
vi.mock('@/lib/likida/lotes', () => ({
  conPool: async <T,>(xs: T[], _n: number, fn: (x: T) => Promise<void>) => { for (const x of xs) await fn(x); },
}));

const { GET } = await import('./route');
const llamar = () => GET(new Request('https://likida.ai/api/cron/wa-outbox', { headers: { authorization: 'Bearer x' } }));
const texto = (to: string) => ({ messaging_product: 'whatsapp', to, type: 'text', text: { body: 'hola' } });
const conLinea = (id: string, to: string, pnid: string) => ({
  id, payload: { ...texto(to), _canal: { phoneNumberId: pnid, lineaId: lineas[pnid]?.lineaId ?? null } }, intentos: 1, leaseToken: `l-${id}`,
});
const plataforma = (id: string, to: string) => ({ id, payload: texto(to), intentos: 1, leaseToken: `l-${id}` });
const meta = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const aceptado = (n: string) => meta(200, { messages: [{ id: `wamid.${n}` }] });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WHATSAPP_ACCESS_TOKEN = 'TOKEN_ENV'; process.env.WHATSAPP_PHONE_NUMBER_ID = 'PNID_ENV';
  sondeo.vencidas.clear();
  finalizar.mockResolvedValue({ ok: true, muerta: false });
});

describe('cron wa-outbox: una salida por la línea con que se encoló', () => {
  it('cada fila sale por su phone_number_id y su token; la plataforma por el entorno; `_canal` nunca llega a Meta', async () => {
    salidas = [conLinea('o1', '525511111111', 'PNID_A'), conLinea('o2', '525522222222', 'PNID_B'), plataforma('o3', '525533333333')];
    const f = vi.fn(async (..._a: unknown[]) => aceptado('1'));
    vi.stubGlobal('fetch', f);
    const res = await llamar();
    expect(await res.json()).toMatchObject({ enviadas: 3, fallidas: 0 });
    const llamadas = f.mock.calls.map((c) => ({ url: String(c[0]), auth: (c[1] as { headers: Record<string, string> }).headers.Authorization, cuerpo: String((c[1] as RequestInit).body) }));
    expect(llamadas[0]).toMatchObject({ url: 'https://graph.facebook.com/v21.0/PNID_A/messages', auth: 'Bearer TOKEN_A' });
    expect(llamadas[1]).toMatchObject({ url: 'https://graph.facebook.com/v21.0/PNID_B/messages', auth: 'Bearer TOKEN_B' });
    expect(llamadas[2]).toMatchObject({ url: 'https://graph.facebook.com/v21.0/PNID_ENV/messages', auth: 'Bearer TOKEN_ENV' });
    for (const l of llamadas) expect(l.cuerpo).not.toContain('_canal');
    expect(JSON.parse(llamadas[2].cuerpo)).toEqual(texto('525533333333')); // plataforma: payload idéntico
  });

  it('el 190 de la línea de un tenant marca ESA línea y NO frena a los demás', async () => {
    salidas = [conLinea('o1', '525511111111', 'PNID_A'), conLinea('o2', '525522222222', 'PNID_B'), conLinea('o3', '525544444444', 'PNID_A'), plataforma('o4', '525533333333')];
    const f = vi.fn(async (u: unknown) => (String(u).includes('PNID_A') ? meta(400, { error: { code: 190 } }) : aceptado('ok')));
    vi.stubGlobal('fetch', f);
    const res = await llamar();
    expect(await res.json()).toMatchObject({ corrio: true, enviadas: 2 });
    expect(marcarVencida).toHaveBeenCalledWith('linea-a');
    // la primera de A pega a Meta (190); la segunda de A ya no llama: la línea se vio vencida en esta corrida
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('PNID_A'))).toHaveLength(1);
    expect(urls.some((u) => u.includes('PNID_B'))).toBe(true);
    expect(urls.some((u) => u.includes('PNID_ENV'))).toBe(true);
    expect(finalizar).toHaveBeenCalledWith(expect.objectContaining({ id: 'o1' }), undefined, expect.stringContaining('retryable:'));
    expect(finalizar).toHaveBeenCalledWith(expect.objectContaining({ id: 'o3' }), undefined, 'retryable:linea_token_vencido');
    expect(finalizar).toHaveBeenCalledWith(expect.objectContaining({ id: 'o2' }), 'wamid.ok', undefined);
    expect(finalizar).toHaveBeenCalledWith(expect.objectContaining({ id: 'o4' }), 'wamid.ok', undefined);
    expect(JSON.stringify([...alertarOperador.mock.calls, ...logger.error.mock.calls, ...logger.warn.mock.calls])).not.toContain('TOKEN_A');
  });

  it('el sondeo vencido de una línea no llama a Meta por esa línea y las otras salen', async () => {
    sondeo.vencidas.add('PNID_A');
    salidas = [conLinea('o1', '525511111111', 'PNID_A'), conLinea('o2', '525522222222', 'PNID_B')];
    const f = vi.fn(async (..._a: unknown[]) => aceptado('b'));
    vi.stubGlobal('fetch', f);
    const res = await llamar();
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toContain('PNID_B');
    expect(finalizar).toHaveBeenCalledWith(expect.objectContaining({ id: 'o1' }), undefined, 'retryable:linea_token_vencido');
    expect(marcarVencida).toHaveBeenCalledWith('linea-a');
  });

  it('un phone_number_id desconocido NUNCA cae a otra línea: no llama a Meta y se reintenta', async () => {
    salidas = [conLinea('o1', '525511111111', 'PNID_DESCONOCIDA')];
    const f = vi.fn(async (..._a: unknown[]) => aceptado('x'));
    vi.stubGlobal('fetch', f);
    await llamar();
    expect(f).not.toHaveBeenCalled();
    expect(finalizar).toHaveBeenCalledWith(expect.anything(), undefined, 'retryable:linea_no_resuelta');
  });

  it('sin ninguna línea propia el comportamiento es el de siempre (una sola llamada, entorno global, sin tocar el canal)', async () => {
    salidas = [plataforma('o1', '525511111111')];
    const f = vi.fn(async (..._a: unknown[]) => aceptado('p'));
    vi.stubGlobal('fetch', f);
    await llamar();
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toBe('https://graph.facebook.com/v21.0/PNID_ENV/messages');
  });
});
