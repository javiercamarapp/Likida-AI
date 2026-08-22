import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD — el reloj y el rechazo de Meta en la escalación.
//
//  · ESC-3 (ALTO) — hasta 4 llamadas a Meta por viaje, de 10 s de techo cada
//    una, en serie, con `limit(100)` y sin reloj: la corrida no cabía en el
//    maxDuration de 120 s y la invocación moría A MEDIAS, después de sellar
//    `escalado_en` y antes de avisarle al jefe. Contrato: el corte va ANTES
//    del claim, lo no intentado queda intacto y SE DICE en `cortadosPorReloj`.
//
//  · RES-1 (CRÍTICO) — un 429 de Meta no es un viaje escalado. El sello no
//    expira: marcarlo ante un rate limit saca al viaje de la consulta PARA
//    SIEMPRE. Contrato: el claim se LIBERA ante un código reintentable, y a
//    los cinco rechazos seguidos la corrida se detiene y grita.
// ═══════════════════════════════════════════════════════════════════════════

const { sendText, sendTemplate, avisarAlChofer, telefonosJefe, avisar, avisarCorridasPorFlota, registrarCorrida, alertarOperador } = vi.hoisted(() => ({
  sendText: vi.fn(), sendTemplate: vi.fn(), avisarAlChofer: vi.fn(), telefonosJefe: vi.fn(),
  avisar: vi.fn(), avisarCorridasPorFlota: vi.fn(), registrarCorrida: vi.fn(), alertarOperador: vi.fn(),
}));
vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  sendText,
  sendTemplate,
  enviarTexto: async (to: string, body: string) => {
    const id = await sendText(to, body);
    // El rechazo típico del texto libre: la ventana de 24 h cerrada (131047),
    // que NO es reintentable — por eso existe el plan B de la plantilla.
    return id ? { ok: true, id } : { ok: false, error: 'rechazado', codigo: 131047, status: 400 };
  },
}));
vi.mock('./operacion', () => ({ avisarAlChofer }));
vi.mock('./contactos', () => ({ telefonosJefe }));
vi.mock('./agentes/notificaciones', () => ({ avisar, avisarCorridasPorFlota }));
vi.mock('./agentes/corridas', () => ({ registrarCorrida }));
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

/** Viajes vencidos que devuelve la lectura. */
let viajes: Array<Record<string, unknown>> = [];
/** Cada UPDATE ejecutado, con lo que escribió. */
const updates: Array<{ fila: Record<string, unknown> }> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      if (tabla === 'tenant') {
        const n: Record<string, unknown> = {};
        n.select = () => n; n.eq = () => n; n.maybeSingle = async () => ({ data: null, error: null });
        return n;
      }
      const n: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'not', 'lte', 'gte', 'limit', 'order']) n[m] = () => n;
      n.update = (fila: Record<string, unknown>) => {
        updates.push({ fila });
        const u: Record<string, unknown> = {};
        for (const m of ['eq', 'is']) u[m] = () => u;
        // El claim y la liberación ganan siempre: una fila devuelta.
        u.select = async () => ({ data: [{ id: 'v' }], error: null });
        return u;
      };
      n.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: viajes, error: null }).then(r);
      return n;
    },
  }),
}));

const { escalarViajesSinAceptar, TOPE_RECHAZOS_META } = await import('./escalar_viaje');

const AHORA = new Date('2026-08-22T18:00:00.000Z');
const viaje = (i: number) => ({
  id: `v-${i}`, tenant_id: 't-1', folio: `VJ-${i}`, operador_id: null,
  avisado_en: '2026-08-22T08:00:00.000Z', avisos_enviados: 0, operador: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  telefonosJefe.mockResolvedValue({ 't-1': '529993700779' });
  sendText.mockResolvedValue('wamid.OK');
  sendTemplate.mockResolvedValue({ ok: true, id: 'wamid.T' });
  viajes = [viaje(1), viaje(2), viaje(3)];
});

