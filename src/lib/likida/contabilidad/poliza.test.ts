// ═══════════════════════════════════════════════════════════════════════════
// La póliza: que cuadre, que no invente cuentas, y que diga qué falta.
//
// Lo que más importa probar aquí no es el camino feliz sino los dos frenos:
// sin catálogo NO sale una póliza con cuentas plausibles, y un asiento que no
// cuadra NO se exporta. Las dos cosas fallan tarde y caro si se dejan pasar:
// una cuenta equivocada se descubre en la auditoría del año siguiente, y un
// descuadre lo rastrea el contador a ciegas.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { polizaDeLiquidacion, type CatalogoContable, type LiquidacionParaPoliza } from './poliza';
import { aContpaqi, aSapB1, archivoContpaqi, archivoSapB1, SAP_B1_BASE } from './formatos';

const CATALOGO: CatalogoContable = {
  gastos: { diesel: '5010-001', caseta: '5010-002', alimentacion: '5010-003' },
  ivaAcreditable: '1180-001',
  anticipoOperador: '1190-001',
  porCobrarOperador: '1190-002',
  porPagarOperador: '2010-001',
};

/** Anticipo 5,000; comprobado 4,000 + 640 de IVA; devuelve 360. */
const LIQ: LiquidacionParaPoliza = {
  folioViaje: 'VJ-2026-0007',
  operador: 'Juan Pérez',
  fecha: '2026-08-20',
  anticipo: 5000,
  porConcepto: [
    { concepto: 'diesel', subtotal: 3000 },
    { concepto: 'caseta', subtotal: 1000 },
  ],
  ivaAcreditable: 640,
  diferencia: 360, // 5000 − 4640
};

describe('la póliza cuadra o no sale', () => {
  it('el asiento completo cuadra al centavo', () => {
    const r = polizaDeLiquidacion(LIQ, CATALOGO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cargos = r.poliza.movimientos.reduce((s, m) => s + m.cargo, 0);
    const abonos = r.poliza.movimientos.reduce((s, m) => s + m.abono, 0);
    expect(cargos).toBeCloseTo(abonos, 2);
    expect(cargos).toBeCloseTo(5000, 2);
  });

  it('un asiento que NO cuadra se NIEGA, no se exporta con aviso', () => {
    // La diferencia declarada no corresponde a los comprobantes: el asiento
    // quedaría descuadrado.
    const roto = { ...LIQ, diferencia: 99 };
    const r = polizaDeLiquidacion(roto, CATALOGO);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.falta.join(' ')).toContain('no cuadra');
  });

  it('el operador que puso de su bolsa genera un ABONO a por-pagar', () => {
    const debe = { ...LIQ, anticipo: 4000, diferencia: -640 };
    const r = polizaDeLiquidacion(debe, CATALOGO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = r.poliza.movimientos.find((x) => x.cuenta === '2010-001');
    expect(m?.abono).toBeCloseTo(640, 2);
    expect(m?.cargo).toBe(0);
  });
});

describe('ninguna cuenta se inventa', () => {
  it('sin cuenta para un concepto, dice CUÁL falta y no exporta', () => {
    const sinCaseta: CatalogoContable = { ...CATALOGO, gastos: { diesel: '5010-001' } };
    const r = polizaDeLiquidacion(LIQ, sinCaseta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.falta.some((f) => f.includes('caseta'))).toBe(true);
  });

  it('sin cuenta de IVA lo dice, aunque las de gasto estén', () => {
    const sinIva: CatalogoContable = { ...CATALOGO, ivaAcreditable: undefined };
    const r = polizaDeLiquidacion(LIQ, sinIva);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.falta.some((f) => f.includes('IVA'))).toBe(true);
  });

  it('reporta TODO lo que falta de una vez, no de uno en uno', () => {
    const r = polizaDeLiquidacion(LIQ, { gastos: {} });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // diesel, caseta, IVA y anticipo: cuatro huecos en una sola respuesta.
    expect(r.falta.length).toBeGreaterThanOrEqual(4);
  });

  it('un concepto con subtotal 0 no exige cuenta: no hay nada que asentar', () => {
    const conCero = {
      ...LIQ,
      porConcepto: [...LIQ.porConcepto, { concepto: 'hospedaje' as const, subtotal: 0 }],
    };
    expect(polizaDeLiquidacion(conCero, CATALOGO).ok).toBe(true);
  });
});

