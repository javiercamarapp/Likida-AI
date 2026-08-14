import { describe, it, expect } from 'vitest';
import {
  aNumero, sumarOCallar, diasEntre,
  contribucion, margenPct, faltaParaLaContribucion,
  clasificarDocumental, leerObservaciones,
  resumirCobro, rotuloFacturacion, rotuloCobro,
  armarRenglon,
  TOLERANCIA_CENTAVO,
  type FacturaDelViaje, type EntradaLibro,
} from './libro_viaje';

// ═══════════════════════════════════════════════════════════════════════════
// Todo lo que se prueba aquí es PURO: sin base, sin reloj, sin mock de
// PostgREST — que además acepta cualquier `.select()` y no probaría la
// consulta de todos modos (`embeds_con_alias.test.ts` lo dice con detalle).
//
// Lo que estas pruebas defienden es UNA cosa: que el libro mayor no invente
// una cifra. El modo de falla es siempre el mismo y siempre se ve razonable —
// un hueco que se lee como un cero medido — y produce las tres conclusiones
// más caras del producto: "esta ruta pierde dinero", "este cliente no paga" y
// "este viaje no gastó nada".
// ═══════════════════════════════════════════════════════════════════════════

const factura = (over: Partial<FacturaDelViaje> = {}): FacturaDelViaje => ({
  id: 'f-1',
  folio: 'A-100',
  fecha: '2026-07-01',
  estatus: 'emitida',
  total: 50_000,
  pagado: 0,
  saldo: 50_000,
  venceEn: '2026-07-31',
  amparaVarios: false,
  ...over,
});

const HOY = '2026-08-14';

const entrada = (over: Partial<EntradaLibro> = {}): EntradaLibro => ({
  viaje: {
    id: '11111111-2222-3333-4444-555555555555',
    folio: 'VJ-2026-0845',
    origen: 'Monterrey',
    destino: 'Querétaro',
    fechaInicio: '2026-07-01',
    estatus: 'liquidado',
    ingresoFlete: 100_000,
  },
  cliente: 'Cementos del Norte',
  unidad: 'C2-08',
  operador: 'Rubén Salazar',
  liquidacion: { id: 'liq-1', totalComprobado: 40_000, diferencias: [] },
  comprobantes: { total: 6, conCfdi: 6 },
  facturas: [],
  hoy: HOY,
  ...over,
});

// ── El hallazgo que define al archivo ──────────────────────────────────────

describe('aNumero — un `null` de lectura NUNCA se lee como 0', () => {
  it('el trap que se está evitando existe de verdad', () => {
    // Esta es la línea que escribiría cualquiera, y es la que rompe el libro:
    // el ingreso que nadie capturó entra como cero, la contribución sale
    // negativa y el margen −100%. Los tres números se ven plausibles.
    expect(Number(null)).toBe(0);
    expect(Number('')).toBe(0);
    expect(Number(undefined)).toBeNaN();
  });

  it('`null` y `undefined` son ausencia, no cero', () => {
    expect(aNumero(null)).toBeNull();
    expect(aNumero(undefined)).toBeNull();
    expect(aNumero(null)).not.toBe(0);
  });

  it('la cadena vacía es ausencia, no cero', () => {
    expect(aNumero('')).toBeNull();
    expect(aNumero('   ')).toBeNull();
  });

  it('un CERO capturado SÍ es cero — no se aplasta con los huecos', () => {
    // Un flete de cortesía existe, y un viaje cuadrado sin comprobantes también.
    expect(aNumero(0)).toBe(0);
    expect(aNumero('0')).toBe(0);
    expect(aNumero('0.00')).toBe(0);
  });

  it('`numeric(12,2)` puede llegar como texto según el driver', () => {
    expect(aNumero('12345.67')).toBe(12345.67);
    expect(aNumero(' 980.5 ')).toBe(980.5);
  });

  it('lo que no se puede imprimir no es una cifra', () => {
    // `mxn(NaN)` sale como "$NaN" en la columna que el contralor cruza contra
    // su PDF: peor que un hueco declarado.
    expect(aNumero(NaN)).toBeNull();
    expect(aNumero(Infinity)).toBeNull();
    expect(aNumero('no es un monto')).toBeNull();
    expect(aNumero({})).toBeNull();
    expect(aNumero([])).toBeNull();
    expect(aNumero(true)).toBeNull();
  });
});

