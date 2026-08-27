import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// CAPA E1 — el CABLEADO de la nota de voz en el dispatcher. La unidad del
// transcriptor vive en voz_transcrita.test.ts; aquí se fija lo que importa del
// enchufe: la transcripción entra al MISMO camino que el texto (el ROJO usa el
// reconocedor REAL de léxico cerrado, sin dobles), y todo fallo de escucha
// termina en un "¿me lo escribes?" — jamás en silencio ni en adivinanza.
// ═══════════════════════════════════════════════════════════════════════════

const resolveOperador = vi.fn();
const resolverCuentaOficina = vi.fn();
const transcribirNotaDeVoz = vi.fn();
const atenderAsistenciaChofer = vi.fn();
const sendText = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: vi.fn() }));
vi.mock('@/lib/likida/voz_transcrita', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  transcribirNotaDeVoz: (...a: unknown[]) => transcribirNotaDeVoz(...a),
}));
// El reconocedor ROJO/ámbar es el REAL (léxico cerrado contra habla mexicana);
// solo la atención de la incidencia —que toca base y WhatsApp— se dobla.
vi.mock('@/lib/likida/asistencia_wa', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  atenderAsistenciaChofer: (...a: unknown[]) => atenderAsistenciaChofer(...a),
}));
vi.mock('@/lib/likida/contactos', () => ({
  resolverCuentaOficina: (...a: unknown[]) => resolverCuentaOficina(...a),
  telefonoJefeDe: vi.fn(async () => null),
  telefonosJefe: vi.fn(async () => ({})),
}));
vi.mock('@/lib/likida/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: (...a: unknown[]) => resolveOperador(...a),
  getOpenViaje: vi.fn(async () => 'v1'),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(),
  claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: vi.fn(async () => true), intentarLockViaje: vi.fn(async () => 'obtenido' as const), releaseViajeLock: vi.fn(),
  releaseMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 1),
  esperarIntake: vi.fn(async () => true),
  buscarTenantPorTelefono: vi.fn(async () => null),
}));
vi.mock('@/lib/likida/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/meta/client', () => ({
  MAX_CUERPO_BOTONES: 1024,
  sendText: (...a: unknown[]) => sendText(...a),
  sendButtons: vi.fn(async () => 'wamid.BTN'),
  sendDocument: vi.fn(async () => 'wamid.DOC'),
  downloadMediaAsDataUrl: vi.fn(async () => null),
  downloadMediaAsText: vi.fn(async () => null),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null, error: { message: 'sin storage' } }) }) },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger }));

const { processInbound } = await import('./processor');
const { RESPUESTA_NO_ENTENDI, RESPUESTA_SIN_PRESUPUESTO } = await import('./voz_transcrita');

const CHOFER_TEL = '5219993700779';
let n = 0;
function notaDeVoz() {
  return { from: CHOFER_TEL, type: 'audio' as const, mediaId: 'audio-1', waMessageId: `wa-voz-${n++}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveOperador.mockResolvedValue({ tenantId: 't1', operadorId: 'o1' });
  resolverCuentaOficina.mockResolvedValue(null);
  sendText.mockResolvedValue('wamid.TXT');
  atenderAsistenciaChofer.mockResolvedValue({ atendida: true, respuesta: 'Ya le avisé a tu jefe 🚨' });
});

describe('la nota de voz del chofer (capa E1)', () => {
  it('un audio que dice "chocamos" dispara el protocolo ROJO con el reconocedor real', async () => {
    transcribirNotaDeVoz.mockResolvedValue({ ok: true, texto: 'chocamos en la carretera, hay un herido' });
    await processInbound(notaDeVoz());
    // El transcriptor recibió el tenant del chofer (el presupuesto es suyo).
    expect(transcribirNotaDeVoz).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', mediaId: 'audio-1' }));
    // La transcripción entró al MISMO camino que el texto: interpretarAsistencia
    // REAL la clasificó rojo y la atención recibió el texto transcrito.
    expect(atenderAsistenciaChofer).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't1', operadorId: 'o1',
      texto: 'chocamos en la carretera, hay un herido',
    }));
    expect(sendText).toHaveBeenCalledWith(CHOFER_TEL, 'Ya le avisé a tu jefe 🚨');
  });

  it('audio ininteligible → "¿me lo escribes?" y NINGÚN protocolo disparado', async () => {
    transcribirNotaDeVoz.mockResolvedValue({ ok: false, motivo: 'ilegible' });
    await processInbound(notaDeVoz());
    expect(sendText).toHaveBeenCalledWith(CHOFER_TEL, RESPUESTA_NO_ENTENDI);
    expect(atenderAsistenciaChofer).not.toHaveBeenCalled();
  });

  it('presupuesto agotado → el mensaje honesto de presupuesto, no un regaño genérico', async () => {
    transcribirNotaDeVoz.mockResolvedValue({ ok: false, motivo: 'presupuesto' });
    await processInbound(notaDeVoz());
    expect(sendText).toHaveBeenCalledWith(CHOFER_TEL, RESPUESTA_SIN_PRESUPUESTO);
  });

  it('audio sin mediaId (webhook raro) → también "¿me lo escribes?", jamás silencio', async () => {
    await processInbound({ from: CHOFER_TEL, type: 'audio', waMessageId: `wa-voz-${n++}` });
    expect(sendText).toHaveBeenCalledWith(CHOFER_TEL, RESPUESTA_NO_ENTENDI);
    expect(transcribirNotaDeVoz).not.toHaveBeenCalled();
  });
});
