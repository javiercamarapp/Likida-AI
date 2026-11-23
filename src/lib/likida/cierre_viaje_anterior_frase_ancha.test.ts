import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InboundMessage } from './processor';

// AUDITORÍA 59 · A59-AGEN-01 (CRÍTICO) — LA BRECHA ENTRE LAS DOS PREDICADAS
// DEL CIERRE.
//
// La guardia del mensaje viejo (`processor.ts`, «cierre.mensaje_de_viaje_
// anterior») existe porque un viaje se cierra UNA vez y es irreversible
// (triggers 0036/0037): un mensaje de cierre del viaje ANTERIOR, entregado por
// la bandeja durable después de que se abrió el viaje nuevo, cierra el viaje
// NUEVO en ceros y manda los comprobantes del regreso a huérfanos. El
// comentario de la guardia lo dice con sus palabras: «un "listo" viejo es una
// liquidación en ceros».
//
// Pero la guardia preguntaba por `pareceCierre` —anclada en `^`, estrecha a
// propósito porque es el freno del cierre en ceros— mientras que quien AUTORIZA
// el cierre es `pidioCerrar`, deliberadamente ANCHA para no dejar atrapado al
// chofer que lo pide con otras palabras. Entre las dos hay una brecha, y todo
// lo que cae en ella cierra el viaje nuevo sin pasar por la guardia:
//
//   «ok jefe, ya terminé» · «mándame mi liquidación» · «ciérrala por favor»
//   «no traigo más tickets» · «ya estuvo» · «es mi último ticket»
//
// Las seis dan `pareceCierre = false` y `pidioCerrar = true`.

const runAgent = vi.fn();
const viajeAbiertoDesdeMs = vi.fn<() => Promise<number | null>>(async () => null);
const esperarIntake = vi.fn(async () => true);
const fotoAnteriorSinProcesar = vi.fn<() => Promise<{ vivas: number; muertas: Array<{ id: string; recibidoMs: number | null; timestampMs: number | null }> } | null>>(async () => ({ vivas: 0, muertas: [] }));
const releaseMessageClaim = vi.fn(async () => undefined);
const getHuerfanos = vi.fn(async (_t: string, _o: string, _op?: Record<string, unknown>) => [] as Array<{ id: string }>);
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const sendText = vi.fn<(to: string, body: string) => Promise<string | null>>(async () => 'wamid.OUT');
const alertarOperador = vi.fn<(evento: string, detalle: Record<string, unknown>) => Promise<void>>(async () => undefined);
const descartarCartaMuerta = vi.fn<(id: string, motivo: string) => Promise<boolean>>(async () => true);

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock('@/lib/likida/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1' })),
  getOpenViaje: vi.fn(async () => 'v1'),
  viajeAbiertoDesdeMs: (...a: unknown[]) => viajeAbiertoDesdeMs(...(a as [])),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [], cierreSinComprobantes: true })),
  saveConversation: vi.fn(), claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: vi.fn(async () => true), intentarLockViaje: vi.fn(async () => 'obtenido' as const),
  releaseViajeLock: vi.fn(),
  releaseMessageClaim: (...a: unknown[]) => releaseMessageClaim(...(a as [])),
  intakeDelta: vi.fn(async () => 0),
  esperarIntake: (...a: unknown[]) => esperarIntake(...(a as [])),
  fotoAnteriorSinProcesar: (...a: unknown[]) => fotoAnteriorSinProcesar(...(a as [])),
}));
vi.mock('@/lib/likida/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  getHuerfanos: (...a: unknown[]) => getHuerfanos(...(a as [string, string, Record<string, unknown>?])),
  guardarHuerfano: vi.fn(async () => true), resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  addGasto: vi.fn(), getGastos: vi.fn(async () => [{ id: 'g1' }]), updateGastoCfdiXml: vi.fn(),
  saveCfdiXmlRaw: vi.fn(), gastoExistePorHash: vi.fn(async () => false),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  getDatosResponsable: vi.fn(async () => ({ razonSocial: 'FLOTA', domicilio: 'Calle 1', urlAvisoIntegral: 'https://x/p' })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 1000 })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Operador', telefono: '5219993700779' })),
  saveLiquidacion: vi.fn(async () => 'L1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base'); }),
  getPerfilCrudo: vi.fn(async () => ({})),
}));
vi.mock('@/lib/likida/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  sendText: (...a: unknown[]) => sendText(...(a as [string, string])),
}));
vi.mock('@/lib/observability/alerta', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  alertarOperador: (...a: unknown[]) => alertarOperador(...(a as [string, Record<string, unknown>])),
}));
vi.mock('@/lib/likida/wa_pendientes', () => ({
  MAX_INTENTOS_PENDIENTE: 5,
  descartarCartaMuerta: (...a: unknown[]) => descartarCartaMuerta(...(a as [string, string])),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null, error: { message: 'sin storage' } }) }) },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger }));


