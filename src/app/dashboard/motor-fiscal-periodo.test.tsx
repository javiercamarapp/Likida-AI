import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MotorFiscalPeriodo } from './motor-fiscal-periodo';
import { resto } from '@/lib/i18n/es/resto';

// ═══════════════════════════════════════════════════════════════════════════
// El motor fiscal del panel del contador: dos cifras con su periodo elegible y las causas del ejercicio. Desde el 11-nov-2026 el
// periodo se elige con el segmentado del sistema (antes, dos flechas ‹ › de 24 px propias) y las causas salen en una BarList del kit
// (antes `MotorFiscal` de resumen-visual). Se conservan las garantías de siempre: sin dato no hay $0 fabricado, y cada cifra dice su
// ventana (un rótulo «del periodo» no puede mentir).
// ═══════════════════════════════════════════════════════════════════════════

const SERIE = {
  semanal: { montoPerdido: 1000, montoEnRiesgo: 2000, montoRecuperable: 500 },
  mensual: { montoPerdido: 4000, montoEnRiesgo: 8000, montoRecuperable: 2000 },
  historico: { montoPerdido: 40000, montoEnRiesgo: 80000, montoRecuperable: 20000 },
};
const CAUSAS = [
  { titulo: 'Sin CFDI', n: 3, monto: 1200 },
  { titulo: 'Fuera de política', n: 1, monto: 300 },
];

describe('MotorFiscalPeriodo', () => {
  it('sin series: dice que no se pudo leer el motor fiscal, no un $0 fabricado', () => {
    const html = renderToStaticMarkup(<MotorFiscalPeriodo series={null} />);
    expect(html).toContain('No se pudo leer el motor fiscal');
    expect(html).not.toMatch(/\$0/);
  });

  it('con series: pinta las dos cifras del periodo semanal por defecto, con su ventana en el rótulo', () => {
    const html = renderToStaticMarkup(<MotorFiscalPeriodo series={SERIE} />);
    expect(html).toContain('$3,000'); // montoEnRiesgo + montoPerdido
    expect(html).toContain('$500'); // montoRecuperable
    expect(html).toContain('En riesgo / perdido · últimos 7 días');
    expect(html).toContain('Recuperable pidiendo factura · últimos 7 días');
  });

  it('el periodo se elige con el segmentado del sistema: tres opciones, la semanal activa, sin flechas propias', () => {
    const html = renderToStaticMarkup(<MotorFiscalPeriodo series={SERIE} />);
    expect(html).toMatch(/role="radiogroup"[^>]*aria-label="Periodo del motor fiscal"/);
    expect((html.match(/role="radio"/g) ?? []).length).toBe(3);
    expect(html).toMatch(/aria-checked="true"[^>]*>7 días</);
    expect(html).not.toMatch(/Periodo más (corto|largo)/);
  });

  it('las causas del ejercicio salen en la lista del kit, con su monto y el conteo de comprobantes', () => {
    const html = renderToStaticMarkup(<MotorFiscalPeriodo series={SERIE} causas={CAUSAS} />);
    expect(html).toContain('Sin CFDI · 3 comprobantes');
    expect(html).toContain('Fuera de política · 1 comprobante');
    expect(html).toContain('$1,200.00');
  });

  it('en cero no hay semáforo: ni «Crítico» sobre $0.00 ni «Recuperable» en verde sin monto', () => {
    const CERO = { montoPerdido: 0, montoEnRiesgo: 0, montoRecuperable: 0 };
    const html = renderToStaticMarkup(<MotorFiscalPeriodo series={{ semanal: CERO, mensual: CERO, historico: CERO }} />);
    expect(html).not.toMatch(/Crítico/);
    expect(html).not.toMatch(/data-tono="(bad|ok)"/);
  });

  it('con monto en riesgo sí marca el semáforo rojo', () => {
    const html = renderToStaticMarkup(<MotorFiscalPeriodo series={SERIE} />);
    expect(html).toMatch(/Crítico|data-tono="bad"/);
  });

  it('sin causas no pinta la lista (ni una barra en cero)', () => {
    const html = renderToStaticMarkup(<MotorFiscalPeriodo series={SERIE} />);
    expect(html).not.toContain('rv-barlist');
  });

  it('cada vista declara su ventana en el diccionario: nunca un número mudo (semanal, mensual, histórico)', () => {
    expect(resto['op.mf_ventana_semanal']).toBe('últimos 7 días');
    expect(resto['op.mf_ventana_mensual']).toBe('últimos 30 días');
    expect(resto['op.mf_ventana_historico']).toBe('histórico');
    expect(resto['op.mf_en_riesgo']).toContain('{ventana}');
    expect(resto['op.mf_recuperable']).toContain('{ventana}');
  });
});
