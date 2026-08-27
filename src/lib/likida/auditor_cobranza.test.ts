import { describe, it, expect } from 'vitest';
import {
  resolverPactado, auditarViaje, resumirAuditoria, ordenarCola, ventanaAuditor,
  CUBETAS_AUDITOR, VENTANA_AUDITOR_DIAS,
  type ViajeParaAuditar, type FacturaAuditada, type CubetaAuditor,
} from './auditor_cobranza';
import type { TarifaRow } from './clientes';

// ═══════════════════════════════════════════════════════════════════════════
// EL AUDITOR DE COBRANZA — una prueba por regla, con los bordes que deciden
// dinero: la tolerancia del centavo, el borrador que sí se audita, la factura
// compartida que no se atribuye, y el `null` que jamás se vuelve $0.
// ═══════════════════════════════════════════════════════════════════════════

const HOY = '2026-08-20';

const tarifa = (extra: Partial<TarifaRow> = {}): TarifaRow => ({
  id: 't-1',
  clienteId: null,
  clienteNombre: null,
  origen: null,
  destino: null,
  modo: 'por_viaje',
  precio: 10_000,
  moneda: 'MXN',
  vigenteDesde: '2026-01-01',
  vigenteHasta: null,
  activa: true,
  creadaEn: '2026-01-01T00:00:00Z',
  ...extra,
});

const factura = (extra: Partial<FacturaAuditada> = {}): FacturaAuditada => ({
  id: 'f-1',
  folio: 'A-1',
  fecha: '2026-08-16',
  estatus: 'emitida',
  total: 11_600,
  subtotal: 10_000,
  pagado: 0,
  saldo: 11_600,
  venceEn: null,
  amparaVarios: false,
  ...extra,
});

const viaje = (extra: Partial<ViajeParaAuditar> = {}): ViajeParaAuditar => ({
  id: 'v-00000001',
  folio: 'V-1',
  clienteId: 'c-1',
  cliente: 'Cliente Uno',
  origen: 'Monterrey',
  destino: 'Querétaro',
  fechaInicio: '2026-08-15',
  ingresoFlete: null,
  kmRecorridos: null,
  podSubido: false,
  descargaEn: null,
  liquidacion: null,
  facturas: [],
  ...extra,
});

const cubetas = (v: ReturnType<typeof auditarViaje>): CubetaAuditor[] => v.hallazgos.map((h) => h.cubeta);

describe('resolverPactado', () => {
  it('el ingreso capturado GANA sobre la tarifa del catálogo', () => {
    const r = resolverPactado(viaje({ ingresoFlete: 9_500 }), [tarifa({ precio: 10_000 })], HOY);
    expect(r.pactado).toEqual({ monto: 9_500, origen: 'capturado', porque: 'Ingreso capturado en el viaje' });
  });

  it('un 0 TECLEADO es un pactado de $0 (la cortesía), no un hueco', () => {
    const r = resolverPactado(viaje({ ingresoFlete: 0 }), [tarifa()], HOY);
    expect(r.pactado?.monto).toBe(0);
    expect(r.pactado?.origen).toBe('capturado');
  });

  it('sin ingreso capturado cae a la tarifa, con su porqué', () => {
    const r = resolverPactado(viaje(), [tarifa({ precio: 12_000 })], HOY);
    expect(r.pactado?.monto).toBe(12_000);
    expect(r.pactado?.origen).toBe('tarifa');
    expect(r.pactado?.porque).toContain('De lista');
  });

  it('una tarifa por km SIN km capturados no se resuelve a monto: dice qué falta', () => {
    const r = resolverPactado(viaje(), [tarifa({ modo: 'por_km', precio: 12.5 })], HOY);
    expect(r.pactado).toBeNull();
    expect(r.motivo).toBe('tarifa_sin_monto');
    expect(r.falta).toBe('km');
  });

  it('sin ninguna tarifa aplicable el motivo es sin_tarifa', () => {
    const r = resolverPactado(viaje(), [], HOY);
    expect(r.pactado).toBeNull();
    expect(r.motivo).toBe('sin_tarifa');
  });

  it('la vigencia se juzga contra la fecha de inicio del viaje, no contra hoy', () => {
    // La tarifa entró en vigor DESPUÉS del viaje: para ese viaje no rige.
    const r = resolverPactado(viaje({ fechaInicio: '2026-08-15' }), [tarifa({ vigenteDesde: '2026-08-16' })], HOY);
    expect(r.motivo).toBe('sin_tarifa');
  });

  it('el catálogo ambiguo se DICE en el porqué, no se elige en silencio', () => {
    const r = resolverPactado(viaje(), [
      tarifa({ id: 't-1', precio: 10_000 }),
      tarifa({ id: 't-2', precio: 11_000 }),
    ], HOY);
    expect(r.pactado?.porque).toContain('otra tarifa igual de específica');
  });
});

