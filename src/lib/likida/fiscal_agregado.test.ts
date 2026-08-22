import { describe, it, expect, vi, beforeEach } from 'vitest';
import { armar as armarPorFacturar } from './facturacion/pendientes';
import { calcularCaducidad, type Plazo } from './facturacion/caducidad';
import { COMERCIOS } from './facturacion/comercios';

// ═══════════════════════════════════════════════════════════════════════════
// ESCALA 50k VIAJES/MES (mig. 0151): getGastosFiscales PASÓ DE `traerTodo`
// SOBRE TODO EL EJERCICIO (+ traerPorIds sobre los viajes) A UNA RPC QUE
// DEVUELVE CELDAS AGREGADAS POR DIMENSIÓN FISCAL.
//
// La ley (resumirFiscal/resumirPerdidas/…) NO se movió a SQL: recibe las
// celdas como `GastoFiscal` con `celda.n` y las pesa. Lo que este archivo
// prueba es LA EQUIVALENCIA: la misma ley, sobre las filas crudas (el camino
// viejo, congelado aquí como `legacyMapear`) y sobre las celdas (el camino
// nuevo, con la RPC mockeada por `sqlAgregadoEquivalente`, un reductor
// escrito de forma independiente que emula el `group by` de la 0151), tiene
// que dar EXACTAMENTE las mismas cifras visibles en el dataset sintético —
// que cubre cada dimensión que la ley mira: EFOS, cancelado, por validar,
// efectivo sobre y bajo el tope, combustible en efectivo, IEPS de diésel,
// casetas con y sin base, alimentación timbrada sobre el tope (mismo viaje y
// día, y un día igual en OTRO viaje), tickets sin CFDI con comercio
// reconocido por liga/RFC/texto y sin reconocer, recientes y vencidos, y
// uno sin fecha (solo entra en 'todo').
//
// También: fail-closed (error de la RPC, forma rota, celda malformada →
// LANZAN), aislamiento entre tenants, y que los cortes de plazo reproducen
// `calcularCaducidad` día por día para cada plazo del catálogo.
// ═══════════════════════════════════════════════════════════════════════════

type Fila = {
  id: string; tenant_id: string; viaje_id: string; concepto: string; monto: number;
  fecha: string | null; folio: string | null; rfc_emisor: string | null; cfdi_uuid: string | null;
  cfdi_valido: boolean | null; estado_sat: string | null; efos: boolean | null; efos_revisar: boolean | null;
  forma_pago: string | null; sub_total: number | null; iva_traslado: number | null; ieps_traslado: number | null;
  clave_prod_serv: string | null; tipo_comprobante: string | null; xml_verificado: boolean | null;
  ocr_confianza: number | null; ocr_extra: Record<string, unknown> | null;
};

const HOY = '2026-08-22';
const T = 'tenant-a';
const OTRO = 'tenant-b';

let seq = 0;
function fila(over: Partial<Fila>): Fila {
  seq += 1;
  return {
    id: `g${String(seq).padStart(3, '0')}`, tenant_id: T, viaje_id: 'v1', concepto: 'diesel', monto: 1000,
    fecha: '2026-08-10', folio: `F${seq}`, rfc_emisor: null, cfdi_uuid: `uuid-${seq}`, cfdi_valido: true,
    estado_sat: 'vigente', efos: false, efos_revisar: null, forma_pago: '04', sub_total: null,
    iva_traslado: null, ieps_traslado: null, clave_prod_serv: null, tipo_comprobante: 'I',
    xml_verificado: true, ocr_confianza: 0.9, ocr_extra: null,
    ...over,
  };
}

