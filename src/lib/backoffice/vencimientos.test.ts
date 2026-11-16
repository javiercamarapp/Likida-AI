import { describe, expect, it } from 'vitest';
import { diasAlVencimiento, evaluarVencimiento, ordenarPorUrgencia, resumenVencimientos, vencimientosPorMes, ventanaDe, VENTANAS_POR_TIPO, type EntradaVencimiento } from './vencimientos';

const HOY = '2026-11-15';
const en = (dias: number): string => new Date(Date.UTC(2026, 10, 15 + dias)).toISOString().slice(0, 10);
const e = (p: Partial<EntradaVencimiento>): EntradaVencimiento => ({ tipo: 'proveedor', estado: 'vigente', venceEl: null, responsable: 'Javier', ...p });

describe('diasAlVencimiento', () => {
  it('cuenta días de calendario, negativos si ya venció', () => {
    expect(diasAlVencimiento('2026-11-15', HOY)).toBe(0);
    expect(diasAlVencimiento('2026-11-16', HOY)).toBe(1);
    expect(diasAlVencimiento('2026-11-14', HOY)).toBe(-1);
    expect(diasAlVencimiento('2027-01-01', '2026-12-31')).toBe(1);
  });
  it('null o fecha inválida da null, nunca 0', () => {
    expect(diasAlVencimiento(null, HOY)).toBeNull();
    expect(diasAlVencimiento('2026-02-30', HOY)).toBeNull();
    expect(diasAlVencimiento('15/11/2026', HOY)).toBeNull();
    expect(diasAlVencimiento('2026-11-15', 'ayer')).toBeNull();
  });
});

describe('ventanas por tipo (prompt del vigía)', () => {
  it('cliente 60/30, suscripción 15, dominio 30, legal 10/3', () => {
    expect(VENTANAS_POR_TIPO.cliente).toEqual([60, 30]);
    expect(VENTANAS_POR_TIPO.suscripcion).toEqual([15]);
    expect(VENTANAS_POR_TIPO.dominio).toEqual([30]);
    expect(VENTANAS_POR_TIPO.legal_pendiente).toEqual([10, 3]);
  });
  it('un tipo sin ventana fija usa la de la fila, y si no hay, DIAS_AVISO (30)', () => {
    expect(ventanaDe('proveedor', [7, 45, 7])).toEqual([45, 7]);
    expect(ventanaDe('otro', [])).toEqual([30]);
    expect(ventanaDe('otro', null)).toEqual([30]);
  });
  it('la ventana fija manda sobre dias_aviso de la fila', () => {
    expect(ventanaDe('cliente', [5])).toEqual([60, 30]);
  });
});

describe('evaluarVencimiento: frontera de ventana', () => {
  it('cliente: 60 días exactos entra; 61 no; 0 vence hoy; -1 vencido', () => {
    expect(evaluarVencimiento(e({ tipo: 'cliente', venceEl: en(60) }), HOY)).toMatchObject({ dentroDeVentana: true, estado: 'por_vencer', avisoActual: 60 });
    expect(evaluarVencimiento(e({ tipo: 'cliente', venceEl: en(61) }), HOY)).toMatchObject({ dentroDeVentana: false, estado: 'vigente', avisoActual: null });
    expect(evaluarVencimiento(e({ tipo: 'cliente', venceEl: en(0) }), HOY)).toMatchObject({ dentroDeVentana: true, dias: 0, avisoActual: 30 });
    expect(evaluarVencimiento(e({ tipo: 'cliente', venceEl: en(-1) }), HOY)).toMatchObject({ estado: 'vencido', nivel: 'vencido', dias: -1, dentroDeVentana: false });
  });
  it('cliente a 45 días: aviso de 60 días; a 30, el de 30', () => {
    expect(evaluarVencimiento(e({ tipo: 'cliente', venceEl: en(45) }), HOY).avisoActual).toBe(60);
    expect(evaluarVencimiento(e({ tipo: 'cliente', venceEl: en(30) }), HOY).avisoActual).toBe(30);
  });
  it('suscripción: 15 entra, 16 no', () => {
    expect(evaluarVencimiento(e({ tipo: 'suscripcion', venceEl: en(15) }), HOY).dentroDeVentana).toBe(true);
    expect(evaluarVencimiento(e({ tipo: 'suscripcion', venceEl: en(16) }), HOY).dentroDeVentana).toBe(false);
  });
  it('dominio: 30 entra, 31 no', () => {
    expect(evaluarVencimiento(e({ tipo: 'dominio', venceEl: en(30) }), HOY).dentroDeVentana).toBe(true);
    expect(evaluarVencimiento(e({ tipo: 'dominio', venceEl: en(31) }), HOY).dentroDeVentana).toBe(false);
  });
  it('documento legal: 10 entra (próximo), 9 es urgente, 11 no entra', () => {
    expect(evaluarVencimiento(e({ tipo: 'legal_pendiente', venceEl: en(10) }), HOY)).toMatchObject({ dentroDeVentana: true, nivel: 'proximo' });
    expect(evaluarVencimiento(e({ tipo: 'legal_pendiente', venceEl: en(9) }), HOY).nivel).toBe('urgente');
    expect(evaluarVencimiento(e({ tipo: 'legal_pendiente', venceEl: en(11) }), HOY).dentroDeVentana).toBe(false);
  });
  it('un contrato fuera de ventana no es urgente ni próximo', () => {
    expect(evaluarVencimiento(e({ tipo: 'suscripcion', venceEl: en(200) }), HOY).nivel).toBe('fuera');
  });
});

