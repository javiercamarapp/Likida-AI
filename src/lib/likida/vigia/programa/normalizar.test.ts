import { describe, expect, it } from 'vitest';
import { construirProgramaSinteticoConOraculo } from './fixtures';
import type { FilaCruda, Seccion } from './lector';
import { leerProgramaCsv } from './lector';
import {
  citaIsoConZona, normalizarFila, normalizarPrograma, normalizarRuta, type FilaPrograma,
} from './normalizar';

const SECCION: Seccion = {
  tipo: 'EXPORTACION', fecha: '2026-10-05', fechaPropia: true, ruta: null,
  titulo: 'EXPORTACION LUNES 05 DE OCTUBRE 2026', lineaTitulo: 1, lineaEncabezado: 2, filas: 1,
};

function cruda(celdas: Record<string, string>, lineaCsv = 10): FilaCruda {
  return { lineaCsv, seccion: 0, celdas };
}

function ok(celdas: Record<string, string>, seccion: Seccion = SECCION, zona?: string): FilaPrograma {
  const r = normalizarFila(cruda(celdas), seccion, zona ? { zonaHoraria: zona } : {});
  if (!r.ok) throw new Error(`se esperaba fila válida: ${r.motivo}`);
  return r.fila;
}

describe('normalizarRuta', () => {
  it.each([
    ['NLD-GDL', { origen: 'NLD', destino: 'GDL', tramos: null }],
    ['NLD - GDL', { origen: 'NLD', destino: 'GDL', tramos: null }],
    ['nld -gdl', { origen: 'NLD', destino: 'GDL', tramos: null }],
    ['GDL-SIL-GDL', { origen: 'GDL', destino: 'GDL', tramos: ['GDL', 'SIL', 'GDL'] }],
    ['GDL - SIL - GDL', { origen: 'GDL', destino: 'GDL', tramos: ['GDL', 'SIL', 'GDL'] }],
    ['MTY-GDL-JRZ', { origen: 'MTY', destino: 'JRZ', tramos: ['MTY', 'GDL', 'JRZ'] }],
  ])('«%s»', (entrada, esperado) => {
    expect(normalizarRuta(entrada)).toEqual(esperado);
  });

  it('vacía o sin guion → null', () => {
    expect(normalizarRuta('')).toBeNull();
    expect(normalizarRuta('   ')).toBeNull();
    expect(normalizarRuta('GDL')).toBeNull();
    expect(normalizarRuta(undefined)).toBeNull();
  });
});

describe('normalizarFila · caja, unidad, línea (texto, nunca número)', () => {
  it('LINEA con espacio final: «LNX » → «LNX»', () => {
    expect(ok({ LINEA: 'LNX ', CAJA: 'ZC1' }).linea).toBe('LNX');
  });

  it('caja con espacio final conserva el texto: «ZS17111 » → «ZS17111»', () => {
    expect(ok({ CAJA: 'ZS17111 ' }).caja).toBe('ZS17111');
  });

  it('minúsculas pasan a mayúsculas', () => {
    const f = ok({ CAJA: ' zc0042 ', UNIDAD: ' tc2505', LINEA: 'lna' });
    expect([f.caja, f.unidad, f.linea]).toEqual(['ZC0042', 'TC2505', 'LNA']);
  });

  it('conserva los ceros a la izquierda y nunca produce un número', () => {
    const f = ok({ CAJA: '0012345', UNIDAD: '000765' });
    expect(f.caja).toBe('0012345');
    expect(f.unidad).toBe('000765');
    expect(typeof f.caja).toBe('string');
  });

  it('unidad numérica «765» y alfanumérica «TC2505» son texto', () => {
    const a = ok({ CAJA: 'ZC1', UNIDAD: '765' });
    const b = ok({ CAJA: 'ZC1', UNIDAD: 'TC2505' });
    expect(a.unidad).toBe('765');
    expect(typeof a.unidad).toBe('string');
    expect(b.unidad).toBe('TC2505');
  });

  it('vacío ≠ 0: celda vacía, solo espacios o ausente → null, jamás "0" ni inventada', () => {
    const f = ok({ CAJA: 'ZC1', UNIDAD: '   ', LINEA: '' });
    expect(f.unidad).toBeNull();
    expect(f.linea).toBeNull();
    const g = ok({ UNIDAD: 'U1' }); // sin columna CAJA
    expect(g.caja).toBeNull();
  });

  it('espacio no separable cuenta como vacío', () => {
    expect(ok({ CAJA: 'ZC1', UNIDAD: ' ' }).unidad).toBeNull();
  });

  it('"0" es un valor presente, no vacío', () => {
    expect(ok({ CAJA: '0' }).caja).toBe('0');
  });
});

