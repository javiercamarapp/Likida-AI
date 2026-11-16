import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CUENTAS_PROPUESTAS, esCodigoCuenta, indexarCuentas, naturalezaUsual, ROTULO_PLAN_PROPUESTO, rotuloCuenta } from './cuentas';

// El plan de cuentas es una PROPUESTA (el contador lo define) y vive en dos lugares: la semilla de la migración 1014 y esta lista.
// La prueba los compara para que no se separen.

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/1014_bo_libro_contable.sql'), 'utf8');
const semilla = [...sql.matchAll(/\('(\d{4})', '([^']+)', '([APKICG])', '([DA])', (true|false), (?:'[^']*'|null)\)/g)].map((m) => ({
  codigo: m[1], nombre: m[2], tipo: m[3], naturaleza: m[4], activa: m[5] === 'true',
}));

describe('plan de cuentas propuesto', () => {
  it('la lista de TypeScript coincide con la semilla de la migración (código, nombre, tipo, naturaleza y activa)', () => {
    expect(semilla.length).toBeGreaterThan(25);
    expect(CUENTAS_PROPUESTAS.map((c) => ({ codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, naturaleza: c.naturaleza, activa: c.activa }))).toEqual(semilla);
  });

  it('códigos únicos, de cuatro dígitos y todo marcado como propuesta', () => {
    const codigos = CUENTAS_PROPUESTAS.map((c) => c.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
    expect(codigos.every(esCodigoCuenta)).toBe(true);
    expect(CUENTAS_PROPUESTAS.every((c) => c.propuesta)).toBe(true);
    expect(ROTULO_PLAN_PROPUESTO).toContain('el contador lo define');
  });

  it('la naturaleza es la usual del tipo, salvo las contra-cuentas declaradas (4210)', () => {
    const raras = CUENTAS_PROPUESTAS.filter((c) => c.naturaleza !== naturalezaUsual(c.tipo)).map((c) => c.codigo);
    expect(raras).toEqual(['4210']);
  });

  it('incluye las cuentas clave del SaaS y el ajuste por redondeo 7900', () => {
    const idx = indexarCuentas(CUENTAS_PROPUESTAS);
    for (const k of ['1110', '1210', '2310', '2210', '1410', '2230', '2120', '4100', '5100', '5200', '6110', '7900']) expect(idx.has(k), k).toBe(true);
    expect(idx.get('7900')?.nombre).toBe('Ajuste por redondeo');
  });

  it('esCodigoCuenta y rotuloCuenta', () => {
    expect(esCodigoCuenta('1110')).toBe(true);
    expect(esCodigoCuenta('111')).toBe(false);
    expect(esCodigoCuenta('12A4')).toBe(false);
    expect(rotuloCuenta({ codigo: '1110', nombre: 'Bancos' })).toBe('1110 · Bancos');
  });
});
