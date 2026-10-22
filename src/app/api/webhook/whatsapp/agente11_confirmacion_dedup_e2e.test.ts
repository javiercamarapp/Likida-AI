import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { crearDbMemoria, type DbMemoria } from '@/lib/likida/e2e/db_memoria.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// HALLAZGO 2 (auditoría, A11 Comunicación con operadores) — el e2e dedicado
// (`agente-11-comunicacion-operadores.e2e.test.ts`) llama DIRECTAMENTE a
// `atenderConfirmacion`/`aceptarPorActividad`, saltándose `route.ts` (firma
// HMAC, rate limit) y el dispatcher real (`processInbound`/`procesarTurno`).
// Su propio comentario lo admite: "DOBLES: base en memoria, Meta."
//
// Este archivo cierra esa costura: entra por el POST REAL del webhook, con
// firma HMAC REAL, y deja CORRER el dedup REAL (`claimMessage` /
// `wa_mensaje_procesado`, vía RPC) y la confirmación REAL
// (`atenderConfirmacion`, `marcarAceptado`) — NINGUNO de los tres se mockea.
// Lo único mockeado es lo que NO es el objeto de esta prueba: la resolución
// del operador (fija, no es dato bajo prueba), el aviso de privacidad (ya
// probado en `privacidad*.test.ts`), el jefe de tráfico y el briefing de
// Agente 5 (ya probados en sus propios e2e).
//
// LA PRUEBA DE QUE EL DEDUP REAL —no el de la bandeja `wa_pendientes`, que
// aquí se deja en modo paso-directo como en `canal_e2e.test.ts`— es quien
// evita el reproceso: en la reentrega, `resolveOperador` (que solo se llama
// DESPUÉS del claim, dentro de `procesarTurno`) se invoca CERO veces extra.
// Si el claim no dedupera de verdad, `procesarTurno` correría una segunda vez
// y `resolveOperador` subiría a 2 — el guardia `is('aceptado_en', null)` de
// `marcarAceptado` NO alcanzaría a esconder eso, porque ni siquiera se
// llegaría a tocar la tabla `viaje` una segunda vez con el claim real.
// ═══════════════════════════════════════════════════════════════════════════

const SECRETO = 'app-secret-agente11-dedup';
process.env.WHATSAPP_APP_SECRET = SECRETO;

const TENANT = 't1';
const OPERADOR = 'o1';
const DESDE_META = '5219993700001';

// ── El claim REAL de `wa_mensaje_procesado`, como RPC con estado ───────────
// `claimMessage`/`completarMessageClaim`/`releaseMessageClaim` (conv.ts) NO
// se mockean: solo se les da una base en memoria que entiende las tres RPC
// que de verdad llaman (`claim_wa_mensaje_procesado`,
// `complete_wa_mensaje_procesado`, `fail_wa_mensaje_procesado`).
let mensajesClaim: Map<string, { estado: 'procesando' | 'completado'; token: string; owner: string }>;
let claimSeq = 0;

function nuevoDb(): DbMemoria {
  mensajesClaim = new Map();
  claimSeq = 0;
  return crearDbMemoria(
    {
      viaje: [{
        id: 'v1', tenant_id: TENANT, operador_id: OPERADOR, folio: 'F-2026',
        origen: 'Mérida', destino: 'Cancún', estatus: 'abierto',
        aceptado_en: null, rechazado_en: null, avisado_en: '2026-10-02T12:00:00Z',
        created_at: '2026-10-02T12:00:00Z',
      }],
    },
    {
      claim_wa_mensaje_procesado: (args) => {
        const id = String(args.p_wa_message_id);
        const existente = mensajesClaim.get(id);
        if (!existente) {
          const token = `tok-${++claimSeq}`;
          mensajesClaim.set(id, { estado: 'procesando', token, owner: String(args.p_lease_owner) });
          return [{ estado: 'nuevo', lease_token: token }];
        }
        if (existente.estado === 'completado') return [{ estado: 'duplicado', lease_token: null }];
        return [{ estado: 'en_curso', lease_token: null }];
      },
      complete_wa_mensaje_procesado: (args) => {
        const id = String(args.p_wa_message_id);
        const fila = mensajesClaim.get(id);
        if (fila && fila.token === args.p_lease_token && fila.owner === args.p_lease_owner) {
          fila.estado = 'completado';
          return true;
        }
        return false;
      },
      fail_wa_mensaje_procesado: (args) => { mensajesClaim.delete(String(args.p_wa_message_id)); return true; },
      renew_wa_mensaje_procesado: () => true,
    },
  );
}

