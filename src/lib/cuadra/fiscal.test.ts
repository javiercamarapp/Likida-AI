import { describe, it, expect } from 'vitest';
import {
  resolverPeriodo, periodoAnterior, PERIODO_POR_DEFECTO,
  causasDe, causaDominante, resumirPerdidas, resumirFiscal,
  resumirCombustibleCasetas, tope15DeGastos, diagnosticoRetencion, aFilasExport,
  esCombustible, esDieselConIeps,
  type GastoFiscal, type OpcionesFiscales,
} from './fiscal';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE SE PRUEBA AQUÍ Y POR QUÉ.
//
// Este módulo produce las cifras que un contador teclea en una declaración
// mensual. La familia de errores que importa no es "se cayó": es "devolvió un
// número que se ve bien y no lo es". Por eso casi toda la suite mide la
// frontera entre CERO y NO SE SABE:
//
//   - un gasto sin desglose de IVA no aporta $0.00 de IVA, aporta NADA;
//   - un comprobante sin `forma_pago` no es efectivo, es desconocido;
//   - un CFDI sin respuesta del SAT no es inválido, es no comprobado.
//
// Todas puras: ni una llamada a la base.
// ═══════════════════════════════════════════════════════════════════════════

const OPTS: OpcionesFiscales = {
  efectivoTopeMxn: 2000,
  clavesCombustible: ['15101505', '15101514', '15101515'],
  clavesDieselIeps: ['15101505'],
  // La mayoría de las pruebas ejercitan la facilidad del 15% (RFA 2.9): sin
  // esto, el efectivo en combustible cae a efectivo_no_elegible.
  elegible15: true,
};

function gasto(over: Partial<GastoFiscal> = {}): GastoFiscal {
  return {
    id: 'g1', viajeId: 'v1', concepto: 'diesel', monto: 1000,
    fecha: '2026-07-15', folio: 'A1', rfcEmisor: 'AAA010101AAA',
    cfdiUuid: 'uuid-1', cfdiValido: null, estadoSat: 'vigente',
    efos: false, efosRevisar: null, formaPago: '03',
    subTotal: null, ivaTraslado: null, iepsTraslado: null,
    claveProdServ: null, tipoComprobante: 'I', xmlVerificado: true,
    ocrConfianza: 0.9, viajeFolio: 'VJ-1', operadorNombre: 'Juan',
    plazoVencido: null,
    ...over,
  };
}

// ── Periodo ────────────────────────────────────────────────────────────────

describe('resolverPeriodo', () => {
  it('el default es el ejercicio en curso, y su rango son los 12 meses', () => {
    const p = resolverPeriodo(undefined, '2026-08-04');
    expect(p.clave).toBe(PERIODO_POR_DEFECTO);
    expect(p.desde).toBe('2026-01-01');
    expect(p.hasta).toBe('2026-12-31');
  });

  it('un `?p=` basura cae al default en vez de dejar la pantalla sin filtro', () => {
    // Fail closed: un periodo desconocido NO se traduce a "todo el histórico",
    // que sería enseñar más de lo que el rótulo promete.
    expect(resolverPeriodo('; drop table gasto', '2026-08-04').clave).toBe(PERIODO_POR_DEFECTO);
    expect(resolverPeriodo('2026-07', '2026-08-04').clave).toBe(PERIODO_POR_DEFECTO);
  });

  it('el mes cierra en su último día real, no en el 30 de todos', () => {
    expect(resolverPeriodo('mes', '2026-02-10').hasta).toBe('2026-02-28');
    expect(resolverPeriodo('mes', '2024-02-10').hasta).toBe('2024-02-29');
    expect(resolverPeriodo('mes', '2026-01-31').hasta).toBe('2026-01-31');
  });

  it('el mes anterior a enero es diciembre DEL AÑO PASADO', () => {
    const p = resolverPeriodo('mes_anterior', '2026-01-15');
    expect(p.desde).toBe('2025-12-01');
    expect(p.hasta).toBe('2025-12-31');
    expect(p.etiqueta).toBe('diciembre 2025');
  });

  it("'todo' no tiene cortes: el rótulo y el filtro dicen lo mismo", () => {
    const p = resolverPeriodo('todo', '2026-08-04');
    expect(p.desde).toBeNull();
    expect(p.hasta).toBeNull();
    expect(p.etiqueta).toMatch(/histórico/i);
  });

  it('el rótulo nombra el rango que de verdad se filtra', () => {
    expect(resolverPeriodo('mes', '2026-08-04').etiqueta).toBe('agosto 2026');
    expect(resolverPeriodo('ejercicio', '2026-08-04').etiqueta).toBe('Ejercicio 2026');
  });
});