describe('normalizarFila · cita', () => {
  it('dd/mm/aaaa h:mm → ISO con la zona de la terminal', () => {
    const f = ok({ CAJA: 'ZC1', CITA: '05/10/2026 8:00' });
    expect(f.citaEn).toBe('2026-10-05T08:00:00-06:00');
    expect(f.zonaHoraria).toBe('America/Mexico_City');
    expect(f.citaTexto).toBeNull();
    expect(f.avisos).toEqual([]);
  });

  it('hora de dos dígitos y día/mes de un dígito', () => {
    expect(ok({ CAJA: 'ZC1', CITA: '5/9/2026 17:30' }).citaEn).toBe('2026-09-05T17:30:00-06:00');
  });

  it('«DIRECTO» → citaTexto, sin citaEn ni aviso', () => {
    const f = ok({ CAJA: 'ZC1', CITA: 'DIRECTO' });
    expect(f.citaTexto).toBe('DIRECTO');
    expect(f.citaEn).toBeNull();
    expect(f.avisos).toEqual([]);
    expect(ok({ CAJA: 'ZC1', CITA: ' directo ' }).citaTexto).toBe('DIRECTO');
  });

  it('solo hora: hereda la fecha de la sección y deja aviso', () => {
    const f = ok({ CAJA: 'ZC1', CITA: '8:00' });
    expect(f.citaEn).toBe('2026-10-05T08:00:00-06:00');
    expect(f.avisos.map((a) => a.codigo)).toEqual(['cita_solo_hora']);
  });

  it('solo hora sin fecha de sección: no inventa, deja aviso', () => {
    const f = ok({ CAJA: 'ZC1', CITA: '8:00' }, { ...SECCION, fecha: null });
    expect(f.citaEn).toBeNull();
    expect(f.avisos.map((a) => a.codigo)).toEqual(['cita_sin_fecha']);
  });

  it('cita vacía → sin cita y sin aviso', () => {
    const f = ok({ CAJA: 'ZC1', CITA: '' });
    expect([f.citaEn, f.citaTexto, f.avisos.length]).toEqual([null, null, 0]);
  });

  it.each(['31/02/2026 8:00', '05/10/2026 25:00', '05/10/2026 8:75', 'MAÑANA', '2026-10-05 08:00'])(
    'cita no reconocida «%s» → null + aviso con el texto original',
    (texto) => {
      const f = ok({ CAJA: 'ZC1', CITA: texto });
      expect(f.citaEn).toBeNull();
      expect(f.avisos).toHaveLength(1);
      expect(f.avisos[0].codigo).toBe('cita_no_reconocida');
      expect(f.avisos[0].original).toBe(texto);
    },
  );

  it('zona IANA configurable por terminal, sin asumir horario de verano', () => {
    // México (sin horario de verano desde 2022): -06:00 también en julio.
    expect(citaIsoConZona(2026, 7, 15, 9, 0, 'America/Mexico_City')).toBe('2026-07-15T09:00:00-06:00');
    expect(citaIsoConZona(2026, 1, 15, 9, 0, 'America/Mexico_City')).toBe('2026-01-15T09:00:00-06:00');
    // Una zona con horario de verano sí cambia de desfase: la fila usa lo que diga IANA.
    expect(citaIsoConZona(2026, 7, 15, 9, 0, 'America/Los_Angeles')).toBe('2026-07-15T09:00:00-07:00');
    expect(citaIsoConZona(2026, 1, 15, 9, 0, 'America/Los_Angeles')).toBe('2026-01-15T09:00:00-08:00');
    expect(citaIsoConZona(2026, 1, 15, 9, 0, 'UTC')).toBe('2026-01-15T09:00:00+00:00');
    const f = ok({ CAJA: 'ZC1', CITA: '15/07/2026 9:00' }, SECCION, 'America/Los_Angeles');
    expect(f.citaEn).toBe('2026-07-15T09:00:00-07:00');
    expect(f.zonaHoraria).toBe('America/Los_Angeles');
  });

  it('zona inexistente falla al normalizar el programa (una vez, no por fila)', () => {
    const { texto } = construirProgramaSinteticoConOraculo({ dias: 1, filasPorSeccion: 2 });
    const lectura = leerProgramaCsv(texto, { terminal: 'GDL' });
    expect(() => normalizarPrograma(lectura, { zonaHoraria: 'Marte/Olimpo' })).toThrow(RangeError);
  });
});

