import { describe, it, expect } from 'vitest';
import { csvConvenios, parsearMatrizConvenios, plantillaCsvConvenios, textoParaSistemaDeLaFlota, type ConvenioExportable } from './importador';
import { matrizDeArchivo } from '../importacion/archivo';

const ENC = ['Cliente', 'Convenio', 'Origen', 'Destino', 'Categoría', 'Instrucción', 'Momento', 'Lugar'];
const OK = { puedeVerFinanzas: false };

describe('parsearMatrizConvenios', () => {
  it('junta las filas del mismo (cliente, convenio) en un convenio con sus instrucciones', () => {
    const r = parsearMatrizConvenios([
      ENC,
      ['Cliente A', 'Ruta norte', 'Planta Zapopan', 'CEDIS Tlaquepaque', 'puerta', 'Puerta 3', 'ambos', 'destino'],
      ['cliente a', 'ruta  norte', '', '', 'Con quién reportarse', 'Sr. Ramírez', 'acercamiento', 'descarga'],
      ['Cliente A', 'Ruta sur', 'Planta Zapopan', 'Bodega Sur', '', '', '', ''],
    ], OK);
    expect(r.errores).toEqual([]);
    expect(r.convenios).toHaveLength(2);
    const [n, s] = r.convenios;
    expect(n.instrucciones).toEqual([
      { categoria: 'puerta', texto: 'Puerta 3', momento: 'ambos', lugar: 'destino', orden: 0 },
      { categoria: 'reportarse', texto: 'Sr. Ramírez', momento: 'acercamiento', lugar: 'destino', orden: 1 },
    ]);
    expect(n.origen).toBe('Planta Zapopan');
    expect(s.instrucciones).toEqual([]); // la fila sin instrucción solo define el convenio
  });

  it('es todo o nada y dice la fila de cada problema', () => {
    const r = parsearMatrizConvenios([
      ENC,
      ['A', 'x', '', '', 'puerta', 'ok', '', ''],
      ['', 'x', '', '', 'puerta', 'sin cliente', '', ''],
      ['A', 'x', '', '', 'inventada', 'texto', '', ''],
      ['A', 'x', '', '', 'puerta', 'texto', 'nunca', ''],
      ['A', 'x', '', '', 'puerta', 'texto', '', 'afuera'],
      ['A', 'x', '', '', 'puerta', '', '', ''],
    ], OK);
    expect(r.convenios).toEqual([]);
    expect(r.errores.map((e) => e.fila)).toEqual([3, 4, 5, 6, 7]);
    expect(r.errores[1].motivo).toMatch(/categoría «inventada»/);
  });

  it('una contradicción entre filas del mismo convenio se rechaza', () => {
    const r = parsearMatrizConvenios([ENC, ['A', 'x', 'Norte', 'Sur', '', '', '', ''], ['A', 'x', 'Otro', '', 'puerta', 'p', '', '']], OK);
    expect(r.errores[0]).toMatchObject({ fila: 3 });
    expect(r.errores[0].motivo).toContain('fila 2');
  });

  it('exige las columnas cliente y convenio', () => {
    expect(parsearMatrizConvenios([['Origen', 'Destino'], ['a', 'b']], OK).errores.map((e) => e.motivo).join()).toMatch(/«cliente».*«convenio»/);
    expect(parsearMatrizConvenios([], OK).errores[0].motivo).toMatch(/vacío/);
  });

  it('deja pasar la misma instrucción repetida (es una) y descarta la fila de ejemplo de la plantilla', () => {
    const r = parsearMatrizConvenios([
      ENC, ['A', 'x', '', '', 'puerta', 'P3', '', ''], ['A', 'x', '', '', 'puerta', 'P3', '', ''], ['Cliente de ejemplo', 'EJEMPLO — bórrame', '', '', 'puerta', 'x', '', ''],
    ], OK);
    expect(r.errores).toEqual([]);
    expect(r.convenios).toHaveLength(1);
    expect(r.convenios[0].instrucciones).toHaveLength(1);
  });

  it('las fechas aceptan ISO, DD/MM/AAAA y serial de Excel; una imposible se rechaza', () => {
    const f = (d: unknown, h: unknown) => parsearMatrizConvenios([[...ENC, 'Vigente desde', 'Vigente hasta'], ['A', 'x', '', '', '', '', '', '', d, h]], OK);
    expect(f('2026-03-05', '05/04/2026').convenios[0]).toMatchObject({ vigenteDesde: '2026-03-05', vigenteHasta: '2026-04-05' });
    expect(f(46_082, null).convenios[0].vigenteDesde).toBe('2026-03-01');
    expect(f('31/02/2026', null).errores[0].motivo).toMatch(/vigente desde/);
    expect(f('2026-05-01', '2026-04-01').errores[0].motivo).toMatch(/antes de empezar/);
  });

  describe('dinero', () => {
    const CON = [...ENC, 'Tarifa modo', 'Tarifa precio', 'Moneda', 'Requisitos de cobro'];
    it('sin permiso de finanzas un archivo con tarifa se rechaza entero (no se descartan columnas en silencio)', () => {
      const r = parsearMatrizConvenios([CON, ['A', 'x', '', '', '', '', '', '', 'por_viaje', '5000', 'MXN', 'Factura']], OK);
      expect(r.convenios).toEqual([]);
      expect(r.errores[0].motivo).toMatch(/solo quien ve finanzas/);
    });
    it('con permiso lee tarifa, moneda y requisitos', () => {
      const r = parsearMatrizConvenios([CON, ['A', 'x', '', '', '', '', '', '', 'por viaje', '$12,500.50', 'usd', 'Factura | Carta porte; Sello']], { puedeVerFinanzas: true });
      expect(r.errores).toEqual([]);
      expect(r.convenios[0].comercial).toEqual({ modo: 'por_viaje', precio: 12500.5, moneda: 'USD', requisitos: ['Factura', 'Carta porte', 'Sello'] });
    });
    it('modo y precio van juntos', () => {
      const r = parsearMatrizConvenios([CON, ['A', 'x', '', '', '', '', '', '', '', '5000', '', '']], { puedeVerFinanzas: true });
      expect(r.errores[0].motivo).toMatch(/modo y precio juntos/);
    });
  });

  it('el archivo de la plantilla se lee de vuelta (CSV real a través del lector xlsx)', () => {
    const csv = plantillaCsvConvenios({ conFinanzas: true });
    const m = matrizDeArchivo(new TextEncoder().encode(csv).buffer as ArrayBuffer);
    // solo la fila de ejemplo: se descarta y queda «no trae ningún convenio»
    expect(parsearMatrizConvenios(m, { puedeVerFinanzas: true }).errores[0].motivo).toMatch(/ningún convenio/);
  });
});

