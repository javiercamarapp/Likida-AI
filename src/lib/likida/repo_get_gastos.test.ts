import { describe, it, expect, beforeEach, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA E.28, PRU-C1 (CRÍTICO pruebas) — `getGastos` es el lector CENTRAL
// de gastos: alimenta el cuadre (`cuadre/desde_db.ts`), el cierre del viaje
// (`processor.ts`, seis llamadas) y por tanto toda cifra de dinero que
// depende de esos dos caminos. Y sin embargo, en toda la suite, la ÚNICA
// invocación de la función REAL (no mockeada) era `repo_tope.test.ts`, que
// solo ejercita el camino de red muda (un socket que nunca contesta) y
// verifica que LANCE — nunca llega a `.map()`. La comprobación con
// `coverage-final.json`: `getGastos` en sí (fn 35) tenía 1 hit; la función
// del `.map()` que arma cada `Gasto` (fn 36, líneas 913-945: TODO el mapeo de
// dinero, RFC, CFDI, EFOS…) tenía CERO hits en el suite completo. Cero
// aserciones sobre el camino feliz de la función que le pone monto, RFC y
// estatus SAT a cada renglón de dinero de la flota.
//
// Mismo patrón que `repo_huerfanos.test.ts`/`repo_aviso.test.ts`: un
// PostgREST de mentira que SÍ ejecuta la cadena real de métodos.
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que se le pidió a la base, en orden: tabla, método, argumentos. */
let llamadas: Array<{ tabla: string; metodo: string; args: unknown[] }> = [];
let respuesta: { data: unknown; error: unknown } = { data: null, error: null };

const from = vi.fn((tabla: string) => {
  const enlace: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) {
    enlace[m] = (...a: unknown[]) => { llamadas.push({ tabla, metodo: m, args: a }); return enlace; };
  }
  enlace.then = (r: (v: unknown) => unknown) => Promise.resolve(respuesta).then(r);
  return enlace;
});

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from }) }));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { getGastos } = await import('./repo');

/** Un renglón CRUDO tal como lo devuelve PostgREST — snake_case, sin mapear. */
function renglonCrudo(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'g1', concepto: 'diesel', monto: 1234.56, fecha: '2026-08-20',
    folio: '00123', folio_norm: '123', ocr_extra: { litros: 200 },
    rfc_emisor: 'PEM123456ABC', rfc_receptor: 'FLO987654XYZ',
    cfdi_uuid: 'uuid-1', cfdi_orden: 1, imagen_url: 'https://x/g1.jpg',
    ocr_confianza: 0.92, cfdi_valido: true, estado_sat: 'vigente',
    efos: false, efos_revisar: false, clave_prod_serv: '15101514',
    clave_unidad: 'LTR', tipo_comprobante: 'I', complemento_hidrocarburos: true,
    cfdi_esquema_alterno: false, xml_verificado: true, forma_pago: '03',
    metodo_pago: 'PUE', pagado_en: '2026-08-21', pagado_forma: 'transferencia',
    sub_total: 1064.28, descuento: 0, ieps_traslado: 45.12, iva_traslado: 170.28,
    ...extra,
  };
}

beforeEach(() => {
  llamadas = [];
  respuesta = { data: null, error: null };
  from.mockClear();
});

describe('getGastos — filtra por tenant y por viaje', () => {
  it('pide EXACTAMENTE tenant_id y viaje_id, en ese orden, sobre la tabla gasto', async () => {
    respuesta = { data: [], error: null };
    await getGastos('v-55', 't-9');
    const eqs = llamadas.filter((l) => l.metodo === 'eq');
    expect(llamadas[0]).toMatchObject({ tabla: 'gasto', metodo: 'select' });
    expect(eqs).toEqual([
      { tabla: 'gasto', metodo: 'eq', args: ['tenant_id', 't-9'] },
      { tabla: 'gasto', metodo: 'eq', args: ['viaje_id', 'v-55'] },
    ]);
  });

  it('un tenant distinto o un viaje distinto arman un filtro distinto (no hay valor quemado)', async () => {
    respuesta = { data: [], error: null };
    await getGastos('otro-viaje', 'otro-tenant');
    const eqs = llamadas.filter((l) => l.metodo === 'eq');
    expect(eqs).toEqual([
      { tabla: 'gasto', metodo: 'eq', args: ['tenant_id', 'otro-tenant'] },
      { tabla: 'gasto', metodo: 'eq', args: ['viaje_id', 'otro-viaje'] },
    ]);
  });
});

describe('getGastos — el caso vacío/null nunca se inventa un gasto', () => {
  it('data: null (PostgREST sin filas) → []', async () => {
    respuesta = { data: null, error: null };
    await expect(getGastos('v1', 't1')).resolves.toEqual([]);
  });

  it('data: [] → []', async () => {
    respuesta = { data: [], error: null };
    await expect(getGastos('v1', 't1')).resolves.toEqual([]);
  });
});

describe('getGastos — un error de Postgres SIEMPRE lanza (nunca [] disfrazado de "sin gastos")', () => {
  it('propaga el mensaje del error, prefijado con "getGastos:"', async () => {
    respuesta = { data: null, error: { message: 'relation "gasto" does not exist' } };
    await expect(getGastos('v1', 't1')).rejects.toThrow('getGastos: relation "gasto" does not exist');
  });
});