describe('normalizarFila · TRANSITO y CCP', () => {
  it.each([
    ['PATIO NLD', 'patio_nld'], ['patio nld ', 'patio_nld'], ['EN RUTA', 'en_ruta'],
    ['PEND CRUCE', 'pend_cruce'], ['OK', 'ok'], ['PATIO EXT', 'patio_otro'], ['PATIO OTRO SITIO', 'patio_otro'],
    ['N/A', 'na'], ['', 'vacio'], [' ', 'vacio'],
  ])('TRANSITO «%s» → %s sin aviso', (texto, esperado) => {
    const f = ok({ CAJA: 'ZC1', TRANSITO: texto });
    expect(f.transito).toBe(esperado);
    expect(f.avisos).toEqual([]);
  });

  it('TRANSITO fuera de catálogo → desconocido + aviso con el original', () => {
    const f = ok({ CAJA: 'ZC1', TRANSITO: 'EN TALLER' });
    expect(f.transito).toBe('desconocido');
    expect(f.avisos).toEqual([expect.objectContaining({ codigo: 'transito_desconocido', original: 'EN TALLER' })]);
  });

  it.each([
    ['LISTO', 'listo'], ['despachado', 'despachado'], ['PEND REQUE CCP', 'pend_reque'], ['PEND CCP', 'pend_ccp'],
    ['FALTA DE COMPLEMENTO', 'falta_complemento'], ['', 'vacio'],
  ])('CCP «%s» → %s sin aviso', (texto, esperado) => {
    const f = ok({ CAJA: 'ZC1', CCP: texto });
    expect(f.ccp).toBe(esperado);
    expect(f.avisos).toEqual([]);
  });

  it.each(['550', '450', '12,5'])('CCP numérico «%s» → desconocido + «dato fuera de columna» (nunca LISTO)', (texto) => {
    const f = ok({ CAJA: 'ZC1', CCP: texto });
    expect(f.ccp).toBe('desconocido');
    expect(f.avisos).toEqual([expect.objectContaining({ codigo: 'dato_fuera_de_columna', campo: 'CCP', original: texto })]);
  });

  it('CCP con texto libre → desconocido + aviso', () => {
    const f = ok({ CAJA: 'ZC1', CCP: 'REVISAR' });
    expect(f.ccp).toBe('desconocido');
    expect(f.avisos[0].codigo).toBe('ccp_desconocido');
  });
});

