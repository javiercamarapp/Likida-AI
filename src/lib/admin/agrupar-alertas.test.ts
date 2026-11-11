import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { agruparAlertas, lineasAgrupadas, RUNBOOK_DE } from './agrupar-alertas';
import type { ItemClasificado } from './guardia';
import type { EvaluacionQuema } from './slo-quema';

const item = (n: number): ItemClasificado => ({ severidad: 'S2', regla: 'r', fuente: 'corridas', titulo: `Corrida ${n}`, flota: 'F', desde: '2026-11-01T00:00:00Z', vence: null, href: null });
const quema = (nivel: EvaluacionQuema['nivel']): EvaluacionQuema => ({ clave: 'agentes_exito', nombre: 'Corridas exitosas', objetivo: 0.95, nivel, regla: 'pagina_rapida', quemas: {}, presupuesto: null, razon: null, nota: '' });

describe('agruparAlertas', () => {
  it('seis eventos de una misma causa producen un solo aviso con runbook', () => {
    const l = lineasAgrupadas({ nuevos: [1, 2, 3, 4, 5, 6].map(item), ciegasNuevas: [] });
    expect(l).toHaveLength(1);
    expect(l[0]).toContain('6 corridas de agentes en fallo');
    expect(l[0]).toContain('runbook: docs/operacion/runbook-incidentes.md');
  });
  it('un evento conserva su título', () => {
    expect(lineasAgrupadas({ nuevos: [item(1)], ciegasNuevas: [] })[0]).toContain('Corrida 1');
  });
  it('la quema en página entra con SLO y ventanas; ticket y sin_medir no', () => {
    const g = agruparAlertas({ items: [], ciegas: [], quema: [quema('pagina'), quema('ticket'), quema('sin_medir')] });
    expect(g).toHaveLength(1);
    expect(g[0].slo?.ventanas).toContain('1h y 5m');
  });
  it('lleva el último cambio', () => {
    expect(lineasAgrupadas({ nuevos: [item(1)], ciegasNuevas: [] }, { ultimoCambio: 'abc1234' })[0]).toContain('abc1234');
  });
  it('cada runbook existe en disco', () => {
    for (const r of Object.values(RUNBOOK_DE)) expect(existsSync(join(process.cwd(), r.ruta)), r.ruta).toBe(true);
  });
});