function dataset(): Fila[] {
  seq = 0;
  const sinCfdi = { cfdi_uuid: null, estado_sat: null, efos: null, forma_pago: null, cfdi_valido: null, xml_verificado: null };
  return [
    // ── con CFDI, cada suerte fiscal ──
    fila({ iva_traslado: 137.93, ieps_traslado: 60, clave_prod_serv: '15101505', sub_total: 862.07 }),
    fila({ iva_traslado: 137.93, ieps_traslado: 60, clave_prod_serv: '15101505', sub_total: 862.07 }), // misma celda
    fila({ concepto: 'diesel', forma_pago: '01', iva_traslado: 68.97, ieps_traslado: 30, clave_prod_serv: '15101505', monto: 500 }),
    fila({ concepto: 'diesel', forma_pago: '01', iva_traslado: 68.97, ieps_traslado: null, clave_prod_serv: '15101505', monto: 500 }),
    fila({ concepto: 'otro', clave_prod_serv: '15101514', iva_traslado: 10, monto: 80 }), // gasolina: combustible por clave, sin IEPS
    fila({ concepto: 'otro', efos: true, iva_traslado: 41.38, monto: 300 }),
    fila({ concepto: 'otro', efos: null, efos_revisar: true, iva_traslado: 20, monto: 145 }),
    fila({ concepto: 'otro', estado_sat: 'cancelado', iva_traslado: 27.59, monto: 200 }),
    fila({ concepto: 'otro', estado_sat: null, iva_traslado: 16, monto: 116 }),            // por validar
    fila({ concepto: 'otro', estado_sat: 'pendiente', iva_traslado: 16, monto: 116 }),     // por validar, no sostiene IVA
    fila({ concepto: 'otro', forma_pago: '01', iva_traslado: 344.83, monto: 2500 }),       // efectivo SOBRE tope
    fila({ concepto: 'otro', forma_pago: '01', iva_traslado: 206.9, monto: 1500 }),        // efectivo BAJO tope
    fila({ concepto: 'otro', forma_pago: '01', iva_traslado: 0, monto: 2001 }),            // sobre tope, iva 0
    fila({ concepto: 'caseta', iva_traslado: 48, sub_total: 300, monto: 348 }),
    fila({ concepto: 'caseta', iva_traslado: null, sub_total: null, monto: 232 }),
    fila({ concepto: 'caseta', iva_traslado: 48, sub_total: 300, monto: 348, fecha: '2026-08-11' }),
    fila({ concepto: 'flete', iva_traslado: 800, monto: 5800 }),
    fila({ concepto: 'otro', monto: 0, iva_traslado: 5 }), // monto cero con IVA: no entra al tope 15 ni a días
    // ── alimentación: el tope de $750 por (viaje, día) ──
    fila({ viaje_id: 'v2', concepto: 'alimentacion', monto: 500, iva_traslado: 68.97, fecha: '2026-08-12' }),
    fila({ viaje_id: 'v2', concepto: 'alimentacion', monto: 400, iva_traslado: 55.17, fecha: '2026-08-12' }),
    fila({ viaje_id: 'v2', concepto: 'alimentacion', monto: 300, iva_traslado: 41.38, fecha: '2026-08-12', ...sinCfdi }), // no timbrado: no entra al prorrateo
    fila({ viaje_id: 'v3', concepto: 'alimentacion', monto: 700, iva_traslado: 96.55, fecha: '2026-08-12' }), // otro viaje, bajo tope
    fila({ viaje_id: 'v3', concepto: 'viaticos', monto: 900, iva_traslado: 124.14, fecha: '2026-08-13' }),    // solo, sobre tope
    fila({ viaje_id: 'v3', concepto: 'alimentacion', monto: 820, iva_traslado: 113.1, fecha: '2026-08-13', forma_pago: '01' }), // sobre tope Y efectivo: no sostiene
    fila({ viaje_id: 'v4', concepto: 'alimentacion', monto: 760, iva_traslado: 104.83, fecha: null }), // sin fecha: propio día, sobre tope
    // ── sin CFDI: el plazo del portal ──
    fila({ concepto: 'diesel', monto: 800, fecha: '2026-08-20', ...sinCfdi, ocr_extra: { urlFacturacion: 'https://facturacion.oxxogas.com/?folio=A1', emisor: 'OXXO GAS' } }),
    fila({ concepto: 'diesel', monto: 810, fecha: '2026-08-21', ...sinCfdi, ocr_extra: { urlFacturacion: 'https://facturacion.oxxogas.com/?folio=A2', emisor: 'OXXO GAS' } }),
    fila({ concepto: 'diesel', monto: 700, fecha: '2026-07-15', ...sinCfdi, ocr_extra: { urlFacturacion: 'https://facturacion.oxxogas.com/?folio=B1' } }), // julio: mes_natural vencido
    fila({ concepto: 'otro', monto: 150, fecha: '2026-07-15', ...sinCfdi, ocr_extra: { urlFacturacion: 'https://facturacion.officedepot.com.mx/x?t=9' } }), // mes_siguiente: vigente
    fila({ concepto: 'otro', monto: 160, fecha: '2026-06-20', ...sinCfdi, ocr_extra: { urlFacturacion: 'https://facturacion.officedepot.com.mx/x?t=10' } }), // mes_siguiente: vencido
    fila({ concepto: 'otro', monto: 90, fecha: '2026-08-18', ...sinCfdi, rfc_emisor: 'CCO8605231N4' }), // OXXO por RFC
    fila({ concepto: 'otro', monto: 95, fecha: '2026-07-30', ...sinCfdi, ocr_extra: { emisor: 'GASOLINERA LA ESQUINA' } }), // sin comercio → default
    fila({ concepto: 'otro', monto: 2200, fecha: '2026-08-18', ...sinCfdi, forma_pago: '01' }), // sin CFDI y efectivo sobre tope
    fila({ concepto: 'otro', monto: 50, fecha: null, ...sinCfdi }),                              // sin fecha
    // ── otra flota: no debe contaminar ──
    fila({ tenant_id: OTRO, monto: 9999, iva_traslado: 999 }),
    fila({ tenant_id: OTRO, monto: 9998, ...sinCfdi, fecha: '2026-07-01' }),
  ];
}

