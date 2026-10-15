import { describe, expect, it } from 'vitest';
import {
  COLUMNAS_PROGRAMA, ENCABEZADOS_PROGRAMA, INDICE_LATERAL, construirProgramaSintetico,
  construirProgramaSinteticoConOraculo,
} from './fixtures';

const lineasDe = (t: string) => t.split('\n').filter((_, i, a) => i < a.length - 1 || _ !== '');
const columnasDe = (l: string) => l.replace(/\r$/, '').split(';').length;

describe('fixtures del programa de despacho', () => {
  it('cada fila tiene 16 383 columnas', () => {
    const { texto, oraculo } = construirProgramaSinteticoConOraculo({ dias: 3 });
    const ls = lineasDe(texto);
    expect(ls.length).toBe(oraculo.resumen.lineasTotales);
    for (const l of ls) expect(columnasDe(l)).toBe(COLUMNAS_PROGRAMA);
  });

  it('un solo encabezado por sección: 3 días con una sección = 3 encabezados repetidos', () => {
    const { texto, oraculo } = construirProgramaSinteticoConOraculo({ dias: 3, secciones: ['IMPORTACION'] });
    const encabezados = lineasDe(texto).filter((l) => l.startsWith('#;SUC;TIPO DE VIAJE;ORIGEN-DESTINO;'));
    expect(encabezados).toHaveLength(3);
    expect(oraculo.resumen.encabezados).toBe(3);
    // «COMENTARIOS» aparece dos veces en cada encabezado.
    expect(encabezados[0].split(';').filter((c) => c === 'COMENTARIOS')).toHaveLength(2);
    expect(ENCABEZADOS_PROGRAMA.filter((c) => c === 'COMENTARIOS')).toHaveLength(2);
  });

  it('con las cinco secciones hay un encabezado y un título por sección y día', () => {
    const { oraculo } = construirProgramaSinteticoConOraculo({ dias: 3 });
    expect(oraculo.secciones).toHaveLength(15);
    expect(oraculo.resumen.encabezados).toBe(15);
    expect(oraculo.resumen.titulos).toBe(15);
  });

  it('el conteo del oráculo coincide con los datos puestos en el texto', () => {
    const { texto, oraculo } = construirProgramaSinteticoConOraculo({ dias: 3, filasPorSeccion: 12 });
    expect(oraculo.filas).toHaveLength(3 * 5 * 12);
    expect(oraculo.resumen.filasDatos).toBe(oraculo.filas.length);
    const ls = lineasDe(texto);
    // Cada fila del oráculo apunta a su línea real y la fila de esa línea trae su caja y unidad.
    for (const f of oraculo.filas) {
      const celdas = ls[f.lineaCsv - 1].replace(/\r$/, '').split(';');
      expect((celdas[7] ?? '').trim().toUpperCase() || null).toBe(f.caja);
      expect((celdas[11] ?? '').trim().toUpperCase() || null).toBe(f.unidad);
      expect(celdas[3]).toBe(f.origenDestino);
    }
    // Filas de datos + títulos + encabezados + vacías = todas las líneas.
    const r = oraculo.resumen;
    expect(r.filasDatos + r.titulos + r.encabezados + oraculo.lineasVacias.length).toBe(r.lineasTotales);
    expect(r.conCaja + r.sinCaja).toBe(r.filasDatos);
    expect(r.porTipo.IMPORTACION + r.porTipo.EXPORTACION + r.porTipo.CANCELACIONES + r.porTipo.DOMESTICO
      + r.porTipo.MOV_VACIO).toBe(r.filasDatos);
  });

  it('es determinista: misma semilla, mismo texto; otra semilla, otro texto', () => {
    const a = construirProgramaSintetico({ semilla: 7, columnas: 40 });
    expect(construirProgramaSintetico({ semilla: 7, columnas: 40 })).toBe(a);
    expect(construirProgramaSintetico({ semilla: 8, columnas: 40 })).not.toBe(a);
  });

  it('títulos: con cifra, sin cifra, sin sufijo, con espacios dobles y fecha en español sin acentos', () => {
    const { oraculo, texto } = construirProgramaSinteticoConOraculo({ dias: 3, columnas: 30 });
    const ls = lineasDe(texto);
    const titulo = (i: number) => ls[oraculo.secciones[i].lineaTitulo - 1].split(';')[0];
    const impo = oraculo.secciones.filter((s) => s.tipo === 'IMPORTACION').map((s) => ls[s.lineaTitulo - 1].split(';')[0]);
    expect(impo[0]).toMatch(/^IMPORTACION LUNES 05 DE OCTUBRE 2026 \/\/\/ \d+ UNIDADES DISPONIBLES/);
    expect(impo[1]).toContain('IMPORTACION  MARTES 06 DE OCTUBRE  2026'); // espacios dobles
    expect(impo[2]).toMatch(/\/\/\/ UNIDADES DISPONIBLES/); // sin cifra
    const expo = oraculo.secciones.filter((s) => s.tipo === 'EXPORTACION').map((s) => ls[s.lineaTitulo - 1].split(';')[0]);
    expect(expo[0]).toBe('EXPORTACION LUNES 05 DE OCTUBRE 2026'); // sin sufijo
    expect(expo[2]).toBe('EXPORTACION MIERCOLES 07 DE OCTUBRE 2026');
    const canc = oraculo.secciones.find((s) => s.tipo === 'CANCELACIONES')!;
    expect(titulo(oraculo.secciones.indexOf(canc))).toBe('CANCELACIONES');
    expect(canc.fechaPropia).toBe(false);
    const dom = oraculo.secciones.find((s) => s.tipo === 'DOMESTICO')!;
    expect(ls[dom.lineaTitulo - 1].split(';')[0]).toBe('DOMESTICO MTY-GDL');
    const vacio = oraculo.secciones.find((s) => s.tipo === 'MOV_VACIO')!;
    expect(ls[vacio.lineaTitulo - 1].split(';')[0]).toBe('MOV VACIO GDL - SIL - GDL');
    // Los días se numeran con su fecha de pared.
    expect(oraculo.secciones.filter((s) => s.tipo === 'IMPORTACION').map((s) => s.fecha))
      .toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
  });

  it('tabla lateral: desde la columna 20, marca de tiempo con comilla final, sin tocar las columnas del programa', () => {
    const { texto, oraculo } = construirProgramaSinteticoConOraculo({ dias: 1, secciones: ['IMPORTACION'], filasPorSeccion: 14 });
    expect(oraculo.lateral.length).toBeGreaterThan(0);
    const ls = lineasDe(texto);
    for (const lat of oraculo.lateral) {
      const celdas = ls[lat.lineaCsv - 1].replace(/\r$/, '').split(';');
      expect(celdas.slice(INDICE_LATERAL, INDICE_LATERAL + 5))
        .toEqual([lat.consecutivo, lat.unidad, lat.marcaTiempo, lat.codigo, lat.letra]);
      expect(lat.marcaTiempo.endsWith('"')).toBe(true);
      expect(celdas.slice(17, INDICE_LATERAL).every((c) => c === '')).toBe(true);
    }
  });

  it('casos sucios presentes y reflejados en el oráculo', () => {
    const { texto, oraculo } = construirProgramaSinteticoConOraculo({ dias: 1, secciones: ['IMPORTACION'], filasPorSeccion: 12 });
    const ls = lineasDe(texto);
    const f = (num: number) => oraculo.filas.find((x) => x.num === num)!;
    const celda = (fila: { lineaCsv: number }, idx: number) => ls[fila.lineaCsv - 1].replace(/\r$/, '').split(';')[idx];
    expect(celda(f(1), 6)).toMatch(/ $/); // LINEA con espacio final
    expect(f(1).linea).toMatch(/^[A-Z]+$/); // el oráculo la trae con trim
    expect(f(2).citaTexto).toBe('DIRECTO');
    expect(celda(f(3), 9)).toBe('8:00');
    expect(f(3).citaLocal).toBe('2026-10-05T08:00');
    expect(celda(f(4), 14)).toBe('550');
    expect(f(4).ccp).toBe('desconocido');
    expect(f(5).ccp).toBe('falta_complemento');
    expect(f(6).transito).toBe('vacio'); // solo un espacio
    expect(f(7).caja).toBeNull(); expect(f(7).unidad).not.toBeNull(); // unidad sin caja
    expect(f(8).caja).not.toBeNull(); expect(f(8).unidad).toBeNull(); // caja sin unidad
    expect(f(9).descartable).toBe(true);
    // fila sin '#': hay datos pero la columna 0 está vacía
    const sinNum = oraculo.filas.find((x) => x.num === null)!;
    expect(celda(sinNum, 0)).toBe('');
    expect(sinNum.cliente).not.toBeNull();
    // fila con CRLF
    expect(ls.some((l) => l.endsWith('\r'))).toBe(true);
    // fila totalmente vacía
    expect(oraculo.lineasVacias).toHaveLength(1);
    expect(ls[oraculo.lineasVacias[0] - 1].replace(/\r$/, '').split(';').every((c) => c === '')).toBe(true);
    // el resumen cuenta unidad sin caja y caja sin unidad
    expect(oraculo.resumen.unidadSinCaja).toBeGreaterThanOrEqual(1);
    expect(oraculo.resumen.cajaSinUnidad).toBeGreaterThanOrEqual(1);
  });

  it('las cajas son texto: los ceros a la izquierda se conservan y la unidad numérica sigue siendo texto', () => {
    const { oraculo } = construirProgramaSinteticoConOraculo({ dias: 1, secciones: ['EXPORTACION'], filasPorSeccion: 12 });
    expect(oraculo.filas.some((f) => f.caja && /^00\d+$/.test(f.caja))).toBe(true);
    expect(oraculo.filas.some((f) => f.unidad && /^\d+$/.test(f.unidad))).toBe(true);
    for (const f of oraculo.filas) { if (f.caja) expect(typeof f.caja).toBe('string'); }
  });

  it('sin casos sucios: ninguna fila degenerada', () => {
    const { oraculo, texto } = construirProgramaSinteticoConOraculo({ dias: 2, sucios: false, columnas: 30 });
    expect(oraculo.lineasVacias).toHaveLength(0);
    expect(texto.includes('\r')).toBe(false);
    expect(oraculo.filas.every((f) => f.num !== null && !f.descartable)).toBe(true);
  });

  it('prueba de tope: 70 000 filas exactas (con ancho reducido para no materializar 1 GB)', () => {
    const { texto, oraculo } = construirProgramaSinteticoConOraculo({ totalFilas: 70_000, dias: 14, columnas: 26 });
    expect(oraculo.filas).toHaveLength(70_000);
    expect(oraculo.resumen.filasDatos).toBe(70_000);
    expect(oraculo.resumen.encabezados).toBe(14 * 5);
    expect(texto.split('\n').length - 1).toBe(oraculo.resumen.lineasTotales);
  });

  it('opciones inválidas fallan con RangeError', () => {
    expect(() => construirProgramaSintetico({ columnas: 5 })).toThrow(RangeError);
    expect(() => construirProgramaSintetico({ dias: 0 })).toThrow(RangeError);
    expect(() => construirProgramaSintetico({ fechaInicio: 'x-y-z' })).toThrow(RangeError);
  });
});