describe('sumarOCallar — un total al que le falta un sumando no es un total', () => {
  it('una lista vacía no suma cero: no hay nada que sumar', () => {
    expect(sumarOCallar([])).toBeNull();
  });

  it('un solo `null` calla la suma entera', () => {
    expect(sumarOCallar([10_000, null, 5_000])).toBeNull();
  });

  it('suma normal y redondea a centavos con el round2 del producto', () => {
    expect(sumarOCallar([10_000, 5_000, 1_250.5])).toBe(16_250.5);
    expect(sumarOCallar([1.005, 1.005])).toBe(2.01);
  });
});

describe('diasEntre — un día de calendario no tiene zona', () => {
  it('cuenta días enteros', () => {
    expect(diasEntre('2026-07-01', '2026-07-31')).toBe(30);
    expect(diasEntre('2026-07-01', '2026-07-01')).toBe(0);
  });

  it('una fecha futura da negativo, no cero', () => {
    expect(diasEntre('2026-09-01', '2026-08-14')).toBe(-18);
  });

  it('cruza el cambio de horario sin perder ni ganar un día', () => {
    // México quitó el horario de verano en 2022, pero el cálculo se hace en
    // UTC justamente para no depender de eso.
    expect(diasEntre('2026-03-01', '2026-04-01')).toBe(31);
    expect(diasEntre('2026-10-01', '2026-11-01')).toBe(31);
  });

  it('RECHAZA un timestamptz en vez de recortarlo', () => {
    // Recortarlo con `.slice(0,10)` se queda con el día UTC, y CST es UTC−6:
    // todo lo sellado después de las 18:00 hora local contaría un día de más.
    expect(diasEntre('2026-07-01T02:00:00.000+00:00', '2026-08-14')).toBeNull();
  });

  it('lo ilegible es `null`, no 0 días', () => {
    expect(diasEntre(null, '2026-08-14')).toBeNull();
    expect(diasEntre('2026-08-14', null)).toBeNull();
    expect(diasEntre('ayer', '2026-08-14')).toBeNull();
    expect(diasEntre(20260701, '2026-08-14')).toBeNull();
  });
});

// ── Contribución y margen ──────────────────────────────────────────────────

describe('contribucion — ingreso menos lo comprobado, y nada más', () => {
  it('con las dos mitades, resta', () => {
    expect(contribucion(100_000, 40_000)).toBe(60_000);
  });

  it('puede salir negativa, y se dice', () => {
    expect(contribucion(30_000, 42_500)).toBe(-12_500);
  });

  it('SIN LIQUIDACIÓN no devuelve el ingreso pelón', () => {
    // Que nadie haya cuadrado el viaje no significa que no gastó diésel:
    // significa que todavía no se sabe cuánto. Devolver el ingreso pintaría de
    // rentable justo el viaje del que menos se sabe.
    expect(contribucion(100_000, null)).toBeNull();
    expect(contribucion(100_000, null)).not.toBe(100_000);
  });

  it('SIN INGRESO no devuelve el gasto en negativo', () => {
    expect(contribucion(null, 40_000)).toBeNull();
    expect(contribucion(null, 40_000)).not.toBe(-40_000);
  });

  it('un comprobado de 0 REAL sí resta cero', () => {
    // El viaje se cuadró y no se comprobó nada: eso es una medición.
    expect(contribucion(100_000, 0)).toBe(100_000);
  });
});

