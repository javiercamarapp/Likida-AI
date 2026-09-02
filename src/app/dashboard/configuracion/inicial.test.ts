// AUDITORÍA 24 · ARQ-3 (ALTO, NUEVO) — el textarea de cuentas NO se prellena
// con la demo, y el catálogo declarado sobrevive el viaje de ida y vuelta.
import { describe, it, expect } from 'vitest';
import { ajustesIniciales, type ConfigParaAjustes } from './inicial';
import { cuentasDeclaradasDe } from '@/lib/likida/contabilidad/catalogo';
import { DEMO_CONFIG } from '@/lib/likida/config';

const CONFIG: ConfigParaAjustes = {
  tabulador: { rendimientoPorDefecto: 3, factorCarga: 0.78, precioDieselPorDefecto: 27, umbralDesviacion: 0.15 },
  salida: 'csv',
};

describe('ARQ-3: la pantalla de configuración no presta las cuentas de la demo', () => {
  it('flota sin catálogo declarado: el textarea va VACÍO, sin 600-001', () => {
    const i = ajustesIniciales(CONFIG, null);
    expect(i.cuentas).toBe('');
    expect(i.cuentas).not.toContain('600-001');
  });

  it('las cuentas de DEMO_CONFIG son justo las que ya no se enseñan', () => {
    // Si alguien vacía `DEMO_CONFIG.catalogoCuentas`, esta prueba deja de
    // probar algo: se afirma que el fixture sigue siendo el del defecto.
    expect(DEMO_CONFIG.catalogoCuentas.diesel).toBe('600-001');
    expect(ajustesIniciales(CONFIG, null).cuentas).not.toContain(DEMO_CONFIG.catalogoCuentas.diesel);
  });

  it('flota CON catálogo declarado: se enseña el suyo, ordenado y completo', () => {
    const i = ajustesIniciales(CONFIG, { diesel: '5010-001', iva_acreditable: '1180-001' });
    expect(i.cuentas).toBe('diesel=5010-001\niva_acreditable=1180-001');
  });

  it('sin config (lectura caída) tampoco se inventan cuentas', () => {
    expect(ajustesIniciales(null, null).cuentas).toBe('');
    expect(ajustesIniciales(null, null).salida).toBe('csv');
  });

  it('el resto de los ajustes sigue igual: el umbral sale en porcentaje', () => {
    expect(ajustesIniciales(CONFIG, null).umbralDesviacionPct).toBe('15');
    expect(ajustesIniciales(CONFIG, null).rendimientoPorDefecto).toBe('3');
  });
});

describe('cuentasDeclaradasDe: lo que no se declaró, no existe', () => {
  it('null / vacío / no-objeto / arreglo → null (no un catálogo vacío)', () => {
    expect(cuentasDeclaradasDe(undefined)).toBeNull();
    expect(cuentasDeclaradasDe(null)).toBeNull();
    expect(cuentasDeclaradasDe({})).toBeNull();
    expect(cuentasDeclaradasDe('600-001')).toBeNull();
    expect(cuentasDeclaradasDe(['diesel=600-001'])).toBeNull();
    expect(cuentasDeclaradasDe({ diesel: '   ' })).toBeNull();
  });

  it('conserva llaves que `armarCatalogo` descartaría (notas del contador)', () => {
    // Leer con `armarCatalogo` y volver a escribir el textarea borraría estas
    // líneas sin que nadie se entere; por eso la pantalla lee el crudo.
    expect(cuentasDeclaradasDe({ diesel: '5010-001', nota_contador: '9999-999' }))
      .toEqual({ diesel: '5010-001', nota_contador: '9999-999' });
  });

  it('recorta espacios y tira los valores que no son texto', () => {
    expect(cuentasDeclaradasDe({ ' diesel ': ' 5010-001 ', caseta: 42, flete: null }))
      .toEqual({ diesel: '5010-001' });
  });
});
