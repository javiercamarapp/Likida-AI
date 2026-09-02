// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD 22-ago-2026 · DAT-34 — EL TECHO COBRABA DOS VECES POR EL
// MISMO MENSAJE, Y QUIEN PAGABA LA CUENTA ERA EL COMPROBANTE NUEVO.
//
// El rate limit por teléfono corría ANTES de cualquier deduplicación, y eso
// volvía trampa el arreglo del 4-ago (aplazar en vez de descartar):
//
//   1. llega un POST con más mensajes que el techo; lo que cabe se procesa y se
//      GUARDA en la bandeja durable, y se contesta 429 por el resto;
//   2. Meta reentrega el POST COMPLETO —así funciona: el payload entero, no el
//      resto—, y los que ya están guardados vuelven a gastar sus cupos;
//   3. los nuevos se vuelven a diferir. Otra vez. Y otra. Hasta que Meta se
//      rinde, y ahí sí se pierden.
//
// Un mensaje que ya está en `wa_evento_pendiente` no cuesta trabajo nuevo: su
// fila existe, el cron la drena y `claimMessage` lo trata como duplicado.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const SECRETO = 'app-secret-de-prueba-dat34';
process.env.WHATSAPP_APP_SECRET = SECRETO;

const processInbound = vi.fn(async (): Promise<string> => 'procesado');
vi.mock('@/lib/likida/processor', () => ({ processInbound: () => processInbound() }));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/observability/sentry', () => ({ flushObservabilidad: vi.fn(async () => {}) }));
// AUDITORÍA 24 · AGEN-7: la ruta lee `leerInterruptor` (distingue «apagado»
// de «no pude leer la palanca»); `estaApagado` se conserva para el resto.
vi.mock('@/lib/likida/interruptores', () => ({
  estaApagado: vi.fn(async () => false),
  leerInterruptor: vi.fn(async () => 'encendido' as const),
}));

const pendientes: Array<() => unknown> = [];
vi.mock('next/server', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, after: (fn: () => unknown) => { pendientes.push(fn); } };
});

/** Lo que la bandeja durable dice que YA tiene. Lo fija cada prueba. */
let yaEnBandeja = new Set<string>();
const guardados: string[] = [];
vi.mock('@/lib/likida/wa_pendientes', () => ({
  pendientesYaConocidos: async (ids: string[]) => new Set(ids.filter((i) => yaEnBandeja.has(i))),
  guardarEventosPendientes: async (ms: Array<{ waMessageId?: string }>) => {
    const filas = ms.map((m, i) => ({ id: m.waMessageId ?? `f-${i}`, evento: m, guardado: true }));
    for (const f of filas) guardados.push(f.id);
    return { guardados: filas.length, fallidos: 0, filas };
  },
  reclamarPendiente: async (id: string) => ({ id, evento: { waMessageId: id, from: 'x', type: 'text', text: 'hola' }, intentos: 1 }),
  marcarPendienteProcesado: async () => {},
  anotarFalloPendiente: async () => {},
}));

const { POST } = await import('./route');

const firmar = (body: string) => 'sha256=' + crypto.createHmac('sha256', SECRETO).update(body).digest('hex');

/** El techo real del webhook (`MSGS_POR_MIN`). El lote lo desborda a propósito. */
const TECHO = 40;

/** Un POST con `n` mensajes del MISMO teléfono — el limitador es por teléfono. */
function lote(telefono: string, ids: string[]) {
  return JSON.stringify({
    entry: [{ changes: [{ value: { messages: ids.map((id) => ({
      id, from: telefono, timestamp: '1714510003', type: 'text', text: { body: 'hola' },
    })) } }] }],
  });
}

async function postear(body: string) {
  const res = await POST(new Request('https://likida.ai/api/webhook/whatsapp', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': firmar(body) }, body,
  }) as never);
  while (pendientes.length) await pendientes.shift()!();
  return res;
}

// El limitador vive en memoria del módulo y es POR TELÉFONO, así que cada
// prueba usa el suyo: reusarlo acopla las pruebas entre sí.
let telefonoSeq = 0;
const otroTelefono = () => `52199900035${String(++telefonoSeq).padStart(2, '0')}`;

beforeEach(() => { vi.clearAllMocks(); yaEnBandeja = new Set(); guardados.length = 0; });

describe('DAT-34 · lo que ya está en la bandeja no vuelve a gastar cupo', () => {
  it('CONTROL — sin dedup previo, un lote sobre el techo difiere el excedente', async () => {
    const tel = otroTelefono();
    const ids = Array.from({ length: TECHO + 5 }, (_, i) => `wamid.c${i}`);
    const res = await postear(lote(tel, ids));
    expect(res.status, 'lo que no cupo se aplaza con 429').toBe(429);
    await expect(res.json()).resolves.toMatchObject({ received: TECHO, diferidos: 5 });
  });

  // ── LA REENTREGA ──────────────────────────────────────────────────────────
  it('EL HALLAZGO: en la reentrega, los ya guardados no consumen el techo', async () => {
    const tel = otroTelefono();
    const yaGuardados = Array.from({ length: TECHO }, (_, i) => `wamid.r${i}`);
    const nuevos = ['wamid.rN1', 'wamid.rN2', 'wamid.rN3', 'wamid.rN4', 'wamid.rN5'];
    // Así queda el mundo tras la primera entrega: 40 en la bandeja, 5 sin entrar.
    yaEnBandeja = new Set(yaGuardados);

    const res = await postear(lote(tel, [...yaGuardados, ...nuevos]));

    // Antes: los 40 volvían a gastar los 40 cupos y los 5 nuevos se diferían
    // otra vez — para siempre, hasta que Meta se rindiera.
    // El 200 es la afirmación que importa: «esto quedó, no lo vuelvas a
    // mandar». El cuerpo del 200 no lleva `diferidos` porque no hubo ninguno.
    expect(res.status, 'ya no queda nada pendiente: 200, no 429').toBe(200);
    await expect(res.json()).resolves.toMatchObject({ received: TECHO + 5 });
    for (const id of nuevos) {
      expect(guardados, `${id} tenía que entrar en esta reentrega`).toContain(id);
    }
  });

  it('el techo SIGUE existiendo para los que de verdad son nuevos', async () => {
    // La deduplicación no puede convertirse en un permiso ilimitado: una ráfaga
    // genuina de mensajes nuevos se sigue aplazando igual que antes.
    const tel = otroTelefono();
    const ids = Array.from({ length: TECHO + 3 }, (_, i) => `wamid.n${i}`);
    const res = await postear(lote(tel, ids));
    await expect(res.json()).resolves.toMatchObject({ received: TECHO, diferidos: 3 });
  });
});