describe('el reloj corta ANTES del claim (ESC-3)', () => {
  it('reloj vencido: cero claims, cero envíos, y lo no intentado SE DICE', async () => {
    const r = await escalarViajesSinAceptar({ ahora: AHORA, venceEn: Date.now() - 1 });
    expect(r.cortadosPorReloj).toBe(3);
    expect(r.escalados).toBe(0);
    expect(updates).toHaveLength(0);   // ni un `escalado_en` puesto
    expect(sendText).not.toHaveBeenCalled();
  });

  it('reloj holgado: los tres salen y cortadosPorReloj es 0', async () => {
    const r = await escalarViajesSinAceptar({ ahora: AHORA, venceEn: Date.now() + 60_000 });
    expect(r.escalados).toBe(3);
    expect(r.cortadosPorReloj).toBe(0);
  });

  it('sin venceEn se comporta como siempre (el cron viejo no se rompe)', async () => {
    const r = await escalarViajesSinAceptar({ ahora: AHORA });
    expect(r.escalados).toBe(3);
    expect(r.cortadosPorReloj).toBe(0);
  });
});

describe('un rechazo REINTENTABLE de Meta no consume el sello (RES-1)', () => {
  it('la plantilla rebota con 429: se LIBERA el escalado_en y el viaje vuelve a la cola', async () => {
    viajes = [viaje(1)];
    sendText.mockResolvedValue(null);                                  // texto rechazado
    sendTemplate.mockResolvedValue({ ok: false, error: 'rate limit', codigo: 130429 });
    const r = await escalarViajesSinAceptar({ ahora: AHORA });

    expect(r.rechazosReintentables).toBe(1);
    expect(r.escalados).toBe(0);                                       // NO cuenta como escalado
    // Dos escrituras: el claim y su liberación — la segunda deja el sello en null.
    expect(updates).toHaveLength(2);
    expect(updates[1].fila.escalado_en).toBeNull();
    expect(r.fallos[0]).toMatch(/se reintenta en la siguiente corrida/);
  });

  it('un fallo NO reintentable (plantilla sin aprobar) sí consume el sello', async () => {
    viajes = [viaje(1)];
    sendText.mockResolvedValue(null);
    sendTemplate.mockResolvedValue({ ok: false, error: 'no aprobada', codigo: 132001 });
    const r = await escalarViajesSinAceptar({ ahora: AHORA });

    expect(r.rechazosReintentables).toBe(0);
    expect(r.escalados).toBe(1);
    expect(updates).toHaveLength(1);                                   // solo el claim
  });

  it(`a los ${TOPE_RECHAZOS_META} rechazos seguidos la corrida SE DETIENE y grita`, async () => {
    // Un solo número de WhatsApp atiende a todas las flotas: cinco rechazos
    // seguidos no son cinco teléfonos malos, es la cuenta limitada.
    viajes = Array.from({ length: 12 }, (_, i) => viaje(i));
    sendText.mockResolvedValue(null);
    sendTemplate.mockResolvedValue({ ok: false, error: 'rate limit', codigo: 130429 });
    const r = await escalarViajesSinAceptar({ ahora: AHORA });

    expect(r.rechazosReintentables).toBe(TOPE_RECHAZOS_META);
    expect(r.cortadosPorReloj).toBe(12 - TOPE_RECHAZOS_META);
    expect(alertarOperador).toHaveBeenCalledWith('wa.rechazo_masivo', expect.objectContaining({ codigo: 'wa_rechazo_masivo' }));
  });

  it('un envío bueno reinicia la racha: no se para por rechazos sueltos', async () => {
    viajes = Array.from({ length: 12 }, (_, i) => viaje(i));
    let n = 0;
    sendText.mockImplementation(async () => (++n % 3 === 0 ? 'wamid.OK' : null));
    sendTemplate.mockResolvedValue({ ok: false, error: 'rate limit', codigo: 130429 });
    const r = await escalarViajesSinAceptar({ ahora: AHORA });

    expect(r.cortadosPorReloj).toBe(0);          // nunca llegó a 5 seguidos
    expect(alertarOperador).not.toHaveBeenCalled();
  });
});