describe('periodoAnterior', () => {
  it("'todo' no tiene un antes — devuelve null en vez de un rango vacío", () => {
    // Un rango vacío produciría un −100% que se lee como una caída MEDIDA.
    expect(periodoAnterior(resolverPeriodo('todo', '2026-08-04'))).toBeNull();
  });

  it('el ejercicio anterior es el año completo previo', () => {
    const a = periodoAnterior(resolverPeriodo('ejercicio', '2026-08-04'))!;
    expect(a.desde).toBe('2025-01-01');
    expect(a.hasta).toBe('2025-12-31');
  });

  it('el mes anterior a marzo termina el 28 o 29, no el 31', () => {
    const a = periodoAnterior(resolverPeriodo('mes', '2026-03-10'))!;
    expect(a.desde).toBe('2026-02-01');
    expect(a.hasta).toBe('2026-02-28');
  });
});

// ── Clasificación de causas ────────────────────────────────────────────────

describe('causasDe', () => {
  it('un comprobante limpio no levanta ninguna causa', () => {
    expect(causasDe(gasto(), OPTS)).toEqual([]);
  });

  it('EFOS y CFDI cancelado se detectan por su columna', () => {
    expect(causasDe(gasto({ efos: true }), OPTS).map((c) => c.causa)).toContain('efos');
    expect(causasDe(gasto({ estadoSat: 'cancelado' }), OPTS).map((c) => c.causa)).toContain('cfdi_cancelado');
  });

  it('EFOS definitivo tapa al indeterminado: no se cuenta el mismo hecho dos veces', () => {
    const cs = causasDe(gasto({ efos: true, efosRevisar: true }), OPTS).map((c) => c.causa);
    expect(cs).toContain('efos');
    expect(cs).not.toContain('efos_indeterminado');
  });

  it('un EFOS no concluyente se marca "en riesgo", nunca como perdido', () => {
    // El SAT no afirmó nada; el panel tampoco puede.
    const c = causasDe(gasto({ efos: null, efosRevisar: true }), OPTS)[0];
    expect(c.causa).toBe('efos_indeterminado');
    expect(c.gravedad).toBe('en_riesgo');
  });

  it('sin CFDI y con plazo vivo es RECUPERABLE, no perdida', () => {
    const c = causasDe(gasto({ cfdiUuid: null, plazoVencido: false }), OPTS)
      .find((x) => x.causa === 'sin_cfdi')!;
    expect(c.gravedad).toBe('recuperable');
  });

  it('sin CFDI y con plazo vencido es PÉRDIDA, y ya no dice "sin_cfdi"', () => {
    // Son el mismo hecho en dos momentos: emitir las dos duplicaría el dinero.
    const cs = causasDe(gasto({ cfdiUuid: null, plazoVencido: true }), OPTS).map((c) => c.causa);
    expect(cs).toContain('plazo_vencido');
    expect(cs).not.toContain('sin_cfdi');
  });

  it('plazo DESCONOCIDO no se da por vencido', () => {
    // `null` es "no se sabe" (sin fecha, o comercio no reconocido). Darlo por
    // perdido haría que nadie fuera a pedir una factura que todavía se podía.
    const cs = causasDe(gasto({ cfdiUuid: null, plazoVencido: null }), OPTS).map((c) => c.causa);
    expect(cs).toContain('sin_cfdi');
    expect(cs).not.toContain('plazo_vencido');
  });

  it('efectivo sobre el tope solo aplica a lo que NO es combustible', () => {
    const comida = gasto({ concepto: 'alimentacion', formaPago: '01', monto: 2500 });
    expect(causasDe(comida, OPTS).map((c) => c.causa)).toContain('efectivo_sobre_tope');

    const dieselCaro = gasto({ concepto: 'diesel', formaPago: '01', monto: 2500 });
    const cs = causasDe(dieselCaro, OPTS).map((c) => c.causa);
    expect(cs).toContain('combustible_efectivo');
    expect(cs).not.toContain('efectivo_sobre_tope');
  });

  it('efectivo bajo el tope y no combustible no levanta nada', () => {
    expect(causasDe(gasto({ concepto: 'alimentacion', formaPago: '01', monto: 500 }), OPTS)).toEqual([]);
  });

  it('el tope sale de las opciones, no de un número escrito a mano', () => {
    const g = gasto({ concepto: 'alimentacion', formaPago: '01', monto: 2500 });
    const conTopeAlto = causasDe(g, { ...OPTS, efectivoTopeMxn: 3000 }).map((c) => c.causa);
    expect(conTopeAlto).not.toContain('efectivo_sobre_tope');
  });

  it('SIN forma de pago no se supone efectivo', () => {
    // Suponerlo inflaría el numerador del 15% contra la flota — mismo criterio
    // que `getAcumuladoCombustible` en repo.ts.
    expect(causasDe(gasto({ formaPago: null, monto: 9999 }), OPTS)).toEqual([]);
  });

  it('cada causa cita una norma: sin fundamento no se afirma', () => {
    const todas = [
      gasto({ efos: true }),
      gasto({ estadoSat: 'cancelado' }),
      gasto({ cfdiUuid: null, plazoVencido: true }),
      gasto({ cfdiUuid: null, plazoVencido: false }),
      gasto({ concepto: 'alimentacion', formaPago: '01', monto: 5000 }),
      gasto({ concepto: 'diesel', formaPago: '01' }),
      gasto({ efosRevisar: true }),
    ].flatMap((g) => causasDe(g, OPTS));
    expect(todas.length).toBeGreaterThan(0);
    for (const c of todas) expect(c.norma.trim()).not.toBe('');
  });
});