let db: DbMemoria = nuevoDb();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));

// ── El interruptor REAL de kill switch, pero ENCENDIDO en este E2E ────────
vi.mock('@/lib/likida/interruptores', () => ({
  estaApagado: vi.fn(async () => false),
  leerInterruptor: vi.fn(async () => 'encendido' as const),
}));

// ── La bandeja durable (`wa_evento_pendiente`): persistir → reclamar →
// procesar, en modo paso-directo (su propio contrato vive en
// `route_dedup_ratelimit.test.ts`; aquí NO es lo que se prueba). ───────────
const bandejaInbox = new Map<string, unknown>();
vi.mock('@/lib/likida/wa_pendientes', () => ({
  pendientesYaConocidos: async () => new Set<string>(),
  guardarEventosPendientes: async (ms: Array<{ waMessageId?: string }>) => {
    const filas = ms.map((m, i) => {
      const id = m.waMessageId ?? `f-${i}`;
      bandejaInbox.set(id, m);
      return { id, evento: m, guardado: true };
    });
    return { guardados: filas.length, fallidos: 0, filas };
  },
  reclamarPendiente: async (id: string) => (bandejaInbox.has(id) ? { id, evento: bandejaInbox.get(id), intentos: 1 } : null),
  marcarPendienteProcesado: async () => undefined,
  anotarFalloPendiente: async () => undefined,
  devolverIntentoPendiente: async () => undefined,
  iniciarRenovacionLease: () => () => {},
}));

// ── Oficina/jefe de tráfico: no es el objeto de esta prueba (A11 es el
// canal con el OPERADOR); se deja sin jefe configurado, como la mayoría de
// las flotas reales. ────────────────────────────────────────────────────
vi.mock('@/lib/likida/contactos', () => ({
  resolverCuentaOficina: vi.fn(async () => null),
  telefonoJefeDe: vi.fn(async () => null),
  telefonosJefe: vi.fn(async () => ({})),
}));

// ── El aviso de privacidad: su propio contrato vive en
// `privacidad*.test.ts`. `reclamarEnvioAviso: false` = "ya se había puesto"
// (el camino MÁS común, no un atajo artificial) → `ponerAvisoADisposicion`
// devuelve 'puesto' sin mandar nada. ───────────────────────────────────────
vi.mock('@/lib/likida/repo', () => ({
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'TRANSPORTES DE PRUEBA SA DE CV', domicilio: 'Calle 1, Mérida',
    urlAvisoIntegral: 'https://flota.mx/privacidad',
  })),
  reclamarEnvioAviso: vi.fn(async () => false),
  liberarEnvioAviso: vi.fn(),
  confirmarEnvioAviso: vi.fn(),
  // `leerConfigConductor` (conductor/repo.ts) la importa para fijar la zona
  // horaria de la flota; sin fila = CDMX por default, igual que en producción.
  getZonaHorariaTenant: vi.fn(async () => null),
}));

