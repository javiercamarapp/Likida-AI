import { describe, it, expect } from 'vitest';
import { ESTATUS, etiquetaEstatus } from './estatus';
import type { EstatusLiquidacion } from '@/types/likida';

describe('estatus del panel — una sola copia que cubre el dominio', () => {
  it('cubre TODOS los valores de EstatusLiquidacion (el hueco que el test gemelo vigilaba)', () => {
    const valores: EstatusLiquidacion[] = ['cuadrada', 'con_diferencias', 'revisar'];
    for (const v of valores) {
      expect(ESTATUS[v], `falta el estatus ${v}`).toBeDefined();
      expect(ESTATUS[v].label.length).toBeGreaterThan(0);
    }
  });

  it('los colores son tokens del sistema (no literales que puedan divergir)', () => {
    for (const e of Object.values(ESTATUS)) {
      expect(e.color).toMatch(/^var\(--/);
    }
  });

  it('un estatus desconocido se pinta con su clave cruda en gris — nunca inventa', () => {
    expect(etiquetaEstatus('archivado')).toEqual({ label: 'archivado', color: 'var(--muted)' });
  });
});