describe('facturado vs pactado', () => {
  it('facturado de MENOS: la brecha con su monto y la nota citable', () => {
    const v = auditarViaje(viaje({ ingresoFlete: 10_000, facturas: [factura({ subtotal: 8_000, total: 9_280 })] }), [], HOY);
    const h = v.hallazgos.find((x) => x.cubeta === 'facturado_menor');
    expect(h?.monto).toBe(2_000);
    expect(h?.nota).toContain('faltan');
    expect(h?.nota).toContain('sin IVA');
  });

  it('facturado de MÁS también se dice', () => {
    const v = auditarViaje(viaje({ ingresoFlete: 10_000, facturas: [factura({ subtotal: 12_000, total: 13_920 })] }), [], HOY);
    const h = v.hallazgos.find((x) => x.cubeta === 'facturado_mayor');
    expect(h?.monto).toBe(2_000);
  });

  it('se compara contra el SUBTOTAL: una factura correcta con IVA no es cobrar de más', () => {
    // subtotal 10,000 = pactado; total 11,600 con IVA. Contra el total saldría
    // un falso "facturado de más" del 16% en CADA factura correcta.
    const v = auditarViaje(viaje({ ingresoFlete: 10_000, facturas: [factura()] }), [], HOY);
    expect(cubetas(v)).not.toContain('facturado_mayor');
    expect(cubetas(v)).not.toContain('facturado_menor');
  });

  it('un centavo de diferencia es redondeo, dos ya son discrepancia', () => {
    const unCentavo = auditarViaje(viaje({ ingresoFlete: 100, facturas: [factura({ subtotal: 99.99, total: 115.99 })] }), [], HOY);
    expect(cubetas(unCentavo)).not.toContain('facturado_menor');
    const dosCentavos = auditarViaje(viaje({ ingresoFlete: 100, facturas: [factura({ subtotal: 99.98, total: 115.98 })] }), [], HOY);
    expect(cubetas(dosCentavos)).toContain('facturado_menor');
  });

  it('el BORRADOR se audita — es el momento de corregir gratis — y la nota lo dice', () => {
    const v = auditarViaje(viaje({
      ingresoFlete: 10_000,
      facturas: [factura({ estatus: 'borrador', subtotal: 8_000 })],
    }), [], HOY);
    const h = v.hallazgos.find((x) => x.cubeta === 'facturado_menor');
    expect(h?.monto).toBe(2_000);
    expect(h?.nota).toContain('borrador');
  });

  it('con factura VIVA correcta, un borrador viejo con otro monto no acusa nada', () => {
    const v = auditarViaje(viaje({
      ingresoFlete: 10_000,
      facturas: [factura({ id: 'f-1', subtotal: 10_000 }), factura({ id: 'f-2', estatus: 'borrador', subtotal: 5_000 })],
    }), [], HOY);
    expect(cubetas(v)).not.toContain('facturado_menor');
  });

  it('un subtotal que no se pudo leer NO se compara: sin acusación sobre dato ilegible', () => {
    const v = auditarViaje(viaje({ ingresoFlete: 10_000, facturas: [factura({ subtotal: null })] }), [], HOY);
    expect(cubetas(v)).not.toContain('facturado_menor');
    expect(cubetas(v)).not.toContain('facturado_mayor');
  });

  it('el pactado puede salir de la tarifa cuando el ingreso no está capturado', () => {
    const v = auditarViaje(viaje({ facturas: [factura({ subtotal: 8_000 })] }), [tarifa({ precio: 10_000 })], HOY);
    const h = v.hallazgos.find((x) => x.cubeta === 'facturado_menor');
    expect(h?.monto).toBe(2_000);
    expect(h?.nota.toLowerCase()).toContain('de lista');
  });
});

