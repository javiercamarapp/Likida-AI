import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL RECORDATORIO AUTOMÁTICO DE COMPROBACIÓN — mismo mecanismo que
// `escalar_viaje.ts`, mismo motivo: Vercel Cron entrega *at-least-once*, así
// que dos corridas pueden solaparse sobre el mismo viaje. Lo que esto
// protege, en orden:
//
//   1. SE RECUERDA UNA SOLA VEZ, incluso entre corridas solapadas — el claim
//      pone `recordatorio_comprobacion_en` ANTES de mandar el mensaje.
//   2. SE MARCA AUNQUE EL ENVÍO FALLE (sin teléfono, Meta rechaza) — la
//      alternativa es reintentar y fallar el mismo viaje cada hora, para
//      siempre.
//   3. UN ERROR NO ES UNA LISTA VACÍA — `viajesSinComprobar` lanza.
//   4. EL CORTE SE MIDE CONTRA `ahora` INYECTADO.
// ═══════════════════════════════════════════════════════════════════════════

const { sendText } = vi.hoisted(() => ({ sendText: vi.fn() }));
vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  sendText,
}));

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

let lectura: { data: unknown; error: { message: string } | null } = { data: [], error: null };
let resultadosUpdate: Array<{ data?: unknown; error: { message: string } | null }> = [];
const filtros: Array<[string, unknown[]]> = [];
const updates: Array<{ fila: Record<string, unknown>; por: Array<[string, unknown]> }> = [];

function cadenaLectura() {
  const nodo: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'is', 'not', 'lte', 'limit']) {
    nodo[m] = (...a: unknown[]) => { filtros.push([m, a]); return nodo; };
  }
  nodo.then = (r: (v: unknown) => unknown) => Promise.resolve(lectura).then(r);
  return nodo;
}

const from = vi.fn((tabla: string) => ({
  select: (...a: unknown[]) => { filtros.push([`select ${tabla}`, a]); return cadenaLectura(); },
  update: (fila: Record<string, unknown>) => {
    const por: Array<[string, unknown]> = [];
    const nodo: Record<string, unknown> = {};
    nodo.eq = (col: string, val: unknown) => { por.push([col, val]); return nodo; };
    nodo.is = () => nodo;
    nodo.select = () => nodo;
    nodo.then = (r: (v: unknown) => unknown) => {
      updates.push({ fila, por });
      const res = resultadosUpdate[updates.length - 1] ?? resultadosUpdate.at(-1) ?? { error: null };
      return Promise.resolve(res).then(r);
    };
    return nodo;
  },
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [string])) }),
}));

const { viajesSinComprobar, armarRecordatorioComprobacion, enviarRecordatoriosComprobacion, DIAS_PARA_RECORDAR } =
  await import('./recordatorio_comprobacion');

const AHORA = new Date('2026-08-08T18:00:00.000Z');
const LIMITE = '2026-08-05'; // 3 días antes, en fecha simple (columna `date`)

const fila = (o: Record<string, unknown> = {}) => ({
  id: 'v-1', tenant_id: 't-1', folio: 'VJ-104', operador_id: 'o-1',
  fecha_inicio: '2026-08-04',
  operador: { nombre: 'Juan Pérez', telefono: '5219993700779' },
  ...o,
});

beforeEach(() => {
  lectura = { data: [], error: null };
  resultadosUpdate = [{ data: [{ id: 'v-1' }], error: null }];
  filtros.length = 0;
  updates.length = 0;
  from.mockClear();
  sendText.mockReset();
  sendText.mockResolvedValue('wamid.TEST');
  for (const f of Object.values(logger)) f.mockReset();
});

const args = (metodo: string) => filtros.filter(([m]) => m === metodo).map(([, a]) => a);

describe('viajesSinComprobar', () => {
  it('pide solo abiertos/en_cuadre, sin recordatorio previo, con fecha vieja', async () => {
    await viajesSinComprobar(AHORA);
    expect(from).toHaveBeenCalledWith('viaje');
    expect(args('in')).toContainEqual(['estatus', ['abierto', 'en_cuadre']]);
    expect(args('is')).toContainEqual(['recordatorio_comprobacion_en', null]);
    expect(args('not')).toContainEqual(['fecha_inicio', 'is', null]);
    expect(args('limit')).toContainEqual([100]);
  });

  it(`el corte son ${3} días exactos, medidos contra el "ahora" inyectado`, async () => {
    await viajesSinComprobar(AHORA);
    const [[columna, limite]] = args('lte') as Array<[string, string]>;
    expect(columna).toBe('fecha_inicio');
    expect(limite).toBe(LIMITE);
    expect(DIAS_PARA_RECORDAR).toBe(3);
  });

  it('UN ERROR NO ES UNA LISTA VACÍA: lanza en vez de decir que no hay viajes', async () => {
    lectura = { data: null, error: { message: 'timeout' } };
    await expect(viajesSinComprobar(AHORA)).rejects.toThrow(/timeout/);
  });

  it('lo que no está capturado viaja como null, no como texto inventado', async () => {
    lectura = { data: [fila({ folio: null, operador: null })], error: null };
    const [v] = await viajesSinComprobar(AHORA);
    expect(v).toMatchObject({ folio: null, operadorNombre: null, operadorTelefono: null });
  });
});

