import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));

import { procesarPush, MAX_BYTES_PUSH, MAX_LECTURAS_PUSH, type DepsPush } from './recibir';
import { firmarPush } from './firma';
import type { ResultadoSync } from '../conectores/sincronizar_gps';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AHORA = Date.parse('2026-10-01T15:30:00Z');
const SEC_A = 'lkd_gps_secreto_de_A';
const SEC_B = 'lkd_gps_secreto_de_B';

function mundo(sobre: Partial<DepsPush> = {}) {
  const guardado = new Set<string>(); // idempotencia: (flota, dispositivo, instante)
  const usos: Array<[string, boolean, string | null]> = [];
  const asentados: Array<{ flota: string; n: number }> = [];
  const deps: DepsPush = {
    rate: async () => true,
    secretos: async (t) => t === A ? { actual: SEC_A, previo: null, previoVenceEn: null, activo: true }
      : t === B ? { actual: SEC_B, previo: null, previoVenceEn: null, activo: true } : null,
    asentar: async (t, lecturas) => {
      asentados.push({ flota: t, n: lecturas.length });
      const base: ResultadoSync = { tenantId: t, proveedor: 'gps_push', leidas: lecturas.length, guardadas: 0, huerfanas: 0 };
      for (const l of lecturas) {
        if (l.deviceId.startsWith('huerfano')) { base.huerfanas += 1; continue; }
        const k = `${t}|${l.deviceId}|${l.medidaEn}`;
        if (!guardado.has(k)) { guardado.add(k); base.guardadas += 1; }
      }
      return base;
    },
    uso: async (t, ok, m) => { usos.push([t, ok, m]); },
    ahora: () => AHORA,
    ...sobre,
  };
  return { deps, guardado, usos, asentados };
}

const lectura = (o: Record<string, unknown> = {}) => ({ dispositivo: 'D1', lat: 20.9, lng: -89.6, fecha: '2026-10-01T15:29:00Z', velocidad_kmh: 60, rumbo: 90, ignicion: true, ...o });
function peticion(cuerpo: unknown, opts: { secreto?: string; ts?: number; firma?: string | null; texto?: string } = {}) {
  const texto = opts.texto ?? JSON.stringify(cuerpo);
  const ts = opts.ts ?? Math.floor(AHORA / 1000);
  const h: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.9', 'x-likida-timestamp': String(ts) };
  if (opts.firma !== null) h['x-likida-signature'] = opts.firma ?? firmarPush(opts.secreto ?? SEC_A, ts, texto);
  return new Request('https://app.likida.ai/api/gps/push/x', { method: 'POST', headers: h, body: texto });
}