describe('causaDominante', () => {
  it('gana la que le cuesta más dinero al cliente, no la primera detectada', () => {
    // Sin CFDI + efectivo sobre tope: lo segundo es pérdida dura, lo primero
    // se arregla con una llamada al portal.
    const g = gasto({ concepto: 'alimentacion', cfdiUuid: null, plazoVencido: false, formaPago: '01', monto: 5000 });
    expect(causasDe(g, OPTS).map((c) => c.causa)).toEqual(expect.arrayContaining(['sin_cfdi', 'efectivo_sobre_tope']));
    expect(causaDominante(g, OPTS)!.causa).toBe('efectivo_sobre_tope');
  });

  it('EFOS gana sobre cancelado', () => {
    const g = gasto({ efos: true, estadoSat: 'cancelado' });
    expect(causaDominante(g, OPTS)!.causa).toBe('efos');
  });

  it('sin causas devuelve null, no una causa vacía', () => {
    expect(causaDominante(gasto(), OPTS)).toBeNull();
  });
});

// ── Deducciones perdidas ───────────────────────────────────────────────────

describe('resumirPerdidas', () => {
  it('cada peso se cuenta UNA vez aunque el gasto tenga varias causas', () => {
    const g = gasto({ concepto: 'alimentacion', cfdiUuid: null, plazoVencido: false, formaPago: '01', monto: 5000 });
    const r = resumirPerdidas([g], OPTS);
    expect(r.montoTotal).toBe(5000);
    expect(r.porCausa.reduce((s, c) => s + c.monto, 0)).toBe(5000);
    expect(r.montoPerdido + r.montoEnRiesgo + r.montoRecuperable).toBe(5000);
  });

  it('separa perdido, en riesgo y recuperable', () => {
    const r = resumirPerdidas([
      gasto({ id: 'a', efos: true, monto: 100 }),
      gasto({ id: 'b', concepto: 'diesel', formaPago: '01', monto: 200 }),
      gasto({ id: 'c', cfdiUuid: null, plazoVencido: false, monto: 300 }),
    ], OPTS);
    expect(r.montoPerdido).toBe(100);
    expect(r.montoEnRiesgo).toBe(200);
    expect(r.montoRecuperable).toBe(300);
  });

  it('EL IVA PERDIDO NO SE ESTIMA — solo se suma el que viene desglosado', () => {
    // Es la regla del archivo entero: 16% sobre un total que puede traer
    // propina, IEPS o conceptos exentos es una cifra inventada, y va directo a
    // una declaración mensual.
    const r = resumirPerdidas([
      gasto({ id: 'a', estadoSat: 'cancelado', monto: 1160, ivaTraslado: 160 }),
      gasto({ id: 'b', cfdiUuid: null, plazoVencido: true, monto: 5000, ivaTraslado: null }),
    ], OPTS);
    expect(r.ivaPerdidoDocumentado).toBe(160);
    expect(r.sinDesgloseDeIva).toBe(1);
    // El monto sí se reporta entero: lo que no se afirma es su IVA.
    expect(r.montoPerdido).toBe(6160);
  });

  it('ordena las filas por monto: lo que más pesa, arriba', () => {
    const r = resumirPerdidas([
      gasto({ id: 'chico', efos: true, monto: 50 }),
      gasto({ id: 'grande', efos: true, monto: 9000 }),
      gasto({ id: 'medio', efos: true, monto: 500 }),
    ], OPTS);
    expect(r.filas.map((f) => f.gasto.id)).toEqual(['grande', 'medio', 'chico']);
  });

  it('un tenant limpio devuelve todo en cero y sin filas — el cero SÍ es medición aquí', () => {
    const r = resumirPerdidas([gasto(), gasto({ id: 'g2' })], OPTS);
    expect(r.filas).toEqual([]);
    expect(r.montoTotal).toBe(0);
    expect(r.porCausa).toEqual([]);
  });

  it('cuenta lo que no se pudo juzgar en vez de tragárselo', () => {
    const r = resumirPerdidas([
      gasto({ id: 'a', formaPago: null }),
      gasto({ id: 'b', fecha: null, formaPago: null }),
      gasto({ id: 'c' }),
    ], OPTS);
    expect(r.sinFormaPago).toBe(2);
    expect(r.sinFecha).toBe(1);
  });

  it('sin gastos no explota', () => {
    const r = resumirPerdidas([], OPTS);
    expect(r.montoTotal).toBe(0);
    expect(r.filas).toEqual([]);
  });
});