// ── EL CAMINO VIEJO, congelado: el mapeo fila→GastoFiscal de getGastosFiscales
//    antes de la 0151 (sin el contexto de viaje, que ninguna cifra usa). ──
import type { GastoFiscal, OpcionesFiscales } from './fiscal';
function legacyMapear(filas: Fila[], tenantId: string, desde: string | null, hasta: string | null, hoy: string): GastoFiscal[] {
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  const bool = (v: unknown): boolean | null => (v === null || v === undefined ? null : Boolean(v));
  return filas
    .filter((f) => f.tenant_id === tenantId)
    .filter((f) => (desde === null || (f.fecha !== null && f.fecha >= desde)) && (hasta === null || (f.fecha !== null && f.fecha <= hasta)))
    .map((f) => {
      const cfdiUuid = f.cfdi_uuid || null;
      let plazoVencido: boolean | null = null;
      if (!cfdiUuid) {
        const c = armarPorFacturar({
          id: f.id, concepto: f.concepto ?? 'otro', monto: Number(f.monto ?? 0), fecha: f.fecha || null,
          folio: f.folio || null, rfc_emisor: f.rfc_emisor || null, cfdi_uuid: null, ocr_extra: f.ocr_extra,
        }, hoy).caducidad;
        plazoVencido = c.desconocido ? null : c.vencido;
      }
      return {
        id: f.id, viajeId: f.viaje_id ?? '', concepto: f.concepto ?? 'otro', monto: Number(f.monto ?? 0),
        fecha: f.fecha || null, folio: f.folio || null, rfcEmisor: f.rfc_emisor || null, cfdiUuid,
        cfdiValido: bool(f.cfdi_valido), estadoSat: f.estado_sat || null, efos: bool(f.efos),
        efosRevisar: bool(f.efos_revisar), formaPago: f.forma_pago || null, subTotal: num(f.sub_total),
        ivaTraslado: num(f.iva_traslado), iepsTraslado: num(f.ieps_traslado), claveProdServ: f.clave_prod_serv || null,
        tipoComprobante: f.tipo_comprobante || null, xmlVerificado: bool(f.xml_verificado), ocrConfianza: num(f.ocr_confianza),
        viajeFolio: null, operadorNombre: null, plazoVencido,
      };
    });
}