describe('los formatos que la landing nombra', () => {
  const poliza = (() => {
    const r = polizaDeLiquidacion(LIQ, CATALOGO);
    if (!r.ok) throw new Error('la póliza de prueba debería cuadrar');
    return r.poliza;
  })();

  it('CONTPAQi: una línea por movimiento, con 0 para cargo y 1 para abono', () => {
    const txt = aContpaqi(poliza, { tipo: 'Dr', numero: 42 });
    const filas = txt.trim().split('\n');
    expect(filas[0]).toContain('TipoMovimiento');
    expect(filas).toHaveLength(1 + poliza.movimientos.length);
    // El cargo a diésel: tipo 0.
    const diesel = filas.find((f) => f.includes('5010-001'));
    expect(diesel).toContain(',0,3000.00,');
    // El abono al anticipo: tipo 1.
    const anticipo = filas.find((f) => f.includes('1190-001'));
    expect(anticipo).toContain(',1,5000.00,');
  });

  it('CONTPAQi: la fecha va en DD/MM/AAAA, no en ISO', () => {
    expect(aContpaqi(poliza, { tipo: 'Dr', numero: 1 })).toContain('20/08/2026');
  });

  it('CONTPAQi: un periodo lleva UN encabezado, nunca uno por póliza', () => {
    const txt = archivoContpaqi([poliza, poliza], { tipo: 'Dr', numeroInicial: 20 });
    expect(txt.match(/TipoMovimiento/g)).toHaveLength(1);
    expect(txt.trim().split('\n')).toHaveLength(1 + poliza.movimientos.length * 2);
  });

  it('SAP B1: dos archivos ligados por JdtNum, con DOBLE encabezado técnico', () => {
    const { cabecera, lineas } = aSapB1(poliza, 7);
    const filasCab = cabecera.trim().split('\n');
    const filasLin = lineas.trim().split('\n');
    // El doble encabezado del DTW: omitir el segundo se come el primer
    // registro real, y es el error más común al armar estos archivos a mano.
    expect(filasCab[0]).toBe(filasCab[1]);
    expect(filasLin[0]).toBe(filasLin[1]);
    expect(filasCab).toHaveLength(3);
    expect(filasLin).toHaveLength(2 + poliza.movimientos.length);
    // La llave técnica que une los dos archivos.
    expect(filasCab[2].startsWith('7\t')).toBe(true);
    expect(filasLin[2].startsWith('7\t')).toBe(true);
    expect(filasCab[0]).toContain('JdtNum');
    expect(filasLin[0]).toContain('Line_ID');
  });

  it('SAP B1: cada renglón trae Debit y Credit, uno de los dos en 0.00', () => {
    const { lineas } = aSapB1(poliza);
    for (const fila of lineas.trim().split('\n').slice(2)) {
      const [, , , debit, credit] = fila.split('\t');
      expect(Number(debit) === 0 || Number(credit) === 0).toBe(true);
      expect(Number(debit) + Number(credit)).toBeGreaterThan(0);
    }
  });

  it('SAP B1: varias pólizas conservan un único doble encabezado por archivo', () => {
    const { cabecera, lineas } = archivoSapB1([poliza, poliza], SAP_B1_BASE);
    expect(cabecera.trim().split('\n')).toHaveLength(4);
    expect(lineas.trim().split('\n')).toHaveLength(2 + poliza.movimientos.length * 2);
  });
});