describe('margenPct — sin ingreso no hay margen, y no es 0%', () => {
  it('el caso normal', () => {
    expect(margenPct(100_000, 60_000)).toBe(60);
    expect(margenPct(80_000, -8_000)).toBe(-10);
  });

  it('sin ingreso capturado el margen es null, NO cero', () => {
    // Un 0% afirmaría "este viaje salió a mano", que es una medición.
    expect(margenPct(null, null)).toBeNull();
    expect(margenPct(null, null)).not.toBe(0);
  });

  it('con ingreso 0 tampoco: sería división entre cero', () => {
    expect(margenPct(0, -40_000)).toBeNull();
    expect(margenPct(0, -40_000)).not.toBe(0);
  });

  it('sin contribución no hay margen aunque haya ingreso', () => {
    expect(margenPct(100_000, null)).toBeNull();
  });

  it('redondea a dos decimales', () => {
    expect(margenPct(3, 1)).toBe(33.33);
  });
});

describe('faltaParaLaContribucion — la pantalla dice QUÉ falta', () => {
  it('con todo capturado no falta nada', () => {
    expect(faltaParaLaContribucion(100_000, 40_000)).toBeNull();
  });

  it('sin ingreso, avisa que el anticipo NO lo sustituye', () => {
    // Es la confusión más común y la más cara: el anticipo siempre está lleno.
    const t = faltaParaLaContribucion(null, 40_000)!;
    expect(t).toContain('ingreso del flete');
    expect(t).toContain('anticipo');
  });

  it('sin liquidación, avisa que no se supone cero', () => {
    const t = faltaParaLaContribucion(100_000, null)!;
    expect(t).toContain('liquidación');
    expect(t).toContain('cero');
  });

  it('sin ninguna de las dos, las nombra las dos', () => {
    const t = faltaParaLaContribucion(null, null)!;
    expect(t).toContain('ingreso del flete');
    expect(t).toContain('liquidación');
  });
});

// ── Estado documental ──────────────────────────────────────────────────────

describe('clasificarDocumental — "sin comprobantes" no es "sin CFDI"', () => {
  it('un viaje al que nadie le mandó nada está SIN CAPTURAR', () => {
    const d = clasificarDocumental(0, 0);
    expect(d.estado).toBe('sin_comprobantes');
    expect(d.estado).not.toBe('sin_cfdi');
    expect(d.rotulo).toBe('Sin comprobantes recibidos');
  });

  it('seis tickets y ningún UUID está capturado y sin respaldo fiscal', () => {
    const d = clasificarDocumental(6, 0);
    expect(d.estado).toBe('sin_cfdi');
    expect(d.sinCfdi).toBe(6);
    expect(d.rotulo).toBe('6 comprobantes, ninguno con CFDI');
  });

  it('todos con CFDI', () => {
    const d = clasificarDocumental(6, 6);
    expect(d.estado).toBe('con_cfdi');
    expect(d.sinCfdi).toBe(0);
    expect(d.rotulo).toBe('6 comprobantes, todos con CFDI');
  });

  it('parcial dice cuántos de cuántos', () => {
    const d = clasificarDocumental(6, 2);
    expect(d.estado).toBe('parcial');
    expect(d.rotulo).toBe('2 de 6 comprobantes con CFDI');
  });

  it('el singular va escrito, no armado con "(s)"', () => {
    expect(clasificarDocumental(1, 0).rotulo).toBe('1 comprobante, sin CFDI');
    expect(clasificarDocumental(1, 1).rotulo).toBe('1 comprobante, con CFDI');
  });

  it('nunca pinta "8 de 5": un conteo imposible tumba la confianza en la tabla', () => {
    const d = clasificarDocumental(5, 8);
    expect(d.conCfdi).toBe(5);
    expect(d.sinCfdi).toBe(0);
    expect(d.estado).toBe('con_cfdi');
  });
});

// ── Observaciones fiscales ─────────────────────────────────────────────────

