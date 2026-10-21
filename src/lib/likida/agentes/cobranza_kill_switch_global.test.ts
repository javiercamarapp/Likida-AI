import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria, type Fila } from '@/lib/pruebas/tablas_en_memoria.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA ADVERSARIAL (21-oct-2026) — A7 COBRANZA NO TENÍA EL FRENO DE
// EMERGENCIA GLOBAL.
//
// `agente:cobranza` vive en el catálogo de `interruptores.ts` desde la 0110 y
// el cron de emergencias (`api/cron/escalar/route.ts`) YA lo pregunta antes de
// llamar a `ejecutarCobranzaGlobal` — pero `ejecutarCobranza` y
// `ejecutarCobranzaGastos`, los dos motores que "Ejecutar ahora" del panel
// (`/dashboard/agentes/cobranza`) llama DIRECTO por tenant, nunca lo
// preguntaban: cero ocurrencias de `estaApagado`/`interruptores` en
// `cobranza.ts`. Un incidente real que Javier apaga desde
// /admin/observabilidad o ⌘K seguía mandando WhatsApp si alguien apretaba el
// botón a mano, porque `config.activo` (la pausa DE LA FLOTA) es un
// interruptor distinto y no sustituye al freno GLOBAL.
//
// Esta suite fija el contrato en los dos sentidos:
//   (a) apagado → NINGÚN trabajo real (ni WhatsApp ni fila de cobranza), con
//       `omitido` dicho en el resultado — igual que "pausado es pausado".
//   (b) encendido (o sin fila, que es el default seguro de interruptores.ts)
//       → el flujo de siempre sigue intacto.
//
// `../interruptores` se mockea directo (mismo patrón que sdr.test.ts /
// redactor.test.ts / enviador.test.ts) para controlar el interruptor sin
// pagar el TTL de caché de 5 s del módulo real entre casos.
// ═══════════════════════════════════════════════════════════════════════════

const interruptor = vi.hoisted(() => ({ apagado: false }));
const estaApagado = vi.hoisted(() => vi.fn(async (nombre: string) => nombre === 'agente:cobranza' && interruptor.apagado));
vi.mock('../interruptores', () => ({ estaApagado }));

const estado = vi.hoisted(() => ({ db: null as unknown as BaseEnMemoria }));
const meta = vi.hoisted(() => ({ enviarTexto: vi.fn(), sendTemplate: vi.fn() }));
const alerta = vi.hoisted(() => vi.fn());
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => estado.db.cliente }));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: alerta }));
vi.mock('../perfil/preguntas', () => ({ ventanaCobranzaDeclarada: () => null }));
vi.mock('../repo', () => ({ getPerfilCrudo: async () => null }));
vi.mock('./notificaciones', () => ({ avisarCorridasPorFlota: async () => {} }));
vi.mock('./corridas', () => ({ registrarCorrida: async () => {} }));
vi.mock('@/lib/likida/wa_ventana', () => ({
  ventanaDeContacto: async () => ({ estado: 'abierta' }),
  registrarDecisionEnvio: async () => {},
}));
vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  enviarTexto: (...a: unknown[]) => meta.enviarTexto(...a),
  sendTemplate: (...a: unknown[]) => meta.sendTemplate(...a),
}));

const { ejecutarCobranza } = await import('./cobranza');
const { ejecutarCobranzaGastos } = await import('./cobranza_gasto');

// Martes 2026-08-18, 17:00Z = 11:00 CDMX: dentro de la ventana default.
const AHORA = new Date('2026-08-18T17:00:00Z');
const OK = { ok: true, id: 'wamid.OK' };

function configViaje(tenant: string, extra: Fila = {}): Fila {
  return {
    tenant_id: tenant, activo: true, tiers: [3, 7, 14], hora_inicio: 9, hora_fin: 18,
    dias_semana: [1, 2, 3, 4, 5, 6], instrucciones: '', firma: '', por_gasto: false, ...extra,
  };
}

function configGasto(tenant: string): Fila {
  return {
    tenant_id: tenant, activo: true, tiers: [3, 7, 14], hora_inicio: 9, hora_fin: 18,
    dias_semana: [1, 2, 3, 4, 5, 6], instrucciones: '', firma: '', por_gasto: true,
    tiers_gasto: [1, 3, 7], max_mensajes_dia: 2, conceptos_cfdi: ['diesel'], umbral_foto: 0.5,
  };
}

function viaje(tenant: string, id: string, telefono: string, operadorId = `op-${id}`): Fila {
  return {
    id, tenant_id: tenant, folio: `F-${id}`, fecha_inicio: '2026-08-15',
    avisado_en: '2026-08-15T10:00:00Z', recordatorio_comprobacion_en: null,
    estatus: 'abierto', operador_id: operadorId, operador: { nombre: `Op-${id}`, telefono },
  };
}

function gasto(tenant: string, id: string, viajeId: string): Fila {
  return {
    id, tenant_id: tenant, viaje_id: viajeId, concepto: 'diesel', monto: 500,
    fecha: '2026-08-16', created_at: '2026-08-16T10:00:00Z', imagen_url: null,
    cfdi_uuid: null, ocr_confianza: null, cfdi_esquema_alterno: null, estado_sat: null,
  };
}