vi.mock('@/lib/likida/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));

// El agente LLM de conversación libre nunca se alcanza en este camino (la
// confirmación de inicio de viaje intercepta y `return`); se mockea solo
// para no exigir credenciales de proveedor al importar el módulo.
vi.mock('@/lib/agents/run', () => ({ runAgent: vi.fn() }));

// El briefing de Agente 5 (Conductor) al arrancar el viaje: su propio
// contrato vive en `briefing_inicio_wa.test.ts` / `processor_briefing_actividad.test.ts`.
// Aquí solo importa que se DISPARE una vez (prueba del cableado), no su texto.
const enviarBriefingInicio = vi.fn(async (..._a: unknown[]) => 'enviado' as const);
vi.mock('@/lib/likida/briefing_inicio_wa', () => ({ enviarBriefingInicio: (...a: unknown[]) => enviarBriefingInicio(...a) }));

// ── `conv.ts`: SOLO se fija la identidad (quién escribe) y la conversación
// guardada — todo lo que SÍ es el objeto de la prueba (`claimMessage`,
// `completarMessageClaim`, `releaseMessageClaim`, `getOpenViaje`) se deja
// REAL, vía `original()`. Mismo patrón que `wa_ventana` en el e2e de
// Agente 11 existente (`agente-11-comunicacion-operadores.e2e.test.ts`).
const resolveOperador = vi.fn(async (..._a: unknown[]) => ({ tenantId: TENANT, operadorId: OPERADOR }));
vi.mock('@/lib/likida/conv', async (original) => {
  const real = await original<typeof import('@/lib/likida/conv')>();
  return {
    ...real,
    resolveOperador: (...a: unknown[]) => resolveOperador(...a),
    getTenantContext: vi.fn(async () => ({ nombre: 'Flota de prueba' })),
    loadConversation: vi.fn(async () => ({ id: 'c1', turns: [], intentosConfirmacion: 0, cierreSinComprobantes: undefined })),
    saveConversation: vi.fn(),
  };
});

// ── Meta: se deja REAL `verifySignature`/`verifyWebhookChallenge`/
// `esReintentableMeta` (son justo lo que prueba el HALLAZGO 2); solo se
// evita la llamada HTTP real de `sendText`. ────────────────────────────────
const sendText = vi.fn(async (..._a: unknown[]) => 'wamid.OUT');
vi.mock('@/lib/meta/client', async (original) => {
  const real = await original<typeof import('@/lib/meta/client')>();
  return { ...real, sendText: (...a: unknown[]) => sendText(...a) };
});

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/observability/sentry', () => ({ flushObservabilidad: vi.fn(async () => {}), codigoDeError: () => 'x' }));

const pendientesAfter: Array<() => unknown> = [];
vi.mock('next/server', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, after: (fn: () => unknown) => { pendientesAfter.push(fn); } };
});

const { POST } = await import('./route');

const firmar = (body: string) => 'sha256=' + crypto.createHmac('sha256', SECRETO).update(body).digest('hex');

/** El POST firmado de Meta con UN mensaje de texto del chofer. */
function payloadSi(waMessageId: string): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: '1', changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          messages: [{ from: DESDE_META, id: waMessageId, timestamp: '1900000000', type: 'text', text: { body: 'sí' } }],
        },
      }],
    }],
  });
}

async function postear(body: string) {
  const res = await POST(new Request('https://app.likida.ai/api/webhook/whatsapp', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': firmar(body) }, body,
  }) as never);
  while (pendientesAfter.length) await pendientesAfter.shift()!();
  return res;
}

const viaje = () => db.tablas.viaje.find((v) => v.id === 'v1')!;

beforeEach(() => {
  db = nuevoDb();
  bandejaInbox.clear();
  pendientesAfter.length = 0;
  resolveOperador.mockClear();
  sendText.mockClear();
  enviarBriefingInicio.mockClear();
});