describe('leerObservaciones — jsonb escrito por versiones distintas del motor', () => {
  it('una fila vieja con `null` no revienta la página del viaje', () => {
    expect(leerObservaciones(null)).toEqual([]);
    expect(leerObservaciones(undefined)).toEqual([]);
    expect(leerObservaciones({ tipo: 'sin_cfdi' })).toEqual([]);
    expect(leerObservaciones('sin_cfdi')).toEqual([]);
  });

  it('pasa la frase del motor tal cual — ahí va citado el fundamento', () => {
    const obs = leerObservaciones([
      { tipo: 'sin_cfdi', nota: 'Diésel de $5,800.00 requiere factura CFDI y no trae UUID válido.', monto: 5800 },
    ]);
    expect(obs).toEqual([
      { tipo: 'sin_cfdi', nota: 'Diésel de $5,800.00 requiere factura CFDI y no trae UUID válido.', monto: 5800 },
    ]);
  });

  it('salta lo que no se puede leer y conserva lo que sí', () => {
    const obs = leerObservaciones([
      { nota: 'sin tipo, no se puede clasificar' },
      null,
      42,
      { tipo: 'anticipo', nota: 'Sobró anticipo por $1,200.00', monto: 1200 },
    ]);
    expect(obs).toHaveLength(1);
    expect(obs[0].tipo).toBe('anticipo');
  });

  it('una observación sin frase deja `nota` en null — no se inventa una', () => {
    const obs = leerObservaciones([{ tipo: 'duplicado' }, { tipo: 'duplicado', nota: '   ' }]);
    expect(obs.map((o) => o.nota)).toEqual([null, null]);
  });

  it('un monto ausente es null y un monto 0 es 0', () => {
    const obs = leerObservaciones([
      { tipo: 'rfc_receptor', nota: 'a' },
      { tipo: 'duplicado', nota: 'b', monto: 0 },
    ]);
    expect(obs[0].monto).toBeNull();
    expect(obs[1].monto).toBe(0);
  });
});

// ── Facturación y cobro ────────────────────────────────────────────────────

describe('resumirCobro — sin factura no es cobrado $0', () => {
  it('un viaje sin factura no afirma nada sobre el dinero', () => {
    const c = resumirCobro([], HOY);
    expect(c.estadoFacturacion).toBe('sin_factura');
    expect(c.estadoCobro).toBe('sin_factura');
    expect(c.totalFacturado).toBeNull();
    expect(c.totalCobrado).toBeNull();
    expect(c.saldo).toBeNull();
    expect(c.diasPorCobrar).toBeNull();
  });

  it('un BORRADOR no es una factura todavía', () => {
    const c = resumirCobro([factura({ estatus: 'borrador' })], HOY);
    expect(c.estadoFacturacion).toBe('solo_borrador');
    expect(c.estadoCobro).toBe('sin_factura');
    expect(c.totalFacturado).toBeNull();
  });

  it('una cancelada no deja al viaje "facturado"', () => {
    const c = resumirCobro([factura({ estatus: 'cancelada' })], HOY);
    expect(c.estadoFacturacion).toBe('cancelada');
    expect(c.estadoCobro).toBe('sin_factura');
  });
});

describe('resumirCobro — FACTURADO Y NO COBRADO', () => {
  const c = resumirCobro([factura({ fecha: '2026-07-15', total: 50_000, pagado: 0, saldo: 50_000 })], HOY);

  it('el estado dice las dos cosas por separado', () => {
    expect(c.estadoFacturacion).toBe('facturado');
    expect(c.estadoCobro).toBe('sin_cobrar');
  });

  it('los importes son los de la factura viva', () => {
    expect(c.totalFacturado).toBe(50_000);
    expect(c.totalCobrado).toBe(0);
    expect(c.saldo).toBe(50_000);
  });

  it('los días por cobrar se cuentan desde la fecha de la factura', () => {
    expect(c.diasPorCobrar).toBe(30);
  });

  it('vencida el 31 de julio, hoy 14 de agosto: 14 días vencida', () => {
    expect(c.diasVencida).toBe(14);
  });
});

describe('resumirCobro — COBRADO PARCIAL', () => {
  const c = resumirCobro(
    [factura({ fecha: '2026-08-01', total: 50_000, pagado: 20_000, saldo: 30_000, venceEn: '2026-08-31' })],
    HOY,
  );

  it('un abono no la vuelve cobrada', () => {
    expect(c.estadoCobro).toBe('parcial');
    expect(c.estadoCobro).not.toBe('cobrado');
  });

  it('enseña lo abonado y lo que falta, sin mezclarlos', () => {
    expect(c.totalCobrado).toBe(20_000);
    expect(c.saldo).toBe(30_000);
  });

  it('sigue contando días por cobrar mientras quede saldo', () => {
    expect(c.diasPorCobrar).toBe(13);
  });

  it('no está vencida: su fecha pactada aún no llega', () => {
    expect(c.diasVencida).toBeNull();
  });
});