// ── Panel fiscal ───────────────────────────────────────────────────────────

describe('resumirFiscal', () => {
  it('solo acredita el IVA de comprobantes que lo sostienen', () => {
    const r = resumirFiscal([
      gasto({ id: 'ok', ivaTraslado: 160 }),
      gasto({ id: 'cancelado', estadoSat: 'cancelado', ivaTraslado: 80 }),
      gasto({ id: 'efos', efos: true, ivaTraslado: 40 }),
    ], OPTS);
    expect(r.ivaAcreditable).toBe(160);
    expect(r.ivaNoAcreditable).toBe(120);
  });

  it('el efectivo sobre tope tumba el acreditamiento aunque haya CFDI vigente', () => {
    // LIVA 5 pide que el gasto sea deducible para ISR; LISR 27-III lo niega.
    const r = resumirFiscal([
      gasto({ concepto: 'alimentacion', formaPago: '01', monto: 5000, ivaTraslado: 689.66 }),
    ], OPTS);
    expect(r.ivaAcreditable).toBe(0);
    expect(r.ivaNoAcreditable).toBe(689.66);
  });

  it('un gasto SIN desglose no aporta $0 de IVA: aporta nada, y se cuenta aparte', () => {
    const r = resumirFiscal([
      gasto({ id: 'a', ivaTraslado: null }),
      gasto({ id: 'b', ivaTraslado: 160 }),
    ], OPTS);
    expect(r.ivaAcreditable).toBe(160);
    expect(r.conCfdiSinDesglose).toBe(1);
  });

  it('"por validar" es CFDI sin respuesta del SAT — no es "inválido"', () => {
    const r = resumirFiscal([
      gasto({ id: 'a', estadoSat: null }),
      gasto({ id: 'b', estadoSat: 'vigente' }),
      gasto({ id: 'c', estadoSat: 'cancelado' }),
      gasto({ id: 'd', cfdiUuid: null, estadoSat: null }),
    ], OPTS);
    expect(r.porValidar).toBe(1);   // solo 'a': 'd' no tiene CFDI que validar
    expect(r.vigentes).toBe(1);
    expect(r.cancelados).toBe(1);
    expect(r.sinCfdi).toBe(1);
  });

  it('el IEPS de diésel exige clave de diésel Y pago electrónico', () => {
    const base = { concepto: 'diesel', iepsTraslado: 400 };
    // Con clave de diésel y transferencia: cuenta.
    expect(resumirFiscal([gasto({ ...base, claveProdServ: '15101505', formaPago: '03' })], OPTS)
      .iepsDieselDocumentado).toBe(400);
    // En efectivo: NO acredita (LIF 20-A 4º párrafo, sin válvula del 15%).
    expect(resumirFiscal([gasto({ ...base, claveProdServ: '15101505', formaPago: '01' })], OPTS)
      .iepsDieselDocumentado).toBe(0);
    // Gasolina magna: el estímulo de IEPS es SOLO diésel.
    expect(resumirFiscal([gasto({ ...base, claveProdServ: '15101514', formaPago: '03' })], OPTS)
      .iepsDieselDocumentado).toBe(0);
  });

  it('la base de peaje solo suma casetas con SubTotal leído, y cuenta las otras', () => {
    const r = resumirFiscal([
      gasto({ id: 'a', concepto: 'caseta', subTotal: 1206.9 }),
      gasto({ id: 'b', concepto: 'caseta', subTotal: null }),
    ], OPTS);
    expect(r.subTotalCasetas).toBe(1206.9);
    expect(r.casetasSinSubTotal).toBe(1);
  });

  it('sin gastos, todo en cero y n=0 — el panel puede distinguirlo de un fallo', () => {
    const r = resumirFiscal([], OPTS);
    expect(r.n).toBe(0);
    expect(r.gastoTotal).toBe(0);
    expect(r.ivaAcreditable).toBe(0);
  });
});

