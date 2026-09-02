import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 21 · BACKEND · ALTO REINCIDENTE (18-c4) — `updateGastoCfdiXml`
// descartaba el `error` de la lectura de `ocr_extra` que hace justo antes de
// fusionar. `acotada` entrega el tope agotado POR VALOR — `{ data: null,
// error }`, nunca lanza (presupuesto.ts) — así que un timeout en esa lectura
// se leía como "el gasto no tenía ocr_extra": el merge arrancaba de `{}` y el
// update posterior REEMPLAZABA el jsonb entero.
//
// El escenario del hallazgo, con valores: un diésel de USD 450 en la frontera
// deja `ocr_extra = { moneda:'USD', tipoCambio:18.90, montoDiscrepante:true,
// estacion, producto, litros }`. Días después llega el XML del emisor con
// `ClaveUnidad=LTR` y `Cantidad=212`; si la lectura previa agota su tope, el
// update escribía `ocr_extra = { litros: 212 }` — y el motor de cuadre
// (`engine.ts`) ya no encuentra `moneda`, no emite `moneda_extranjera`, y el
// IVA se acredita sobre USD 450 como si fueran $450.00 MXN.
//
// Esta prueba ejercita el CUERPO REAL de `repo.ts` (nada de `vi.fn()` sobre
// la función): lo que se dobla es la base y `acotada`.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

/** Lo que el intake dejó escrito del diésel de USD 450. */
const OCR_EXTRA_INTAKE = {
  producto: 'Diesel',
  estacion: 'Pemex 4412',
  litros: 210.5,
  moneda: 'USD',
  tipoCambio: 18.9,
  montoDiscrepante: true,
};

/** La fila viva de `gasto` en la "base". El update la REEMPLAZA columna por
 *  columna, igual que PostgREST: `ocr_extra` no se fusiona en la base, se
 *  escribe entero — por eso el merge tiene que pasar en el código, y por eso
 *  perder la lectura previa borra lo que ya había. */
let gastoEnBase: Record<string, unknown>;
const updates: Array<Record<string, unknown>> = [];

function builderGasto() {
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b,
    eq: () => b,
    maybeSingle: () => ({
      then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve({ data: { ocr_extra: gastoEnBase.ocr_extra }, error: null }).then(res, rej),
    }),
    update: (v: Record<string, unknown>) => {
      const w: Record<string, unknown> = {
        eq: () => w,
        then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => {
          updates.push(v);
          gastoEnBase = { ...gastoEnBase, ...v };
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        },
      };
      return w;
    },
  });
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => builderGasto() }) }));

/** El fallo por valor que entrega `acotada` al agotarse `TOPE_CONSULTA_MS`
 *  (o un error de Postgres): mismo canal, nunca una excepción. Se dispara
 *  SOLO en la etiqueta de la lectura previa — el update sigue sano, que es
 *  exactamente el peor momento del hallazgo. */
let errorLectura: { message: string; code?: string } | null = null;
vi.mock('./presupuesto', () => ({
  acotada: (q: unknown, etiqueta: string) =>
    etiqueta === 'updateGastoCfdiXml.leerOcrExtra' && errorLectura
      ? Promise.resolve({ data: null, error: errorLectura })
      : q,
}));

const { updateGastoCfdiXml } = await import('./repo');

/** El XML del emisor pegado al ticket: litros autoritativos, sin nodo de moneda. */
const XML_LITROS = { claveUnidad: 'LTR', cantidad: 212, tipoComprobante: 'I' };

beforeEach(() => {
  gastoEnBase = { id: 'g-1', tenant_id: 't-1', ocr_extra: { ...OCR_EXTRA_INTAKE } };
  updates.length = 0;
  errorLectura = null;
});

describe('updateGastoCfdiXml — el tope de la lectura previa NO borra ocr_extra (fail-closed)', () => {
  it('REPRO: con la lectura agotando su tope, LANZA y no escribe nada — moneda, tipoCambio y montoDiscrepante sobreviven', async () => {
    errorLectura = { message: 'sin respuesta en 8000 ms (tope de consulta)' };

    await expect(updateGastoCfdiXml('t-1', 'g-1', XML_LITROS))
      .rejects.toThrow(/updateGastoCfdiXml\.leerOcrExtra/);

    // Fail-closed de verdad: CERO updates — no "un update sin ocr_extra".
    expect(updates).toEqual([]);
    // El jsonb del intake queda intacto, banderas de fraude incluidas.
    expect(gastoEnBase.ocr_extra).toEqual(OCR_EXTRA_INTAKE);
  });

  it('un error de Postgres en la lectura viaja con su `code` (mismo contrato que el update)', async () => {
    errorLectura = { message: 'permission denied for table gasto', code: '42501' };
    const err = await updateGastoCfdiXml('t-1', 'g-1', XML_LITROS).catch((e: Error & { code?: string }) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error & { code?: string }).code).toBe('42501');
    expect(updates).toEqual([]);
  });

  it('con la lectura sana, los litros del XML se FUSIONAN: 212 entra y la moneda extranjera sigue ahí', async () => {
    await updateGastoCfdiXml('t-1', 'g-1', XML_LITROS);

    expect(updates).toHaveLength(1);
    expect(gastoEnBase.ocr_extra).toEqual({ ...OCR_EXTRA_INTAKE, litros: 212 });
    // Lo que el motor de cuadre necesita para emitir `moneda_extranjera`:
    const extra = gastoEnBase.ocr_extra as Record<string, unknown>;
    expect(extra.moneda).toBe('USD');
    expect(extra.tipoCambio).toBe(18.9);
    expect(extra.montoDiscrepante).toBe(true);
  });

  it('la moneda del XML manda sobre la del OCR, sin tirar el resto del jsonb', async () => {
    await updateGastoCfdiXml('t-1', 'g-1', { ...XML_LITROS, moneda: 'USD', tipoCambio: 19.05 });
    expect(gastoEnBase.ocr_extra).toEqual({ ...OCR_EXTRA_INTAKE, litros: 212, tipoCambio: 19.05 });
  });
});