describe('resumirCobro — cobrada, y el centavo de tolerancia', () => {
  it('saldo cero es cobrada y ya no cuenta días', () => {
    const c = resumirCobro([factura({ pagado: 50_000, saldo: 0 })], HOY);
    expect(c.estadoCobro).toBe('cobrado');
    expect(c.diasPorCobrar).toBeNull();
    expect(c.diasVencida).toBeNull();
  });

  it('una factura de $0 no queda "sin cobrar": no hay nada que cobrar', () => {
    // El flete de cortesía existe. Mirar lo abonado antes que el saldo dejaba
    // un pendiente inventado en la cartera del cliente.
    const c = resumirCobro([factura({ total: 0, pagado: 0, saldo: 0 })], HOY);
    expect(c.estadoCobro).toBe('cobrado');
    expect(c.diasPorCobrar).toBeNull();
  });

  it('un centavo de redondeo no deja la factura "por cobrar"', () => {
    // Misma tolerancia que `factura_total_cuadra` y `factura_saldo` en la 0049:
    // usar otra haría que una factura saldada en Postgres saliera con saldo aquí.
    const c = resumirCobro([factura({ pagado: 49_999.99, saldo: TOLERANCIA_CENTAVO })], HOY);
    expect(c.estadoCobro).toBe('cobrado');
  });
});

describe('resumirCobro — lo que NO se pudo leer no acusa a nadie', () => {
  it('sin fila de saldo, el estado es `sin_dato`, no `sin cobrar`', () => {
    // `sin_cobrar` acusaría de moroso a un cliente que quizá ya pagó.
    const c = resumirCobro([factura({ pagado: null, saldo: null })], HOY);
    expect(c.estadoCobro).toBe('sin_dato');
    expect(c.totalCobrado).toBeNull();
    expect(c.saldo).toBeNull();
    expect(c.diasPorCobrar).toBeNull();
  });

  it('una factura con total ilegible calla el total, no lo sustituye por 0', () => {
    const c = resumirCobro([factura(), factura({ id: 'f-2', total: null })], HOY);
    expect(c.totalFacturado).toBeNull();
  });
});

describe('resumirCobro — sin crédito pactado no hay vencimiento que reclamar', () => {
  it('marca `sinCondiciones` y no inventa días vencida', () => {
    const c = resumirCobro([factura({ venceEn: null, fecha: '2026-05-01' })], HOY);
    expect(c.sinCondiciones).toBe(true);
    expect(c.diasVencida).toBeNull();
    // Los días por cobrar sí existen: el dinero lleva afuera desde que se facturó.
    expect(c.diasPorCobrar).toBe(105);
  });
});

describe('resumirCobro — varias facturas', () => {
  it('los días los marca la MÁS ANTIGUA con saldo, no un promedio', () => {
    const c = resumirCobro([
      factura({ id: 'f-1', fecha: '2026-06-01', total: 10_000, pagado: 0, saldo: 10_000 }),
      factura({ id: 'f-2', fecha: '2026-08-10', total: 10_000, pagado: 0, saldo: 10_000 }),
    ], HOY);
    expect(c.diasPorCobrar).toBe(74);
  });

  it('una ya cobrada no arrastra los días de la que sí falta', () => {
    const c = resumirCobro([
      factura({ id: 'f-1', fecha: '2026-06-01', total: 10_000, pagado: 10_000, saldo: 0 }),
      factura({ id: 'f-2', fecha: '2026-08-10', total: 10_000, pagado: 0, saldo: 10_000 }),
    ], HOY);
    expect(c.diasPorCobrar).toBe(4);
    expect(c.estadoCobro).toBe('parcial');
  });

  it('los borradores y las canceladas no entran a las sumas', () => {
    const c = resumirCobro([
      factura({ id: 'f-1', total: 10_000, pagado: 0, saldo: 10_000 }),
      factura({ id: 'f-2', estatus: 'borrador', total: 99_000, pagado: 0, saldo: 99_000 }),
      factura({ id: 'f-3', estatus: 'cancelada', total: 77_000, pagado: 0, saldo: 77_000 }),
    ], HOY);
    expect(c.totalFacturado).toBe(10_000);
    expect(c.saldo).toBe(10_000);
  });
});