// ── EL SQL, emulado de forma independiente (lo que la RPC de la 0151 hace). ──
type ArgsRpc = {
  p_tenant: string; p_desde: string | null; p_hasta: string | null;
  p_tope_efectivo: number; p_tope_alimentacion: number | null;
  p_conceptos_alimentacion: string[]; p_cortes: string[];
};
function hostDe(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  const m = url.toLowerCase().match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?([^/?#]+)/);
  return m ? m[1] : null;
}
function sqlAgregadoEquivalente(filas: Fila[], a: ArgsRpc): unknown[] {
  const nz = (s: string | null) => (s === null || s === '' ? null : s);
  const base = filas
    .filter((f) => f.tenant_id === a.p_tenant)
    .filter((f) => (a.p_desde === null || (f.fecha !== null && f.fecha >= a.p_desde)) && (a.p_hasta === null || (f.fecha !== null && f.fecha <= a.p_hasta)))
    .map((f) => ({
      ...f,
      rfc_emisor: nz(f.rfc_emisor), cfdi_uuid: nz(f.cfdi_uuid), estado_sat: nz(f.estado_sat),
      forma_pago: nz(f.forma_pago), clave_prod_serv: nz(f.clave_prod_serv),
      tiene_cfdi: nz(f.cfdi_uuid) !== null,
      dia: f.fecha ?? `sin-fecha:${f.id}`,
      sobre_tope: f.monto > a.p_tope_efectivo,
      iva_estado: f.iva_traslado === null ? 'nulo' : f.iva_traslado > 0 ? 'positivo' : 'no_positivo',
    }));
  // dias: (viaje, dia) de alimentación cuyo total timbrado rebasa el tope
  const dias = new Map<string, number>();
  if (a.p_tope_alimentacion !== null) {
    const acc = new Map<string, number>();
    for (const b of base) {
      if (!a.p_conceptos_alimentacion.includes(b.concepto) || !(b.monto > 0)) continue;
      const k = `${b.viaje_id}|${b.dia}`;
      acc.set(k, (acc.get(k) ?? 0) + (b.tiene_cfdi ? b.monto : 0));
    }
    for (const [k, t] of acc) if (t > a.p_tope_alimentacion) dias.set(k, t);
  }
  const celdas = new Map<string, Record<string, unknown> & { n: number; monto: number; iva: number; ieps: number; iepsNulos: number; subTotal: number; subTotalNulos: number; muestraId: string; muestraCfdi: string | null; fechaMax: string | null }>();
  for (const b of base) {
    const sinCfdi = !b.tiene_cfdi;
    const banda = sinCfdi && b.fecha !== null ? a.p_cortes.filter((c) => b.fecha! < c).length : null;
    const enDia = b.tiene_cfdi && b.monto > 0 && a.p_conceptos_alimentacion.includes(b.concepto) && dias.has(`${b.viaje_id}|${b.dia}`);
    const dims = {
      concepto: b.concepto, claveProdServ: b.clave_prod_serv, formaPago: b.forma_pago, efos: b.efos, efosRevisar: b.efos_revisar,
      estadoSat: b.estado_sat, tieneCfdi: b.tiene_cfdi, sinFecha: b.fecha === null, ivaEstado: b.iva_estado, sobreTopeEfectivo: b.sobre_tope,
      banda, rfcEmisor: sinCfdi ? b.rfc_emisor : null, host: sinCfdi ? hostDe(b.ocr_extra?.urlFacturacion) : null,
      emisor: sinCfdi ? nz((b.ocr_extra?.emisor as string | undefined) ?? null) : null,
      diaViaje: enDia ? b.viaje_id : null, diaDia: enDia ? b.dia : null,
      totalTimbradoDia: enDia ? dias.get(`${b.viaje_id}|${b.dia}`)! : null,
    };
    const k = JSON.stringify(dims);
    const c = celdas.get(k) ?? { ...dims, n: 0, monto: 0, iva: 0, ieps: 0, iepsNulos: 0, subTotal: 0, subTotalNulos: 0, muestraId: b.id, muestraCfdi: b.cfdi_uuid, fechaMax: b.fecha };
    c.n += 1; c.monto += b.monto; c.iva += b.iva_traslado ?? 0; c.ieps += b.ieps_traslado ?? 0;
    if (b.ieps_traslado === null) c.iepsNulos += 1;
    c.subTotal += b.sub_total ?? 0; if (b.sub_total === null) c.subTotalNulos += 1;
    if (b.id < c.muestraId) c.muestraId = b.id;
    if (b.cfdi_uuid !== null && (c.muestraCfdi === null || b.cfdi_uuid < c.muestraCfdi)) c.muestraCfdi = b.cfdi_uuid;
    if (b.fecha !== null && (c.fechaMax === null || b.fecha > c.fechaMax)) c.fechaMax = b.fecha;
    celdas.set(k, c);
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return [...celdas.values()].map(({ diaViaje, diaDia, ...c }) => ({ ...c, monto: round2(c.monto), iva: round2(c.iva), ieps: round2(c.ieps), subTotal: round2(c.subTotal) }));
}
function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

const servidor: { filas: Fila[] } = { filas: [] };
const llamadasRpc: Array<{ fn: string; args: ArgsRpc }> = [];
let forzarError: { message: string } | null = null;
let forzarForma: unknown = undefined;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: ArgsRpc) => {
      llamadasRpc.push({ fn, args });
      if (forzarError) return Promise.resolve({ data: null, error: forzarError });
      if (forzarForma !== undefined) return Promise.resolve({ data: forzarForma, error: null });
      return Promise.resolve({ data: sqlAgregadoEquivalente(servidor.filas, args), error: null });
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const {
  getGastosFiscales, resumirFiscal, resumirPerdidas, resumirCombustibleCasetas, tope15DeGastos,
  diagnosticoRetencion, cortesDePlazo, resolverPeriodo,
} = await import('./fiscal');

const OPTS: OpcionesFiscales = {
  efectivoTopeMxn: 2000,
  clavesCombustible: ['15101505', '15101514', '15101515'],
  clavesDieselIeps: ['15101505'],
  viaticosTopeFiscalDiarioMxn: 750,
  elegible15: true,
};

beforeEach(() => {
  servidor.filas = dataset();
  llamadasRpc.length = 0;
  forzarError = null;
  forzarForma = undefined;
});

/** Todo lo que las pantallas y el chat leen, sobre un mismo arreglo de GastoFiscal. */
function cifras(gastos: GastoFiscal[], o: OpcionesFiscales) {
  const p = resumirPerdidas(gastos, o);
  // `filas` es la ÚNICA salida por comprobante (sin consumidor vivo): se excluye.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { filas, ...perdidas } = p;
  return {
    fiscal: resumirFiscal(gastos, o),
    perdidas,
    combustible: resumirCombustibleCasetas(gastos),
    tope15: tope15DeGastos(gastos, o),
    retencion: diagnosticoRetencion(gastos),
  };
}

describe('getGastosFiscales — equivalencia: la ley sobre filas crudas vs sobre celdas (mig. 0151)', () => {
  it.each([
    ['ejercicio', '2026-01-01', '2026-12-31'],
    ['mes', '2026-08-01', '2026-08-31'],
    ['7 días', '2026-08-16', '2026-08-22'],
    ['todo (sin cota: entran los sin fecha)', null, null],
  ])('%s: ninguna cifra visible cambia', async (_n, desde, hasta) => {
    const crudo = legacyMapear(servidor.filas, T, desde, hasta, HOY);
    const celdas = await getGastosFiscales(T, { clave: 'mes', desde, hasta, etiqueta: 'x' }, HOY, OPTS);
    const viejo = cifras(crudo, OPTS);
    const nuevo = cifras(celdas, OPTS);
    expect(nuevo).toEqual(viejo);
    // Control: el dataset sí ejercita lo que importa.
    expect(viejo.fiscal.n).toBeGreaterThan(0);
  });

  it('el dataset ejercita cada cubeta (control de que la equivalencia no es trivial)', () => {
    const v = cifras(legacyMapear(servidor.filas, T, null, null, HOY), OPTS);
    expect(v.perdidas.montoPerdido).toBeGreaterThan(0);
    expect(v.perdidas.montoEnRiesgo).toBeGreaterThan(0);
    expect(v.perdidas.montoRecuperable).toBeGreaterThan(0);
    expect(v.perdidas.porCausa.map((c) => c.causa).sort()).toEqual([
      'cfdi_cancelado', 'combustible_efectivo', 'efectivo_sobre_tope', 'efos', 'efos_indeterminado', 'plazo_vencido', 'sin_cfdi',
    ]);
    expect(v.fiscal.ivaNoAcreditable).toBeGreaterThan(0);
    expect(v.fiscal.iepsDieselDocumentado).toBe(120);
    expect(v.fiscal.casetasSinSubTotal).toBe(1);
    expect(v.fiscal.porValidar).toBe(2);
    expect(v.perdidas.sinFecha).toBe(2);
    expect(v.tope15.razon).toBeGreaterThan(0);
    expect(v.retencion.candidatos).toBe(1);
  });

  it('la proporción de alimentación es la del motor: 900 timbrados en el día → 750/900 de su IVA', async () => {
    // El tope es por (viaje, DÍA) y sobre lo TIMBRADO, con el criterio del
    // motor (`diasSobreTope`). Se compara contra el cálculo hecho a mano, no
    // contra el camino viejo, para que un bug compartido no se esconda:
    //   · v2, 12-ago: 500 + 400 timbrados = 900 > 750 → 750/900 para los dos.
    //     El de $300 SIN CFDI del mismo día NO infla el denominador
    //     (auditoría 8, CRÍTICO) ni recibe proporción.
    //   · v3, 12-ago: $700 solo, bajo el tope → acredita entero.
    //   · v3, 13-ago: $900 (viáticos) + $820 (alimentación en efectivo, bajo
    //     el tope de efectivo, así que SÍ sostiene IVA) comparten el día:
    //     1,720 timbrados > 750 → 750/1720 para los dos. Es el mismo día y el
    //     mismo viaje: el tope es por beneficiario y por día, no por
    //     comprobante ni por concepto.
    const celdas = await getGastosFiscales(T, { clave: 'mes', desde: '2026-08-12', hasta: '2026-08-13', etiqueta: 'x' }, HOY, OPTS);
    const r = resumirFiscal(celdas, OPTS);
    const esperado = (68.97 + 55.17) * (750 / 900) + 96.55 + (124.14 + 113.1) * (750 / 1720);
    expect(r.ivaAcreditable).toBeCloseTo(esperado, 2);
    expect(r.ivaAcreditable + r.ivaNoAcreditable).toBeCloseTo(68.97 + 55.17 + 41.38 + 96.55 + 124.14 + 113.1, 2);
  });

  it('cientos de celdas, no millones de filas: 10,000 comprobantes repetidos caben en las mismas celdas', async () => {
    const base = dataset().filter((f) => f.tenant_id === T);
    const grande: Fila[] = [];
    for (let i = 0; i < 300; i++) {
      for (const f of base) grande.push({ ...f, id: `${f.id}-${i}`, cfdi_uuid: f.cfdi_uuid ? `${f.cfdi_uuid}-${i}` : null, viaje_id: `${f.viaje_id}-${i}` });
    }
    servidor.filas = grande;
    const celdas = await getGastosFiscales(T, resolverPeriodo('todo', HOY), HOY, OPTS);
    expect(grande.length).toBe(base.length * 300);
    // Cada celda nueva por viaje-día sobre tope (4 por copia) es lo único que
    // crece con el volumen: todo lo demás son las mismas dimensiones.
    expect(celdas.length).toBeLessThan(base.length + 4 * 300);
    expect(resumirFiscal(celdas, OPTS).n).toBe(grande.length);
    expect(cifras(celdas, OPTS)).toEqual(cifras(legacyMapear(grande, T, null, null, HOY), OPTS));
  });

  it('aislamiento: la otra flota no contamina ninguna celda', async () => {
    const celdas = await getGastosFiscales(T, resolverPeriodo('todo', HOY), HOY, OPTS);
    expect(celdas.some((c) => c.monto >= 9998)).toBe(false);
    expect(resumirFiscal(celdas, OPTS).gastoTotal).toBe(resumirFiscal(legacyMapear(servidor.filas, T, null, null, HOY), OPTS).gastoTotal);
  });

  it('un tenant sin gastos: cero celdas, n=0 medido', async () => {
    const celdas = await getGastosFiscales('nadie', resolverPeriodo('todo', HOY), HOY, OPTS);
    expect(celdas).toEqual([]);
    expect(resumirFiscal(celdas, OPTS).n).toBe(0);
  });
});

describe('getGastosFiscales — los argumentos viajan a la RPC', () => {
  it('manda tenant, periodo, los topes de la config y los cortes ascendentes', async () => {
    await getGastosFiscales(T, resolverPeriodo('ejercicio', HOY), HOY, OPTS);
    const a = llamadasRpc[0];
    expect(a.fn).toBe('gastos_fiscales_agregados_tenant');
    expect(a.args.p_tenant).toBe(T);
    expect(a.args.p_desde).toBe('2026-01-01');
    expect(a.args.p_hasta).toBe('2026-12-31');
    expect(a.args.p_tope_efectivo).toBe(2000);
    expect(a.args.p_tope_alimentacion).toBe(750);
    expect(a.args.p_conceptos_alimentacion).toEqual(['alimentacion', 'viaticos']);
    expect(a.args.p_cortes).toEqual([...a.args.p_cortes].sort());
    expect(a.args.p_cortes.length).toBeGreaterThan(0);
  });

  it('sin tope de alimentación configurado, manda null (el motor tampoco prorratea)', async () => {
    await getGastosFiscales(T, resolverPeriodo('mes', HOY), HOY, { ...OPTS, viaticosTopeFiscalDiarioMxn: null });
    expect(llamadasRpc[0].args.p_tope_alimentacion).toBeNull();
  });
});

describe('getGastosFiscales — fail-closed (mig. 0151)', () => {
  it('un error de la RPC LANZA', async () => {
    forzarError = { message: 'function gastos_fiscales_agregados_tenant does not exist' };
    await expect(getGastosFiscales(T, resolverPeriodo('mes', HOY), HOY, OPTS)).rejects.toThrow(/does not exist/);
  });
  it('data que no es arreglo LANZA (¿migración sin aplicar?)', async () => {
    forzarForma = null;
    await expect(getGastosFiscales(T, resolverPeriodo('mes', HOY), HOY, OPTS)).rejects.toThrow(/0151/);
  });
  it('una celda sin `n` o con `monto` que no es número LANZA — nunca `?? 0`', async () => {
    forzarForma = [{ concepto: 'diesel', monto: '12' }];
    await expect(getGastosFiscales(T, resolverPeriodo('mes', HOY), HOY, OPTS)).rejects.toThrow(/forma esperada/);
    forzarForma = [{ ...(sqlAgregadoEquivalente(dataset(), { p_tenant: T, p_desde: null, p_hasta: null, p_tope_efectivo: 2000, p_tope_alimentacion: 750, p_conceptos_alimentacion: ['alimentacion'], p_cortes: [] })[0] as object), n: 0 }];
    await expect(getGastosFiscales(T, resolverPeriodo('mes', HOY), HOY, OPTS)).rejects.toThrow(/`n`/);
  });
});

describe('cortesDePlazo — reproduce calcularCaducidad día por día, para cada plazo del catálogo', () => {
  const plazos: Plazo[] = ['mes_natural'];
  for (const c of COMERCIOS) if (!plazos.some((p) => JSON.stringify(p) === JSON.stringify(c.plazo))) plazos.push(c.plazo);

  it.each(['2026-08-22', '2026-08-01', '2026-08-31', '2026-01-03', '2026-03-01', '2026-12-31'])('hoy=%s', (hoy) => {
    const cortes = cortesDePlazo(hoy);
    for (let atras = -5; atras <= 200; atras++) {
      const d = new Date(`${hoy}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - atras);
      const fecha = d.toISOString().slice(0, 10);
      const banda = cortes.cortes.filter((c) => fecha < c).length;  // lo que SQL cuenta
      for (const plazo of plazos) {
        expect(cortes.vencido(plazo, banda), `plazo ${JSON.stringify(plazo)} fecha ${fecha}`)
          .toBe(calcularCaducidad({ fechaTicket: fecha, plazo, hoy }).vencido);
      }
    }
  });

  it('hay un corte por plazo distinto (mes_natural y mes_siguiente hoy)', () => {
    expect(cortesDePlazo('2026-08-22').cortes).toEqual(['2026-07-01', '2026-08-01']);
  });
});
