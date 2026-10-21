import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria, type Fila } from '@/lib/pruebas/tablas_en_memoria.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 28 — HALLAZGO ALTO #1: el "freno de emergencia" del rate-limit de
// A7 Cobranza (`TOPE_RECHAZOS_META_COBRANZA = 5`: cinco rechazos reintentables
// SEGUIDOS detienen la corrida de la flota, marcan `rechazoMasivo` y llaman
// `alertarOperador('wa.rechazo_masivo', ...)`) NO TENÍA NINGUNA PRUEBA. Esta
// suite cierra ese hueco con una base en memoria REAL (filtra por tenant/id
// de verdad, a diferencia de los dobles manuales de `vi.fn()` encadenados):
//
//   (a) 5 rechazos reintentables SEGUIDOS SÍ activan `rechazoMasivo` y
//       detienen la corrida DE LA FLOTA (`ejecutarCobranza`).
//   (b) `ejecutarCobranzaGlobal` SÍ detiene las flotas restantes cuando una
//       activa `rechazoMasivo` (RES-1: el problema es del número compartido,
//       no de una flota — ver también cobranza_reparto.test.ts).
//   (c) 4 rechazos + 1 éxito NO activan el freno: confirma que el tope es de
//       rechazos SEGUIDOS, no acumulados en la corrida.
// ═══════════════════════════════════════════════════════════════════════════

const estado = vi.hoisted(() => ({ db: null as unknown as BaseEnMemoria }));
const meta = vi.hoisted(() => ({ enviarTexto: vi.fn(), sendTemplate: vi.fn() }));
const alerta = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => estado.db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: alerta }));
vi.mock('../perfil/preguntas', () => ({ ventanaCobranzaDeclarada: () => null }));
vi.mock('../repo', () => ({ getPerfilCrudo: async () => null }));
vi.mock('./notificaciones', () => ({ avisarCorridasPorFlota: async () => {} }));
vi.mock('./corridas', () => ({ registrarCorrida: async () => {} }));
vi.mock('@/lib/likida/wa_ventana', () => ({
  // Ventana SIEMPRE abierta: `enviarConFallback` intenta el texto directo
  // (sin plantilla), que es lo que estos rechazos simulan.
  ventanaDeContacto: async () => ({ estado: 'abierta' }),
  registrarDecisionEnvio: async () => {},
}));
vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  enviarTexto: (...a: unknown[]) => meta.enviarTexto(...a),
  sendTemplate: (...a: unknown[]) => meta.sendTemplate(...a),
}));

const { ejecutarCobranza, ejecutarCobranzaGlobal } = await import('./cobranza');

// Martes-con-ventana: 2026-08-18 es un martes (día ISO 2, permitido por el
// default); 17:00Z = 11:00 CDMX, dentro de 9-18.
const AHORA = new Date('2026-08-18T17:00:00Z');

function config(tenant: string): Fila {
  return {
    tenant_id: tenant, activo: true, tiers: [3, 7, 14], hora_inicio: 9, hora_fin: 18,
    dias_semana: [1, 2, 3, 4, 5, 6], instrucciones: '', firma: '', por_gasto: false,
  };
}

function viaje(tenant: string, id: string, telefono: string): Fila {
  return {
    id, tenant_id: tenant, folio: `F-${id}`, fecha_inicio: '2026-08-15',
    avisado_en: '2026-08-15T10:00:00Z', recordatorio_comprobacion_en: null,
    estatus: 'abierto', operador: { nombre: `Op-${id}`, telefono },
  };
}

function nuevaBase(inicial: Record<string, Fila[]>) {
  estado.db = crearBaseEnMemoria(
    { viaje: [], agente_cobranza_config: [], cobranza_contacto: [], cobranza_gasto_contacto: [], ...inicial },
    [{ tabla: 'cobranza_contacto', nombre: 'cobranza_contacto_viaje_id_tier_key', columnas: ['viaje_id', 'tier'] }],
  );
}

const contactos = () => estado.db.tabla('cobranza_contacto');

/** Rechazo "vuelve más tarde" (429, sin código): reintentable Y encolado — el
 *  mismo caso que `client.ts` encola en `wa_outbox` del lado del productor. */
const RECHAZO_429 = { ok: false, error: 'rate limit', status: 429 } as const;
const EXITO = { ok: true, id: 'wamid.OK' } as const;

beforeEach(() => {
  meta.enviarTexto.mockReset();
  meta.sendTemplate.mockReset().mockResolvedValue(EXITO);
  alerta.mockReset().mockResolvedValue(undefined);
});