describe('factura compartida', () => {
  it('una factura que ampara varios viajes NO se compara: cubeta propia que lo dice', () => {
    const v = auditarViaje(viaje({
      ingresoFlete: 10_000,
      facturas: [factura({ subtotal: 50_000, total: 58_000, amparaVarios: true })],
    }), [], HOY);
    expect(cubetas(v)).toContain('factura_compartida');
    // Aunque 50,000 ≠ 10,000, la diferencia NO se afirma: no es de este viaje.
    expect(cubetas(v)).not.toContain('facturado_mayor');
  });
});

describe('entregado sin facturar — el dinero dormido', () => {
  it('POD subido y sin factura: hallazgo con el pactado como monto dormido', () => {
    const v = auditarViaje(viaje({ ingresoFlete: 10_000, podSubido: true }), [], HOY);
    const h = v.hallazgos.find((x) => x.cubeta === 'entregado_sin_facturar');
    expect(h?.monto).toBe(10_000);
    expect(h?.nota).toContain('POD está subido');
  });

  it('el hito de descarga también es evidencia, y los días se cuentan en día de México', () => {
    // 02:00Z del 16 = 20:00 del 15 en México: dormido desde el 15 → 5 días.
    const v = auditarViaje(viaje({ ingresoFlete: 10_000, descargaEn: '2026-08-16T02:00:00Z' }), [], HOY);
    const h = v.hallazgos.find((x) => x.cubeta === 'entregado_sin_facturar');
    expect(h?.nota).toContain('desde hace 5 días');
  });

  it('sin pactado resoluble el monto es null — no $0 — y ADEMÁS se pide la tarifa', () => {
    const v = auditarViaje(viaje({ podSubido: true }), [], HOY);
    const h = v.hallazgos.find((x) => x.cubeta === 'entregado_sin_facturar');
    expect(h?.monto).toBeNull();
    expect(cubetas(v)).toContain('sin_tarifa');
  });

  it('la factura CANCELADA no cuenta: el viaje entregado vuelve a estar dormido', () => {
    const v = auditarViaje(viaje({
      ingresoFlete: 10_000, podSubido: true,
      facturas: [factura({ estatus: 'cancelada' })],
    }), [], HOY);
    expect(cubetas(v)).toContain('entregado_sin_facturar');
  });

  it('con borrador empezado la nota manda a terminarlo', () => {
    const v = auditarViaje(viaje({
      ingresoFlete: 10_000, podSubido: true,
      facturas: [factura({ estatus: 'borrador', subtotal: 10_000 })],
    }), [], HOY);
    const h = v.hallazgos.find((x) => x.cubeta === 'entregado_sin_facturar');
    expect(h?.nota).toContain('borrador');
  });

  it('con factura viva NO hay dinero dormido', () => {
    const v = auditarViaje(viaje({ ingresoFlete: 10_000, podSubido: true, facturas: [factura()] }), [], HOY);
    expect(cubetas(v)).not.toContain('entregado_sin_facturar');
  });
});

describe('facturado sin POD', () => {
  it('factura viva sin POD subido: el monto en juego es el SALDO, no el total', () => {
    const v = auditarViaje(viaje({
      ingresoFlete: 10_000,
      facturas: [factura({ pagado: 6_600, saldo: 5_000 })],
    }), [], HOY);
    const h = v.hallazgos.find((x) => x.cubeta === 'facturado_sin_pod');
    expect(h?.monto).toBe(5_000);
    expect(h?.nota).toContain('prueba de entrega');
  });

  it('un POD pendiente o rechazado NO es un POD subido', () => {
    // El loader solo marca `podSubido` con estado 'subido'; aquí se fija que
    // la regla dispara con `false`, que es como llegan pendiente y rechazado.
    const v = auditarViaje(viaje({ ingresoFlete: 10_000, podSubido: false, facturas: [factura()] }), [], HOY);
    expect(cubetas(v)).toContain('facturado_sin_pod');
  });

  it('con POD subido la regla no dispara', () => {
    const v = auditarViaje(viaje({ ingresoFlete: 10_000, podSubido: true, facturas: [factura()] }), [], HOY);
    expect(cubetas(v)).not.toContain('facturado_sin_pod');
  });

  it('con hito de descarga pero sin papel, la nota distingue: llegó, falta el POD', () => {
    const v = auditarViaje(viaje({
      ingresoFlete: 10_000, descargaEn: '2026-08-16T02:00:00Z', facturas: [factura()],
    }), [], HOY);
    const h = v.hallazgos.find((x) => x.cubeta === 'facturado_sin_pod');
    expect(h?.nota).toContain('falta el papel');
  });
});

