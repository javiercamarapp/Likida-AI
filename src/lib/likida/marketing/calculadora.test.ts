import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  calcularEstimacion, cuotaVencida, CUOTA_DOF, PRECIO_DIESEL_REFERENCIA,
} from './calculadora';
import {
  parsearCuotasDiesel, validarCuotasDiesel, cuotaDieselVigente,
} from '../cuadre/cuota_diesel';

// ═══════════════════════════════════════════════════════════════════════════
// El motor de la calculadora contra los SEIS candados de honestidad del
// blueprint del lead magnet — cada candado tiene aquí su escenario.
// ═══════════════════════════════════════════════════════════════════════════

const HOY_VIVA = CUOTA_DOF.registradaEl;               // la cuota recién registrada
const HOY_VENCIDA = '2027-01-15';                       // meses después: vencida

describe('calcularEstimacion — peaje (pesos sí, con condiciones a la vista)', () => {
  it('50% del subtotal (gasto ÷ 1.16), mensual y anual, redondeado a pesos', () => {
    const r = calcularEstimacion({
      litrosDieselMes: null, gastoDieselMesMxn: null, precioLitro: null,
      gastoCasetasMesMxn: 116_000, unidades: 20, hoy: HOY_VIVA,
    });
    expect('estimuloMesMxn' in r.peaje && r.peaje.subtotalEstimadoMes).toBe(100_000);
    expect('estimuloMesMxn' in r.peaje && r.peaje.estimuloMesMxn).toBe(50_000);
    expect('estimuloAnioMxn' in r.peaje && r.peaje.estimuloAnioMxn).toBe(600_000);
    // El supuesto del IVA viaja junto a la cifra (candado 1).
    expect(r.supuestos.join(' ')).toContain('÷ 1.16');
  });

  it('las tres condiciones del estímulo van EN el bloque, no en letra chica aparte', () => {
    const r = calcularEstimacion({
      litrosDieselMes: null, gastoDieselMesMxn: null, precioLitro: null,
      gastoCasetasMesMxn: 50_000, unidades: null, hoy: HOY_VIVA,
    });
    const condiciones = 'condiciones' in r.peaje ? r.peaje.condiciones.join(' ') : '';
    expect(condiciones).toContain('Red Nacional de Autopistas de Cuota');
    expect(condiciones).toContain('bitácora');
    expect(condiciones).toContain('electrónicos');
  });
});

describe('calcularEstimacion — diésel (litros primero, pesos solo con cuota viva)', () => {
  it('con litros directos: litros mes/año y estimación con la cuota FECHADA', () => {
    const r = calcularEstimacion({
      litrosDieselMes: 10_000, gastoDieselMesMxn: null, precioLitro: null,
      gastoCasetasMesMxn: null, unidades: null, hoy: HOY_VIVA,
    });
    if (!('litrosMes' in r.diesel)) throw new Error('esperaba bloque de diésel');
    expect(r.diesel.litrosMes).toBe(10_000);
    expect(r.diesel.litrosAnio).toBe(120_000);
    expect(r.diesel.estimacionMesMxn).toBe(Math.round(10_000 * CUOTA_DOF.pesosPorLitro));
    expect(r.diesel.cuota.registradaEl).toBe(CUOTA_DOF.registradaEl);
  });

  it('candado 2: con la cuota VENCIDA no hay pesos de IEPS — litros sí, y el total lo dice', () => {
    expect(cuotaVencida(HOY_VENCIDA)).toBe(true);
    const r = calcularEstimacion({
      litrosDieselMes: 10_000, gastoDieselMesMxn: null, precioLitro: null,
      gastoCasetasMesMxn: 116_000, unidades: null, hoy: HOY_VENCIDA,
    });
    if (!('litrosMes' in r.diesel)) throw new Error('esperaba bloque de diésel');
    expect(r.diesel.estimacionMesMxn).toBeNull();          // jamás pesos con cuota vieja
    expect(r.diesel.litrosMes).toBe(10_000);               // el dato que no cambia
    expect(r.totalAnualMxn).toBe(600_000);                 // solo el peaje entra
    expect(r.notaDelTotal).toContain('litros');
  });

  it('conversión pesos→litros: usa el precio DECLARADO y lo dice en supuestos', () => {
    const r = calcularEstimacion({
      litrosDieselMes: null, gastoDieselMesMxn: 260_000, precioLitro: 26,
      gastoCasetasMesMxn: null, unidades: null, hoy: HOY_VIVA,
    });
    if (!('litrosMes' in r.diesel)) throw new Error('esperaba bloque de diésel');
    expect(r.diesel.litrosMes).toBe(10_000);
    expect(r.diesel.conversion).toEqual({ gastoMxn: 260_000, precioLitro: 26 });
    expect(r.supuestos.join(' ')).toContain('$26.00 por litro');
  });

  it('sin precio declarado la conversión cae al de referencia — declarado igual', () => {
    const r = calcularEstimacion({
      litrosDieselMes: null, gastoDieselMesMxn: 26_000, precioLitro: null,
      gastoCasetasMesMxn: null, unidades: null, hoy: HOY_VIVA,
    });
    if (!('litrosMes' in r.diesel)) throw new Error('esperaba bloque de diésel');
    expect(r.diesel.conversion?.precioLitro).toBe(PRECIO_DIESEL_REFERENCIA);
    expect(r.supuestos.join(' ')).toContain(`$${PRECIO_DIESEL_REFERENCIA.toFixed(2)}`);
  });
});