describe('(a) 5 rechazos reintentables SEGUIDOS activan rechazoMasivo y detienen la corrida', () => {
  it('con 6 viajes en cola, los 5 primeros se intentan y rechazan; el 6° NUNCA se toca', async () => {
    nuevaBase({
      agente_cobranza_config: [config('t1')],
      viaje: [
        viaje('t1', 'v1', '5210000001'), viaje('t1', 'v2', '5210000002'), viaje('t1', 'v3', '5210000003'),
        viaje('t1', 'v4', '5210000004'), viaje('t1', 'v5', '5210000005'), viaje('t1', 'v6', '5210000006'),
      ],
    });
    meta.enviarTexto.mockResolvedValue(RECHAZO_429);

    const r = await ejecutarCobranza('t1', AHORA);

    expect(r.rechazoMasivo).toBe(true);
    expect(r.rechazosReintentables).toBe(5);
    expect(r.contactados).toBe(0);
    expect(meta.enviarTexto).toHaveBeenCalledTimes(5); // el 6° jamás se intenta
    expect(meta.enviarTexto).not.toHaveBeenCalledWith('5210000006', expect.anything());
    expect(contactos().map((c) => c.viaje_id).sort()).toEqual(['v1', 'v2', 'v3', 'v4', 'v5']);
    expect(contactos().some((c) => c.viaje_id === 'v6')).toBe(false); // sin claim: el tier queda intacto
    // El operador se enteró (RES-1): un bloqueo de Meta no debe pasar en silencio.
    expect(alerta).toHaveBeenCalledWith('wa.rechazo_masivo', expect.objectContaining({ codigo: 'wa_rechazo_masivo' }));
    // Lo que no se alcanzó a intentar se DICE, no se pierde.
    expect(r.cortadosPorReloj).toBe(1);
  });
});