describe('cobrado parcial', () => {
  it('abonos con saldo restante: hallazgo con el saldo como monto', () => {
    const v = auditarViaje(viaje({
      ingresoFlete: 10_000, podSubido: true,
      facturas: [factura({ pagado: 6_600, saldo: 5_000 })],
    }), [], HOY);
    const h = v.hallazgos.find((x) => x.cubeta === 'cobrado_parcial');
    expect(h?.monto).toBe(5_000);
  });

  it('los días vencida entran a la nota cuando la factura ya pasó su fecha', () => {
    const v = auditarViaje(viaje({
      ingresoFlete: 10_000, podSubido: true,
      facturas: [factura({ pagado: 6_600, saldo: 5_000, venceEn: '2026-08-10' })],
    }), [], HOY);
    const h = v.hallazgos.find((x) => x.cubeta === 'cobrado_parcial');
    expect(h?.nota).toContain('10 días vencida');
  });

  it('cobrada completa o sin un solo abono NO son "parcial"', () => {
    const cobrada = auditarViaje(viaje({
      ingresoFlete: 10_000, podSubido: true,
      facturas: [factura({ pagado: 11_600, saldo: 0 })],
    }), [], HOY);
    expect(cubetas(cobrada)).not.toContain('cobrado_parcial');
    const sinCobrar = auditarViaje(viaje({ ingresoFlete: 10_000, podSubido: true, facturas: [factura()] }), [], HOY);
    expect(cubetas(sinCobrar)).not.toContain('cobrado_parcial');
  });
});

describe('sin tarifa — la cubeta que pide capturar', () => {
  it('solo se emite cuando el cruce se NECESITABA (hay factura o entrega)', () => {
    const sinActividad = auditarViaje(viaje(), [], HOY);
    expect(sinActividad.hallazgos).toHaveLength(0);
    const conFactura = auditarViaje(viaje({ facturas: [factura()] }), [], HOY);
    expect(cubetas(conFactura)).toContain('sin_tarifa');
  });

  it('se emite UNA vez aunque dos reglas la necesiten', () => {
    const v = auditarViaje(viaje({ podSubido: true, facturas: [factura({ estatus: 'borrador' })] }), [], HOY);
    expect(cubetas(v).filter((c) => c === 'sin_tarifa')).toHaveLength(1);
  });

  it('tarifa por km sin km capturados cae a su propia cubeta con la falta dicha', () => {
    const v = auditarViaje(viaje({ facturas: [factura()] }), [tarifa({ modo: 'por_km', precio: 12.5 })], HOY);
    const h = v.hallazgos.find((x) => x.cubeta === 'tarifa_sin_monto');
    expect(h?.nota).toContain('kilómetro');
  });
});

describe('margen real — el argumento del margen fijo', () => {
  it('pactado y liquidación medidos: margen y % reales', () => {
    const v = auditarViaje(viaje({ ingresoFlete: 10_000, liquidacion: { totalComprobado: 6_500 } }), [], HOY);
    expect(v.margen).toEqual({
      pactado: 10_000, comprobado: 6_500, margen: 3_500, margenPct: 35, falta: null,
    });
  });

  it('sin liquidación el margen es null — que nadie cuadró no significa que no se gastó', () => {
    const v = auditarViaje(viaje({ ingresoFlete: 10_000 }), [], HOY);
    expect(v.margen.margen).toBeNull();
    expect(v.margen.falta).toContain('liquidación');
  });

  it('una liquidación con $0 comprobado SÍ es una medición', () => {
    const v = auditarViaje(viaje({ ingresoFlete: 10_000, liquidacion: { totalComprobado: 0 } }), [], HOY);
    expect(v.margen.margen).toBe(10_000);
    expect(v.margen.margenPct).toBe(100);
  });

  it('el pactado del margen puede venir de la tarifa', () => {
    const v = auditarViaje(viaje({ liquidacion: { totalComprobado: 6_000 } }), [tarifa({ precio: 10_000 })], HOY);
    expect(v.margen.margen).toBe(4_000);
  });
});