describe('armarRecordatorioComprobacion', () => {
  const VIAJE = { id: 'v-1', tenantId: 't-1', folio: 'VJ-104', operadorId: 'o-1', operadorNombre: 'Juan', operadorTelefono: '52999', fechaInicio: '2026-08-04' };

  it('dice cuántos días lleva y qué mandar, sin regañar', () => {
    const t = armarRecordatorioComprobacion(VIAJE, 4);
    expect(t).toContain('4 días');
    expect(t).toContain('VJ-104');
    expect(t).toMatch(/mándame|manda/i);
    expect(t).not.toMatch(/no has|deberías|urgente/i);
  });

  it('sin folio no inventa uno', () => {
    const t = armarRecordatorioComprobacion({ ...VIAJE, folio: null }, 4);
    expect(t).toContain('tu viaje abierto');
    expect(t).not.toMatch(/null|undefined/);
  });
});

describe('enviarRecordatoriosComprobacion', () => {
  it('manda el recordatorio y marca el viaje', async () => {
    lectura = { data: [fila()], error: null };
    const r = await enviarRecordatoriosComprobacion(AHORA);

    expect(sendText).toHaveBeenCalledWith('5219993700779', expect.stringContaining('VJ-104'));
    expect(updates).toHaveLength(1);
    expect(updates[0].por).toEqual([['id', 'v-1'], ['tenant_id', 't-1']]);
    expect(typeof updates[0].fila.recordatorio_comprobacion_en).toBe('string');
    expect(r).toEqual({ revisados: 1, recordados: 1, fallos: [] });
  });

  it('sin teléfono capturado: SE MARCA igual, y el fallo queda dicho', async () => {
    lectura = { data: [fila({ operador: { nombre: 'Juan' } })], error: null };
    const r = await enviarRecordatoriosComprobacion(AHORA);

    expect(sendText).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
    expect(r.recordados).toBe(0);
    expect(r.fallos[0]).toMatch(/no tiene teléfono capturado/i);
    expect(logger.error).toHaveBeenCalledWith('recordatorio_comprobacion.sin_telefono', { tenantId: 't-1', viaje: 'v-1' });
  });

  it('si el claim NO se pudo escribir, no se cuenta ni se manda nada', async () => {
    resultadosUpdate = [{ error: { message: 'deadlock detected' } }];
    lectura = { data: [fila()], error: null };

    const r = await enviarRecordatoriosComprobacion(AHORA);

    expect(r.recordados).toBe(0);
    expect(r.revisados).toBe(1);
    expect(r.fallos.join(' ')).toMatch(/marcar VJ-104: deadlock detected/);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('DOS CORRIDAS SOLAPADAS: solo UNA gana el claim y manda el mensaje', async () => {
    lectura = { data: [fila()], error: null };

    resultadosUpdate = [{ data: [{ id: 'v-1' }], error: null }];
    const r1 = await enviarRecordatoriosComprobacion(AHORA);
    expect(r1.recordados).toBe(1);
    expect(sendText).toHaveBeenCalledTimes(1);

    sendText.mockClear();
    resultadosUpdate = [{ data: [], error: null }]; // la corrida 1 ya puso el sello
    const r2 = await enviarRecordatoriosComprobacion(AHORA);

    expect(r2.recordados).toBe(0);
    expect(r2.fallos).toEqual([]); // perder la carrera no es un fallo
    expect(sendText).not.toHaveBeenCalled();
  });

  it('un viaje malo no tumba al resto del lote', async () => {
    lectura = {
      data: [fila({ id: 'v-1', folio: 'VJ-1' }), fila({ id: 'v-2', folio: 'VJ-2' }), fila({ id: 'v-3', folio: 'VJ-3' })],
      error: null,
    };
    resultadosUpdate = [
      { data: [{}], error: null },
      { error: { message: 'deadlock' } },
      { data: [{}], error: null },
    ];

    const r = await enviarRecordatoriosComprobacion(AHORA);

    expect(sendText).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ revisados: 3, recordados: 2 });
    expect(r.fallos).toHaveLength(1);
    expect(r.fallos[0]).toMatch(/marcar VJ-2: deadlock/);
  });

  it('el UPDATE va acotado por tenant, no solo por id', async () => {
    lectura = { data: [fila({ tenant_id: 't-9' })], error: null };
    await enviarRecordatoriosComprobacion(AHORA);
    expect(updates[0].por).toContainEqual(['tenant_id', 't-9']);
  });

  it('sin viajes vencidos no manda nada ni escribe nada', async () => {
    lectura = { data: [], error: null };
    const r = await enviarRecordatoriosComprobacion(AHORA);
    expect(r).toEqual({ revisados: 0, recordados: 0, fallos: [] });
    expect(sendText).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('una EXCEPCIÓN de sendText no impide marcar ni corta el lote', async () => {
    sendText.mockRejectedValue(new Error('socket hang up'));
    lectura = { data: [fila({ id: 'v-1', folio: 'VJ-1' }), fila({ id: 'v-2', folio: 'VJ-2' })], error: null };

    const r = await enviarRecordatoriosComprobacion(AHORA);

    expect(updates).toHaveLength(2);
    expect(r.recordados).toBe(0);
    expect(r.fallos).toEqual(['VJ-1: socket hang up', 'VJ-2: socket hang up']);
  });

  it('deja en el log el resumen de la corrida', async () => {
    lectura = { data: [fila()], error: null };
    await enviarRecordatoriosComprobacion(AHORA);
    expect(logger.info).toHaveBeenCalledWith('viaje.recordatorio_comprobacion', { revisados: 1, recordados: 1, fallos: 0 });
  });
});
