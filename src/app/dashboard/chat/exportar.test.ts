import { describe, expect, it } from 'vitest';
import { PAYLOADS_HOSTILES } from '@/lib/pruebas/cargas_hostiles_csv';
import { tablaACsv } from './exportar';

// El CSV de una tabla de respuesta pasa TODA celda por la guarda única (`@/lib/csv_seguro`, CWE-1236).
describe('chat · tablaACsv es seguro contra inyección de fórmulas', () => {
  it.each(PAYLOADS_HOSTILES)('neutraliza %j en el concepto y en el valor', (p) => {
    const filas = tablaACsv([[p, p]]).split('\n').slice(1).join('\n');
    expect(filas).toContain(`'${p.replace(/"/g, '""')}`);
    for (const celda of filas.split(',')) expect(celda.replace(/^"/, '')).not.toMatch(/^[=+\-@\t\r]/);
  });

  it('los cuatro payloads clásicos quedan con apóstrofo', () => {
    for (const p of ['=HYPERLINK("http://x")', "=cmd|'/c calc'!A1", '-2+3', '+1', '@SUM(A1)', '\t=1']) {
      expect(tablaACsv([['k', p]])).toContain(`'${p.replace(/"/g, '""')}`);
    }
  });

  it('un importe en texto plano no se altera, y el CSV conserva su forma', () => {
    const csv = tablaACsv([['Monto comprobado', '1284000.00'], ['Diferencia', '-12.50'], ['Viajes', '42']]);
    expect(csv).toBe('Concepto,Valor\nMonto comprobado,1284000.00\nDiferencia,-12.50\nViajes,42');
  });

  it('comillas y comas siguen entrecomilladas (RFC 4180)', () => {
    expect(tablaACsv([['a, b', '$1,000.00']])).toBe('Concepto,Valor\n"a, b","$1,000.00"');
  });
});
