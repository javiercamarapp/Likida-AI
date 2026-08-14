import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 3, REND-C2 (CRÍTICO): a 750 camiones los envíos seriales no
// caben en maxDuration y el proceso moría a la mitad — con claims ya
// insertados y tiers consumidos sin que ningún chofer recibiera nada.
// Contrato que estas pruebas fijan: el reloj corta ANTES del claim (lo no
// intentado queda intacto y SE DICE en cortadosPorReloj), y con reloj
// holgado todo sale normal.
//
// AUDITORÍA 3, AG-A2 (ALTO): la población objetivo del agente es el chofer
// que lleva DÍAS sin escribir — ventana de 24 h cerrada, donde Meta rechaza
// todo texto libre. Contrato: cuando `sendText` devuelve null cae la
// plantilla `recordatorio_cierre` (el patrón de escalar_viaje.ts); si la
// plantilla sale, el contacto CUENTA y la bitácora lo dice; si también
// falla, el detalle lleva el motivo de ambas.
// ═══════════════════════════════════════════════════════════════════════════

const VIAJES = [
  { id: 'v1', folio: 'V-1', fecha_inicio: '2026-07-20', avisado_en: '2026-07-20T15:00:00Z', recordatorio_comprobacion_en: null, operador: { nombre: 'Juan', telefono: '5215511111111' } },
  { id: 'v2', folio: 'V-2', fecha_inicio: '2026-07-22', avisado_en: '2026-07-22T15:00:00Z', recordatorio_comprobacion_en: null, operador: { nombre: 'María', telefono: '5215522222222' } },
];

const claims: unknown[] = [];
const updates: { tabla: string; fila: unknown }[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      const chain = () => b;
      Object.assign(b, {
        select: chain, eq: chain, in: chain, not: chain, limit: chain, order: chain,
        delete: chain, is: chain, lt: chain,
        insert: (fila: unknown) => { claims.push(fila); return b; },
        update: (fila: unknown) => { updates.push({ tabla, fila }); return b; },
        maybeSingle: async () => ({ data: null, error: null }),
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: tabla === 'viaje' ? VIAJES : [], error: null }).then(res),
      });
      return b;
    },
  }),
}));
const sendText = vi.fn<(...a: unknown[]) => Promise<string | null>>();
const sendTemplate = vi.fn<(...a: unknown[]) => Promise<{ ok: true; id: string | null } | { ok: false; error: string; codigo?: number }>>();
vi.mock('@/lib/meta/client', () => ({
  sendText: (...a: unknown[]) => sendText(...a),
  sendTemplate: (...a: unknown[]) => sendTemplate(...a),
  motivoDeFalloWhatsApp: (error: string, codigo?: number) => (codigo ? `(${codigo}) ${error}` : error),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { ejecutarCobranza } = await import('./cobranza');
const AHORA = new Date('2026-08-14T17:00:00Z');

beforeEach(() => {
  claims.length = 0;
  updates.length = 0;
  sendText.mockReset();
  sendText.mockResolvedValue('wamid.OK');
  sendTemplate.mockReset();
  sendTemplate.mockResolvedValue({ ok: true, id: 'wamid.PLANTILLA' });
});

describe('ejecutarCobranza — el reloj corta ANTES del claim (REND-C2)', () => {

  it('reloj vencido: cero claims, cero envíos, y lo no intentado SE DICE', async () => {
    const r = await ejecutarCobranza('t1', AHORA, { ignorarVentana: true, venceEn: Date.now() - 1 });
    expect(r.cortadosPorReloj).toBe(2);
    expect(r.contactados).toBe(0);
    expect(sendText).not.toHaveBeenCalled();
    expect(claims).toHaveLength(0); // los tiers NO se consumieron
  });

  it('reloj holgado: los dos salen y cortadosPorReloj es 0', async () => {
    const r = await ejecutarCobranza('t1', AHORA, { ignorarVentana: true, venceEn: Date.now() + 60_000 });
    expect(r.contactados).toBe(2);
    expect(r.cortadosPorReloj).toBe(0);
    expect(sendText).toHaveBeenCalledTimes(2);
    expect(claims).toHaveLength(2);
  });

  it('sin venceEn (el botón Ejecutar ahora) se porta como siempre', async () => {
    const r = await ejecutarCobranza('t1', AHORA, { ignorarVentana: true });
    expect(r.contactados).toBe(2);
    expect(r.cortadosPorReloj).toBe(0);
  });
});

describe('ejecutarCobranza — ventana de 24 h cerrada: habla la plantilla (AG-A2)', () => {
  it('texto rechazado → sale recordatorio_cierre con nombre y folio, el contacto CUENTA y la bitácora lo dice', async () => {
    sendText.mockResolvedValue(null); // Meta rechaza el texto libre: ventana cerrada
    const r = await ejecutarCobranza('t1', AHORA, { ignorarVentana: true });
    expect(r.contactados).toBe(2);
    expect(r.fallos).toHaveLength(0);
    expect(sendTemplate).toHaveBeenCalledTimes(2);
    expect(sendTemplate).toHaveBeenCalledWith('5215511111111', 'recordatorio_cierre', { parametros: ['Juan', 'V-1'] });
    expect(sendTemplate).toHaveBeenCalledWith('5215522222222', 'recordatorio_cierre', { parametros: ['María', 'V-2'] });
    const resultados = updates.filter((u) => u.tabla === 'cobranza_contacto').map((u) => u.fila);
    expect(resultados).toHaveLength(2);
    for (const fila of resultados) {
      expect(fila).toMatchObject({ enviado: true, detalle: 'plantilla recordatorio_cierre (ventana de 24 h cerrada)' });
    }
  });

  it('texto Y plantilla rechazados → enviado=false con el motivo de AMBAS', async () => {
    sendText.mockResolvedValue(null);
    sendTemplate.mockResolvedValue({ ok: false, error: 'la plantilla no está aprobada', codigo: 132001 });
    const r = await ejecutarCobranza('t1', AHORA, { ignorarVentana: true });
    expect(r.contactados).toBe(0);
    expect(r.fallos).toHaveLength(2);
    expect(r.fallos[0]).toContain('texto');       // motivo 1: el texto libre no salió
    expect(r.fallos[0]).toContain('132001');      // motivo 2: el de la plantilla, traducido
    const resultados = updates.filter((u) => u.tabla === 'cobranza_contacto').map((u) => u.fila as { enviado: boolean; detalle: string });
    expect(resultados[0].enviado).toBe(false);
    expect(resultados[0].detalle).toContain('plantilla');
  });

  it('texto entregado → la plantilla NO se toca (la ventana está abierta)', async () => {
    const r = await ejecutarCobranza('t1', AHORA, { ignorarVentana: true });
    expect(r.contactados).toBe(2);
    expect(sendTemplate).not.toHaveBeenCalled();
  });
});
