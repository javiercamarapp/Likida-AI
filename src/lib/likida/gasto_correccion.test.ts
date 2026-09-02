import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · WA-3 (ALTO) — hasta hoy NO existía ningún camino para
// cambiar `gasto.monto`. Un ticket de $8,000 leído como $800 con 0.94 de
// confianza salía «Anotado ✅» sin botón, y ni el chofer ni el panel podían
// tocarlo: la única salida era reenviar la foto y quedarse con DOS gastos.
//
// Se ejercita el cuerpo real contra un PostgREST de mentira que registra la
// cadena: lo que importa aquí es qué columnas se tocan (y cuáles NO), que el
// `ocr_extra` se MERGEE en vez de reemplazarse, y que cada motivo de rechazo
// tenga nombre — «llegó tarde» no es «hubo un problema».
// ═══════════════════════════════════════════════════════════════════════════

let llamadas: Array<{ tabla: string; metodo: string; args: unknown[] }> = [];
let lectura: { data: unknown; error: unknown } = { data: null, error: null };
let escritura: { data: unknown; error: unknown } = { data: null, error: null };

const from = vi.fn((tabla: string) => {
  const enlace: Record<string, unknown> = {};
  let esUpdate = false;
  for (const m of ['insert', 'select', 'update', 'eq', 'is', 'maybeSingle']) {
    enlace[m] = (...a: unknown[]) => {
      llamadas.push({ tabla, metodo: m, args: a });
      if (m === 'update' || m === 'insert') esUpdate = true;
      if (m === 'maybeSingle') return Promise.resolve(lectura);
      return enlace;
    };
  }
  enlace.then = (r: (v: unknown) => unknown) => Promise.resolve(esUpdate ? escritura : lectura).then(r);
  return enlace;
});

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from }) }));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { corregirMontoGasto, marcarMontoDisputado } = await import('./gasto_correccion');

const ACTOR = { id: 'u1', email: 'contralor@flota.mx' };
const FILA = {
  id: 'g1', viaje_id: 'v1', monto: 800, xml_verificado: false,
  ocr_extra: { litros: 400, moneda: 'MXN' },
};

const update = () => llamadas.find((l) => l.tabla === 'gasto' && l.metodo === 'update')?.args[0] as
  { monto: number; ocr_extra: Record<string, unknown> } | undefined;

beforeEach(() => {
  llamadas = [];
  lectura = { data: FILA, error: null };
  escritura = { data: null, error: null };
  from.mockClear();
  logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
});

describe('corregirMontoGasto — el camino que faltaba', () => {
  it('EL CASO: $800 leído mal pasa a $8,000, y solo se tocan monto y ocr_extra', async () => {
    const r = await corregirMontoGasto({ tenantId: 't1', gastoId: 'g1', montoNuevo: 8000, actor: ACTOR, motivo: 'el ticket dice 8,000' });
    expect(r).toEqual({ ok: true, antes: 800, despues: 8000 });
    expect(Object.keys(update()!).sort()).toEqual(['monto', 'ocr_extra']);
    expect(update()!.monto).toBe(8000);
  });

  it('acotado por gasto Y por tenant, en la lectura y en la escritura', async () => {
    await corregirMontoGasto({ tenantId: 't1', gastoId: 'g1', montoNuevo: 8000, actor: ACTOR, motivo: 'x' });
    const eqs = llamadas.filter((l) => l.metodo === 'eq').map((l) => l.args);
    expect(eqs.filter((a) => a[0] === 'tenant_id')).toHaveLength(2);
    expect(eqs.filter((a) => a[0] === 'id')).toHaveLength(2);
  });

  it('el ocr_extra se MERGEA: litros y moneda sobreviven a la corrección', async () => {
    await corregirMontoGasto({ tenantId: 't1', gastoId: 'g1', montoNuevo: 8000, actor: ACTOR, motivo: 'x' });
    const extra = update()!.ocr_extra;
    expect(extra.litros).toBe(400);
    expect(extra.moneda).toBe('MXN');
  });

  it('deja constancia EN LA FILA de lo que decía antes, quién y por qué', async () => {
    await corregirMontoGasto({ tenantId: 't1', gastoId: 'g1', montoNuevo: 8000, actor: ACTOR, motivo: 'el ticket dice 8,000' });
    const hist = update()!.ocr_extra.montoCorregido as Array<Record<string, unknown>>;
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ antes: 800, despues: 8000, motivo: 'el ticket dice 8,000', por: 'contralor@flota.mx' });
  });

  it('una segunda corrección NO pisa la primera: la historia entera queda', async () => {
    lectura = { data: { ...FILA, monto: 8000, ocr_extra: { montoCorregido: [{ antes: 800, despues: 8000 }] } }, error: null };
    await corregirMontoGasto({ tenantId: 't1', gastoId: 'g1', montoNuevo: 8500, actor: ACTOR, motivo: 'faltaba propina' });
    expect(update()!.ocr_extra.montoCorregido).toHaveLength(2);
  });

  it('y queda en la bitácora, con la entidad y la acción propias', async () => {
    await corregirMontoGasto({ tenantId: 't1', gastoId: 'g1', montoNuevo: 8000, actor: ACTOR, motivo: 'x' });
    const ins = llamadas.find((l) => l.tabla === 'bitacora_auditoria' && l.metodo === 'insert');
    expect(ins?.args[0]).toMatchObject({
      tenant_id: 't1', actor_email: 'contralor@flota.mx',
      accion: 'gasto.corregir_monto', entidad: 'gasto', entidad_id: 'g1',
    });
  });
});

