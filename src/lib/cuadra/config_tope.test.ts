import { describe, it, expect, afterAll } from 'vitest';
import net from 'node:net';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 8 · ALTO REINCIDENTE — "Ahora hay techo por consulta" cubría 2 de
// 13 pasos del cierre. `getConfig` (config.ts) es el cuarto camino que la
// ronda 8 confirmó, sin ningún `Promise.all` que lo salvara por accidente:
// `consultar_politica` (tools.ts) lo llama SOLO, dentro del presupuesto de
// 40s del agente. Sin techo propio, un socket que acepta y calla se llevaba
// la invocación entera — Vercel mata a los 120s, 180s ANTES de que el fetch
// se rindiera solo.
//
// Mismo patrón que `repo_tope.test.ts`: servidor mudo real, sin red ni
// Supabase, midiendo con reloj real cuánto tarda en asentarse.
// ═══════════════════════════════════════════════════════════════════════════

const servidorMudo = net.createServer((s) => { s.on('error', () => {}); /* acepta y calla */ });
await new Promise<void>((r) => servidorMudo.listen(0, '127.0.0.1', () => r()));
const puerto = (servidorMudo.address() as net.AddressInfo).port;

process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${puerto}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'llave-falsa-para-la-medicion';
process.env.CUADRA_TOPE_CONSULTA_MS = '1500';

const { getConfig } = await import('./config');
const { TOPE_CONSULTA_MS } = await import('./presupuesto');

afterAll(() => { servidorMudo.close(); });

const CORTE_MS = 12_000;

async function tardanza(fn: () => Promise<unknown>): Promise<number | null> {
  const t0 = performance.now();
  const gano = await Promise.race([
    fn().then(() => 'asienta', () => 'asienta'),
    new Promise<'colgada'>((r) => setTimeout(() => r('colgada'), CORTE_MS)),
  ]);
  return gano === 'colgada' ? null : performance.now() - t0;
}

describe('getConfig contra una base que acepta la conexión y no contesta', () => {
  it('el camino de consultar_politica se rinde en su tope, no se cuelga la invocación', async () => {
    const ms = await tardanza(() => getConfig('t1').catch(() => null));
    expect(ms, `getConfig seguía bloqueada a los ${CORTE_MS} ms: no hay techo`).not.toBeNull();
    expect(ms!).toBeLessThan(TOPE_CONSULTA_MS + 4_000);
  }, 20_000);
});