describe('getGastos — el mapeo del camino feliz (la parte que NUNCA se ejecutaba)', () => {
  it('mapea monto a Number y conserva concepto, fecha y folios tal cual', async () => {
    respuesta = { data: [renglonCrudo()], error: null };
    const [g] = await getGastos('v1', 't1');
    expect(g.id).toBe('g1');
    expect(g.concepto).toBe('diesel');
    expect(g.monto).toBe(1234.56);
    expect(typeof g.monto).toBe('number');
    expect(g.fecha).toBe('2026-08-20');
    expect(g.folio).toBe('00123');
    expect(g.folioNorm).toBe('123');
  });

  it('conserva RFC, CFDI y los booleanos EXACTOS del renglón (true y false, no solo el caso feliz)', async () => {
    respuesta = { data: [renglonCrudo({ cfdi_valido: true, efos: false, xml_verificado: true })], error: null };
    const [g] = await getGastos('v1', 't1');
    expect(g.rfcEmisor).toBe('PEM123456ABC');
    expect(g.rfcReceptor).toBe('FLO987654XYZ');
    expect(g.cfdiUuid).toBe('uuid-1');
    expect(g.cfdiValido).toBe(true);
    expect(g.efos).toBe(false);          // false ≠ "sin dato": no debe volverse undefined
    expect(g.xmlVerificado).toBe(true);
  });

  it('conserva cfdiOrden = 0 tal cual (0 es un renglón válido, no "sin dato")', async () => {
    respuesta = { data: [renglonCrudo({ cfdi_orden: 0 })], error: null };
    const [g] = await getGastos('v1', 't1');
    expect(g.cfdiOrden).toBe(0);
  });

  it('las cifras fiscales (subTotal, descuento, IEPS, IVA) llegan como Number, no como string', async () => {
    respuesta = {
      data: [renglonCrudo({ sub_total: 500, descuento: 12.5, ieps_traslado: 10, iva_traslado: 80 })],
      error: null,
    };
    const [g] = await getGastos('v1', 't1');
    expect(g.subTotal).toBe(500);
    expect(g.descuento).toBe(12.5);
    expect(g.iepsTraslado).toBe(10);
    expect(g.ivaTraslado).toBe(80);
    for (const v of [g.subTotal, g.descuento, g.iepsTraslado, g.ivaTraslado]) {
      expect(typeof v).toBe('number');
      expect(Number.isNaN(v)).toBe(false);
    }
  });

  it('mapea varios renglones en el mismo orden en que los devolvió la base', async () => {
    respuesta = {
      data: [renglonCrudo({ id: 'g1', monto: 100 }), renglonCrudo({ id: 'g2', monto: 200 })],
      error: null,
    };
    const gastos = await getGastos('v1', 't1');
    expect(gastos.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(gastos.map((g) => g.monto)).toEqual([100, 200]);
  });

  // ── LA GARANTÍA DE LA CASA: null NUNCA se vuelve 0 ni NaN ──────────────────
  it('con TODOS los campos opcionales en null, se vuelven undefined — nunca 0, nunca NaN, nunca cadena vacía', async () => {
    respuesta = {
      data: [{
        id: 'g-vacio', concepto: 'otro', monto: 0,
        fecha: null, folio: null, folio_norm: null, ocr_extra: null,
        rfc_emisor: null, rfc_receptor: null, cfdi_uuid: null, cfdi_orden: null,
        imagen_url: null, ocr_confianza: null, cfdi_valido: null, estado_sat: null,
        efos: null, efos_revisar: null, clave_prod_serv: null, clave_unidad: null,
        tipo_comprobante: null, complemento_hidrocarburos: null, cfdi_esquema_alterno: null,
        xml_verificado: null, forma_pago: null, metodo_pago: null, pagado_en: null,
        pagado_forma: null, sub_total: null, descuento: null, ieps_traslado: null, iva_traslado: null,
      }],
      error: null,
    };
    const [g] = await getGastos('v1', 't1');
    // Los opcionales `null` se vuelven `undefined` — el contrato de la función
    // (nunca `null` cuando no hay dato, y JAMÁS un número falso como 0/NaN).
    for (const campo of [
      'fecha', 'folio', 'folioNorm', 'ocrExtra', 'rfcEmisor', 'rfcReceptor', 'cfdiUuid',
      'cfdiOrden', 'imagenUrl', 'ocrConfianza', 'cfdiValido', 'estadoSat', 'efos', 'efosRevisar',
      'claveProdServ', 'claveUnidad', 'tipoComprobante', 'complementoHidrocarburos',
      'cfdiEsquemaAlterno', 'xmlVerificado', 'formaPago', 'metodoPago', 'pagadoEn', 'pagadoForma',
      'subTotal', 'descuento', 'iepsTraslado', 'ivaTraslado',
    ] as const) {
      expect(g[campo], `${campo} debería ser undefined, no null/0/NaN`).toBeUndefined();
    }
    // `monto` SÍ es obligatorio en el tipo: un 0 real de la base es un 0 real,
    // no un `null` disfrazado — esta fila lo manda explícito en 0.
    expect(g.monto).toBe(0);
    expect(Number.isNaN(g.monto)).toBe(false);
  });
});