// ── Combustible y casetas ──────────────────────────────────────────────────

describe('resumirCombustibleCasetas', () => {
  it('parte con CFDI contra sin CFDI, en conteo y en monto', () => {
    const [diesel] = resumirCombustibleCasetas([
      gasto({ id: 'a', concepto: 'diesel', monto: 4200, cfdiUuid: 'u1' }),
      gasto({ id: 'b', concepto: 'diesel', monto: 400, cfdiUuid: null }),
      gasto({ id: 'c', concepto: 'diesel', monto: 300, cfdiUuid: null }),
    ]);
    expect(diesel.n).toBe(3);
    expect(diesel.conCfdi).toBe(1);
    expect(diesel.montoConCfdi).toBe(4200);
    expect(diesel.sinCfdi).toBe(2);
    expect(diesel.montoSinCfdi).toBe(700);
  });

  it('el % electrónico se mide sobre el monto CON forma de pago conocida', () => {
    const [diesel] = resumirCombustibleCasetas([
      gasto({ id: 'a', concepto: 'diesel', monto: 800, formaPago: '03' }),
      gasto({ id: 'b', concepto: 'diesel', monto: 200, formaPago: '01' }),
      gasto({ id: 'c', concepto: 'diesel', monto: 5000, formaPago: null }),
    ]);
    expect(diesel.pctElectronico).toBe(80);       // 800 de 1000, no de 6000
    expect(diesel.montoSinFormaPago).toBe(5000);
  });

  it('sin ninguna forma de pago conocida el % es null, NO 0%', () => {
    // Un 0% ahí se lee como "todo se paga en efectivo", que es una acusación.
    const [diesel] = resumirCombustibleCasetas([
      gasto({ concepto: 'diesel', formaPago: null }),
    ]);
    expect(diesel.pctElectronico).toBeNull();
  });

  it('un concepto sin comprobantes devuelve n=0 y % null', () => {
    const [, caseta] = resumirCombustibleCasetas([gasto({ concepto: 'diesel' })]);
    expect(caseta.n).toBe(0);
    expect(caseta.pctElectronico).toBeNull();
  });
});

describe('tope15DeGastos', () => {
  it('la base es combustible contra combustible, no el gasto total', () => {
    // El denominador equivocado haría parecer holgada a una flota que ya se pasó.
    const r = tope15DeGastos([
      gasto({ id: 'a', concepto: 'diesel', monto: 200, formaPago: '01' }),
      gasto({ id: 'b', concepto: 'diesel', monto: 800, formaPago: '03' }),
      gasto({ id: 'c', concepto: 'alimentacion', monto: 100000, formaPago: '01' }),
    ], OPTS);
    expect(r.razon).toBeCloseTo(0.2, 5);
    expect(r.estado).toBe('excedido');
  });

  it('sin combustible no se afirma nada', () => {
    expect(tope15DeGastos([gasto({ concepto: 'alimentacion', monto: 500 })], OPTS).estado).toBe('holgado');
  });
});

// ── Retenciones ────────────────────────────────────────────────────────────

describe('diagnosticoRetencion', () => {
  it('NO es calculable, y nombra el campo exacto que falta', () => {
    const d = diagnosticoRetencion([gasto()]);
    expect(d.calculable).toBe(false);
    expect(d.camposFaltantes.join(' ')).toMatch(/iva_retenido/);
    expect(d.camposFaltantes.join(' ')).toMatch(/Retenciones/);
  });

  it('cuenta los candidatos como SEÑAL, sin traducirlos a pesos retenidos', () => {
    const d = diagnosticoRetencion([
      gasto({ id: 'a', concepto: 'flete', monto: 10000 }),
      gasto({ id: 'b', concepto: 'diesel', monto: 500 }),
    ]);
    expect(d.candidatos).toBe(1);
    expect(d.montoCandidatos).toBe(10000);
    // Lo que NO existe: una propiedad con el 4% ya calculado.
    expect(Object.keys(d)).not.toContain('retencion');
  });
});

