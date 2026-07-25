import { describe, it, expect } from 'vitest';
import { cuadrarViaje, type PoliticaGasto } from './engine';
import type { Gasto } from '@/types/cuadra';

const g = (p: Partial<Gasto>): Gasto => ({
  id: Math.random().toString(36).slice(2),
  concepto: 'diesel',
  monto: 0,
  ocrConfianza: 0.95,
  ...p,
});

const politica: PoliticaGasto[] = [
  { concepto: 'diesel', topeMonto: 2500 },
  { concepto: 'caseta', topeMonto: 1000 },
  { concepto: 'factura', requiereCfdi: true },
];

describe('cuadrarViaje', () => {
  it('cuadra exacto cuando comprobado = anticipo y todo dentro de política', () => {
    const r = cuadrarViaje({
      viajeId: 'v1', anticipo: 3000, politica,
      gastos: [g({ concepto: 'diesel', monto: 2000, folio: 'A1' }), g({ concepto: 'caseta', monto: 1000, folio: 'C1' })],
    });
    expect(r.totalComprobado).toBe(3000);
    expect(r.diferencia).toBe(0);
    expect(r.estatus).toBe('cuadrada');
    expect(r.diferencias).toHaveLength(0);
  });

  it('detecta sobre-política, faltante de CFDI y diferencia de anticipo', () => {
    const r = cuadrarViaje({
      viajeId: 'v2', anticipo: 5000, politica,
      gastos: [
        g({ concepto: 'diesel', monto: 3000, folio: 'D1' }),          // 500 sobre tope 2500
        g({ concepto: 'caseta', monto: 800, folio: 'C1' }),
        g({ concepto: 'factura', monto: 800, folio: 'F1' }),          // requiere CFDI, sin uuid
      ],
    });
    expect(r.totalComprobado).toBe(4600);
    expect(r.diferencia).toBe(400); // sobró anticipo, a favor empresa
    const tipos = r.diferencias.map((d) => d.tipo).sort();
    expect(tipos).toContain('sobre_politica');
    expect(tipos).toContain('sin_cfdi');
    expect(tipos).toContain('anticipo');
    expect(r.estatus).toBe('revisar'); // sin_cfdi → revisar
  });

  it('detecta comprobantes duplicados (mismo folio+monto)', () => {
    const r = cuadrarViaje({
      viajeId: 'v3', anticipo: 4000, politica,
      gastos: [
        g({ concepto: 'diesel', monto: 2000, folio: 'DUP' }),
        g({ concepto: 'diesel', monto: 2000, folio: 'DUP' }),
      ],
    });
    expect(r.diferencias.some((d) => d.tipo === 'duplicado')).toBe(true);
    expect(r.estatus).toBe('con_diferencias');
  });

  it('marca baja confianza de OCR para revisión', () => {
    const r = cuadrarViaje({
      viajeId: 'v4', anticipo: 1000, politica,
      gastos: [g({ concepto: 'caseta', monto: 1000, folio: 'C9', ocrConfianza: 0.5 })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'ocr_baja_confianza')).toBe(true);
    expect(r.estatus).toBe('revisar');
  });

  it('duplicado por UUID NO infla el total (fix del audit)', () => {
    const r = cuadrarViaje({
      viajeId: 'v5', anticipo: 2000, politica,
      gastos: [
        g({ concepto: 'diesel', monto: 2000, cfdiUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', folio: 'X1' }),
        g({ concepto: 'diesel', monto: 2000, cfdiUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', folio: 'X2' }),
      ],
    });
    expect(r.totalComprobado).toBe(2000); // NO 4000
    expect(r.diferencias.some((d) => d.tipo === 'duplicado')).toBe(true);
  });

  it('detecta RFC receptor distinto al de la empresa', () => {
    const r = cuadrarViaje({
      viajeId: 'v6', anticipo: 1000, politica, empresaRfc: 'EMP010101AAA',
      gastos: [g({ concepto: 'factura', monto: 1000, folio: 'F1', cfdiUuid: 'u', rfcReceptor: 'CHOFER800101XY1' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'rfc_receptor')).toBe(true);
    expect(r.estatus).toBe('revisar');
  });

  it('detecta CFDI cancelado ante el SAT', () => {
    const r = cuadrarViaje({
      viajeId: 'v7', anticipo: 1000, politica,
      gastos: [g({ concepto: 'factura', monto: 1000, folio: 'F2', cfdiUuid: 'u2', estadoSat: 'cancelado' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'cfdi_cancelado')).toBe(true);
  });

  it('SAT pendiente NO tumba: continúa como revisar', () => {
    const r = cuadrarViaje({
      viajeId: 'v8', anticipo: 1000, politica,
      gastos: [g({ concepto: 'factura', monto: 1000, folio: 'F3', cfdiUuid: 'u3', estadoSat: 'pendiente' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'cfdi_pendiente')).toBe(true);
    expect(r.estatus).toBe('revisar');
  });

  // 1.9: EFOS con código no concluyente → bandeja, NUNCA fraude.
  it('1.9: EFOS no concluyente → cfdi_efos_indeterminado (revisar, no fraude)', () => {
    const r = cuadrarViaje({
      viajeId: 'e1', anticipo: 1000, politica,
      gastos: [g({ concepto: 'factura', monto: 1000, cfdiUuid: 'u', estadoSat: 'vigente', efosRevisar: true })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'cfdi_efos_indeterminado')).toBe(true);
    expect(r.diferencias.some((d) => d.tipo === 'cfdi_efos')).toBe(false);
    expect(r.estatus).toBe('revisar');
  });

  // CR-3: un CFDI que el SAT NO reconoce (fabricado) no debe pasar como cuadrado.
  it('CR-3: CFDI no_encontrado se marca no deducible y manda a revisar', () => {
    const r = cuadrarViaje({
      viajeId: 'v9', anticipo: 1000, politica,
      gastos: [g({ concepto: 'factura', monto: 1000, folio: 'F4', cfdiUuid: 'u4', estadoSat: 'no_encontrado' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'cfdi_no_encontrado')).toBe(true);
    expect(r.estatus).toBe('revisar');
  });

  // ME-5: un monto ≤ 0 no debe reducir el total ni sesgar la diferencia.
  it('ME-5: monto negativo no reduce el total y se marca monto_invalido', () => {
    const r = cuadrarViaje({
      viajeId: 'v10', anticipo: 2000, politica,
      gastos: [
        g({ concepto: 'diesel', monto: 2000, folio: 'D2' }),
        g({ concepto: 'caseta', monto: -500, folio: 'C2' }), // OCR erróneo / nota de crédito
      ],
    });
    expect(r.totalComprobado).toBe(2000); // NO 1500
    expect(r.diferencia).toBe(0);
    expect(r.diferencias.some((d) => d.tipo === 'monto_invalido')).toBe(true);
    expect(r.estatus).toBe('revisar');
  });

  // AL-6: con el RFC genérico del SAT NO se valida el receptor (evita falsos positivos).
  it('AL-6: RFC de empresa genérico no marca facturas como no-deducibles', () => {
    const r = cuadrarViaje({
      viajeId: 'v11', anticipo: 1000, politica, empresaRfc: 'XAXX010101000',
      gastos: [g({ concepto: 'factura', monto: 1000, folio: 'F5', cfdiUuid: 'u5', rfcReceptor: 'CUALQUIER800101XY1' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'rfc_receptor')).toBe(false);
  });

  // AL-6 (contraparte): un RFC real SÍ valida el receptor.
  it('AL-6: RFC real de empresa sí valida el receptor', () => {
    const r = cuadrarViaje({
      viajeId: 'v12', anticipo: 1000, politica, empresaRfc: 'TIN950101ABC',
      gastos: [g({ concepto: 'factura', monto: 1000, folio: 'F6', cfdiUuid: 'u6', rfcReceptor: 'TIN950101ABC' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'rfc_receptor')).toBe(false); // coincide → OK
  });

  // ═══ Bloque 1: complemento de hidrocarburos (dos niveles) ═══
  const HC = { claves: ['15101505', '15101514', '15101515'], unidad: 'LTR', vigenteDesde: '2026-04-24' };

  // NIVEL 1: factura de combustible (con UUID) SIN XML → no verificable, a bandeja,
  // NUNCA no deducible.
  it('B1 NIVEL 1: combustible con UUID sin XML → complemento_no_verificable (no no-deducible)', () => {
    const r = cuadrarViaje({
      viajeId: 'h1', anticipo: 4200, politica, hidrocarburos: HC,
      gastos: [g({ concepto: 'diesel', monto: 4200, folio: 'D1', cfdiUuid: 'uuid-diesel', fecha: '2026-05-01' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'complemento_no_verificable')).toBe(true);
    expect(r.diferencias.some((d) => d.tipo === 'complemento_hidrocarburos')).toBe(false);
    expect(r.estatus).toBe('revisar');
  });

  // NIVEL 1: ticket de diésel SIN UUID (no es factura) → NO se marca complemento.
  it('B1 NIVEL 1: diésel sin UUID no dispara complemento (no es CFDI)', () => {
    const r = cuadrarViaje({
      viajeId: 'h2', anticipo: 3800, politica, hidrocarburos: HC,
      gastos: [g({ concepto: 'diesel', monto: 3800, folio: 'D2', fecha: '2026-05-01' })],
    });
    expect(r.diferencias.some((d) => d.tipo.startsWith('complemento'))).toBe(false);
  });

  // NIVEL 2: XML de combustible SIN el nodo del complemento → DURA, no deducible.
  it('B1 NIVEL 2: XML de combustible sin complemento → complemento_hidrocarburos (no deducible)', () => {
    const r = cuadrarViaje({
      viajeId: 'h3', anticipo: 4200, politica, hidrocarburos: HC,
      gastos: [g({ concepto: 'diesel', monto: 4200, cfdiUuid: 'u', fecha: '2026-05-01', xmlVerificado: true, claveProdServ: '15101505', claveUnidad: 'LTR', tipoComprobante: 'I', complementoHidrocarburos: false })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'complemento_hidrocarburos')).toBe(true);
    expect(r.diferencias.some((d) => d.tipo === 'complemento_no_verificable')).toBe(false);
    expect(r.estatus).toBe('revisar');
  });

  // NIVEL 2: XML CON el complemento → sin diferencia.
  it('B1 NIVEL 2: XML de combustible CON complemento → sin diferencia', () => {
    const r = cuadrarViaje({
      viajeId: 'h4', anticipo: 4200, politica, hidrocarburos: HC,
      gastos: [g({ concepto: 'diesel', monto: 4200, cfdiUuid: 'u', fecha: '2026-05-01', xmlVerificado: true, claveProdServ: '15101505', claveUnidad: 'LTR', tipoComprobante: 'I', complementoHidrocarburos: true })],
    });
    expect(r.diferencias.some((d) => d.tipo.startsWith('complemento'))).toBe(false);
  });

  // Vigencia: un CFDI ANTERIOR al 24-abr-2026 no exige complemento.
  it('B1 vigencia: CFDI antes del 24-abr-2026 no exige complemento', () => {
    const r = cuadrarViaje({
      viajeId: 'h5', anticipo: 4200, politica, hidrocarburos: HC,
      gastos: [g({ concepto: 'diesel', monto: 4200, cfdiUuid: 'u', fecha: '2026-03-01', xmlVerificado: true, claveProdServ: '15101505', claveUnidad: 'LTR', tipoComprobante: 'I', complementoHidrocarburos: false })],
    });
    expect(r.diferencias.some((d) => d.tipo.startsWith('complemento'))).toBe(false);
  });

  // Sin config de hidrocarburos, la regla NO corre (retrocompat).
  it('B1: sin config de hidrocarburos la regla no corre', () => {
    const r = cuadrarViaje({
      viajeId: 'h6', anticipo: 4200, politica,
      gastos: [g({ concepto: 'diesel', monto: 4200, cfdiUuid: 'u', fecha: '2026-05-01' })],
    });
    expect(r.diferencias.some((d) => d.tipo.startsWith('complemento'))).toBe(false);
  });

  // Verificación oficial: LTR NO es requisito de la regla → sin complemento, la
  // regla dura corre AUNQUE la unidad no sea LTR (evita falso negativo).
  it('B1 NIVEL 2: sin complemento aplica aunque la unidad no sea LTR', () => {
    const r = cuadrarViaje({
      viajeId: 'h7', anticipo: 4200, politica, hidrocarburos: HC,
      gastos: [g({ concepto: 'diesel', monto: 4200, cfdiUuid: 'u', fecha: '2026-05-01', xmlVerificado: true, claveProdServ: '15101505', claveUnidad: 'E48', tipoComprobante: 'I', complementoHidrocarburos: false })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'complemento_hidrocarburos')).toBe(true);
  });

  // Verificación oficial: ECC/Carta Porte quedan EXCLUIDOS de la regla 2.7.1.48.
  it('B1 NIVEL 2: esquema alterno (ECC/Carta Porte) NO dispara la regla', () => {
    const r = cuadrarViaje({
      viajeId: 'h8', anticipo: 4200, politica, hidrocarburos: HC,
      gastos: [g({ concepto: 'diesel', monto: 4200, cfdiUuid: 'u', fecha: '2026-05-01', xmlVerificado: true, claveProdServ: '15101505', claveUnidad: 'LTR', tipoComprobante: 'I', complementoHidrocarburos: false, cfdiEsquemaAlterno: true })],
    });
    expect(r.diferencias.some((d) => d.tipo.startsWith('complemento'))).toBe(false);
  });

  // ═══ NIVEL 1: acreditamiento fiscal ═══
  const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: ['15101505'] };

  it('7/9: IEPS y IVA acreditables de un CFDI de diésel deducible', () => {
    const r = cuadrarViaje({
      viajeId: 'a1', anticipo: 5000, politica, hidrocarburos: HC, estimulos: EST,
      gastos: [g({ concepto: 'diesel', monto: 5000, cfdiUuid: 'u', fecha: '2026-05-01', xmlVerificado: true, claveProdServ: '15101505', claveUnidad: 'LTR', tipoComprobante: 'I', complementoHidrocarburos: true, formaPago: '03', iepsTraslado: 900, ivaTraslado: 640 })],
    });
    expect(r.iepsAcreditable).toBe(900);
    expect(r.ivaAcreditable).toBe(640);
  });

  it('5: combustible en efectivo → no deducible NI acreditable', () => {
    const r = cuadrarViaje({
      viajeId: 'a2', anticipo: 5000, politica, hidrocarburos: HC, estimulos: EST,
      gastos: [g({ concepto: 'diesel', monto: 5000, cfdiUuid: 'u', fecha: '2026-05-01', xmlVerificado: true, claveProdServ: '15101505', claveUnidad: 'LTR', tipoComprobante: 'I', complementoHidrocarburos: true, formaPago: '01', iepsTraslado: 900, ivaTraslado: 640 })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'combustible_efectivo')).toBe(true);
    expect(r.iepsAcreditable).toBe(0); // bloqueado → no acredita
    expect(r.ivaAcreditable).toBe(0);
    expect(r.estatus).toBe('revisar');
  });

  it('1.6: peaje acreditable = 50% del SubTotal de casetas', () => {
    const r = cuadrarViaje({
      viajeId: 'a3', anticipo: 1160, politica, estimulos: EST,
      gastos: [g({ concepto: 'caseta', monto: 1160, cfdiUuid: 'u', xmlVerificado: true, formaPago: '04', subTotal: 1000, ivaTraslado: 160 })],
    });
    expect(r.peajeAcreditable).toBe(500); // 1000 * 0.5
    expect(r.ivaAcreditable).toBe(160);
  });

  // Ticket 5 (Cd. Juárez, franja fronteriza): IVA al 8%. El acreditable es el
  // importe LEÍDO del comprobante, NUNCA recomputado con 16%.
  it('IVA 8% fronterizo: se acredita el importe leído, no se recomputa al 16%', () => {
    const r = cuadrarViaje({
      viajeId: 'a7', anticipo: 200, politica, hidrocarburos: HC, estimulos: EST,
      gastos: [g({ concepto: 'diesel', monto: 200, cfdiUuid: 'u', fecha: '2026-05-01', xmlVerificado: true,
        claveProdServ: '15101505', claveUnidad: 'LTR', tipoComprobante: 'I', complementoHidrocarburos: true,
        formaPago: '03', subTotal: 185.65, ivaTraslado: 14.35, iepsTraslado: 120.00 })],
    });
    expect(r.ivaAcreditable).toBe(14.35);  // leído (8%), NO 29.70 (16%)
    expect(r.iepsAcreditable).toBe(120.00);
  });

  // La GASOLINA no tiene el estímulo de IEPS (solo diésel, LIF Art. 20-A fr. IV).
  it('gasolina (15101514) con IEPS desglosado NO acredita IEPS (solo diésel)', () => {
    const r = cuadrarViaje({
      viajeId: 'a9', anticipo: 500, politica, hidrocarburos: HC, estimulos: EST,
      gastos: [g({ concepto: 'diesel', monto: 500, cfdiUuid: 'u', fecha: '2026-05-01', xmlVerificado: true,
        claveProdServ: '15101514', claveUnidad: 'LTR', tipoComprobante: 'I', complementoHidrocarburos: true,
        formaPago: '04', iepsTraslado: 90, ivaTraslado: 65 })],
    });
    expect(r.iepsAcreditable).toBe(0);   // gasolina → sin estímulo IEPS
    expect(r.ivaAcreditable).toBe(65);   // el IVA sí es acreditable
    expect(r.diferencias.some((d) => d.tipo === 'ieps_no_desglosado')).toBe(false);
  });

  // Un ticket sin factura (sin xmlVerificado) NO acredita, aunque traiga montos.
  it('ticket sin CFDI verificado no acredita (necesita timbrarse)', () => {
    const r = cuadrarViaje({
      viajeId: 'a8', anticipo: 400, politica, hidrocarburos: HC, estimulos: EST,
      gastos: [g({ concepto: 'diesel', monto: 400, folio: 'T1', subTotal: 345, ivaTraslado: 55, formaPago: '04' })],
    });
    expect(r.ivaAcreditable).toBe(0);
    expect(r.iepsAcreditable).toBe(0);
  });

  it('7: diésel con XML pero SIN IEPS desglosado → ieps_no_desglosado', () => {
    const r = cuadrarViaje({
      viajeId: 'a4', anticipo: 4000, politica, hidrocarburos: HC, estimulos: EST,
      gastos: [g({ concepto: 'diesel', monto: 4000, cfdiUuid: 'u', fecha: '2026-05-01', xmlVerificado: true, claveProdServ: '15101505', claveUnidad: 'LTR', tipoComprobante: 'I', complementoHidrocarburos: true, formaPago: '03', iepsTraslado: 0 })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'ieps_no_desglosado')).toBe(true);
    expect(r.iepsAcreditable).toBe(0);
  });

  it('6: gasto no-combustible en efectivo > $2,000 → no deducible', () => {
    const r = cuadrarViaje({
      viajeId: 'a5', anticipo: 2500, politica: [], estimulos: EST,
      gastos: [g({ concepto: 'otro', monto: 2500, formaPago: '01' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'efectivo_sobre_tope')).toBe(true);
  });

  it('1.10: viático > tope fiscal $750/día → excedente no deducible', () => {
    const r = cuadrarViaje({
      viajeId: 'a6', anticipo: 900, politica, estimulos: EST,
      gastos: [g({ concepto: 'viaticos', monto: 900, folio: 'V1' })],
    });
    const d = r.diferencias.find((x) => x.tipo === 'viatico_excede_fiscal');
    expect(d).toBeTruthy();
    expect(d!.monto).toBe(150); // 900 - 750
  });
});