describe('resumirAuditoria', () => {
  it('cuenta por cubeta, suma el dormido CONOCIDO y declara el sin monto', () => {
    const auditorias = [
      auditarViaje(viaje({ id: 'v-1', folio: 'A', ingresoFlete: 10_000, podSubido: true }), [], HOY),
      auditarViaje(viaje({ id: 'v-2', folio: 'B', podSubido: true }), [], HOY),
      auditarViaje(viaje({ id: 'v-3', folio: 'C', ingresoFlete: 8_000, facturas: [factura({ subtotal: 5_000 })] }), [], HOY),
    ];
    const r = resumirAuditoria(auditorias);
    expect(r.viajesAuditados).toBe(3);
    expect(r.porCubeta.entregado_sin_facturar).toBe(2);
    expect(r.dineroDormido).toBe(10_000);
    expect(r.dormidosSinMonto).toBe(1);
    expect(r.brechaFacturadoDeMenos).toBe(3_000);
    expect(r.porCubeta.sin_tarifa).toBe(1);
  });

  it('el margen agregado suma SOLO los medidos y dice cuántos faltan', () => {
    const auditorias = [
      auditarViaje(viaje({ id: 'v-1', ingresoFlete: 10_000, liquidacion: { totalComprobado: 6_000 } }), [], HOY),
      auditarViaje(viaje({ id: 'v-2', ingresoFlete: 20_000 }), [], HOY),
    ];
    const r = resumirAuditoria(auditorias);
    expect(r.margen).toEqual({
      pactado: 10_000, comprobado: 6_000, margen: 4_000, margenPct: 40,
      viajesMedidos: 1, viajesSinDato: 1,
    });
  });

  it('sin un solo viaje medido el % es null, jamás 0', () => {
    const r = resumirAuditoria([auditarViaje(viaje(), [], HOY)]);
    expect(r.margen.margenPct).toBeNull();
    expect(r.margen.viajesMedidos).toBe(0);
  });
});

describe('ordenarCola', () => {
  it('el dinero más grande arriba; sin monto al final, sin inventarle uno', () => {
    const auditorias = [
      auditarViaje(viaje({ id: 'v-1', folio: 'A', podSubido: true }), [], HOY),
      auditarViaje(viaje({ id: 'v-2', folio: 'B', ingresoFlete: 5_000, podSubido: true }), [], HOY),
      auditarViaje(viaje({ id: 'v-3', folio: 'C', ingresoFlete: 20_000, podSubido: true }), [], HOY),
    ];
    const cola = ordenarCola(auditorias);
    const dormidos = cola.filter((h) => h.cubeta === 'entregado_sin_facturar');
    expect(dormidos.map((h) => h.monto)).toEqual([20_000, 5_000, null]);
  });
});

describe('el contrato de las cubetas', () => {
  it('las ocho cubetas tienen rótulo, y la ventana por defecto es de 30 días', () => {
    expect(CUBETAS_AUDITOR).toHaveLength(8);
    expect(new Set(CUBETAS_AUDITOR.map((c) => c.clave)).size).toBe(8);
    expect(VENTANA_AUDITOR_DIAS).toBe(30);
  });
});

describe('ventanaAuditor', () => {
  it('resta días de calendario sin que la zona corra la fecha', () => {
    expect(ventanaAuditor('2026-08-20')).toEqual({ desde: '2026-07-21', hasta: '2026-08-20' });
    // Cruza el año: en enero es exactamente cuando el corte importa.
    expect(ventanaAuditor('2026-01-15')).toEqual({ desde: '2025-12-16', hasta: '2026-01-15' });
  });
});
