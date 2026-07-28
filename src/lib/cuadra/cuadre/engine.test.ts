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

  it('5: combustible en efectivo NO acredita IEPS/IVA', () => {
    // La facilidad del 15% (RFA 2026 regla 2.9) salva la DEDUCCIÓN de ISR, pero NO
    // habilita el acreditamiento del IEPS. Son dos beneficios distintos, y el
    // efectivo solo conserva uno: el acreditamiento sigue bloqueado.
    const r = cuadrarViaje({
      viajeId: 'a2', anticipo: 5000, politica, hidrocarburos: HC, estimulos: EST,
      gastos: [g({ concepto: 'diesel', monto: 5000, cfdiUuid: 'u', fecha: '2026-05-01', xmlVerificado: true, claveProdServ: '15101505', claveUnidad: 'LTR', tipoComprobante: 'I', complementoHidrocarburos: true, formaPago: '01', iepsTraslado: 900, ivaTraslado: 640 })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'combustible_efectivo')).toBe(true);
    expect(r.iepsAcreditable).toBe(0);
    expect(r.ivaAcreditable).toBe(0);
    expect(r.estatus).toBe('revisar'); // sí se revisa: hay que contarlo contra el 15%
  });

  it('5b: el aviso de combustible en efectivo NO afirma que sea no deducible', () => {
    // Decía "no deducible" a secas. Para el autotransporte de carga federal es
    // FALSO: la RFA 2026 regla 2.9 lo tiene por deducible hasta el 15% del total
    // pagado por combustible en el ejercicio. Un motor que lo declare no deducible
    // le está quitando dinero real a la flota.
    const r = cuadrarViaje({
      viajeId: 'a2b', anticipo: 5000, politica, hidrocarburos: HC, estimulos: EST,
      gastos: [g({ concepto: 'diesel', monto: 5000, cfdiUuid: 'u', fecha: '2026-05-01', xmlVerificado: true, claveProdServ: '15101505', claveUnidad: 'LTR', tipoComprobante: 'I', complementoHidrocarburos: true, formaPago: '01' })],
    });
    const nota = r.diferencias.find((d) => d.tipo === 'combustible_efectivo')!.nota;
    expect(nota).not.toMatch(/no deducible/i);
    expect(nota).toMatch(/15\s*%/);      // dice contra qué se compara
    expect(nota).toMatch(/2\.9/);        // y con qué fundamento
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

  // #1: validación de cordura de la fecha (periodo fiscal / plazo / complemento).
  it('#1 fecha muy anterior al viaje → fecha_sospechosa (bandeja)', () => {
    const r = cuadrarViaje({
      viajeId: 'f1', anticipo: 1000, politica, fechaMin: '2026-07-01', fechaMax: '2026-07-25',
      gastos: [g({ concepto: 'caseta', monto: 1000, folio: 'C1', fecha: '2026-05-15' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'fecha_sospechosa')).toBe(true);
    expect(r.estatus).toBe('revisar');
  });

  it('#1 fecha FUTURA → fecha_sospechosa (caso del mes mal leído del ticket 4)', () => {
    const r = cuadrarViaje({
      viajeId: 'f2', anticipo: 1000, politica, fechaMin: '2026-07-01', fechaMax: '2026-07-25',
      gastos: [g({ concepto: 'caseta', monto: 1000, folio: 'C1', fecha: '2026-09-15' })], // futura
    });
    expect(r.diferencias.some((d) => d.tipo === 'fecha_sospechosa')).toBe(true);
  });

  it('#1 fecha dentro de rango NO dispara', () => {
    const r = cuadrarViaje({
      viajeId: 'f3', anticipo: 1000, politica, fechaMin: '2026-07-01', fechaMax: '2026-07-25',
      gastos: [g({ concepto: 'caseta', monto: 1000, folio: 'C1', fecha: '2026-07-10' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'fecha_sospechosa')).toBe(false);
  });

  // #3: folio de combustible con baja confianza (ticket 3 borroso) → avisar, no bloquear.
  it('#3 folio_verificar: folio de combustible con baja confianza avisa', () => {
    const r = cuadrarViaje({
      viajeId: 'f4', anticipo: 1000, politica,
      gastos: [g({ concepto: 'diesel', monto: 1000, folio: '841067', ocrConfianza: 0.6 })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'folio_verificar')).toBe(true);
  });

  // Bonus 0.6: CFDI real de FERRETERÍA (no combustible, tarjeta, IVA 16% exacto,
  // tipo I). El motor NO acredita IEPS donde no aplica, no marca falsos positivos.
  it('0.6 ferretería: no-combustible con IVA 16% → IVA acredita, IEPS no, sin falsos positivos', () => {
    const r = cuadrarViaje({
      viajeId: 'fer1', anticipo: 114.82, politica, hidrocarburos: HC, estimulos: EST,
      gastos: [g({ concepto: 'factura', monto: 114.82, cfdiUuid: '38a50290-59f1-4a48-b886-0a31f938837c', fecha: '2026-05-01', xmlVerificado: true, claveProdServ: '31162800', claveUnidad: 'H87', tipoComprobante: 'I', formaPago: '04', subTotal: 98.98, ivaTraslado: 15.84, estadoSat: 'vigente', efos: false })],
    });
    expect(r.iepsAcreditable).toBe(0);       // NO combustible → sin estímulo de IEPS
    expect(r.ivaAcreditable).toBe(15.84);    // IVA sí es acreditable
    expect(r.diferencias.some((d) => d.tipo.startsWith('complemento'))).toBe(false);
    expect(r.diferencias.some((d) => d.tipo === 'combustible_efectivo' || d.tipo === 'ieps_no_desglosado')).toBe(false);
    expect(r.estatus).toBe('cuadrada');       // anticipo = comprobado, sin diferencias
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

  it('7b: el IEPS sin desglosar NO manda la liquidación a revisar', () => {
    // El gasto SÍ es deducible: lo único que se pierde es el acreditamiento del
    // estímulo. Mandarlo a `revisar` tumbaba TODA liquidación con diésel —y casi
    // ningún CFDI de gasolinera desglosa el IEPS al consumidor final—, con lo que
    // la bandeja de excepciones dejaba de significar algo.
    const r = cuadrarViaje({
      viajeId: 'a4b', anticipo: 4000, politica, hidrocarburos: HC, estimulos: EST,
      gastos: [g({ concepto: 'diesel', monto: 4000, cfdiUuid: 'u', fecha: '2026-05-01', xmlVerificado: true, claveProdServ: '15101505', claveUnidad: 'LTR', tipoComprobante: 'I', complementoHidrocarburos: true, formaPago: '03', iepsTraslado: 0 })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'ieps_no_desglosado')).toBe(true); // se sigue avisando
    expect(r.estatus).not.toBe('revisar');                                         // pero no manda a la bandeja
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

// ═══════════════════════════════════════════════════════════════════════════
// TOTALES DE DEDUCIBILIDAD — la cifra que el contralor de verdad compra.
//
// El motor ya detectaba todo lo necesario y NO lo sumaba: el contralor tenía que
// leer la lista de diferencias y hacer la cuenta a mano. Son tres cubetas, no
// dos, porque el combustible en efectivo NO cae en ninguna de las dos clásicas:
// es deducible hasta el 15% del ejercicio (RFA 2026 regla 2.9) y ese contador
// todavía no existe. Meterlo en "no deducible" le quita dinero al cliente;
// meterlo en "deducible" le promete algo que quizá no tenga.
// ═══════════════════════════════════════════════════════════════════════════
describe('cuadrarViaje — totales de deducibilidad', () => {
  const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: ['15101505'] };

  it('todo limpio → todo deducible', () => {
    const r = cuadrarViaje({
      viajeId: 't1', anticipo: 3000, politica, estimulos: EST,
      gastos: [g({ concepto: 'diesel', monto: 2000, folio: 'A1', formaPago: '04' }), g({ concepto: 'caseta', monto: 1000, folio: 'C1', formaPago: '04' })],
    });
    expect(r.totalDeducible).toBe(3000);
    expect(r.totalNoDeducible).toBe(0);
    expect(r.totalPorConfirmar).toBe(0);
  });

  it('un CFDI cancelado se va entero a no deducible', () => {
    const r = cuadrarViaje({
      viajeId: 't2', anticipo: 3000, politica, estimulos: EST,
      gastos: [
        g({ concepto: 'caseta', monto: 1000, folio: 'C1', formaPago: '04' }),
        g({ concepto: 'factura', monto: 2000, cfdiUuid: 'u1', estadoSat: 'cancelado', formaPago: '04' }),
      ],
    });
    expect(r.totalNoDeducible).toBe(2000);
    expect(r.totalDeducible).toBe(1000);
  });

  it('del viático solo el EXCEDENTE es no deducible, no el gasto entero', () => {
    // LISR 28-V topa la alimentación en $750/día. Un viático de $900 no se pierde
    // completo: se pierden $150. Mandar los $900 a no deducible es el error que
    // más dinero le cuesta al cliente en esta lista.
    const r = cuadrarViaje({
      viajeId: 't3', anticipo: 900, politica: [], estimulos: EST,
      gastos: [g({ concepto: 'viaticos', monto: 900, folio: 'V1', formaPago: '04' })],
    });
    expect(r.totalNoDeducible).toBe(150);
    expect(r.totalDeducible).toBe(750);
  });

  it('el combustible en efectivo va a POR CONFIRMAR, ni deducible ni perdido', () => {
    const r = cuadrarViaje({
      viajeId: 't4', anticipo: 1500, politica, estimulos: EST,
      gastos: [g({ concepto: 'diesel', monto: 1500, folio: 'D1', formaPago: '01' })],
    });
    expect(r.totalPorConfirmar).toBe(1500);
    expect(r.totalNoDeducible).toBe(0);
    expect(r.totalDeducible).toBe(0);
  });

  it('un gasto no-combustible en efectivo sobre el tope SÍ es no deducible', () => {
    // Aquí no hay facilidad que valga: LISR 27-III sin excepción para el sector.
    const r = cuadrarViaje({
      viajeId: 't5', anticipo: 2500, politica: [], estimulos: EST,
      gastos: [g({ concepto: 'otro', monto: 2500, folio: 'O1', formaPago: '01' })],
    });
    expect(r.totalNoDeducible).toBe(2500);
    expect(r.totalPorConfirmar).toBe(0);
  });

  it('las tres cubetas SIEMPRE suman el total comprobado', () => {
    // La invariante que hace confiable la cifra: si no cuadra, el contralor lo
    // nota con una calculadora y pierde la confianza en todo lo demás.
    const r = cuadrarViaje({
      viajeId: 't6', anticipo: 9000, politica, estimulos: EST,
      gastos: [
        g({ concepto: 'diesel', monto: 2000, folio: 'D1', formaPago: '04' }),
        g({ concepto: 'diesel', monto: 1500, folio: 'D2', formaPago: '01' }),         // por confirmar
        g({ concepto: 'viaticos', monto: 900, folio: 'V1', formaPago: '04' }),        // 150 fuera
        g({ concepto: 'factura', monto: 2000, cfdiUuid: 'u1', estadoSat: 'cancelado', formaPago: '04' }),
        g({ concepto: 'caseta', monto: 1000, folio: 'C1', formaPago: '04' }),
      ],
    });
    const suma = r.totalDeducible + r.totalNoDeducible + r.totalPorConfirmar;
    expect(suma).toBeCloseTo(r.totalComprobado, 2);
  });

  it('un duplicado no cuenta en ninguna cubeta', () => {
    const r = cuadrarViaje({
      viajeId: 't7', anticipo: 2000, politica, estimulos: EST,
      gastos: [
        g({ concepto: 'caseta', monto: 1000, cfdiUuid: 'dup', formaPago: '04' }),
        g({ concepto: 'caseta', monto: 1000, cfdiUuid: 'dup', formaPago: '04' }),
      ],
    });
    expect(r.totalComprobado).toBe(1000);
    expect(r.totalDeducible + r.totalNoDeducible + r.totalPorConfirmar).toBe(1000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// VIÁTICOS: el tope de $750 es SOLO de alimentación, y es POR DÍA.
//
// LISR 28-V topa la alimentación nacional en $750 por día y por beneficiario.
// Antes el motor lo aplicaba (a) a todo lo etiquetado "viaticos", incluido el
// hospedaje —que NO tiene tope nacional—, y (b) por COMPROBANTE, así que tres
// comidas de $400 el mismo día pasaban limpias mientras una sola de $800 se
// marcaba. Las dos cosas dan cifras falsas al contralor.
// ═══════════════════════════════════════════════════════════════════════════
describe('cuadrarViaje — tope de viáticos', () => {
  const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: ['15101505'] };

  it('el hospedaje NO tiene tope nacional: $2,000 pasa limpio', () => {
    const r = cuadrarViaje({
      viajeId: 'w1', anticipo: 2000, politica: [], estimulos: EST,
      gastos: [g({ concepto: 'hospedaje', monto: 2000, fecha: '2026-05-01', formaPago: '04' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'viatico_excede_fiscal')).toBe(false);
    expect(r.totalNoDeducible).toBe(0);
  });

  it('la alimentación sí: $900 en un día marca $150', () => {
    const r = cuadrarViaje({
      viajeId: 'w2', anticipo: 900, politica: [], estimulos: EST,
      gastos: [g({ concepto: 'alimentacion', monto: 900, fecha: '2026-05-01', formaPago: '04' })],
    });
    const d = r.diferencias.find((x) => x.tipo === 'viatico_excede_fiscal')!;
    expect(d.monto).toBe(150);
  });

  it('el tope es POR DÍA, no por comprobante: tres comidas de $400 el mismo día exceden', () => {
    // Es el hueco que dejaba pasar el gasto real: partir la cuenta en tres
    // tickets del mismo día burlaba un tope aplicado comprobante por comprobante.
    const r = cuadrarViaje({
      viajeId: 'w3', anticipo: 1200, politica: [], estimulos: EST,
      gastos: [
        g({ concepto: 'alimentacion', monto: 400, fecha: '2026-05-01', formaPago: '04' }),
        g({ concepto: 'alimentacion', monto: 400, fecha: '2026-05-01', formaPago: '04' }),
        g({ concepto: 'alimentacion', monto: 400, fecha: '2026-05-01', formaPago: '04' }),
      ],
    });
    const total = r.diferencias.filter((x) => x.tipo === 'viatico_excede_fiscal').reduce((s, x) => s + (x.monto ?? 0), 0);
    expect(total).toBe(450); // 1200 - 750
  });

  it('comidas de días distintos NO se suman entre sí', () => {
    const r = cuadrarViaje({
      viajeId: 'w4', anticipo: 1200, politica: [], estimulos: EST,
      gastos: [
        g({ concepto: 'alimentacion', monto: 600, fecha: '2026-05-01', formaPago: '04' }),
        g({ concepto: 'alimentacion', monto: 600, fecha: '2026-05-02', formaPago: '04' }),
      ],
    });
    expect(r.diferencias.some((x) => x.tipo === 'viatico_excede_fiscal')).toBe(false);
  });

  it('"viaticos" a secas sigue topado: es lo que emitía el OCR viejo', () => {
    // Compatibilidad: los gastos ya guardados con el concepto genérico no se
    // pueden reclasificar solos. Se mantiene el criterio conservador.
    const r = cuadrarViaje({
      viajeId: 'w5', anticipo: 900, politica: [], estimulos: EST,
      gastos: [g({ concepto: 'viaticos', monto: 900, fecha: '2026-05-01', formaPago: '04' })],
    });
    expect(r.diferencias.some((x) => x.tipo === 'viatico_excede_fiscal')).toBe(true);
  });

  it('el transporte del operador no lleva tope de alimentación', () => {
    const r = cuadrarViaje({
      viajeId: 'w6', anticipo: 1500, politica: [], estimulos: EST,
      gastos: [g({ concepto: 'transporte', monto: 1500, fecha: '2026-05-01', formaPago: '04' })],
    });
    expect(r.diferencias.some((x) => x.tipo === 'viatico_excede_fiscal')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL TICKET QUE SE VA A QUEDAR SIN FACTURA.
//
// Un ticket de gasolinera NO es factura: hay que timbrarlo en el portal del
// emisor, y ese portal cierra su ventana. Si nadie lo hace a tiempo, el gasto
// deja de ser deducible — el dinero ya salió y el IVA se pierde.
//
// Se avisa con la regla GENERAL (dentro del mes natural de la operación), que
// es la documentada. Los plazos por cadena (5-15 días) siguen SIN VERIFICAR y
// por eso no se afirman: se dice que la ventana del comercio puede ser menor.
// ═══════════════════════════════════════════════════════════════════════════
describe('cuadrarViaje — aviso de ticket por facturar', () => {
  const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: ['15101505'] };
  const conPortal = (over: Partial<Gasto> = {}) => g({
    concepto: 'diesel', monto: 1000, folio: 'T1', formaPago: '04',
    ocrExtra: { urlFacturacion: 'https://facturacion.oxxogas.com/' }, ...over,
  });

  it('avisa cuando el mes está por cerrarse', () => {
    const r = cuadrarViaje({
      viajeId: 'p1', anticipo: 1000, politica: [], estimulos: EST, hoy: '2026-05-30',
      gastos: [conPortal({ fecha: '2026-05-02' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'factura_por_vencer')).toBe(true);
  });

  it('no molesta a principio de mes', () => {
    const r = cuadrarViaje({
      viajeId: 'p2', anticipo: 1000, politica: [], estimulos: EST, hoy: '2026-05-05',
      gastos: [conPortal({ fecha: '2026-05-02' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'factura_por_vencer')).toBe(false);
  });

  it('si ya se timbró, no hay nada que avisar', () => {
    const r = cuadrarViaje({
      viajeId: 'p3', anticipo: 1000, politica: [], estimulos: EST, hoy: '2026-05-30',
      gastos: [conPortal({ fecha: '2026-05-02', cfdiUuid: 'ya-timbrado' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'factura_por_vencer')).toBe(false);
  });

  it('sin liga de portal no aplica: no todo ticket se factura en línea', () => {
    const r = cuadrarViaje({
      viajeId: 'p4', anticipo: 1000, politica: [], estimulos: EST, hoy: '2026-05-30',
      gastos: [g({ concepto: 'diesel', monto: 1000, folio: 'T2', fecha: '2026-05-02', formaPago: '04' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'factura_por_vencer')).toBe(false);
  });

  it('sin fecha confiable NO se afirma un plazo', () => {
    // El OCR ya devolvió 2023 en un ticket de 2026. Decirle a alguien "te
    // quedan 2 días" con una fecha inventada es peor que no decir nada.
    const r = cuadrarViaje({
      viajeId: 'p5', anticipo: 1000, politica: [], estimulos: EST, hoy: '2026-05-30',
      gastos: [conPortal({ fecha: undefined })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'factura_por_vencer')).toBe(false);
  });

  it('el aviso NO afirma un plazo por comercio: dice que puede ser menor', () => {
    const r = cuadrarViaje({
      viajeId: 'p6', anticipo: 1000, politica: [], estimulos: EST, hoy: '2026-05-30',
      gastos: [conPortal({ fecha: '2026-05-02' })],
    });
    const nota = r.diferencias.find((d) => d.tipo === 'factura_por_vencer')!.nota;
    expect(nota).toMatch(/puede ser menor|antes/i);
    expect(nota).not.toMatch(/\b(5|7|15) días\b/); // no inventa el plazo de la cadena
  });

  it('sin `hoy` la regla no corre: no se asume la fecha del servidor', () => {
    const r = cuadrarViaje({
      viajeId: 'p7', anticipo: 1000, politica: [], estimulos: EST,
      gastos: [conPortal({ fecha: '2026-05-02' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'factura_por_vencer')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// H1 y RLISR 57 — las dos reglas que le quitaban deducciones legítimas.
// ═══════════════════════════════════════════════════════════════════════════
describe('cuadrarViaje — soporte de la alimentación (LISR 28-V) y RFC del viático (RLISR 57)', () => {
  const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: ['15101505'] };

  it('H1: alimentación sin hospedaje ni transporte en el viaje se marca', () => {
    // LISR 28-V: el tope de $750 procede "y el contribuyente acompañe el comprobante
    // fiscal... que ampare el hospedaje o transporte". Una comida sola no lo cumple.
    const r = cuadrarViaje({
      viajeId: 'h1a', anticipo: 400, politica: [], estimulos: EST,
      gastos: [g({ concepto: 'alimentacion', monto: 400, fecha: '2026-05-01', formaPago: '04' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'alimentacion_sin_soporte')).toBe(true);
  });

  it('H1: con hospedaje en el viaje, la alimentación queda soportada', () => {
    const r = cuadrarViaje({
      viajeId: 'h1b', anticipo: 1400, politica: [], estimulos: EST,
      gastos: [
        g({ concepto: 'alimentacion', monto: 400, fecha: '2026-05-01', formaPago: '04' }),
        g({ concepto: 'hospedaje', monto: 1000, fecha: '2026-05-01', formaPago: '04' }),
      ],
    });
    expect(r.diferencias.some((d) => d.tipo === 'alimentacion_sin_soporte')).toBe(false);
  });

  it('H1: el transporte también sirve de soporte', () => {
    const r = cuadrarViaje({
      viajeId: 'h1c', anticipo: 700, politica: [], estimulos: EST,
      gastos: [
        g({ concepto: 'alimentacion', monto: 400, fecha: '2026-05-01', formaPago: '04' }),
        g({ concepto: 'transporte', monto: 300, fecha: '2026-05-01', formaPago: '04' }),
      ],
    });
    expect(r.diferencias.some((d) => d.tipo === 'alimentacion_sin_soporte')).toBe(false);
  });

  it('H1: se marca para revisión, NO se declara no deducible', () => {
    // No vemos toda la contabilidad de la flota: el comprobante de hospedaje puede
    // existir fuera de esta liquidación. Declararlo no deducible sería el mismo
    // error al revés — quitarle una deducción que quizá sí tiene.
    const r = cuadrarViaje({
      viajeId: 'h1d', anticipo: 400, politica: [], estimulos: EST,
      gastos: [g({ concepto: 'alimentacion', monto: 400, fecha: '2026-05-01', formaPago: '04' })],
    });
    expect(r.estatus).toBe('revisar');
    expect(r.totalNoDeducible).toBe(0);
    expect(r.totalDeducible).toBe(400);
  });

  it('RLISR 57: el viático a nombre del OPERADOR es válido', () => {
    // "Si benefician a personas que le prestan servicios personales subordinados,
    // los comprobantes fiscales podrán ser expedidos a nombre de dichas personas."
    const r = cuadrarViaje({
      viajeId: 'r57a', anticipo: 1000, politica: [], estimulos: EST,
      empresaRfc: 'TIN950101ABC', operadorRfc: 'PEJJ800101XY1',
      gastos: [g({ concepto: 'hospedaje', monto: 1000, fecha: '2026-05-01', formaPago: '04', cfdiUuid: 'u', rfcReceptor: 'PEJJ800101XY1' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'rfc_receptor')).toBe(false);
    expect(r.totalNoDeducible).toBe(0);
  });

  it('RLISR 57: sin saber el RFC del operador, se REVISA en vez de rechazar', () => {
    const r = cuadrarViaje({
      viajeId: 'r57b', anticipo: 1000, politica: [], estimulos: EST,
      empresaRfc: 'TIN950101ABC',
      gastos: [g({ concepto: 'hospedaje', monto: 1000, fecha: '2026-05-01', formaPago: '04', cfdiUuid: 'u', rfcReceptor: 'PEJJ800101XY1' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'rfc_receptor')).toBe(false);
    expect(r.diferencias.some((d) => d.tipo === 'viatico_rfc_operador')).toBe(true);
    expect(r.totalNoDeducible).toBe(0); // NO se le quita la deducción
  });

  it('RLISR 57 NO cubre el diésel: ese sí debe ir a nombre de la empresa', () => {
    // El reglamento habla de VIÁTICOS. Una factura de combustible a nombre del
    // chofer sigue siendo un problema.
    const r = cuadrarViaje({
      viajeId: 'r57c', anticipo: 2000, politica: [], estimulos: EST,
      empresaRfc: 'TIN950101ABC', operadorRfc: 'PEJJ800101XY1',
      gastos: [g({ concepto: 'diesel', monto: 2000, formaPago: '04', cfdiUuid: 'u', rfcReceptor: 'PEJJ800101XY1' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'rfc_receptor')).toBe(true);
    expect(r.totalNoDeducible).toBe(2000);
  });

  it('un viático a un RFC que no es ni la empresa ni el operador SÍ se rechaza', () => {
    const r = cuadrarViaje({
      viajeId: 'r57d', anticipo: 1000, politica: [], estimulos: EST,
      empresaRfc: 'TIN950101ABC', operadorRfc: 'PEJJ800101XY1',
      gastos: [g({ concepto: 'hospedaje', monto: 1000, formaPago: '04', cfdiUuid: 'u', rfcReceptor: 'OTRO900101ZZ9' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'rfc_receptor')).toBe(true);
  });
});
