import { describe, expect, it } from 'vitest';
import { construirProgramaSinteticoConOraculo } from './fixtures';
import { ErrorLectorPrograma, leerFechaTitulo, leerProgramaCsv } from './lector';

const T = { terminal: 'GDL' };

describe('leerProgramaCsv · estructura', () => {
  it('(a) fixture de 3 días: N filas por sección y fecha correcta en cada una', () => {
    const { texto, oraculo } = construirProgramaSinteticoConOraculo({ dias: 3, filasPorSeccion: 12 });
    const r = leerProgramaCsv(texto, T);
    expect(r.secciones).toHaveLength(oraculo.secciones.length);
    expect(r.filas).toHaveLength(oraculo.filas.length);
    r.secciones.forEach((s, i) => {
      const o = oraculo.secciones[i];
      expect(s.tipo).toBe(o.tipo);
      expect(s.fecha).toBe(o.fecha);
      expect(s.fechaPropia).toBe(o.fechaPropia);
      expect(s.ruta).toBe(o.rutaSeccion);
      expect(s.lineaTitulo).toBe(o.lineaTitulo);
      expect(s.lineaEncabezado).toBe(o.lineaEncabezado);
      expect(s.filas).toBe(o.filas);
    });
    // Cada fila cae en la sección y línea que dice el oráculo, con su caja y unidad crudas.
    r.filas.forEach((f, i) => {
      const o = oraculo.filas[i];
      expect(f.lineaCsv).toBe(o.lineaCsv);
      expect(r.secciones[f.seccion].fecha).toBe(o.fecha);
      expect(r.secciones[f.seccion].tipo).toBe(o.tipo);
      expect(f.celdas['ORIGEN-DESTINO']).toBe(o.origenDestino);
      expect(f.celdas.CAJA.trim().toUpperCase() || null).toBe(o.caja);
      expect(f.celdas.UNIDAD.trim().toUpperCase() || null).toBe(o.unidad);
    });
    expect(r.resumen.filasLeidas).toBe(oraculo.resumen.filasDatos);
    expect(r.resumen.terminal).toBe('GDL');
    expect(r.resumen.delimitador).toBe(';');
  });

  it('(b) el encabezado repetido no genera filas ni avisos', () => {
    const { texto, oraculo } = construirProgramaSinteticoConOraculo({ dias: 3, secciones: ['IMPORTACION'] });
    const r = leerProgramaCsv(texto, T);
    expect(oraculo.resumen.encabezados).toBe(3);
    expect(r.filas).toHaveLength(oraculo.resumen.filasDatos);
    expect(r.avisos).toEqual([]);
    // Ninguna fila es un encabezado disfrazado.
    expect(r.filas.some((f) => f.celdas.CAJA.trim().toUpperCase() === 'CAJA')).toBe(false);
  });

  it('el segundo «COMENTARIOS» se lee como COMENTARIOS_2', () => {
    const { texto, oraculo } = construirProgramaSinteticoConOraculo({ dias: 2, filasPorSeccion: 20 });
    const r = leerProgramaCsv(texto, T);
    r.filas.forEach((f, i) => {
      const o = oraculo.filas[i];
      expect(f.celdas.COMENTARIOS.trim() || null).toBe(o.comentarios);
      expect(f.celdas.COMENTARIOS_2.trim() || null).toBe(o.comentarios2);
    });
    expect(r.filas.some((f) => f.celdas.COMENTARIOS_2.trim() !== '')).toBe(true);
  });

  it('(c) la tabla lateral no contamina CAJA ni UNIDAD y se devuelve aparte', () => {
    const { texto, oraculo } = construirProgramaSinteticoConOraculo({ dias: 3, filasPorSeccion: 14 });
    const r = leerProgramaCsv(texto, T);
    expect(oraculo.lateral.length).toBeGreaterThan(0);
    expect(r.lateral).toHaveLength(oraculo.lateral.length);
    r.lateral.forEach((l, i) => {
      const o = oraculo.lateral[i];
      expect(l.lineaCsv).toBe(o.lineaCsv);
      expect(l.celdas.slice(0, 5)).toEqual([o.consecutivo, o.unidad, o.marcaTiempo, o.codigo, o.letra]);
    });
    const unidadesLaterales = new Set(oraculo.lateral.map((l) => l.unidad));
    for (const f of r.filas) {
      const o = oraculo.filas.find((x) => x.lineaCsv === f.lineaCsv)!;
      expect(f.celdas.UNIDAD.trim().toUpperCase() || null).toBe(o.unidad);
      expect(unidadesLaterales.has(f.celdas.UNIDAD.trim())).toBe(false);
      // Una fila de programa solo trae columnas del programa.
      expect(Object.keys(f.celdas).length).toBeLessThanOrEqual(17);
    }
  });

  it('(d) título con y sin sufijo, con espacios dobles; CANCELACIONES hereda la fecha con aviso', () => {
    const { texto, oraculo } = construirProgramaSinteticoConOraculo({ dias: 3, filasPorSeccion: 2 });
    const r = leerProgramaCsv(texto, T);
    const impo = r.secciones.filter((s) => s.tipo === 'IMPORTACION');
    const expo = r.secciones.filter((s) => s.tipo === 'EXPORTACION');
    expect(impo.map((s) => s.fecha)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
    expect(expo.map((s) => s.fecha)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
    // Día impar del fixture: título con espacios dobles.
    expect(oraculo.secciones.length).toBe(15);
    const canc = r.secciones.filter((s) => s.tipo === 'CANCELACIONES');
    expect(canc).toHaveLength(3);
    for (const s of canc) {
      expect(s.fechaPropia).toBe(false);
      expect(s.fecha).not.toBeNull();
    }
    const avisosCanc = r.avisos.filter((a) => a.codigo === 'titulo_sin_fecha');
    // CANCELACIONES, DOMESTICO y MOV VACIO no traen fecha propia: 3 secciones x 3 días.
    expect(avisosCanc).toHaveLength(9);
    expect(avisosCanc[0].mensaje).toContain('2026-10-05');
    const dom = r.secciones.filter((s) => s.tipo === 'DOMESTICO');
    expect(dom.map((s) => s.ruta)).toEqual(['MTY-GDL', 'GDL - JUAREZ', 'JRZ-GDL']);
    expect(r.secciones.find((s) => s.tipo === 'MOV_VACIO')!.ruta).toBe('GDL - SIL - GDL');
  });

  it('leerFechaTitulo tolera espacios dobles, acentos y fechas imposibles', () => {
    expect(leerFechaTitulo('IMPORTACION LUNES 05 DE OCTUBRE  2026 /// 22 UNIDADES')).toBe('2026-10-05');
    expect(leerFechaTitulo('exportación sábado 24 de octubre 2026')).toBe('2026-10-24');
    expect(leerFechaTitulo('EXPORTACION 31 DE FEBRERO 2026')).toBeNull();
    expect(leerFechaTitulo('CANCELACIONES')).toBeNull();
  });

  it('(g) CRLF y BOM', () => {
    const { texto, oraculo } = construirProgramaSinteticoConOraculo({ dias: 2, filasPorSeccion: 12, columnas: 30 });
    const crlf = '﻿' + texto.replace(/\r?\n/g, '\r\n');
    const r = leerProgramaCsv(crlf, T);
    expect(r.filas).toHaveLength(oraculo.filas.length);
    expect(r.secciones[0].titulo.startsWith('IMPORTACION')).toBe(true);
    expect(r.filas.every((f) => !/[\r\n]/.test(Object.values(f.celdas).join('')))).toBe(true);
    // La fila con CRLF del fixture no arrastra «\r» al último campo.
    expect(r.filas[0].lineaCsv).toBe(oraculo.filas[0].lineaCsv);
  });

  it('detecta «,» solo cuando no hay «;»', () => {
    const csv = [
      'EXPORTACION LUNES 05 DE OCTUBRE 2026',
      '#,SUC,TIPO DE VIAJE,ORIGEN-DESTINO,CLIENTE,CONSIGNATARIO,LINEA,CAJA,COMENTARIOS,CITA,CITA LIMITE,UNIDAD',
      '1,GDL,EXPO,GDL-NLD,CLIENTE SINT 01,CONSIG SINT A,LNA,ZC0001,,05/10/2026 8:00,,ZU0001',
    ].join('\n');
    const r = leerProgramaCsv(csv, T);
    expect(r.resumen.delimitador).toBe(',');
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].celdas.CAJA).toBe('ZC0001');
    expect(r.filas[0].celdas.UNIDAD).toBe('ZU0001');
  });

  it('encabezado desconocido y columna faltante generan aviso, no error', () => {
    const csv = [
      'EXPORTACION LUNES 05 DE OCTUBRE 2026',
      '#;ORIGEN-DESTINO;CAJA;COLOR RARO',
      '1;GDL-NLD;ZC0001;ROJO',
    ].join('\n');
    const r = leerProgramaCsv(csv, T);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].celdas['COLOR RARO']).toBe('ROJO');
    expect(r.avisos.map((a) => a.codigo).sort()).toEqual(['columna_faltante', 'encabezado_desconocido']);
  });

  it('no exige folio ni columna «#» y conserva lineaCsv 1-based', () => {
    const csv = [
      'IMPORTACION LUNES 05 DE OCTUBRE 2026',
      'ORIGEN-DESTINO;CLIENTE;CAJA;UNIDAD',
      '',
      'NLD-GDL;CLIENTE SINT 01;ZC0001;ZU0001',
    ].join('\n');
    const r = leerProgramaCsv(csv, T);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].lineaCsv).toBe(4);
  });
});