function nuevaBase(inicial: Record<string, Fila[]>) {
  estado.db = crearBaseEnMemoria(
    { viaje: [], gasto: [], agente_cobranza_config: [], cobranza_contacto: [], cobranza_gasto_contacto: [], ...inicial },
    [
      { tabla: 'cobranza_contacto', nombre: 'cobranza_contacto_viaje_id_tier_key', columnas: ['viaje_id', 'tier'] },
      { tabla: 'cobranza_gasto_contacto', nombre: 'cobranza_gasto_contacto_gasto_tier_key', columnas: ['gasto_id', 'tier'] },
    ],
  );
}

const contactosViaje = () => estado.db.tabla('cobranza_contacto');
const contactosGasto = () => estado.db.tabla('cobranza_gasto_contacto');

beforeEach(() => {
  interruptor.apagado = false;
  estaApagado.mockClear();
  meta.enviarTexto.mockReset().mockResolvedValue(OK);
  meta.sendTemplate.mockReset().mockResolvedValue(OK);
  alerta.mockReset().mockResolvedValue(undefined);
});

describe('ejecutarCobranza — el freno de emergencia global (agente:cobranza)', () => {
  it('apagado: no revisa, no manda WhatsApp y no escribe ninguna fila de cobranza', async () => {
    interruptor.apagado = true;
    nuevaBase({
      agente_cobranza_config: [configViaje('t1')],
      viaje: [viaje('t1', 'v1', '5210000001')],
    });

    const r = await ejecutarCobranza('t1', AHORA);

    expect(r).toMatchObject({
      revisados: 0, contactados: 0, sinTelefono: 0, cortadosPorReloj: 0,
      omitido: 'apagado por el interruptor global agente:cobranza',
    });
    expect(meta.enviarTexto).not.toHaveBeenCalled();
    expect(meta.sendTemplate).not.toHaveBeenCalled();
    expect(contactosViaje()).toHaveLength(0);
    expect(estaApagado).toHaveBeenCalledWith('agente:cobranza');
  });

  it('apagado: el botón "Ejecutar ahora" (ignorarVentana=true) tampoco corre — pausado global es pausado', async () => {
    interruptor.apagado = true;
    nuevaBase({
      agente_cobranza_config: [configViaje('t1')],
      viaje: [viaje('t1', 'v1', '5210000001')],
    });

    const r = await ejecutarCobranza('t1', AHORA, { ignorarVentana: true });

    expect(r.omitido).toBe('apagado por el interruptor global agente:cobranza');
    expect(meta.enviarTexto).not.toHaveBeenCalled();
    expect(contactosViaje()).toHaveLength(0);
  });

  it('encendido explícito: el flujo normal de cobranza por viaje sigue funcionando igual que antes', async () => {
    interruptor.apagado = false;
    nuevaBase({
      agente_cobranza_config: [configViaje('t1')],
      viaje: [viaje('t1', 'v1', '5210000001')],
    });

    const r = await ejecutarCobranza('t1', AHORA);

    expect(r.omitido).toBeUndefined();
    expect(r.contactados).toBe(1);
    expect(meta.enviarTexto).toHaveBeenCalledTimes(1);
    expect(contactosViaje()).toHaveLength(1);
  });

  it('sin fila en `interruptor` (el default seguro de interruptores.ts): corre igual que encendido', async () => {
    // El doble de `estaApagado` ya refleja "sin fila = encendido" (devuelve
    // false salvo que `interruptor.apagado` se ponga en true a propósito) —
    // esta prueba fija que `ejecutarCobranza` no le exige NADA más al default.
    nuevaBase({
      agente_cobranza_config: [configViaje('t1')],
      viaje: [viaje('t1', 'v1', '5210000001')],
    });

    const r = await ejecutarCobranza('t1', AHORA);

    expect(r.contactados).toBe(1);
    expect(contactosViaje()).toHaveLength(1);
  });
});

describe('ejecutarCobranzaGastos — mismo freno, llamada directa (defensa en profundidad)', () => {
  it('apagado: no revisa gastos, no manda WhatsApp y no escribe ninguna fila de cobranza por gasto', async () => {
    interruptor.apagado = true;
    nuevaBase({
      agente_cobranza_config: [configGasto('t1')],
      viaje: [viaje('t1', 'v1', '5210000001')],
      gasto: [gasto('t1', 'g1', 'v1')],
    });

    const r = await ejecutarCobranzaGastos('t1', AHORA);

    expect(r).toMatchObject({
      pendientes: 0, mensajes: 0, gastosAvisados: 0, sinTelefono: 0, pospuestosPorTope: 0, resueltos: 0,
      omitido: 'apagado por el interruptor global agente:cobranza',
    });
    expect(meta.enviarTexto).not.toHaveBeenCalled();
    expect(meta.sendTemplate).not.toHaveBeenCalled();
    expect(contactosGasto()).toHaveLength(0);
  });

  it('encendido: la cobranza por gasto sigue funcionando igual que antes', async () => {
    interruptor.apagado = false;
    nuevaBase({
      agente_cobranza_config: [configGasto('t1')],
      viaje: [viaje('t1', 'v1', '5210000001')],
      gasto: [gasto('t1', 'g1', 'v1')],
    });

    const r = await ejecutarCobranzaGastos('t1', AHORA);

    expect(r.omitido).toBeUndefined();
    expect(r.mensajes).toBe(1);
    expect(contactosGasto()).toHaveLength(1);
  });
});
