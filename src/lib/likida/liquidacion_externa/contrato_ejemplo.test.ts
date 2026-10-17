// T-A1-40: el contrato que se le manda a sistemas es el que el código valida. El ejemplo del documento pasa
// `validarLiquidacionExterna` (vía `aLiquidacionExterna`), un campo desconocido falla con mensaje llano y los campos
// documentados son exactamente las claves del contrato.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTRATO_EJEMPLO } from './contrato_ejemplo.fixture';
import { aLiquidacionExterna, validarDesgloseBitacora } from './desglose_contrato';

const RAIZ = resolve(__dirname, '../../../..');
const DOC = readFileSync(resolve(RAIZ, 'docs/integracion/liquidaciones-contrato.md'), 'utf8');
const FUENTE = readFileSync(resolve(__dirname, 'desglose_contrato.ts'), 'utf8');

/** Primer bloque ```json del documento. */
function ejemploDelDocumento(): unknown {
  const m = /```json\n([\s\S]*?)\n```/.exec(DOC);
  if (!m) throw new Error('el documento no trae el bloque JSON de ejemplo');
  return JSON.parse(m[1]);
}

/** Campos (primera columna, entre comillas invertidas) de la tabla que sigue a un encabezado en negritas. */
function camposDeTabla(titulo: string): string[] {
  const ini = DOC.indexOf(`**${titulo}**`);
  if (ini < 0) throw new Error(`no hay tabla «${titulo}»`);
  const filas: string[] = [];
  for (const linea of DOC.slice(ini).split('\n').slice(1)) {
    if (linea.trim() === '' && filas.length > 0) break;
    const m = /^\|\s*((?:`[^`]+`(?:,\s*)?)+)\s*\|/.exec(linea);
    if (m) for (const c of m[1].matchAll(/`([^`]+)`/g)) filas.push(c[1]);
  }
  return filas;
}

function clavesDelContrato(): string[] {
  const m = /const CAMPOS = \[([^\]]*)\] as const/.exec(FUENTE);
  if (!m) throw new Error('no se encontró CAMPOS en desglose_contrato.ts');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('contrato de liquidaciones para sistemas (T-A1-40)', () => {
  it('el JSON de ejemplo del documento es el fixture y pasa la validación', () => {
    expect(ejemploDelDocumento()).toEqual(CONTRATO_EJEMPLO);
    const r = aLiquidacionExterna(validarDesgloseBitacora(ejemploDelDocumento()), { sistemaOrigen: 'contrato-ejemplo' });
    expect(r.totalOrigen).toBe('origen');
    expect(r.liquidacion.total).toBe(4200.25);
    expect(r.liquidacion.claveExterna).toBe('LIQ-T01-L-0001');
    expect(r.liquidacion.viajes).toEqual(['B-0001', 'B-0002']);
    expect(r.dias).toBe(6);
  });

  it('un campo desconocido falla con un mensaje llano que lo nombra', () => {
    const malo = { ...CONTRATO_EJEMPLO, saldoFavor: 10 };
    expect(() => validarDesgloseBitacora(malo)).toThrow(/campos que el contrato no tiene.*saldoFavor/);
    const renglon = { ...CONTRATO_EJEMPLO, percepciones: [{ concepto: 'Sueldo', monto: 10, nota: 'x' }] };
    expect(() => validarDesgloseBitacora(renglon)).toThrow(/percepciones\[0\].*nota/);
  });

  it('un neto que no cuadra con los renglones se rechaza', () => {
    expect(() => aLiquidacionExterna({ ...CONTRATO_EJEMPLO, neto: 1 }, { sistemaOrigen: 'contrato-ejemplo' })).toThrow();
  });

  it('coherencia doc↔código: los campos documentados son las claves del contrato', () => {
    const doc = camposDeTabla('Liquidación').sort();
    expect(doc).toEqual([...clavesDelContrato()].sort());
    expect(Object.keys(CONTRATO_EJEMPLO).sort()).toEqual(doc);
  });

  it('coherencia doc↔código: operador y renglón', () => {
    expect(camposDeTabla('Renglón').sort()).toEqual(['concepto', 'monto', 'vale']);
    // `operador` lo documenta la fila de la liquidación; sus dos subcampos están en el texto.
    expect(DOC).toContain('`numeroEmpleado`');
    expect(DOC).toContain('`nombre`');
    expect(() => validarDesgloseBitacora({ ...CONTRATO_EJEMPLO, operador: { numeroEmpleado: 'E-1', correo: 'x' } })).toThrow(/operador/);
  });

  it('el documento nombra los errores y el endpoint push que existen', () => {
    expect(DOC).toContain('POST /api/v1/liquidaciones-externas/desgloses');
    for (const c of ['parametro_invalido', 'no_autenticado', 'sin_permiso', 'demasiadas_peticiones', 'correccion_pendiente']) {
      expect(DOC).toContain(c);
    }
  });
});