describe('leerProgramaCsv · tope y errores', () => {
  it('(e) 70 000 filas: lee 60 000 y avisa con la cifra', () => {
    const { texto } = construirProgramaSinteticoConOraculo({ dias: 7, totalFilas: 70_000, columnas: 26, sucios: false });
    const r = leerProgramaCsv(texto, T);
    expect(r.filas).toHaveLength(60_000);
    expect(r.resumen.filasEncontradas).toBe(70_000);
    const a = r.avisos.find((x) => x.codigo === 'tope_filas');
    expect(a).toBeDefined();
    expect(a!.mensaje).toContain('se leyeron 60 000 de 70 000');
  });

  it('el tope es configurable y no avisa si no se rebasa', () => {
    const { texto, oraculo } = construirProgramaSinteticoConOraculo({ dias: 1, filasPorSeccion: 6, columnas: 30 });
    const corto = leerProgramaCsv(texto, { terminal: 'GDL', topeFilas: 10 });
    expect(corto.filas).toHaveLength(10);
    expect(corto.avisos.some((a) => a.mensaje.includes(`de ${oraculo.filas.length}`))).toBe(true);
    const completo = leerProgramaCsv(texto, { terminal: 'GDL', topeFilas: 1000 });
    expect(completo.avisos.some((a) => a.codigo === 'tope_filas')).toBe(false);
  });

  it('(f) archivo vacío o sin encabezados → error en lenguaje llano', () => {
    expect(() => leerProgramaCsv('', T)).toThrow(ErrorLectorPrograma);
    expect(() => leerProgramaCsv(' \n;;;\n', T)).toThrow(/vac/);
    expect(() => leerProgramaCsv('hola;mundo\n1;2\n', T)).toThrow(/encabezados/);
    try {
      leerProgramaCsv('IMPORTACION LUNES 05 DE OCTUBRE 2026\n1;2;3\n', T);
      throw new Error('debió fallar');
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorLectorPrograma);
      expect((e as Error).message).toMatch(/ORIGEN-DESTINO/);
    }
  });

  it('(h) memoria: 5 000 filas × 16 383 columnas no retiene el relleno', () => {
    const { texto, oraculo } = construirProgramaSinteticoConOraculo({ dias: 5, totalFilas: 5_000, sucios: false });
    expect(oraculo.resumen.columnas).toBe(16_383);
    const r = leerProgramaCsv(texto, T);
    expect(r.filas).toHaveLength(5_000);
    let retenidos = 0;
    let celdasMax = 0;
    for (const f of r.filas) {
      const valores = Object.values(f.celdas);
      celdasMax = Math.max(celdasMax, valores.length);
      for (const v of valores) retenidos += v.length;
    }
    for (const l of r.lateral) for (const c of l.celdas) retenidos += c.length;
    // Contenido real ~150 caracteres por fila; el presupuesto es 2 000 caracteres por fila.
    expect(retenidos).toBeLessThan(5_000 * 400);
    expect(celdasMax).toBeLessThanOrEqual(17);
    // El texto de entrada pesa ~80 M caracteres; lo retenido es una fracción mínima.
    expect(texto.length).toBeGreaterThan(5_000 * 16_000);
    expect(retenidos / texto.length).toBeLessThan(0.01);
  }, 60_000);
});

