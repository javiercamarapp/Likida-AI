import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria, type Fila } from '@/lib/pruebas/tablas_en_memoria.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA ADVERSARIAL (HALLAZGO 2, A7 COBRANZA, 21-oct-2026) — EL FRENO DE
// RECHAZO MASIVO NO SOBREVIVÍA ENTRE INVOCACIONES.
//
// `rechazosSeguidos` (cobranza.ts/cobranza_gasto.ts) es una variable LOCAL a
// cada llamada de `ejecutarCobranza`. `ejecutarCobranzaGlobal` la propaga
// bien ENTRE flotas porque las recorre en un bucle secuencial DENTRO DE LA
// MISMA invocación — pero el botón "Ejecutar ahora" del panel
// (`dashboard/agentes/cobranza/page.tsx`) llama `ejecutarCobranza` DIRECTO
// por tenant, por fuera de ese bucle. Dos corridas manuales casi
// simultáneas (de flotas distintas, o del mismo superadmin insistiendo)
// podían acumular 5+5 rechazos contra el MISMO número de WhatsApp
// compartido antes de que cualquiera de las dos viera el freno de la otra.
//
// El fix (0854, `freno_temporal` + `interruptores.ts`): la marca que deja
// la PRIMERA invocación que llega al tope es compartida en la base (TTL
// corto, se suelta sola) y la SIGUIENTE invocación — manual o del cron — la
// consulta al INICIO, antes de intentar nada.
//
// Esta suite fija, con una base en memoria REAL (filtra por id de verdad,
// mismo arnés que `cobranza_freno_emergencia.test.ts`):
//   (a) la flota que dispara el rechazo masivo deja la marca;
//   (b) una SEGUNDA llamada "manual" (otro tenant), hecha justo después, VE
//       la marca al inicio y no vuelve a golpear WhatsApp — el total de
//       rechazos entre las dos llamadas se queda en 5, nunca en 10;
//   (c) pasado el TTL, la marca ya no frena — se suelta sola, sin que nadie
//       la apague a mano (a diferencia del kill switch de `interruptor`).
//
// `../interruptores` NO se mockea (a propósito, igual que
// `cobranza_freno_emergencia.test.ts`): corre el módulo real contra la base
// en memoria vía el mismo `supabaseAdmin` ya mockeado — es la integración
// real la que este hallazgo necesitaba.
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

const { ejecutarCobranza } = await import('./cobranza');

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
    { viaje: [], agente_cobranza_config: [], cobranza_contacto: [], cobranza_gasto_contacto: [], freno_temporal: [], ...inicial },
    [{ tabla: 'cobranza_contacto', nombre: 'cobranza_contacto_viaje_id_tier_key', columnas: ['viaje_id', 'tier'] }],
  );
}

const contactos = () => estado.db.tabla('cobranza_contacto');
const freno = () => estado.db.tabla('freno_temporal');

/** Rechazo "vuelve más tarde" (429, sin código): reintentable Y encolado. */
const RECHAZO_429 = { ok: false, error: 'rate limit', status: 429 } as const;
const EXITO = { ok: true, id: 'wamid.OK' } as const;

beforeEach(() => {
  meta.enviarTexto.mockReset();
  meta.sendTemplate.mockReset().mockResolvedValue(EXITO);
  alerta.mockReset().mockResolvedValue(undefined);
});