describe('calcularEstimacion — honestidad de lo ausente (candado 5)', () => {
  it('sin ningún dato: los dos bloques declaran qué falta y el total es null, no 0', () => {
    const r = calcularEstimacion({
      litrosDieselMes: null, gastoDieselMesMxn: null, precioLitro: null,
      gastoCasetasMesMxn: null, unidades: null, hoy: HOY_VIVA,
    });
    expect('faltante' in r.diesel && r.diesel.faltante.length > 0).toBe(true);
    expect('faltante' in r.peaje && r.peaje.faltante.length > 0).toBe(true);
    expect(r.totalAnualMxn).toBeNull();
  });

  it('cero y negativos NO cuentan como dato', () => {
    const r = calcularEstimacion({
      litrosDieselMes: 0, gastoDieselMesMxn: -5, precioLitro: null,
      gastoCasetasMesMxn: 0, unidades: null, hoy: HOY_VIVA,
    });
    expect('faltante' in r.diesel).toBe(true);
    expect('faltante' in r.peaje).toBe(true);
  });
});

describe('calcularEstimacion — las advertencias que venden (candados 3 y 6)', () => {
  it('acumulable SIEMPRE visible, la cuota semanal explicada y "quien acredita es tu contador"', () => {
    const r = calcularEstimacion({
      litrosDieselMes: 100, gastoDieselMesMxn: null, precioLitro: null,
      gastoCasetasMesMxn: 100, unidades: 1, hoy: HOY_VIVA,
    });
    const adv = r.advertencias.join(' ');
    expect(adv).toContain('ingreso acumulable');
    expect(adv).toContain('1 − tu tasa de ISR');
    expect(adv).toContain('DOF cada semana');
    expect(adv).toContain('contador');
  });

  it('candado 4: ningún texto del motor dice "hasta un" ni promete recuperar', () => {
    const r = calcularEstimacion({
      litrosDieselMes: 100, gastoDieselMesMxn: null, precioLitro: null,
      gastoCasetasMesMxn: 100, unidades: 1, hoy: HOY_VIVA,
    });
    const todo = JSON.stringify(r).toLowerCase();
    expect(todo).not.toContain('hasta un');
    expect(todo).not.toContain('te recuperamos');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 20, FISC-C1 (CRÍTICO). `CUOTA_DOF` es la ÚNICA superficie pública
// que imprime pesos de estímulo de IEPS de diésel, y su cifra estaba tecleada
// a mano sin ningún vínculo con `normas/datos/cuota-ieps-diesel.yaml` —el
// archivo que la rutina del DOF escribe y que el repo cotejó dígito por dígito
// contra sus acuerdos—. Resultado: la cuota del 25-31 de JULIO ($2.0925)
// sellada `registradaEl: '2026-08-27'`. El sello de agosto impedía que la
// guarda de frescura de 14 días disparara, así que la página publicaba pesos
// calculados con una cuota de hace más de un mes.
//
// Las pruebas de arriba no podían verlo: `HOY_VIVA = CUOTA_DOF.registradaEl`
// compara la constante contra sí misma. Este bloque la compara contra la
// FUENTE, usando el mismo lector fail-closed que el repo ya tenía escrito para
// esto (`cuadre/cuota_diesel.ts`) y que nadie llamaba.
// ═══════════════════════════════════════════════════════════════════════════

describe('CUOTA_DOF contra la tabla verificada del DOF', () => {
  const tabla = parsearCuotasDiesel(readFileSync('normas/datos/cuota-ieps-diesel.yaml', 'utf8'));

  it('la tabla de normas/ está bien formada', () => {
    expect(validarCuotasDiesel(tabla)).toEqual([]);
    expect(tabla.semanas.length).toBeGreaterThan(0);
  });

  it('la cuota publicada es la que de verdad estaba vigente en la fecha que la sella', () => {
    const semana = cuotaDieselVigente(tabla, CUOTA_DOF.registradaEl);
    expect(semana).not.toBeNull();
    expect(semana!.cuotaDisminuidaPorLitro).toBe(CUOTA_DOF.pesosPorLitro);
  });

  it('no se publica una cuota más vieja que la última que el repo verificó', () => {
    const ultima = [...tabla.semanas].sort((a, b) => a.desde.localeCompare(b.desde)).at(-1)!;
    expect(CUOTA_DOF.registradaEl >= ultima.desde).toBe(true);
  });
});