describe('leerProgramaCsv · encabezado por mayoría de rótulos (T-A4-49)', () => {
  const ENC = '#;SUC;TIPO DE VIAJE;ORIGEN-DESTINO;CLIENTE;CONSIGNATARIO;LINEA;CAJA;COMENTARIOS;CITA;UNIDAD;TRANSITO;CCP';
  const DATOS = '1;GDL;IMP;PUERTO-PLANTA;CLIENTE X;DEST Y;LNA;ABCD123456;;05/10 08:00;U-01;EN RUTA;SI';

  it('encabezado en la fila 1: se elige y no hay avisos de estructura', () => {
    const r = leerProgramaCsv(`${ENC}\n${DATOS}\n`, T);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].celdas.CAJA).toBe('ABCD123456');
    expect(r.secciones[0].lineaEncabezado).toBe(1);
    expect(r.avisos.filter((a) => a.codigo === 'columna_faltante' || a.codigo === 'encabezado_desconocido')).toEqual([]);
  });

  it('encabezado en la fila 3 tras una fila de título y una vacía', () => {
    const r = leerProgramaCsv(`PROGRAMA DE DESPACHO SINTETICO\n\n${ENC}\n${DATOS}\n`, T);
    expect(r.filas).toHaveLength(1);
    expect(r.secciones[r.filas[0].seccion].lineaEncabezado).toBe(3);
    expect(r.filas[0].celdas.UNIDAD).toBe('U-01');
  });

  it('título con celdas combinadas (texto en la primera, resto vacío) y encabezado con huecos', () => {
    const titulo = 'IMPORTACION MARTES 06 DE OCTUBRE 2026;;;;;;;;;;;;';
    const encHuecos = '#;SUC;;ORIGEN-DESTINO;;CLIENTE;CONSIGNATARIO;LINEA;CAJA;;COMENTARIOS;CITA;;UNIDAD;TRANSITO;CCP';
    const dato = '1;GDL;;PUERTO-PLANTA;;CLIENTE X;DEST Y;LNA;ABCD123456;;;05/10 08:00;;U-01;EN RUTA;SI';
    const r = leerProgramaCsv(`${titulo}\n${encHuecos}\n${dato}\n`, T);
    expect(r.secciones[0].tipo).toBe('IMPORTACION');
    expect(r.secciones[0].fecha).toBe('2026-10-06');
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].celdas.CAJA).toBe('ABCD123456');
    expect(r.filas[0].celdas.UNIDAD).toBe('U-01');
  });

  it('encabezado sin CAJA ni ORIGEN-DESTINO exactos: basta la mayoría de rótulos, con aviso de las columnas faltantes', () => {
    const enc = '#;SUC;CLIENTE;CONSIGNATARIO;LINEA;CITA;UNIDAD;TRANSITO;CCP';
    const r = leerProgramaCsv(`${enc}\n1;GDL;CLIENTE X;DEST Y;LNA;05/10 08:00;U-01;EN RUTA;SI\n`, T);
    expect(r.filas).toHaveLength(1);
    const falta = r.avisos.find((a) => a.codigo === 'columna_faltante');
    expect(falta?.mensaje).toMatch(/ORIGEN-DESTINO/);
    expect(falta?.mensaje).toMatch(/CAJA/);
  });

  it('rótulos no reconocidos se informan y la fila elegida queda en lineaEncabezado', () => {
    const enc = `${ENC};COLUMNA RARA`;
    const r = leerProgramaCsv(`TITULO\n${enc}\n${DATOS}\n`, T);
    expect(r.secciones[0].lineaEncabezado).toBe(2);
    const desc = r.avisos.filter((a) => a.codigo === 'encabezado_desconocido');
    expect(desc).toHaveLength(1);
    expect(desc[0].mensaje).toMatch(/COLUMNA RARA/);
  });

  it('empate de dos candidatos seguidos sin datos en medio: gana el de más rótulos', () => {
    const pobre = '#;SUC;CLIENTE;CAJA;UNIDAD';
    const r = leerProgramaCsv(`${pobre}\n${ENC}\n${DATOS}\n`, T);
    expect(r.secciones[0].lineaEncabezado).toBe(2);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].celdas.TRANSITO).toBe('EN RUTA');
    // Y al revés: el rico primero no se pisa con el pobre.
    const r2 = leerProgramaCsv(`${ENC}\n${pobre}\n${DATOS}\n`, T);
    expect(r2.secciones[0].lineaEncabezado).toBe(1);
    expect(r2.filas[0].celdas.TRANSITO).toBe('EN RUTA');
  });

  it('sin encabezado (menos rótulos que el umbral) → error llano', () => {
    expect(() => leerProgramaCsv('#;SUC;CLIENTE\n1;GDL;X\n', T)).toThrow(ErrorLectorPrograma);
    expect(() => leerProgramaCsv('#;SUC;CLIENTE\n1;GDL;X\n', T)).toThrow(/encabezados/);
  });

  it('una fila de datos con pocas coincidencias no se confunde con encabezado', () => {
    const r = leerProgramaCsv(`${ENC}\n1;GDL;IMP;CAJA;CLIENTE;X;LNA;UNIDAD;;05/10;U-01;EN RUTA;SI\n`, T);
    expect(r.filas).toHaveLength(1);
  });
});