describe('resumirCobro — una factura que ampara varios viajes', () => {
  it('marca los importes como NO atribuibles a este viaje', () => {
    // Sin esta marca, una factura que cubre cinco viajes pintaría sus $180,000
    // completos en el renglón de uno solo.
    const c = resumirCobro([factura({ total: 180_000, amparaVarios: true })], HOY);
    expect(c.importesCompartidos).toBe(true);
  });

  it('con facturas propias del viaje, no se marca nada', () => {
    expect(resumirCobro([factura()], HOY).importesCompartidos).toBe(false);
  });
});

describe('los rótulos que van a pantalla', () => {
  it('cada estado de facturación tiene su frase, y ninguna miente', () => {
    expect(rotuloFacturacion('sin_factura')).toBe('Sin facturar');
    expect(rotuloFacturacion('solo_borrador')).toBe('Solo borrador');
    expect(rotuloFacturacion('facturado')).toBe('Facturado');
    expect(rotuloFacturacion('cancelada')).toBe('Factura cancelada');
  });

  it('cada estado de cobro tiene su frase, y `sin_dato` no dice "sin cobrar"', () => {
    expect(rotuloCobro('sin_factura')).toBe('Nada que cobrar todavía');
    expect(rotuloCobro('sin_dato')).toBe('No se pudo leer el saldo');
    expect(rotuloCobro('sin_cobrar')).toBe('Sin cobrar');
    expect(rotuloCobro('parcial')).toBe('Cobrado en parte');
    expect(rotuloCobro('cobrado')).toBe('Cobrado');
  });
});

// ── El renglón completo ────────────────────────────────────────────────────

describe('armarRenglon — el viaje con todo capturado', () => {
  const r = armarRenglon(entrada({
    facturas: [factura({ fecha: '2026-07-15', total: 100_000, pagado: 100_000, saldo: 0 })],
  }));

  it('cruza cliente, unidad y operador', () => {
    expect(r.cliente).toBe('Cementos del Norte');
    expect(r.unidad).toBe('C2-08');
    expect(r.operador).toBe('Rubén Salazar');
  });

  it('la contribución y el margen salen de cifras reales', () => {
    expect(r.ingreso).toBe(100_000);
    expect(r.comprobado).toBe(40_000);
    expect(r.contribucion).toBe(60_000);
    expect(r.margenPct).toBe(60);
    expect(r.falta).toBeNull();
  });

  it('arma la ruta y respeta el folio del viaje', () => {
    expect(r.ruta).toBe('Monterrey → Querétaro');
    expect(r.folio).toBe('VJ-2026-0845');
  });

  it('facturado y cobrado', () => {
    expect(r.cobro.estadoFacturacion).toBe('facturado');
    expect(r.cobro.estadoCobro).toBe('cobrado');
  });
});

describe('armarRenglon — SIN INGRESO CAPTURADO', () => {
  const r = armarRenglon(entrada({
    viaje: { ...entrada().viaje, ingresoFlete: null },
  }));

  it('el ingreso queda en null, no en 0', () => {
    expect(r.ingreso).toBeNull();
    expect(r.ingreso).not.toBe(0);
  });

  it('el MARGEN es null, NO 0 ni −100%', () => {
    expect(r.margenPct).toBeNull();
    expect(r.margenPct).not.toBe(0);
    expect(r.margenPct).not.toBe(-100);
  });

  it('la contribución tampoco sale del gasto en negativo', () => {
    expect(r.contribucion).toBeNull();
    expect(r.contribucion).not.toBe(-40_000);
  });

  it('y la pantalla tiene QUÉ decir en vez de un guion mudo', () => {
    expect(r.falta).toContain('ingreso del flete');
  });

  it('lo que SÍ se sabe del viaje se sigue enseñando', () => {
    // Falta media cifra, no el viaje entero.
    expect(r.comprobado).toBe(40_000);
    expect(r.cliente).toBe('Cementos del Norte');
    expect(r.documental.estado).toBe('con_cfdi');
  });
});