const { processInbound } = await import('./processor');

// Las seis frases de la brecha: `pidioCerrar` las reconoce (autorizan el
// cierre) y `pareceCierre` no (la guardia no las veía).
const FRASES_DE_LA_BRECHA = [
  'ok jefe, ya terminé',
  'mándame mi liquidación',
  'ciérrala por favor',
  'no traigo más tickets',
  'ya estuvo',
  'es mi último ticket',
];

// `listo` sí la reconocían las dos: es el control de que la guardia no se rompió.
const FRASE_ESTRECHA = 'listo';

const VIAJE_ABIERTO_MS = 1_756_000_050_000;
const MENSAJE_VIEJO_MS = 1_756_000_001_100; // 48.9 s ANTES de abrirse el viaje nuevo

const mensaje = (text: string, timestampMs: number): InboundMessage => ({
  from: '5219993700779', type: 'text', text, waMessageId: 'wa1',
  timestampMs, recibidoMs: timestampMs,
});

beforeEach(() => {
  runAgent.mockReset();
  runAgent.mockResolvedValue({ finalText: 'Listo', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 });
  esperarIntake.mockReset(); esperarIntake.mockResolvedValue(true);
  fotoAnteriorSinProcesar.mockReset(); fotoAnteriorSinProcesar.mockResolvedValue({ vivas: 0, muertas: [] });
  releaseMessageClaim.mockReset(); releaseMessageClaim.mockResolvedValue(undefined);
  getHuerfanos.mockReset(); getHuerfanos.mockResolvedValue([]);
  sendText.mockReset(); sendText.mockResolvedValue('wamid.OUT');
  alertarOperador.mockReset(); alertarOperador.mockResolvedValue(undefined);
  descartarCartaMuerta.mockReset(); descartarCartaMuerta.mockResolvedValue(true);
  logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
  viajeAbiertoDesdeMs.mockReset(); viajeAbiertoDesdeMs.mockResolvedValue(VIAJE_ABIERTO_MS);
});

describe('A59-AGEN-01 · un cierre del viaje ANTERIOR no cierra el viaje nuevo', () => {
  it.each(FRASES_DE_LA_BRECHA)(
    'descarta «%s» recibida antes de abrirse el viaje nuevo, sin llamar al agente',
    async (frase) => {
      await processInbound(mensaje(frase, MENSAJE_VIEJO_MS));

      // Lo que importa: el agente —el único que puede llamar a
      // `guardar_liquidacion`— no corre con un mensaje del viaje anterior.
      expect(runAgent).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'cierre.mensaje_de_viaje_anterior',
        expect.objectContaining({ mensajeMs: MENSAJE_VIEJO_MS, viajeDesdeMs: VIAJE_ABIERTO_MS }),
      );
      // Y se le dice al chofer, sin ponerle en la boca una palabra que no dijo.
      const dicho = sendText.mock.calls.map(([, cuerpo]) => cuerpo).join(' | ');
      expect(dicho).toContain('viaje anterior');
      expect(dicho).toContain('viaje nuevo');
    },
  );

  it('la frase estrecha «listo» sigue descartándose igual (control de no-regresión)', async () => {
    await processInbound(mensaje(FRASE_ESTRECHA, MENSAJE_VIEJO_MS));
    expect(runAgent).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('cierre.mensaje_de_viaje_anterior', expect.anything());
  });

  it('la MISMA frase ancha con hora POSTERIOR a la apertura sí sigue su curso', async () => {
    // El control que impide que el arreglo se vuelva un freno universal: un
    // cierre legítimo del viaje en curso tiene que llegar al agente.
    await processInbound(mensaje('mándame mi liquidación', VIAJE_ABIERTO_MS + 5_000));
    expect(logger.warn).not.toHaveBeenCalledWith('cierre.mensaje_de_viaje_anterior', expect.anything());
    expect(runAgent).toHaveBeenCalled();
  });
});