// ── Export ─────────────────────────────────────────────────────────────────

describe('aFilasExport', () => {
  it('las columnas sin dato van VACÍAS, nunca en cero', () => {
    // Un 0.00 en la columna de IVA se importa al ERP como "no causó IVA".
    const [f] = aFilasExport([gasto({ cfdiUuid: null, ivaTraslado: null, subTotal: null, plazoVencido: false })], OPTS);
    expect(f.iva_traslado).toBe('');
    expect(f.sub_total).toBe('');
    expect(f.cfdi_uuid).toBe('');
    expect(f.estado_sat).toBe('');   // sin CFDI no hay estado que reportar
  });

  it('un CFDI sin respuesta del SAT se exporta como "sin validar", no como vacío', () => {
    const [f] = aFilasExport([gasto({ cfdiUuid: 'u1', estadoSat: null })], OPTS);
    expect(f.estado_sat).toBe('sin validar');
  });

  it('EFOS desconocido va vacío; conocido va si/no', () => {
    expect(aFilasExport([gasto({ efos: null })], OPTS)[0].efos).toBe('');
    expect(aFilasExport([gasto({ efos: false })], OPTS)[0].efos).toBe('no');
    expect(aFilasExport([gasto({ efos: true })], OPTS)[0].efos).toBe('si');
  });

  it('cada fila lleva su situación fiscal y el artículo que la sostiene', () => {
    const [f] = aFilasExport([gasto({ estadoSat: 'cancelado' })], OPTS);
    expect(f.situacion_fiscal).toMatch(/cancelado/i);
    expect(f.fundamento).toBe('CFF 29-A');
  });

  it('un comprobante limpio dice "Sin observación" y no inventa un fundamento', () => {
    const [f] = aFilasExport([gasto()], OPTS);
    expect(f.situacion_fiscal).toBe('Sin observación');
    expect(f.fundamento).toBe('');
  });
});

// ── Predicados de combustible ──────────────────────────────────────────────

describe('esCombustible / esDieselConIeps', () => {
  it('el concepto `diesel` cuenta como combustible aunque no traiga clave', () => {
    expect(esCombustible(gasto({ concepto: 'diesel', claveProdServ: null }), OPTS)).toBe(true);
  });

  it('la gasolina es combustible para el 15% pero NO tiene estímulo de IEPS', () => {
    const magna = gasto({ concepto: 'otro', claveProdServ: '15101514' });
    expect(esCombustible(magna, OPTS)).toBe(true);
    expect(esDieselConIeps(magna, OPTS)).toBe(false);
  });

  it('solo la clave 15101505 lleva el estímulo de IEPS', () => {
    expect(esDieselConIeps(gasto({ claveProdServ: '15101505' }), OPTS)).toBe(true);
    expect(esDieselConIeps(gasto({ claveProdServ: null }), OPTS)).toBe(false);
  });
});

// ── AUDITORÍA 13 · ALTO: el panel acreditaba IVA de CFDIs sin confirmar ─────
describe('AUDITORÍA 13 — el estándar del motor se propaga al panel del contador', () => {
  it('un CFDI con estado SAT pendiente NO acredita IVA en el panel (el motor ya no lo hace)', () => {
    const r = resumirFiscal([gasto({ estadoSat: 'pendiente', ivaTraslado: 137.93 })], OPTS);
    expect(r.ivaAcreditable).toBe(0);
    expect(r.porValidar).toBeGreaterThan(0);   // la cola sigue siendo visible
  });

  it('un CFDI no_encontrado (UUID fabricado) tampoco acredita', () => {
    const r = resumirFiscal([gasto({ estadoSat: 'no_encontrado', ivaTraslado: 50 })], OPTS);
    expect(r.ivaAcreditable).toBe(0);
  });

  it('el CFDI VIGENTE sí acredita (no-regresión)', () => {
    const r = resumirFiscal([gasto({ estadoSat: 'vigente', ivaTraslado: 137.93 })], OPTS);
    expect(r.ivaAcreditable).toBe(137.93);
  });
});
