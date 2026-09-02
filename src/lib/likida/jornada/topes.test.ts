import { describe, it, expect } from 'vitest';
import {
  TOPE_DIARIO_LFT_68_HORAS,
  TOPE_ORDINARIO_LFT_61_HORAS,
  DESCANSO_MINIMO_LFT_63_MINUTOS,
  DIAS_TRABAJO_ANTES_DE_DESCANSO_LFT_69,
  TOPE_SEMANAL_POR_ANIO,
  PRIMER_ANIO_CON_TOPE_SEMANAL,
  ANIO_REGIMEN_PLENO,
  MAX_MINUTOS_JORNADA,
  topeSemanalDelAnio,
  clasificarJornadaLFT60,
  minutoDelDiaMx,
  LEYENDA_NOM_087,
  LEYENDA_NO_ES_BITACORA_83,
  LEYENDA_SIN_DICTAMEN,
  FRASE_SIN_REGISTRO,
  FRASE_REGISTRO_INCOMPLETO,
  CONSERVACION_NOM_087_ANIOS,
  CONSERVACION_LFT_804,
} from './topes';

// ═══════════════════════════════════════════════════════════════════════════
// LAS CIFRAS DE LA LEY, CONTRA EL TEXTO DE LA LEY.
//
// Cada número de este archivo se compara contra el artículo que lo dice, no
// contra "lo que el código calculaba ayer". Una prueba de regresión que
// congela una cifra equivocada la vuelve permanente — y aquí una cifra
// equivocada es una alerta falsa (o peor, una alerta que no salta) sobre la
// jornada de una persona.
//
// La ficha con el texto vigente transcrito es
// `normas/lft-132-XXXIV-jornada.yaml`.
// ═══════════════════════════════════════════════════════════════════════════

