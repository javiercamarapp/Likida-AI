import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-S11-03 — el feed /v1/hitos/eventos publica SOLO los 9 eventos del contrato y un `detalle` de lista blanca.
// La bitácora guarda además renglones internos (validación, evidencia, alertas…) con texto libre del chofer.

let filasDb: Array<Record<string, unknown>> = [];
const filtroIn: Array<[string, unknown[]]> = [];

function constructor() {
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, gt: () => b, order: () => b, limit: () => b,
    in: (c: string, v: unknown[]) => { filtroIn.push([c, v]); return b; },
    then: (res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: filasDb, error: null }).then(res, rej),
  });
  return b;
}

vi.mock('../presupuesto', async (orig) => ({ ...(await orig<Record<string, unknown>>()), acotada: <T,>(q: T) => q }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => constructor() }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { leerEventos } = await import('./repo');
const { detalleDeFeed, EVENTOS_FEED } = await import('./lectura');

const fila = (id: number, evento: string, detalle: unknown) => ({
  id, viaje_id: 'v1', viaje_hito_id: 'h1', tipo_hito: 'llegada_carga', evento, detalle, created_at: '2026-10-02T10:00:00Z',
});

beforeEach(() => { filasDb = []; filtroIn.length = 0; });

describe('A37-S11-03: feed de eventos de hitos', () => {
  it('la consulta pide SOLO los eventos del contrato', async () => {
    await leerEventos('t-1', 0, 10);
    expect(filtroIn).toContainEqual(['evento', [...EVENTOS_FEED]]);
  });

  it('un renglón con detalle.clase (bitácora interna que reutiliza un nombre del contrato) no sale', async () => {
    filasDb = [
      fila(1, 'recibido', { fuente: 'texto', via: 'regla', texto_libre: '¿cómo descargas? por la rampa norte' }),
      fila(2, 'atendido', { clase: 'patio_entrega', estado: 'atendido', ciclo: 1 }),
      fila(3, 'validacion', { clase: 'reporte_llegada', respuesta: 'texto del chofer' }),
    ];
    const r = await leerEventos('t-1', 0, 10);
    expect(r.filas.map((f) => f.id)).toEqual([1]);
    // El cursor avanza sobre lo LEÍDO aunque no se publique, para que el integrador no vuelva a pedirlo.
    expect(r.ultimoIdLeido).toBe(3);
  });

  it('el detalle es de lista blanca: lo que no está declarado no sale', async () => {
    filasDb = [fila(5, 'recibido', { fuente: 'boton', via: 'boton', tarde: true, texto_libre: 'dato personal', motivo_interno: 'x' })];
    const r = await leerEventos('t-1', 0, 10);
    expect(r.filas[0].detalle).toEqual({ fuente: 'boton', via: 'boton', tarde: true });
  });

  it('detalleDeFeed: escalado conserva sus conteos pero no la causa libre; eventos fuera del contrato → null', () => {
    expect(detalleDeFeed('escalado', { nivel: 1, destinatarios: 2, entregados: 0, motivo: 'problema_reportado_sin_aviso', causa: 'Meta 131047: texto largo' }))
      .toEqual({ nivel: 1, destinatarios: 2, entregados: 0, motivo: 'problema_reportado_sin_aviso' });
    for (const ev of ['validacion', 'evidencia', 'captura_manual', 'alerta_estadia', 'alerta_llegada_sin_confirmar']) {
      expect(detalleDeFeed(ev, {}), ev).toBeNull();
    }
    expect(detalleDeFeed('contacto', { cualquier: 'cosa' })).toEqual({});
  });
});
