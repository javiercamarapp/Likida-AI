import { describe, it, expect } from 'vitest';
import { armarCorreoDesglose, nombreAdjuntoDesglose } from './entrega_correo';

// 26-nov-2026: la nómina del cliente nombra cada archivo con el nombre del operador; el adjunto de Likida hace lo mismo. Nombres sintéticos.

const ctx = { claveExterna: 'BIT-1191', periodoDesde: '2026-11-14', periodoHasta: '2026-11-17', bitacora: '1191' };

describe('nombre del adjunto del desglose', () => {
  it('con operador: «NOMBRE DEL OPERADOR.xlsx», con acentos y espacios', () => {
    expect(nombreAdjuntoDesglose('1191', 'JOSÉ PÉREZ MUÑOZ')).toBe('JOSÉ PÉREZ MUÑOZ.xlsx');
    const r = armarCorreoDesglose({ ...ctx, operadorNombre: 'OPERADOR DE PRUEBA' });
    expect(r.nombreAdjunto).toBe('OPERADOR DE PRUEBA.xlsx');
    expect(r.correo.archivo?.nombre).toBe('OPERADOR DE PRUEBA.xlsx');
  });

  it('la copia del revisor lleva el mismo nombre', () => {
    const r = armarCorreoDesglose({ ...ctx, operadorNombre: 'OPERADOR DE PRUEBA' }, { departamento: null, retenidoMotivo: null });
    expect(r.nombreAdjunto).toBe('OPERADOR DE PRUEBA.xlsx');
  });

  it('quita caracteres que un sistema de archivos no acepta y espacios de sobra', () => {
    expect(nombreAdjuntoDesglose('1', '  ANA / LUZ: "X"  ')).toBe('ANA LUZ X.xlsx');
    expect(nombreAdjuntoDesglose('1', 'A'.repeat(200))).toBe(`${'A'.repeat(80)}.xlsx`);
  });

  it('sin operador (o con un nombre vacío o solo símbolos): sigue `desglose-<bitácora>.xlsx`', () => {
    expect(armarCorreoDesglose(ctx).nombreAdjunto).toBe('desglose-1191.xlsx');
    expect(nombreAdjuntoDesglose('1191', '   ')).toBe('desglose-1191.xlsx');
    expect(nombreAdjuntoDesglose('1191', '///')).toBe('desglose-1191.xlsx');
  });
});