describe('push firmado de posiciones', () => {
  it('feliz: autentica, asienta y cuenta', async () => {
    const m = mundo();
    const res = await procesarPush(peticion({ posiciones: [lectura(), lectura({ dispositivo: 'D2' }), lectura({ dispositivo: 'huerfano-1' })] }), A, m.deps);
    expect(res.estado).toBe(200);
    expect(res.cuerpo).toMatchObject({ recibidas: 3, guardadas: 2, duplicadas: 0, descartadas: 0, huerfanas: 1 });
    expect(m.usos).toEqual([[A, true, null]]);
  });

  it('DUPLICADO: reenviar el mismo lote no duplica nada (idempotente)', async () => {
    const m = mundo();
    const lote = { posiciones: [lectura(), lectura({ dispositivo: 'D2' })] };
    await procesarPush(peticion(lote), A, m.deps);
    const otra = await procesarPush(peticion(lote), A, m.deps);
    expect(otra.cuerpo).toMatchObject({ guardadas: 0, duplicadas: 2 });
    expect(m.guardado.size).toBe(2);
  });

  it('FUERA DE ORDEN: una lectura más vieja llega después y se asienta como historia', async () => {
    const m = mundo();
    await procesarPush(peticion({ posiciones: [lectura({ fecha: '2026-10-01T15:29:00Z' })] }), A, m.deps);
    const r2 = await procesarPush(peticion({ posiciones: [lectura({ fecha: '2026-10-01T15:10:00Z' })] }), A, m.deps);
    expect(r2.cuerpo).toMatchObject({ guardadas: 1 });
    expect(m.guardado.size).toBe(2);
  });

  it('OTRO TENANT: el secreto de B no firma por A; y la flota inexistente responde igual que una firma mala', async () => {
    const m = mundo();
    const cuerpo = { posiciones: [lectura()] };
    const conSecretoDeB = await procesarPush(peticion(cuerpo, { secreto: SEC_B }), A, m.deps);
    const inexistente = await procesarPush(peticion(cuerpo), 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', m.deps);
    const firmaMala = await procesarPush(peticion(cuerpo, { firma: 'v1=00' }), A, m.deps);
    for (const x of [conSecretoDeB, inexistente, firmaMala]) expect(x).toEqual({ estado: 401, cuerpo: { error: 'no_autorizado' } });
    expect(m.asentados).toHaveLength(0);
    // y lo de A solo se asienta en A
    await procesarPush(peticion(cuerpo), A, m.deps);
    expect(m.asentados).toEqual([{ flota: A, n: 1 }]);
  });

  it('el UUID de la flota se compara sin distinguir mayúsculas y uno inválido es 401', async () => {
    const m = mundo();
    expect((await procesarPush(peticion({ posiciones: [lectura()] }), A.toUpperCase(), m.deps)).estado).toBe(200);
    expect((await procesarPush(peticion({ posiciones: [lectura()] }), 'no-es-uuid', m.deps)).estado).toBe(401);
  });

  it('sin cabeceras de firma/hora → 401; timestamp con formato raro → 401', async () => {
    const m = mundo();
    expect((await procesarPush(peticion({ posiciones: [lectura()] }, { firma: null }), A, m.deps)).estado).toBe(401);
    const req = new Request('https://x/api', { method: 'POST', body: '{}', headers: { 'x-likida-signature': 'v1=ab', 'x-likida-timestamp': '1e9' } });
    expect((await procesarPush(req, A, m.deps)).estado).toBe(401);
  });

  it('RELOJ DESFASADO: firma buena con timestamp a +10 min → 401 reloj_desfasado con la hora del servidor; con firma mala NO se informa', async () => {
    const m = mundo();
    const ts = Math.floor(AHORA / 1000) + 600;
    const buena = await procesarPush(peticion({ posiciones: [lectura()] }, { ts }), A, m.deps);
    expect(buena.estado).toBe(401);
    expect(buena.cuerpo).toMatchObject({ error: 'reloj_desfasado', servidor_utc: '2026-10-01T15:30:00.000Z' });
    const mala = await procesarPush(peticion({ posiciones: [lectura()] }, { ts, secreto: 'otro' }), A, m.deps);
    expect(mala.cuerpo).toEqual({ error: 'no_autorizado' });
    expect(m.asentados).toHaveLength(0);
  });

  it('REPETICIÓN con otro timestamp: no se puede reusar la firma cambiando la hora', async () => {
    const m = mundo();
    const texto = JSON.stringify({ posiciones: [lectura()] });
    const ts = Math.floor(AHORA / 1000);
    const firma = firmarPush(SEC_A, ts, texto);
    const r = await procesarPush(peticion(null, { texto, ts: ts + 1, firma }), A, m.deps);
    expect(r.estado).toBe(401);
  });

  it('ROTACIÓN: el secreto previo vale mientras no venza y el vencido se rechaza', async () => {
    const vigente = mundo({ secretos: async () => ({ actual: 'nuevo', previo: SEC_A, previoVenceEn: AHORA + 3_600_000, activo: true }) });
    expect((await procesarPush(peticion({ posiciones: [lectura()] }, { secreto: SEC_A }), A, vigente.deps)).estado).toBe(200);
    expect((await procesarPush(peticion({ posiciones: [lectura()] }, { secreto: 'nuevo' }), A, vigente.deps)).estado).toBe(200);
    const vencido = mundo({ secretos: async () => ({ actual: 'nuevo', previo: SEC_A, previoVenceEn: AHORA - 1, activo: true }) });
    expect((await procesarPush(peticion({ posiciones: [lectura()] }, { secreto: SEC_A }), A, vencido.deps)).estado).toBe(401);
  });

  it('push apagado (activo=false) → 401', async () => {
    const m = mundo({ secretos: async () => ({ actual: SEC_A, previo: null, previoVenceEn: null, activo: false }) });
    expect((await procesarPush(peticion({ posiciones: [lectura()] }), A, m.deps)).estado).toBe(401);
  });

  it('LÍMITES: tasa antes de leer el cuerpo (429 sin consumirlo), cuerpo grande 413, más de 500 lecturas 400', async () => {
    let consumido = false;
    const limitado = mundo({ rate: async () => false });
    const body = new ReadableStream<Uint8Array>({ pull(c) { consumido = true; c.close(); } }, { highWaterMark: 0 });
    const req = new Request('https://x/api', { method: 'POST', body, duplex: 'half', headers: { 'x-likida-timestamp': '1790000000', 'x-likida-signature': 'v1=a' } } as RequestInit & { duplex: 'half' });
    expect((await procesarPush(req, A, limitado.deps)).estado).toBe(429);
    await Promise.resolve();
    expect(consumido).toBe(false);

    const m = mundo();
    const grande = await procesarPush(peticion(null, { texto: 'x'.repeat(MAX_BYTES_PUSH + 1) }), A, m.deps);
    expect(grande.estado).toBe(413);
    const muchas = await procesarPush(peticion({ posiciones: Array.from({ length: MAX_LECTURAS_PUSH + 1 }, () => lectura()) }), A, m.deps);
    expect(muchas.estado).toBe(400);
  });

  it('lecturas malformadas se cuentan y NO tumban el lote; el sobre con claves de más se rechaza', async () => {
    const m = mundo();
    const r = await procesarPush(peticion({ posiciones: [lectura(), { dispositivo: 'X' }, lectura({ fecha: '2026-10-01T15:29:00' }), lectura({ extra: 1 }), 'basura'] }), A, m.deps);
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toMatchObject({ recibidas: 5, descartadas: 4, guardadas: 1 });
    expect((await procesarPush(peticion({ posiciones: [lectura()], otra: true }), A, m.deps)).estado).toBe(400);
    expect((await procesarPush(peticion(null, { texto: '{no json' }), A, m.deps)).estado).toBe(400);
  });

  it('base caída → 503 (el dispositivo conserva su buffer y reintenta); lectura de secretos caída → 503', async () => {
    const caida = mundo({ asentar: async (t) => ({ tenantId: t, proveedor: 'gps_push', leidas: 1, guardadas: 0, huerfanas: 0, error: 'no se pudieron guardar las posiciones' }) });
    expect((await procesarPush(peticion({ posiciones: [lectura()] }), A, caida.deps)).estado).toBe(503);
    const sinSecretos = mundo({ secretos: async () => { throw new Error('db'); } });
    expect((await procesarPush(peticion({ posiciones: [lectura()] }), A, sinSecretos.deps)).estado).toBe(503);
  });

  it('la salud anota rechazos de firma sin tumbar la respuesta aunque anotar falle', async () => {
    const m = mundo({ uso: async () => { throw new Error('db'); } });
    expect((await procesarPush(peticion({ posiciones: [lectura()] }, { secreto: 'mala' }), A, m.deps)).estado).toBe(401);
    expect((await procesarPush(peticion({ posiciones: [lectura()] }), A, m.deps)).estado).toBe(200);
  });
});