describe('evaluarVencimiento: sin fecha y estados', () => {
  it('venceEl null NUNCA es vigente: es sin_dato con hallazgo sin_fecha', () => {
    const v = evaluarVencimiento(e({ tipo: 'suscripcion', venceEl: null }), HOY);
    expect(v.estado).toBe('sin_dato');
    expect(v.estado).not.toBe('vigente');
    expect(v.nivel).toBe('sin_fecha');
    expect(v.dias).toBeNull();
    expect(v.hallazgos).toContain('sin_fecha');
  });
  it('créditos sin fecha: «No vence», sin hallazgo de fecha', () => {
    const v = evaluarVencimiento(e({ tipo: 'creditos', venceEl: null }), HOY);
    expect(v).toMatchObject({ estado: 'no_vence', noVence: true, dentroDeVentana: false });
    expect(v.hallazgos).not.toContain('sin_fecha');
  });
  it('créditos con fecha sí vencen, con la ventana de la fila', () => {
    const v = evaluarVencimiento(e({ tipo: 'creditos', venceEl: en(20), diasAviso: [30] }), HOY);
    expect(v).toMatchObject({ noVence: false, dentroDeVentana: true });
  });
  it('terminado y borrador son inactivos: no avisan aunque la fecha esté vencida', () => {
    for (const estado of ['terminado', 'borrador'] as const) {
      const v = evaluarVencimiento(e({ estado, venceEl: en(-100) }), HOY);
      expect(v).toMatchObject({ estado: 'inactivo', dentroDeVentana: false });
      expect(v.hallazgos).toEqual([]);
    }
  });
  it('sin responsable es hallazgo; con responsable en blanco también', () => {
    expect(evaluarVencimiento(e({ venceEl: en(5), responsable: null }), HOY).hallazgos).toContain('sin_responsable');
    expect(evaluarVencimiento(e({ venceEl: en(5), responsable: '  ' }), HOY).hallazgos).toContain('sin_responsable');
    expect(evaluarVencimiento(e({ venceEl: en(5), responsable: 'Javier' }), HOY).hallazgos).toEqual([]);
  });
});

describe('ordenarPorUrgencia', () => {
  it('menos días primero, vencidos al frente, null al final, sin mutar', () => {
    const items = [{ n: 'a', d: 20 }, { n: 'b', d: null }, { n: 'c', d: -3 }, { n: 'd', d: 2 }, { n: 'e', d: null }];
    const copia = [...items];
    expect(ordenarPorUrgencia(items, (x) => x.d).map((x) => x.n)).toEqual(['c', 'd', 'a', 'b', 'e']);
    expect(items).toEqual(copia);
  });
});

describe('resumenVencimientos y vencimientosPorMes', () => {
  const filas = [
    { tipo: 'cliente' as const, venceEl: en(10), ev: evaluarVencimiento(e({ tipo: 'cliente', venceEl: en(10) }), HOY) },
    { tipo: 'suscripcion' as const, venceEl: en(-4), ev: evaluarVencimiento(e({ tipo: 'suscripcion', venceEl: en(-4), responsable: null }), HOY) },
    { tipo: 'dominio' as const, venceEl: null, ev: evaluarVencimiento(e({ tipo: 'dominio', venceEl: null }), HOY) },
    { tipo: 'creditos' as const, venceEl: null, ev: evaluarVencimiento(e({ tipo: 'creditos', venceEl: null }), HOY) },
    { tipo: 'otro' as const, venceEl: en(300), ev: evaluarVencimiento(e({ tipo: 'otro', estado: 'terminado', venceEl: en(300) }), HOY) },
  ];
  it('cuenta vivos, ventana, vencidos, sin fecha (sin créditos), sin responsable y clientes', () => {
    expect(resumenVencimientos(filas)).toEqual({ vivos: 4, vencenEnVentana: 1, vencidos: 1, sinFecha: 1, sinResponsable: 1, clientesVivos: 1, noVencen: 1 });
  });
  it('sin contratos de cliente: 0 clientes vivos es un estado real', () => {
    expect(resumenVencimientos([]).clientesVivos).toBe(0);
    expect(resumenVencimientos([]).vivos).toBe(0);
  });
  it('12 meses desde el actual; vencidos, sin fecha y terminados no entran', () => {
    const m = vencimientosPorMes(filas, HOY);
    expect(m).toHaveLength(12);
    expect(m[0].mes).toBe('2026-11');
    expect(m[2].mes).toBe('2027-01');
    expect(m[11].mes).toBe('2027-10');
    expect(m.reduce((s, x) => s + x.n, 0)).toBe(1);
    expect(m[0].n).toBe(1);
  });
});