describe('el freno de rechazo masivo SOBREVIVE entre invocaciones (HALLAZGO 2)', () => {
  it('t-mala dispara el freno y deja la marca en freno_temporal', async () => {
    nuevaBase({
      agente_cobranza_config: [config('t-mala')],
      viaje: [
        viaje('t-mala', 'v1', '5210000001'), viaje('t-mala', 'v2', '5210000002'),
        viaje('t-mala', 'v3', '5210000003'), viaje('t-mala', 'v4', '5210000004'),
        viaje('t-mala', 'v5', '5210000005'),
      ],
    });
    meta.enviarTexto.mockResolvedValue(RECHAZO_429);

    const r = await ejecutarCobranza('t-mala', AHORA, { ignorarVentana: true });

    expect(r.rechazoMasivo).toBe(true);
    expect(freno()).toHaveLength(1);
    expect(freno()[0]).toMatchObject({ id: 'cobranza:rechazo_masivo_whatsapp' });
    expect(new Date(freno()[0].activo_hasta as string).getTime()).toBeGreaterThan(AHORA.getTime());
  });

  it('dos llamadas "manuales" back-to-back: la segunda (otro tenant) VE la marca de la primera y nunca golpea WhatsApp — el total de rechazos se queda en 5, no en 10', async () => {
    nuevaBase({
      agente_cobranza_config: [config('t-mala'), config('t-buena')],
      viaje: [
        viaje('t-mala', 'v1', '5210000001'), viaje('t-mala', 'v2', '5210000002'),
        viaje('t-mala', 'v3', '5210000003'), viaje('t-mala', 'v4', '5210000004'),
        viaje('t-mala', 'v5', '5210000005'),
        // t-buena: si llegara a intentarse, SALDRÍA BIEN — por eso es la prueba.
        viaje('t-buena', 'vB1', '5219999991'), viaje('t-buena', 'vB2', '5219999992'),
        viaje('t-buena', 'vB3', '5219999993'), viaje('t-buena', 'vB4', '5219999994'),
        viaje('t-buena', 'vB5', '5219999995'),
      ],
    });
    meta.enviarTexto.mockResolvedValue(RECHAZO_429);

    // Llamada "manual" #1 (el botón "Ejecutar ahora" de t-mala): dispara el
    // tope de 5, deja la marca compartida.
    const r1 = await ejecutarCobranza('t-mala', AHORA, { ignorarVentana: true });
    expect(r1.rechazoMasivo).toBe(true);
    expect(meta.enviarTexto).toHaveBeenCalledTimes(5);

    // Llamada "manual" #2, HECHA JUSTO DESPUÉS (otro tenant, otra persona
    // clicando el mismo botón): sin el fix, esta llamada no sabía NADA de
    // la primera — su propio `rechazosSeguidos` local arrancaba en 0 y
    // volvía a golpear el MISMO número 5 veces más (10 en total). Con el
    // fix, ve la marca al inicio y se abstiene por completo.
    meta.enviarTexto.mockClear();
    const r2 = await ejecutarCobranza('t-buena', AHORA, { ignorarVentana: true });

    expect(r2.omitido).toMatch(/rechazo masivo/);
    expect(r2.contactados).toBe(0);
    expect(meta.enviarTexto).not.toHaveBeenCalled();
    expect(contactos().some((c) => c.tenant_id === 't-buena')).toBe(false);
    // El total de rechazos reintentables entre las DOS llamadas se queda en
    // 5 (los de t-mala): t-buena nunca llegó a intentar el suyo.
    expect(contactos().filter((c) => c.enviado === false && c.detalle !== null).length).toBeLessThanOrEqual(5);
  });

  it('pasado el TTL, el freno se suelta SOLO: la siguiente corrida vuelve a correr sin que nadie lo apague a mano', async () => {
    nuevaBase({
      agente_cobranza_config: [config('t-mala'), config('t-buena')],
      viaje: [
        viaje('t-mala', 'v1', '5210000001'), viaje('t-mala', 'v2', '5210000002'),
        viaje('t-mala', 'v3', '5210000003'), viaje('t-mala', 'v4', '5210000004'),
        viaje('t-mala', 'v5', '5210000005'),
        viaje('t-buena', 'vB1', '5219999991'),
      ],
    });
    meta.enviarTexto.mockResolvedValue(RECHAZO_429);

    const r1 = await ejecutarCobranza('t-mala', AHORA, { ignorarVentana: true });
    expect(r1.rechazoMasivo).toBe(true);

    // Diez minutos después (más que el TTL de 5 minutos): t-buena SÍ corre.
    meta.enviarTexto.mockReset().mockResolvedValue(EXITO);
    const masTarde = new Date(AHORA.getTime() + 10 * 60_000);
    const r2 = await ejecutarCobranza('t-buena', masTarde, { ignorarVentana: true });

    expect(r2.omitido).toBeUndefined();
    expect(r2.contactados).toBe(1);
    expect(meta.enviarTexto).toHaveBeenCalledTimes(1);
  });
});