describe('(c) 4 rechazos + 1 éxito NO activan el freno (es "seguidos", no acumulado)', () => {
  it('4 rechazos, 1 éxito, y 4 rechazos más (8 en total, nunca 5 seguidos): la corrida sigue entera', async () => {
    nuevaBase({
      agente_cobranza_config: [config('t1')],
      viaje: [
        viaje('t1', 'v1', '5210000001'), viaje('t1', 'v2', '5210000002'), viaje('t1', 'v3', '5210000003'),
        viaje('t1', 'v4', '5210000004'), viaje('t1', 'v5', '5210000005'), viaje('t1', 'v6', '5210000006'),
        viaje('t1', 'v7', '5210000007'), viaje('t1', 'v8', '5210000008'), viaje('t1', 'v9', '5210000009'),
      ],
    });
    // v1-v4 rechazan, v5 sale bien (resetea el contador), v6-v9 rechazan de nuevo.
    meta.enviarTexto
      .mockResolvedValueOnce(RECHAZO_429).mockResolvedValueOnce(RECHAZO_429)
      .mockResolvedValueOnce(RECHAZO_429).mockResolvedValueOnce(RECHAZO_429)
      .mockResolvedValueOnce(EXITO)
      .mockResolvedValueOnce(RECHAZO_429).mockResolvedValueOnce(RECHAZO_429)
      .mockResolvedValueOnce(RECHAZO_429).mockResolvedValueOnce(RECHAZO_429);

    const r = await ejecutarCobranza('t1', AHORA);

    expect(r.rechazoMasivo).toBeUndefined();
    expect(r.rechazosReintentables).toBe(8);
    expect(r.contactados).toBe(1);
    expect(meta.enviarTexto).toHaveBeenCalledTimes(9); // los 9 viajes SÍ se intentaron, nadie se cortó
    expect(r.cortadosPorReloj).toBe(0);
    expect(alerta).not.toHaveBeenCalled();
  });

  it('exactamente 4 rechazos seguidos, sin un 5°, tampoco activan el freno', async () => {
    nuevaBase({
      agente_cobranza_config: [config('t1')],
      viaje: [
        viaje('t1', 'v1', '5210000001'), viaje('t1', 'v2', '5210000002'),
        viaje('t1', 'v3', '5210000003'), viaje('t1', 'v4', '5210000004'),
      ],
    });
    meta.enviarTexto.mockResolvedValue(RECHAZO_429);

    const r = await ejecutarCobranza('t1', AHORA);

    expect(r.rechazoMasivo).toBeUndefined();
    expect(r.rechazosReintentables).toBe(4);
    expect(meta.enviarTexto).toHaveBeenCalledTimes(4);
    expect(alerta).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 28 — HALLAZGO ALTO #2: un timeout de red (o cualquier rechazo que
// el cliente de Meta ya haya dejado en `wa_outbox`, ver `encolado` en
// enviar_con_fallback.ts) NO debe producir un segundo envío REAL del mismo
// recordatorio. Esta prueba corre DOS corridas sucesivas sobre una base en
// memoria con estado real: si el fix no conservara el claim, la segunda
// corrida volvería a llamar a Meta para el MISMO tier.
// ═══════════════════════════════════════════════════════════════════════════
describe('HALLAZGO 2: un timeout de red no produce un segundo envío real (claim conservado entre corridas)', () => {
  it('status 503 sin código (mismo contrato que el catch de red de enviarTexto en client.ts): el claim se conserva y la corrida siguiente NO vuelve a llamar a Meta', async () => {
    nuevaBase({
      agente_cobranza_config: [config('t1')],
      viaje: [viaje('t1', 'v1', '5210000001')],
    });
    // Exactamente lo que devuelve `enviarTexto` cuando el `fetch` hacia
    // graph.facebook.com truena: sin código de Meta, status 503 — y el
    // cliente YA dejó este payload en `wa_outbox` (RETRASO_AMBIGUO_SEGUNDOS).
    const TIMEOUT_RED = { ok: false, error: 'No se pudo contactar a WhatsApp: fetch failed', status: 503 } as const;
    meta.enviarTexto.mockResolvedValue(TIMEOUT_RED);

    const r1 = await ejecutarCobranza('t1', AHORA);
    expect(r1.contactados).toBe(0);
    expect(r1.rechazosReintentables).toBe(1);
    expect(contactos()).toEqual([expect.objectContaining({ viaje_id: 'v1', tier: 3, enviado: false })]);
    expect(String(contactos()[0].detalle)).toMatch(/ya en la cola de salida de WhatsApp/);

    // Segunda corrida, una hora después: si el código liberara el tier aquí,
    // llamaría a Meta DE CERO — y si el primer intento (que Meta pudo haber
    // ACEPTADO pese al timeout) y este segundo intento AMBOS llegaran a
    // salir, el chofer recibiría el mismo recordatorio dos veces.
    meta.enviarTexto.mockClear();
    const r2 = await ejecutarCobranza('t1', new Date(AHORA.getTime() + 3_600_000));
    expect(meta.enviarTexto).not.toHaveBeenCalled();
    expect(r2.revisados).toBe(0); // nada pendiente: el tier ya quedó resuelto, sin segundo intento
    expect(contactos()).toHaveLength(1); // ninguna fila nueva
  });
});

describe('(b) ejecutarCobranzaGlobal detiene las flotas RESTANTES cuando una activa rechazoMasivo', () => {
  it('t-mala corre primero (rotación), dispara rechazoMasivo, y t-buena NUNCA llega a intentar nada', async () => {
    nuevaBase({
      agente_cobranza_config: [config('t-mala'), config('t-buena')],
      viaje: [
        viaje('t-mala', 'v1', '5210000001'), viaje('t-mala', 'v2', '5210000002'),
        viaje('t-mala', 'v3', '5210000003'), viaje('t-mala', 'v4', '5210000004'),
        viaje('t-mala', 'v5', '5210000005'),
        viaje('t-buena', 'v6', '5219999999'), // si llegara a correr, SALDRÍA BIEN — por eso es la prueba
      ],
    });
    // Orden alfabético sin rotar: [t-buena, t-mala]. A las 17:00Z (hora
    // impar) la rotación de 2 elementos empieza en el índice 1 → t-mala
    // corre PRIMERO (ver rotarPorHora en cobranza_reparto.test.ts).
    meta.enviarTexto.mockResolvedValue(RECHAZO_429);

    const r = await ejecutarCobranzaGlobal(AHORA);

    expect(r.rechazoMasivo).toBe(true);
    expect(r.tenants).toBe(2);
    expect(r.contactados).toBe(0);
    // Las 5 llamadas son TODAS de t-mala: t-buena nunca marcó.
    expect(meta.enviarTexto).toHaveBeenCalledTimes(5);
    expect(meta.enviarTexto).not.toHaveBeenCalledWith('5219999999', expect.anything());
    expect(contactos().every((c) => c.tenant_id === 't-mala')).toBe(true);
    expect(contactos().some((c) => c.tenant_id === 't-buena')).toBe(false);
    // t-buena se queda sin turno, pero SE DICE (no se pierde en silencio).
    expect(r.cortadosPorReloj).toBeGreaterThanOrEqual(1);
  });
});