describe('lo que NO se deja hacer, con su nombre', () => {
  const base = { tenantId: 't1', gastoId: 'g1', actor: ACTOR, motivo: 'x' };

  it('un monto de cero, negativo o absurdo se rechaza sin tocar la base', async () => {
    for (const m of [0, -1, NaN, 2_000_000]) {
      llamadas = [];
      expect(await corregirMontoGasto({ ...base, montoNuevo: m })).toEqual({ ok: false, motivo: 'monto_invalido' });
      expect(from).not.toHaveBeenCalled();
    }
  });

  it('sin motivo escrito no se corrige: una cifra de dinero movida «porque sí» no existe', async () => {
    expect(await corregirMontoGasto({ ...base, motivo: '   ', montoNuevo: 8000 })).toEqual({ ok: false, motivo: 'sin_motivo' });
  });

  it('sin actor tampoco: esto siempre lo firma alguien', async () => {
    expect(await corregirMontoGasto({ ...base, actor: {}, montoNuevo: 8000 })).toEqual({ ok: false, motivo: 'sin_actor' });
  });

  it('un gasto que no existe se dice como tal', async () => {
    lectura = { data: null, error: null };
    expect(await corregirMontoGasto({ ...base, montoNuevo: 8000 })).toEqual({ ok: false, motivo: 'no_existe' });
  });

  it('un gasto con XML verificado NO se corrige a mano: el CFDI es la autoridad', async () => {
    lectura = { data: { ...FILA, xml_verificado: true }, error: null };
    expect(await corregirMontoGasto({ ...base, montoNuevo: 8000 })).toEqual({ ok: false, motivo: 'xml_verificado' });
    expect(update()).toBeUndefined();
  });

  it('CU001 (la liquidación ya se emitió) es «llegó tarde», no «hubo un problema»', async () => {
    escritura = { data: null, error: { message: 'el viaje ya tiene liquidación emitida', code: 'CU001' } };
    expect(await corregirMontoGasto({ ...base, montoNuevo: 8000 })).toEqual({ ok: false, motivo: 'liquidado' });
  });

  it('FAIL-CLOSED: una lectura caída NO se toma por «el gasto no tenía ocr_extra»', async () => {
    // Sin esto, el update de abajo reemplazaría el jsonb entero desde `{}` y
    // el motor de cuadre perdería litros, moneda y discrepancias.
    lectura = { data: null, error: { message: 'tope de consulta agotado' } };
    const r = await corregirMontoGasto({ ...base, montoNuevo: 8000 });
    expect(r).toMatchObject({ ok: false, motivo: 'error' });
    expect(update(), 'no se escribió nada').toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('gasto.correccion_lectura', expect.anything());
  });

  it('corregir al MISMO monto no escribe nada y no miente: dice ok', async () => {
    const r = await corregirMontoGasto({ ...base, montoNuevo: 800 });
    expect(r).toEqual({ ok: true, antes: 800, despues: 800 });
    expect(update()).toBeUndefined();
  });
});

describe('marcarMontoDisputado — el botón «No, corregir» por fin deja rastro', () => {
  it('marca la fila SIN tocar el monto: nadie dijo cuál es el bueno', async () => {
    const ok = await marcarMontoDisputado({ tenantId: 't1', gastoId: 'g1', quien: 'o1', dijo: 'son 8000' });
    expect(ok).toBe(true);
    expect(Object.keys(update()!)).toEqual(['ocr_extra']);
    expect(update()!.ocr_extra.montoDisputado).toMatchObject({ montoLeido: 800, por: 'o1', dijo: 'son 8000' });
  });

  it('el resto del ocr_extra sobrevive', async () => {
    await marcarMontoDisputado({ tenantId: 't1', gastoId: 'g1', quien: 'o1' });
    expect(update()!.ocr_extra.litros).toBe(400);
  });

  it('una lectura caída no borra nada y devuelve false (el texto al chofer cambia con esto)', async () => {
    lectura = { data: null, error: { message: 'tope' } };
    expect(await marcarMontoDisputado({ tenantId: 't1', gastoId: 'g1', quien: 'o1' })).toBe(false);
    expect(update()).toBeUndefined();
  });

  it('un fallo de escritura tampoco lanza: el gasto ya está en el viaje', async () => {
    escritura = { data: null, error: { message: 'CU001', code: 'CU001' } };
    expect(await marcarMontoDisputado({ tenantId: 't1', gastoId: 'g1', quien: 'o1' })).toBe(false);
  });
});
