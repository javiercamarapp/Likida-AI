// ═══════════════════════════════════════════════════════════════════════════
// COBERTURA (ronda 16): chofer.ts estaba a 27% — el panel del chofer. Primero
// las funciones PURAS (la lógica que decide qué se le dice), luego el estado.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { estadoComprobante, resumenLiquidacion, leerDiferencia, etiquetaEstatusViaje } from './chofer';

describe('estadoComprobante — qué se le enseña al chofer de una foto', () => {
  it('confianza baja → revisar; alta → registrado', () => {
    expect(estadoComprobante(0.5)).toBe('revisar');
    expect(estadoComprobante(0.95)).toBe('registrado');
  });
  it('sin confianza (null/undefined) → registrado, no "revisar" (no hay lectura que dudar)', () => {
    expect(estadoComprobante(null)).toBe('registrado');
    expect(estadoComprobante(undefined)).toBe('registrado');
  });
  it('confianza no numérica → registrado (no truena ni inventa)', () => {
    expect(estadoComprobante('abc' as unknown as number)).toBe('registrado');
  });
});

describe('resumenLiquidacion — el saldo en vivo del viaje', () => {
  const E = (p: Partial<Parameters<typeof resumenLiquidacion>[0]>) => ({
    anticipo: 0, comprobado: 0, comprobantes: 0, enRevision: 0, ...p,
  });

  it('falta comprobar cuando comprobado < anticipo', () => {
    const r = resumenLiquidacion(E({ anticipo: 10000, comprobado: 6000, comprobantes: 3 }));
    expect(r.falta).toBe(4000);
    expect(r.excedente).toBe(0);
    expect(r.avance).toBeCloseTo(0.6);
    expect(r.leyenda).toContain('Te falta comprobar');
  });

  it('excedente cuando comprobado > anticipo (información, no error de dibujo)', () => {
    const r = resumenLiquidacion(E({ anticipo: 10000, comprobado: 12000 }));
    expect(r.falta).toBe(0);
    expect(r.excedente).toBe(2000);
    expect(r.avance).toBeGreaterThan(1);
    expect(r.leyenda).toContain('más que el anticipo');
  });

  it('justo con el anticipo', () => {
    const r = resumenLiquidacion(E({ anticipo: 10000, comprobado: 10000 }));
    expect(r.falta).toBe(0);
    expect(r.excedente).toBe(0);
    expect(r.leyenda).toContain('justo con el anticipo');
  });

  it('anticipo 0 es AMBIGUO: no se afirma "ya no debes nada" — falta/excedente null', () => {
    const r = resumenLiquidacion(E({ anticipo: 0, comprobado: 5000 }));
    expect(r.falta).toBeNull();
    expect(r.excedente).toBeNull();
    expect(r.avance).toBeNull();
    expect(r.leyenda).toContain('no tiene anticipo registrado');
  });
});

describe('leerDiferencia — el signo se dice sin adelantar veredicto laboral', () => {
  it('positiva → a favor de la empresa (warn)', () => {
    expect(leerDiferencia(3288)).toEqual({ texto: 'A favor de la empresa', tono: 'warn' });
  });
  it('negativa → a favor del operador (ok)', () => {
    expect(leerDiferencia(-3288)).toEqual({ texto: 'A favor del operador', tono: 'ok' });
  });
  it('cero → sin diferencia (neutral)', () => {
    expect(leerDiferencia(0)).toEqual({ texto: 'Sin diferencia', tono: 'neutral' });
  });
});

describe('etiquetaEstatusViaje — nunca traduce un estatus desconocido', () => {
  it('los tres conocidos', () => {
    expect(etiquetaEstatusViaje('abierto')).toBe('En ruta');
    expect(etiquetaEstatusViaje('en_cuadre')).toBe('En cuadre');
    expect(etiquetaEstatusViaje('liquidado')).toBe('Liquidado');
  });
  it('desconocido se pinta CRUDO (no se inventa una traducción)', () => {
    expect(etiquetaEstatusViaje('archivado')).toBe('archivado');
  });
});