describe('armarRenglon — SIN LIQUIDACIÓN', () => {
  const r = armarRenglon(entrada({ liquidacion: null }));

  it('el comprobado es desconocido, no cero', () => {
    expect(r.comprobado).toBeNull();
    expect(r.comprobado).not.toBe(0);
    expect(r.liquidacionId).toBeNull();
  });

  it('la contribución NO es el ingreso pelón', () => {
    expect(r.contribucion).toBeNull();
    expect(r.contribucion).not.toBe(100_000);
    expect(r.margenPct).toBeNull();
    expect(r.margenPct).not.toBe(100);
  });

  it('las observaciones son `null` — "no hay liquidación" no es "salió limpia"', () => {
    expect(r.observaciones).toBeNull();
    expect(r.observaciones).not.toEqual([]);
  });

  it('con liquidación y sin diferencias, las observaciones son la lista vacía', () => {
    const limpio = armarRenglon(entrada());
    expect(limpio.observaciones).toEqual([]);
  });
});

describe('armarRenglon — un viaje cuadrado que no comprobó nada', () => {
  it('un comprobado de 0 REAL sí produce contribución y margen', () => {
    // Es la contraparte del caso anterior: aquí el 0 es una medición, y
    // aplastarlo con el hueco escondería que el operador no entregó un solo
    // ticket de un viaje ya cerrado.
    const r = armarRenglon(entrada({
      liquidacion: { id: 'liq-1', totalComprobado: 0, diferencias: [] },
    }));
    expect(r.comprobado).toBe(0);
    expect(r.contribucion).toBe(100_000);
    expect(r.margenPct).toBe(100);
    expect(r.falta).toBeNull();
  });
});

describe('armarRenglon — los huecos del alta', () => {
  it('un viaje sin folio se cita por los primeros 8 de su id', () => {
    const r = armarRenglon(entrada({ viaje: { ...entrada().viaje, folio: null } }));
    expect(r.folio).toBe('11111111');
  });

  it('sin cliente, sin unidad y sin operador, son `null` y no "—"', () => {
    // El guion es cosa de la vista; el motor entrega la ausencia sin disfraz.
    const r = armarRenglon(entrada({ cliente: null, unidad: null, operador: null }));
    expect(r.cliente).toBeNull();
    expect(r.unidad).toBeNull();
    expect(r.operador).toBeNull();
  });

  it('con media ruta capturada, enseña la mitad que hay', () => {
    expect(armarRenglon(entrada({ viaje: { ...entrada().viaje, destino: null } })).ruta).toBe('Monterrey');
    expect(armarRenglon(entrada({ viaje: { ...entrada().viaje, origen: null, destino: null } })).ruta).toBeNull();
  });

  it('un viaje sin comprobantes lo dice como tal', () => {
    const r = armarRenglon(entrada({ comprobantes: { total: 0, conCfdi: 0 } }));
    expect(r.documental.estado).toBe('sin_comprobantes');
  });
});

describe('armarRenglon — el `total_comprobado` crudo pasa por aNumero', () => {
  it('un `null` en la columna no se cuela como 0 aunque la liquidación exista', () => {
    // `total_comprobado` es `not null` en la tabla, pero la defensa vive en el
    // motor: si un día llega vacío, el renglón se calla en vez de afirmar que
    // el viaje no gastó nada.
    const r = armarRenglon(entrada({
      liquidacion: { id: 'liq-1', totalComprobado: null, diferencias: [] },
    }));
    expect(r.comprobado).toBeNull();
    expect(r.contribucion).toBeNull();
    expect(r.falta).toContain('liquidación');
  });

  it('y un texto numérico sí se lee', () => {
    const r = armarRenglon(entrada({
      liquidacion: { id: 'liq-1', totalComprobado: '40000.00', diferencias: [] },
    }));
    expect(r.comprobado).toBe(40_000);
    expect(r.contribucion).toBe(60_000);
  });
});