describe('los topes de la LFT están donde dice el artículo', () => {
  // Art. 68, último párrafo: «La suma de las jornadas ordinaria y
  // extraordinaria, en ningún caso podrá ser mayor a doce horas diarias.»
  it('el tope duro del día son doce horas (art. 68)', () => {
    expect(TOPE_DIARIO_LFT_68_HORAS).toBe(12);
  });

  // Art. 61: «ocho horas la diurna, siete la nocturna y siete horas y media la
  // mixta». Los tres, exactos: confundir el de la nocturna con el de la diurna
  // regalaría una hora de tiempo extraordinario sin pagar.
  it('el tope ordinario depende del tipo de jornada (art. 61)', () => {
    expect(TOPE_ORDINARIO_LFT_61_HORAS.diurna).toBe(8);
    expect(TOPE_ORDINARIO_LFT_61_HORAS.nocturna).toBe(7);
    expect(TOPE_ORDINARIO_LFT_61_HORAS.mixta).toBe(7.5);
  });

  // Art. 63: «un descanso de media hora, por lo menos».
  it('el descanso mínimo de la jornada continua es media hora (art. 63)', () => {
    expect(DESCANSO_MINIMO_LFT_63_MINUTOS).toBe(30);
  });

  // Art. 69: «Por cada seis días de trabajo se deberá otorgar, por lo menos,
  // un día de descanso».
  it('el día de descanso va por cada seis trabajados (art. 69)', () => {
    expect(DIAS_TRABAJO_ANTES_DE_DESCANSO_LFT_69).toBe(6);
  });

  // NINGÚN TOPE ORDINARIO PUEDE REBASAR EL TOPE DURO. Si algún día alguien
  // teclea 13 en el art. 61, esta prueba lo caza antes que un cliente.
  it('ningún tope ordinario rebasa el tope duro del día', () => {
    for (const horas of Object.values(TOPE_ORDINARIO_LFT_61_HORAS)) {
      expect(horas).toBeLessThan(TOPE_DIARIO_LFT_68_HORAS);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL ESCALONAMIENTO DEL TRANSITORIO SEGUNDO — el error más caro de la reforma.
//
// El art. 59 vigente ya dice cuarenta horas semanales. Pero el Transitorio
// Segundo del decreto del 01-05-2026 lo escalona por año calendario, y un
// motor que hardcodee 40 marcaría HOY en rojo a una flota que va en regla.
// ═══════════════════════════════════════════════════════════════════════════

describe('el tope semanal se escalona por año, no es el del artículo', () => {
  it('la tabla es exactamente la del Transitorio Segundo y Cuarto', () => {
    expect(TOPE_SEMANAL_POR_ANIO[2026]).toEqual({ ordinaria: 48, extra: 9 });
    expect(TOPE_SEMANAL_POR_ANIO[2027]).toEqual({ ordinaria: 46, extra: 9 });
    expect(TOPE_SEMANAL_POR_ANIO[2028]).toEqual({ ordinaria: 44, extra: 10 });
    expect(TOPE_SEMANAL_POR_ANIO[2029]).toEqual({ ordinaria: 42, extra: 11 });
    expect(TOPE_SEMANAL_POR_ANIO[2030]).toEqual({ ordinaria: 40, extra: 12 });
  });

  // ÉSTA ES LA PRUEBA QUE IMPORTA. En 2026 el tope es 48, no 40. Si alguien
  // "simplifica" el motor a las cuarenta horas del artículo, una flota que
  // trabaja 46 h sale marcada como excedida cuatro años antes de tiempo.
  it('en 2026 son 48 horas, NO las 40 del artículo', () => {
    expect(topeSemanalDelAnio(2026)?.ordinaria).toBe(48);
    expect(topeSemanalDelAnio(2026)?.ordinaria).not.toBe(40);
  });

  it('el escalonamiento baja año con año hasta 2030', () => {
    const anios = [2026, 2027, 2028, 2029, 2030];
    for (let i = 1; i < anios.length; i++) {
      const previo = topeSemanalDelAnio(anios[i - 1])!.ordinaria;
      const actual = topeSemanalDelAnio(anios[i])!.ordinaria;
      expect(actual).toBeLessThanOrEqual(previo);
    }
    // Y las extras suben, que es la otra mitad del trato.
    expect(topeSemanalDelAnio(2030)!.extra).toBeGreaterThan(topeSemanalDelAnio(2026)!.extra);
  });

  // De 2030 en adelante rige el texto del artículo: el escalonamiento terminó.
  it('de 2030 en adelante rige el régimen pleno del artículo', () => {
    expect(topeSemanalDelAnio(2030)).toEqual({ ordinaria: 40, extra: 12 });
    expect(topeSemanalDelAnio(2031)).toEqual({ ordinaria: 40, extra: 12 });
    expect(topeSemanalDelAnio(2045)).toEqual({ ordinaria: 40, extra: 12 });
  });

  // ANTES DE 2026 EL PRODUCTO NO AFIRMA NADA. El régimen anterior no se
  // verificó en esta ronda, así que no se inventa: `null`, y el día se reporta
  // con sus horas medidas y SIN veredicto semanal.
  it('antes de 2026 devuelve null — no se inventa el régimen anterior', () => {
    expect(topeSemanalDelAnio(2025)).toBeNull();
    expect(topeSemanalDelAnio(2019)).toBeNull();
    expect(topeSemanalDelAnio(PRIMER_ANIO_CON_TOPE_SEMANAL - 1)).toBeNull();
  });

  it('un año que no es un año devuelve null, no un tope al azar', () => {
    expect(topeSemanalDelAnio(Number.NaN)).toBeNull();
    expect(topeSemanalDelAnio(2026.5)).toBeNull();
    expect(topeSemanalDelAnio(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('las constantes de borde apuntan a donde dice la tabla', () => {
    expect(PRIMER_ANIO_CON_TOPE_SEMANAL).toBe(2026);
    expect(ANIO_REGIMEN_PLENO).toBe(2030);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA CLASIFICACIÓN DEL ART. 60 — por reloj de pared de México.
//
// «Jornada diurna es la comprendida entre las seis y las veinte horas. Jornada
// nocturna es la comprendida entre las veinte y las seis horas. Jornada mixta
// es la que comprende períodos de las dos, siempre que el período nocturno sea
// menor de tres horas y media, pues si comprende tres y media o más, se
// reputará jornada nocturna.»
// ═══════════════════════════════════════════════════════════════════════════

/** Un instante de México a partir de 'AAAA-MM-DD' y 'HH:MM'. México es UTC−6
 *  fijo desde 2022, así que el offset no tiene ramas. */
function mx(dia: string, hhmm: string): Date {
  return new Date(`${dia}T${hhmm}:00-06:00`);
}

describe('clasificarJornadaLFT60', () => {
  it('de 08:00 a 16:00 es diurna y su tope son ocho horas', () => {
    const c = clasificarJornadaLFT60(mx('2026-08-27', '08:00'), mx('2026-08-27', '16:00'));
    expect(c).not.toBeNull();
    expect(c!.tipo).toBe('diurna');
    expect(c!.minutosNocturnos).toBe(0);
    expect(c!.minutosDiurnos).toBe(480);
    expect(c!.topeOrdinarioHoras).toBe(8);
  });

  // Enteramente dentro del tramo nocturno, cruzando la medianoche. Es el caso
  // que la aritmética de intervalos se equivoca y el conteo minuto a minuto no.
  it('de 21:00 a 04:00 es nocturna aunque cruce la medianoche', () => {
    const c = clasificarJornadaLFT60(mx('2026-08-27', '21:00'), mx('2026-08-28', '04:00'));
    expect(c!.tipo).toBe('nocturna');
    expect(c!.minutosDiurnos).toBe(0);
    expect(c!.minutosNocturnos).toBe(420);
    expect(c!.topeOrdinarioHoras).toBe(7);
  });

  // 18:00 → 22:00: dos horas nocturnas (20:00-22:00), menos de tres y media.
  it('con menos de tres horas y media nocturnas es MIXTA', () => {
    const c = clasificarJornadaLFT60(mx('2026-08-27', '18:00'), mx('2026-08-27', '22:00'));
    expect(c!.tipo).toBe('mixta');
    expect(c!.minutosNocturnos).toBe(120);
    expect(c!.minutosDiurnos).toBe(120);
    expect(c!.topeOrdinarioHoras).toBe(7.5);
  });

  // ── EL BORDE EXACTO DEL ARTÍCULO ────────────────────────────────────────
  // «si comprende tres y media o más, se reputará jornada nocturna». Tres y
  // media EXACTAS ya son nocturnas: el artículo dice «o más», no «más de».
  // Un `>` en vez de `>=` le regalaría media hora de tope al patrón.
  it('tres horas y media nocturnas EXACTAS ya se reputan nocturna', () => {
    // 16:30 → 23:30 = 3.5 h nocturnas (20:00-23:30) y 3.5 h diurnas.
    const c = clasificarJornadaLFT60(mx('2026-08-27', '16:30'), mx('2026-08-27', '23:30'));
    expect(c!.minutosNocturnos).toBe(210);
    expect(c!.tipo).toBe('nocturna');
    expect(c!.topeOrdinarioHoras).toBe(7);
  });

  it('un minuto menos de tres y media todavía es mixta', () => {
    // El tramo nocturno lo fija el FIN, no el inicio: 20:00 → 23:29 son
    // 3 h 29 min, un minuto por debajo del umbral del artículo.
    const c = clasificarJornadaLFT60(mx('2026-08-27', '16:30'), mx('2026-08-27', '23:29'));
    expect(c!.minutosNocturnos).toBe(209);
    expect(c!.tipo).toBe('mixta');
    expect(c!.topeOrdinarioHoras).toBe(7.5);
  });

  // Los bordes de las ventanas del artículo: 06:00 empieza lo diurno, 20:00
  // empieza lo nocturno.
  it('las ventanas del art. 60 empiezan a las 06:00 y a las 20:00', () => {
    const amanece = clasificarJornadaLFT60(mx('2026-08-27', '06:00'), mx('2026-08-27', '07:00'));
    expect(amanece!.minutosNocturnos).toBe(0);

    const anochece = clasificarJornadaLFT60(mx('2026-08-27', '20:00'), mx('2026-08-27', '21:00'));
    expect(anochece!.minutosNocturnos).toBe(60);

    // El minuto ANTES de las seis todavía es noche.
    const casi = clasificarJornadaLFT60(mx('2026-08-27', '05:59'), mx('2026-08-27', '06:00'));
    expect(casi!.minutosNocturnos).toBe(1);
  });

  it('los minutos diurnos y nocturnos suman siempre la duración', () => {
    const pares: Array<[string, string, string, string]> = [
      ['2026-08-27', '04:00', '2026-08-27', '19:00'],
      ['2026-08-27', '22:15', '2026-08-28', '06:45'],
      ['2026-08-27', '00:00', '2026-08-27', '23:59'],
      ['2026-01-15', '13:00', '2026-01-15', '21:30'],
    ];
    for (const [d1, h1, d2, h2] of pares) {
      const c = clasificarJornadaLFT60(mx(d1, h1), mx(d2, h2))!;
      const dur = Math.round((mx(d2, h2).getTime() - mx(d1, h1).getTime()) / 60_000);
      expect(c.minutosDiurnos + c.minutosNocturnos).toBe(dur);
    }
  });

  // ── LO QUE SE NIEGA A CLASIFICAR ────────────────────────────────────────
  // `null` NO es un fallo: es la negativa a inventar un tipo de jornada. Un
  // tipo inventado arrastra un tope inventado, y ese tope decide una alerta.
  it('no clasifica sin poder: fin antes del inicio, duración cero o más de 24 h', () => {
    expect(clasificarJornadaLFT60(mx('2026-08-27', '18:00'), mx('2026-08-27', '08:00'))).toBeNull();
    expect(clasificarJornadaLFT60(mx('2026-08-27', '08:00'), mx('2026-08-27', '08:00'))).toBeNull();
    // Veinticinco horas no son un día largo: son dos marcas mal capturadas.
    expect(clasificarJornadaLFT60(mx('2026-08-27', '06:00'), mx('2026-08-28', '07:00'))).toBeNull();
  });

  it('veinticuatro horas exactas todavía se clasifican; una más, no', () => {
    const justo = clasificarJornadaLFT60(mx('2026-08-27', '06:00'), mx('2026-08-28', '06:00'));
    expect(justo).not.toBeNull();
    expect(justo!.minutosDiurnos + justo!.minutosNocturnos).toBe(MAX_MINUTOS_JORNADA);

    const pasado = clasificarJornadaLFT60(mx('2026-08-27', '06:00'), mx('2026-08-28', '06:01'));
    expect(pasado).toBeNull();
  });

  it('una fecha ilegible devuelve null en vez de un tipo al azar', () => {
    expect(clasificarJornadaLFT60(new Date('no es fecha'), mx('2026-08-27', '18:00'))).toBeNull();
    expect(clasificarJornadaLFT60(mx('2026-08-27', '08:00'), new Date('tampoco'))).toBeNull();
  });
});

describe('minutoDelDiaMx lee el RELOJ DEL OPERADOR, no el del servidor', () => {
  // La clasificación del art. 60 es por reloj de pared. Leer el mismo instante
  // en UTC clasificaría al revés una jornada de tarde-noche: a las 19:30 de
  // México ya son las 01:30 UTC del día siguiente.
  it('las 19:30 de México son el minuto 1170, no el de su UTC', () => {
    expect(minutoDelDiaMx(mx('2026-08-27', '19:30'))).toBe(19 * 60 + 30);
  });

  it('la medianoche de México es el minuto 0, no 1440', () => {
    expect(minutoDelDiaMx(mx('2026-08-27', '00:00'))).toBe(0);
  });

  it('siempre cae dentro del día', () => {
    for (const h of ['00:00', '05:59', '06:00', '12:00', '19:59', '20:00', '23:59']) {
      const m = minutoDelDiaMx(mx('2026-08-27', h));
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThan(1440);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LAS LEYENDAS — no son texto de UI, son los límites de lo que el producto
// afirma. Si alguien las vacía "porque estorban", esto lo caza.
// ═══════════════════════════════════════════════════════════════════════════

describe('las leyendas dicen lo que el producto NO afirma', () => {
  it('la de la NOM-087 nombra la norma que se está absteniendo de aplicar', () => {
    expect(LEYENDA_NOM_087).toContain('NOM-087-SCT-2-2017');
    expect(LEYENDA_NOM_087).toContain('conducción');
    // Callarse sin nombrar lo que uno calla no es transparencia.
    expect(LEYENDA_NOM_087).toContain('no se emite juicio');
  });

  it('la del reporte avisa que NO es la bitácora del art. 83', () => {
    expect(LEYENDA_NO_ES_BITACORA_83).toContain('NO es la bitácora');
    expect(LEYENDA_NO_ES_BITACORA_83).toContain('83');
    // Enumera lo que le falta, para que nadie la enseñe en un retén creyendo
    // que cumple.
    expect(LEYENDA_NO_ES_BITACORA_83).toContain('placas');
    expect(LEYENDA_NO_ES_BITACORA_83).toContain('licencia');
  });

  it('la del dictamen manda al abogado y no promete cumplimiento', () => {
    expect(LEYENDA_SIN_DICTAMEN).toContain('No');
    expect(LEYENDA_SIN_DICTAMEN).toContain('certifica cumplimiento');
    expect(LEYENDA_SIN_DICTAMEN).toContain('abogado');
  });

  // LA FRASE QUE MÁS IMPORTA DEL PRODUCTO. Un día sin marcas no es un día de
  // cero horas, y la frase tiene que decirlo con esas palabras: en un juicio,
  // «cero horas» es una afirmación del patrón, y si es falsa la firmó él.
  it('la del día sin dato dice literalmente que NO son cero horas', () => {
    expect(FRASE_SIN_REGISTRO).toContain('Sin registro declarado');
    expect(FRASE_SIN_REGISTRO).toContain('No son cero horas');
  });

  it('la del registro incompleto se niega a estimar la hora que falta', () => {
    expect(FRASE_REGISTRO_INCOMPLETO).toContain('No se estima');
  });

  // Dos plazos DISTINTOS, y se enseñan por separado: el del control de
  // asistencia (LFT 804) y el de la bitácora de horas de servicio (NOM-087 8.5).
  it('los dos plazos de conservación se declaran como dos, no como uno', () => {
    expect(CONSERVACION_NOM_087_ANIOS).toBe(2);
    expect(CONSERVACION_LFT_804).toContain('804');
    expect(CONSERVACION_LFT_804).toContain('NOM-087');
    expect(CONSERVACION_LFT_804).toContain('dos plazos distintos');
  });

  it('ninguna leyenda quedó vacía', () => {
    for (const l of [
      LEYENDA_NOM_087, LEYENDA_NO_ES_BITACORA_83, LEYENDA_SIN_DICTAMEN,
      FRASE_SIN_REGISTRO, FRASE_REGISTRO_INCOMPLETO, CONSERVACION_LFT_804,
    ]) {
      expect(l.trim().length).toBeGreaterThan(40);
    }
  });
});
