/* eslint-disable security/detect-non-literal-fs-filename -- prueba que lee/escribe rutas del propio repo o de un directorio temporal; ninguna ruta ni patrón viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validarLiquidacionExterna } from './esquema';
import {
  DESGLOSE_SINTETICO, centavos, sumaCentavos, cuerpoLiquidacionDesde, diasInclusivos, sumaPercepcionesNombradas, type DesgloseFixture,
} from './desglose.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// ACEPTACIÓN DEL DESGLOSE «AL CENTAVO» (T-A1-01).
//
// (a)/(b) corren siempre sobre el fixture sintético. (c) corre solo en local: `LIKIDA_DESGLOSE_REAL_JSON` apunta a un
// JSON FUERA del repo (público) con un desglose real y su bloque `esperado`; sin la variable, queda `skipped`.
// ═══════════════════════════════════════════════════════════════════════════

const RUTA_REAL = process.env.LIKIDA_DESGLOSE_REAL_JSON;

describe('fixture sintético isomorfo', () => {
  const f = DESGLOSE_SINTETICO;

  it('(a) pasa el contrato vigente y su total es el neto esperado', () => {
    const n = validarLiquidacionExterna(cuerpoLiquidacionDesde(f));
    expect(n.total).toBe(4850);
    expect(n.conceptos).toHaveLength(14);
    expect(n.conceptos.filter((c) => c.tipo === 'percepcion')).toHaveLength(8);
    expect(n.conceptos.filter((c) => c.tipo === 'deduccion')).toHaveLength(6);
    expect(n.viajes).toEqual(['B-0001']);
  });

  it('(b) identidad aritmética en centavos: percepciones − deducciones = neto', () => {
    expect(sumaCentavos(f.percepciones)).toBe(centavos(9850.5));
    expect(sumaCentavos(f.deducciones)).toBe(centavos(5000.5));
    expect(sumaCentavos(f.percepciones) - sumaCentavos(f.deducciones)).toBe(centavos(4850));
    expect(f.esperado).toEqual({ percepciones: 9850.5, deducciones: 5000.5, neto: 4850 });
  });

  it('(b) identidad de composición: Sueldo + Viáticos = suma de sus cuatro componentes', () => {
    const izq = sumaPercepcionesNombradas(f, f.identidad.izquierda);
    const der = f.identidad.derecha.reduce((a, m) => a + centavos(m), 0);
    expect(izq).toBe(centavos(5500.5));
    expect(izq).toBe(der);
  });

  it('conserva la forma del impreso: 3 anticipos con vale (sin asterisco), días inclusivos y nombres neutros', () => {
    expect(f.deducciones.filter((d) => d.vale)).toHaveLength(3);
    expect(f.deducciones.every((d) => !d.vale || /^[0-9]+$/.test(d.vale))).toBe(true);
    expect(diasInclusivos(f.desde, f.hasta)).toBe(f.dias);
    expect(f.operador.nombre).toMatch(/^Operador Ejemplo/);
  });
});

describe.skipIf(!RUTA_REAL)('desglose real (solo local, fuera del repo)', () => {
  const real = (): DesgloseFixture => JSON.parse(readFileSync(RUTA_REAL as string, 'utf8')) as DesgloseFixture;

  it('(c) los totales del impreso salen al centavo', () => {
    const d = real();
    const sp = sumaCentavos(d.percepciones);
    const sd = sumaCentavos(d.deducciones);
    expect(sp).toBe(centavos(d.esperado.percepciones));
    expect(sd).toBe(centavos(d.esperado.deducciones));
    expect(sp - sd).toBe(centavos(d.esperado.neto));
    expect(diasInclusivos(d.desde, d.hasta)).toBe(d.dias);
  });

  it('(c) identidad de composición del impreso al centavo', () => {
    const d = real();
    const izq = sumaPercepcionesNombradas(d, d.identidad.izquierda);
    expect(izq).toBe(d.identidad.derecha.reduce((a, m) => a + centavos(m), 0));
  });

  it('(c) pasa el contrato vigente con el total esperado', () => {
    const d = real();
    const n = validarLiquidacionExterna(cuerpoLiquidacionDesde(d));
    expect(n.total).toBe(d.esperado.neto);
  });
});
