import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { filasAcreditables, BASE_ESTIMULO_PEAJE, CONDICIONES_ESTIMULO_PEAJE } from './acreditable';
import { cuadrarViaje } from '../cuadre/engine';

// ═══════════════════════════════════════════════════════════════════════════
// EL ESTÍMULO DE PEAJE SE IMPRIMÍA COMO UN DERECHO YA GANADO.
//
// Caseta timbrada de $1,160 (SubTotal $1,000 + IVA $160) → el motor devuelve
// `peajeAcreditable = 500` y el PDF imprimía, en VERDE y en negritas:
//
//     Estímulo de peaje 50% (LIF 2026 art. 20, ap. A)        $500.00
//
// con dos huecos que el papel no confesaba:
//
//  1. LA BASE. `normas/lif-2026-20-A.yaml` dice "50% del GASTO TOTAL EROGADO";
//     el motor usa el SubTotal SIN IVA. Sobre $1,160 la ley admite leerse como
//     $580, no $500. Es el hallazgo H4 de la ficha, `estado: SIN RESOLVER`, y
//     resolverlo hacia el total podría duplicar el beneficio del IVA que ya se
//     acredita aparte — pregunta para un contador. Lo exigible al papel es
//     decir cuál de las dos usó.
//  2. LA ELEGIBILIDAD. El motor dispara con `concepto === 'caseta'` a secas: no
//     conoce los ingresos de la flota, ni su relación de partes, ni si la
//     caseta es de la Red Nacional de Autopistas de Cuota (H5 y H6). Una flota
//     con ingresos ≥ $300M se llevaba el estímulo impreso con el artículo al
//     lado, y el criterio 1/LIF/PI alcanza a "quien preste servicios".
// ═══════════════════════════════════════════════════════════════════════════

const liq = (extra: Partial<Parameters<typeof filasAcreditables>[0]> = {}) => ({
  ivaAcreditable: 0, peajeAcreditable: 0, litrosDieselAcreditables: 0, ...extra,
});

describe('filasAcreditables — el peaje deja de afirmarse solo', () => {
  it('sin nada que acreditar no hay sección', () => {
    expect(filasAcreditables(liq())).toBe(null);
  });

  it('el renglón de peaje dice CUÁL BASE usó', () => {
    const r = filasAcreditables(liq({ peajeAcreditable: 500 }))!;
    const peaje = r.filas.find((f) => f.label.includes('peaje'))!;
    expect(peaje.valor).toBe('$500.00');
    expect(peaje.pies).toContain(BASE_ESTIMULO_PEAJE);
    expect(BASE_ESTIMULO_PEAJE).toContain('subtotal SIN IVA');
    // Y que la otra lectura existe, con su magnitud: $1,160 × 50% = $580.
    expect(BASE_ESTIMULO_PEAJE).toContain('gasto total erogado');
  });

  it('el renglón de peaje enumera las CUATRO condiciones de elegibilidad', () => {
    const r = filasAcreditables(liq({ peajeAcreditable: 500 }))!;
    const peaje = r.filas.find((f) => f.label.includes('peaje'))!;
    expect(peaje.pies).toContain(CONDICIONES_ESTIMULO_PEAJE);
    for (const condicion of ['EXCLUSIVAMENTE', 'Red Nacional de Autopistas de Cuota', '$300 millones', 'parte relacionada']) {
      expect(CONDICIONES_ESTIMULO_PEAJE).toContain(condicion);
    }
    // Y dice quién NO las verificó, que es lo que evita que el papel se lea como
    // un dictamen de elegibilidad.
    expect(CONDICIONES_ESTIMULO_PEAJE).toContain('Likida NO verifica');
  });

  it('el peaje NO se pinta como cifra sostenida entera', () => {
    const r = filasAcreditables(liq({ peajeAcreditable: 500 }))!;
    const peaje = r.filas.find((f) => f.label.includes('peaje'))!;
    expect(peaje.tono).toBe('condicionado');
    // La condición también en el label: es el renglón lo que se skimmea.
    expect(peaje.label).toContain('sujeto a elegibilidad');
  });

  it('el IVA sí se sostiene entero: es la única cifra en verde', () => {
    const r = filasAcreditables(liq({ ivaAcreditable: 689.66, peajeAcreditable: 500, litrosDieselAcreditables: 200 }))!;
    const buenas = r.filas.filter((f) => f.tono === 'bueno').map((f) => f.label);
    expect(buenas).toEqual(['IVA acreditable (LIVA art. 5)']);
  });

  it('los litros de diésel siguen entregándose en LITROS, no en pesos', () => {
    const r = filasAcreditables(liq({ litrosDieselAcreditables: 200 }))!;
    expect(r.filas[0].valor).toBe('200 L');
    expect(r.filas[0].pies.join(' ')).toContain('cuota SEMANAL');
  });

  it('el aviso de ingreso acumulable sigue debajo de todo el bloque', () => {
    const r = filasAcreditables(liq({ ivaAcreditable: 100 }))!;
    expect(r.piesGenerales.join(' ')).toContain('ingreso acumulable');
  });

  it('cuadra con la cifra que produce el motor real sobre una caseta timbrada', () => {
    // El escenario del hallazgo, corrido de punta a punta.
    const cuadre = cuadrarViaje({
      viajeId: 'v-peaje', anticipo: 1160, politica: [{ concepto: 'caseta' }],
      estimulos: { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000 },
      gastos: [{
        id: 'g1', concepto: 'caseta', monto: 1160, fecha: '2026-07-20', cfdiUuid: 'u-caseta',
        xmlVerificado: true, subTotal: 1000, ivaTraslado: 160, formaPago: '03',
      }],
    });
    expect(cuadre.peajeAcreditable).toBe(500);
    const r = filasAcreditables(cuadre)!;
    const peaje = r.filas.find((f) => f.label.includes('peaje'))!;
    expect(peaje.valor).toBe('$500.00');
    expect(peaje.pies.length).toBe(2);
  });

  it('el PDF ya no arma la sección por su cuenta', () => {
    // La sección vivía dibujada a mano dentro de pdf.ts, que es donde no se
    // puede probar lo que dice. Si alguien la reconstruye ahí, esto avisa.
    const src = readFileSync(new URL('./pdf.ts', import.meta.url), 'utf8');
    expect(src).toContain('filasAcreditables');
    expect(src).not.toContain("acred('Estímulo de peaje");
  });
});