describe('normalizarFila · ruta, num, comentarios, descarte', () => {
  it('toma tipo y fecha de la sección y separa la ruta', () => {
    const f = ok({ CAJA: 'ZC1', 'ORIGEN-DESTINO': 'NLD - GDL', '#': '7' });
    expect([f.tipo, f.fecha, f.num]).toEqual(['EXPORTACION', '2026-10-05', 7]);
    expect(f.ruta).toEqual({ origen: 'NLD', destino: 'GDL', tramos: null });
  });

  it('ruta ilegible → origen/destino null + aviso', () => {
    const f = ok({ CAJA: 'ZC1', 'ORIGEN-DESTINO': 'GDL' });
    expect(f.ruta).toEqual({ origen: null, destino: null, tramos: null });
    expect(f.avisos[0].codigo).toBe('ruta_no_reconocida');
  });

  it('fila sin «#» → num null; los dos COMENTARIOS se conservan por separado', () => {
    const f = ok({ CAJA: 'ZC1', '#': '', COMENTARIOS: ' nota ', COMENTARIOS_2: '' });
    expect(f.num).toBeNull();
    expect(f.comentarios).toBe('nota');
    expect(f.comentarios2).toBeNull();
  });

  it('fila sin CAJA ni UNIDAD ni CLIENTE → descartada con motivo (aunque tenga comentarios)', () => {
    const r = normalizarFila(cruda({ COMENTARIOS: 'SOLO COMENTARIO', CITA: '05/10/2026 8:00' }, 42), SECCION);
    expect(r).toEqual({
      ok: false, lineaCsv: 42, motivo: 'sin_caja_unidad_ni_cliente', mensaje: expect.any(String),
    });
  });

  it('con solo CLIENTE sigue siendo válida', () => {
    expect(normalizarFila(cruda({ CLIENTE: 'CLIENTE SINT 01' }), SECCION).ok).toBe(true);
  });
});