describe('exportación', () => {
  const C: ConvenioExportable = {
    cliente: 'Cliente A', nombre: 'Ruta norte', origen: 'Zapopan', destino: 'Tlaquepaque', vigenteDesde: null, vigenteHasta: null, notas: null,
    instrucciones: [
      { categoria: 'puerta', texto: 'Puerta 3, "lado poniente"', momento: 'ambos', lugar: 'destino', orden: 0 },
      { categoria: 'documentos', texto: '=HYPERLINK("x")', momento: 'despacho', lugar: 'ambos', orden: 1 },
    ],
    comercial: { modo: 'por_viaje', precio: 5000, moneda: 'MXN', requisitos: ['Factura'] },
  };
  it('sin finanzas NO lleva tarifa ni requisitos de cobro', () => {
    const csv = csvConvenios([C], { conFinanzas: false });
    expect(csv).not.toMatch(/tarifa|5000|Factura/i);
  });
  it('con finanzas los lleva, y escapa comillas y fórmulas', () => {
    const csv = csvConvenios([C], { conFinanzas: true });
    expect(csv).toContain('5000');
    expect(csv).toContain('"Puerta 3, ""lado poniente"""');
    expect(csv).toContain("'=HYPERLINK");
  });
  it('lo que se exporta se vuelve a importar igual (ida y vuelta)', () => {
    const csv = csvConvenios([{ ...C, instrucciones: [C.instrucciones[0]] }], { conFinanzas: true });
    const m = matrizDeArchivo(new TextEncoder().encode(csv).buffer as ArrayBuffer);
    const r = parsearMatrizConvenios(m, { puedeVerFinanzas: true });
    expect(r.errores).toEqual([]);
    expect(r.convenios[0].instrucciones).toEqual([C.instrucciones[0]]);
    expect(r.convenios[0].comercial?.precio).toBe(5000);
  });
  it('el texto para el sistema de la flota no lleva dinero y marca la planta', () => {
    const t = textoParaSistemaDeLaFlota(C);
    expect(t).toContain('Cliente A — Ruta norte (Zapopan → Tlaquepaque)');
    expect(t).toContain('- Por dónde entras [al descargar]: Puerta 3');
    expect(t).not.toMatch(/5000|Factura/);
    expect(textoParaSistemaDeLaFlota({ ...C, instrucciones: [] })).toContain('sin instrucciones');
  });
});