describe('Agente 11 · confirmación de inicio de viaje por el HTTP real del webhook', () => {
  it('«sí» entra por route.ts con firma HMAC real y el dispatcher real confirma el viaje', async () => {
    const res = await postear(payloadSi('wamid.CONFIRM-1'));

    expect(res.status).toBe(200);
    // El motor REAL (`marcarAceptado`, el UPDATE con `is('aceptado_en', null)`)
    // dejó la constancia, no un doble que simule el resultado.
    expect(viaje().aceptado_en).not.toBeNull();
    // Y salió UN acuse real por `sendText` (el "va, arrancamos:" de `decidirInicio`).
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0][0]).toBe(DESDE_META);
    expect(String(sendText.mock.calls[0][1])).toMatch(/F-2026/);
    // Y el cableado del briefing de Agente 5 se disparó (una sola vez: fue la
    // primera aceptación, el `ok` de `marcarAceptado`).
    expect(enviarBriefingInicio).toHaveBeenCalledTimes(1);
    expect(enviarBriefingInicio).toHaveBeenCalledWith(TENANT, 'v1');
  });

  it('sin firma válida, nada corre: ni el dispatcher ni la confirmación arrancan', async () => {
    const body = payloadSi('wamid.SIN-FIRMA');
    const res = await POST(new Request('https://app.likida.ai/api/webhook/whatsapp', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=invalida' }, body,
    }) as never);
    while (pendientesAfter.length) await pendientesAfter.shift()!();

    expect(res.status).toBe(401);
    expect(resolveOperador).not.toHaveBeenCalled();
    expect(viaje().aceptado_en).toBeNull();
  });

  describe('la reentrega duplicada de Meta (MISMO wa_message_id)', () => {
    it('el dedup REAL de `wa_mensaje_procesado` evita procesar dos veces — no un simulacro', async () => {
      const WAMID = 'wamid.CONFIRM-REENTREGA';

      const primera = await postear(payloadSi(WAMID));
      expect(primera.status).toBe(200);
      const aceptadoEn1 = viaje().aceptado_en;
      expect(aceptadoEn1).not.toBeNull();

      // Meta reentrega el MISMO POST, con el MISMO wamid — el escenario real
      // de un webhook que tardó en contestar o cuyo ack se perdió.
      const segunda = await postear(payloadSi(WAMID));
      expect(segunda.status).toBe(200);

      // ── LA PRUEBA DE QUE EL DEDUP ES REAL, NO EL CANDADO DE `marcarAceptado` ──
      // `claimMessage` vive en `conv.ts` y corre DENTRO de `processInbound`,
      // ANTES de `procesarTurno` — así que si de verdad marcó esta reentrega
      // como 'duplicado', `procesarTurno` NUNCA se vuelve a invocar y
      // `resolveOperador` (que solo se llama DENTRO de `procesarTurno`) sigue
      // en 1. Si el dedup fuera un simulacro (o no corriera), esta cifra subiría
      // a 2 — el `is('aceptado_en', null)` de `marcarAceptado` habría tapado el
      // reproceso sin que nadie lo notara.
      expect(resolveOperador).toHaveBeenCalledTimes(1);

      // Y por la misma razón, la tabla `viaje` solo se LEYÓ las DOS veces de
      // un único turno (`getOpenViaje` + `viajesPorConfirmar`, dentro de
      // `procesarTurno`/`atenderConfirmacion`) — la reentrega nunca llegó a
      // tocar la base del cuadre una segunda vez.
      const lecturasViaje = db.llamadas.filter((l) => l.tabla === 'viaje' && l.op === 'select');
      expect(lecturasViaje).toHaveLength(2);

      // Un solo acuse de WhatsApp en total (no dos "va, arrancamos:" para el
      // mismo chofer) y un solo disparo del briefing.
      expect(sendText).toHaveBeenCalledTimes(1);
      expect(enviarBriefingInicio).toHaveBeenCalledTimes(1);

      // La hora de aceptación de la PRIMERA entrega se conserva intacta.
      expect(viaje().aceptado_en).toBe(aceptadoEn1);
    });

    it('CONTROL — dos mensajes DISTINTOS (wamid distinto) del mismo chofer SÍ son dos turnos', async () => {
      // No es que el canal se haya vuelto incapaz de procesar un segundo
      // mensaje: es que el PRIMER "sí" ya aceptó el viaje, así que el
      // segundo "sí" (ya sin nada por confirmar) cae en `mensaje: null` y
      // sigue su camino normal sin volver a tocar `marcarAceptado`. La
      // diferencia con el caso de arriba es el wamid, no el contenido.
      await postear(payloadSi('wamid.A'));
      expect(resolveOperador).toHaveBeenCalledTimes(1);

      await postear(payloadSi('wamid.B'));
      // Dos wamids distintos SÍ corren el dispatcher dos veces — el dedup
      // real actúa por MENSAJE, no por contenido ni por remitente.
      expect(resolveOperador).toHaveBeenCalledTimes(2);
    });
  });
});