describe('normalizarPrograma · contra el oráculo del fixture', () => {
  it('reporte de calidad y cada campo coinciden con el oráculo', () => {
    const { texto, oraculo } = construirProgramaSinteticoConOraculo({ dias: 4, filasPorSeccion: 24 });
    const lectura = leerProgramaCsv(texto, { terminal: 'GDL' });
    const { filas, calidad } = normalizarPrograma(lectura);
    const r = oraculo.resumen;

    expect(calidad.leidas).toBe(r.filasDatos);
    expect(calidad.validas).toBe(r.filasDatos - r.descartables);
    expect(calidad.descartadas).toHaveLength(r.descartables);
    expect(r.descartables).toBeGreaterThan(0);
    expect(calidad.conCaja).toBe(r.conCaja);
    expect(calidad.conUnidad).toBe(r.conUnidad);
    expect(calidad.sinCaja).toBe(r.sinCaja - r.descartables);
    expect(calidad.cajaSinUnidad).toBe(r.cajaSinUnidad);
    // «unidad sin caja» no se asume imposible: el fixture lo trae y el reporte lo cuenta.
    expect(r.unidadSinCaja).toBeGreaterThan(0);
    expect(calidad.unidadSinCaja).toBe(r.unidadSinCaja);

    const descartables = oraculo.filas.filter((o) => o.descartable);
    expect(calidad.descartadas.map((d) => d.lineaCsv)).toEqual(descartables.map((o) => o.lineaCsv));
    expect(calidad.descartadas.every((d) => d.motivo === 'sin_caja_unidad_ni_cliente')).toBe(true);

    const validas = oraculo.filas.filter((o) => !o.descartable);
    expect(filas).toHaveLength(validas.length);
    filas.forEach((f, i) => {
      const o = validas[i];
      expect(f.lineaCsv).toBe(o.lineaCsv);
      expect(f.fecha).toBe(o.fecha);
      expect(f.tipo).toBe(o.tipo);
      expect(f.num).toBe(o.num);
      expect(f.caja).toBe(o.caja);
      expect(f.unidad).toBe(o.unidad);
      expect(f.cliente).toBe(o.cliente);
      expect(f.consignatario).toBe(o.consignatario);
      expect(f.linea).toBe(o.linea);
      expect(f.citaTexto).toBe(o.citaTexto);
      expect(f.transito).toBe(o.transito);
      expect(f.ccp).toBe(o.ccp);
      expect(f.comentarios).toBe(o.comentarios);
      expect(f.comentarios2).toBe(o.comentarios2);
      // La cita ISO, sin el desfase, es la hora de pared del oráculo.
      expect(f.citaEn === null ? null : f.citaEn.slice(0, 16)).toBe(o.citaLocal);
      if (f.citaEn) expect(f.citaEn.endsWith('-06:00')).toBe(true);
    });
  });

  it('casos sucios del fixture: DIRECTO, solo hora, CCP 550, FALTA DE COMPLEMENTO, tránsito en blanco', () => {
    const { texto } = construirProgramaSinteticoConOraculo({ dias: 1, secciones: ['IMPORTACION'], filasPorSeccion: 12 });
    const { filas } = normalizarPrograma(leerProgramaCsv(texto, { terminal: 'GDL' }));
    const porNum = (n: number) => filas.find((f) => f.num === n)!;
    expect(porNum(2).citaTexto).toBe('DIRECTO');
    expect(porNum(3).avisos.map((a) => a.codigo)).toContain('cita_solo_hora');
    expect(porNum(4).ccp).toBe('desconocido');
    expect(porNum(4).avisos.map((a) => a.codigo)).toContain('dato_fuera_de_columna');
    expect(porNum(5).ccp).toBe('falta_complemento');
    expect(porNum(6).transito).toBe('vacio');
    expect(porNum(1).linea).not.toMatch(/\s/);
  });

  it('70 000 filas: el lector corta en su tope y el normalizador procesa todo lo leído', () => {
    const { texto } = construirProgramaSinteticoConOraculo({ totalFilas: 70_000, columnas: 26, dias: 14 });
    const lectura = leerProgramaCsv(texto, { terminal: 'GDL' });
    expect(lectura.resumen.filasEncontradas).toBe(70_000);
    const { filas, calidad } = normalizarPrograma(lectura);
    expect(calidad.leidas).toBe(lectura.resumen.filasLeidas);
    expect(calidad.leidas).toBe(60_000);
    expect(calidad.validas + calidad.descartadas.length).toBe(calidad.leidas);
    expect(filas).toHaveLength(calidad.validas);
    expect(calidad.validas).toBeGreaterThan(50_000);
  }, 60_000);

  it('zona por terminal gana sobre la zona general', () => {
    const { texto } = construirProgramaSinteticoConOraculo({ dias: 1, secciones: ['EXPORTACION'], filasPorSeccion: 4, terminal: 'TJN' });
    const lectura = leerProgramaCsv(texto, { terminal: 'TJN' });
    const { filas } = normalizarPrograma(lectura, {
      zonaHoraria: 'America/Mexico_City', zonasPorTerminal: { TJN: 'America/Los_Angeles' },
    });
    const conCita = filas.filter((f) => f.citaEn !== null);
    expect(conCita.length).toBeGreaterThan(0);
    expect(conCita.every((f) => f.zonaHoraria === 'America/Los_Angeles' && f.citaEn!.endsWith('-07:00'))).toBe(true);
  });
});

describe('normalizarPrograma · unidadSinCaja con datos construidos a mano', () => {
  it('se reporta cuando aparece y es 0 cuando no', () => {
    const secciones = [SECCION];
    const resumen = { terminal: 'GDL', delimitador: ';', lineas: 3, filasEncontradas: 2, filasLeidas: 2 };
    const sin = normalizarPrograma({
      filas: [cruda({ CAJA: 'ZC1', UNIDAD: 'U1' }, 3), cruda({ CAJA: 'ZC2', UNIDAD: '' }, 4)], secciones, resumen,
    });
    expect(sin.calidad.unidadSinCaja).toBe(0);
    expect(sin.calidad.cajaSinUnidad).toBe(1);
    const con = normalizarPrograma({
      filas: [cruda({ CAJA: '', UNIDAD: 'U9' }, 3), cruda({ CAJA: 'ZC2', UNIDAD: 'U2' }, 4)], secciones, resumen,
    });
    expect(con.calidad.unidadSinCaja).toBe(1);
    expect(con.calidad.sinCaja).toBe(1);
    expect(con.filas[0].caja).toBeNull(); // nunca se inventa la caja
  });
});
