import { describe, it, expect } from 'vitest';
import {
  componerJornada,
  sinRegistroDeclarado,
  fraseDelHueco,
  aHoras,
  estaVivo,
  ROTULO_PROCEDENCIA,
  ALCANCE_PROCEDENCIA,
  type Asiento,
  type Procedencia,
  type TipoAsiento,
} from './modelo';
import { FRASE_SIN_REGISTRO, FRASE_REGISTRO_INCOMPLETO } from './topes';

// ═══════════════════════════════════════════════════════════════════════════
// LA REGLA QUE ESTE ARCHIVO VIGILA: `null` JAMÁS SE VUELVE 0.
//
// «No reportó» y «trabajó cero horas» son dos afirmaciones distintas, y la
// segunda es una afirmación DEL PATRÓN sobre la jornada de un trabajador. En
// un juicio, si es falsa, la firmó él. Casi todas las pruebas de abajo son la
// misma prueba mirada desde otro ángulo.
// ═══════════════════════════════════════════════════════════════════════════

let n = 0;
function asiento(
  tipo: TipoAsiento,
  momento: string,
  procedencia: Procedencia = 'declarado_operador',
  extra: Partial<Asiento> = {},
): Asiento {
  n += 1;
  return {
    id: `a-${n}`,
    tipo,
    momento,
    procedencia,
    origenRef: null,
    waMessageId: null,
    viajeId: null,
    registradoPorEmail: null,
    nota: null,
    corrigeA: null,
    anuladoEn: null,
    anuladoPorEmail: null,
    anuladoMotivo: null,
    ...extra,
  };
}

const T = (hhmm: string) => `2026-08-27T${hhmm}:00-06:00`;

describe('componerJornada: el día completo', () => {
  it('mide los minutos entre las dos puntas y descuenta los descansos', () => {
    const j = componerJornada([
      asiento('inicio_jornada', T('06:00')),
      asiento('inicio_descanso', T('13:00')),
      asiento('fin_descanso', T('13:45')),
      asiento('fin_jornada', T('17:00')),
    ]);
    expect(j.minutosBrutos).toBe(660);       // 06:00 → 17:00
    expect(j.minutosDescanso).toBe(45);
    expect(j.minutosEfectivos).toBe(615);
    expect(j.huecos).toHaveLength(0);
    expect(j.mezclada).toBe(false);
  });

  it('varios descansos en un día se suman', () => {
    const j = componerJornada([
      asiento('inicio_jornada', T('06:00')),
      asiento('inicio_descanso', T('10:00')),
      asiento('fin_descanso', T('10:20')),
      asiento('inicio_descanso', T('14:00')),
      asiento('fin_descanso', T('14:40')),
      asiento('fin_jornada', T('18:00')),
    ]);
    expect(j.descansos).toHaveLength(2);
    expect(j.minutosDescanso).toBe(60);
    expect(j.minutosEfectivos).toBe(720 - 60);
  });

  it('los asientos entran desordenados y salen ordenados', () => {
    const j = componerJornada([
      asiento('fin_jornada', T('17:00')),
      asiento('inicio_jornada', T('06:00')),
    ]);
    expect(j.minutosBrutos).toBe(660);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LOS TRES `null` QUE UN CERO BORRARÍA
// ═══════════════════════════════════════════════════════════════════════════

describe('`null` nunca se vuelve 0', () => {
  // El día sin una sola marca. ES EL CASO QUE MÁS IMPORTA DEL PRODUCTO.
  it('un día sin marcas NO son cero horas: son null y una frase', () => {
    const j = componerJornada([]);
    expect(j.minutosBrutos).toBeNull();
    expect(j.minutosDescanso).toBeNull();
    expect(j.minutosEfectivos).toBeNull();
    expect(j.inicio).toBeNull();
    expect(j.fin).toBeNull();
    expect(sinRegistroDeclarado(j)).toBe(true);
    expect(fraseDelHueco(j)).toBe(FRASE_SIN_REGISTRO);
    expect(fraseDelHueco(j)).toContain('No son cero horas');
  });

  // NADIE ANOTÓ UN DESCANSO ≠ NO DESCANSÓ. Un 0 aquí sería una afirmación en
  // contra del propio patrón, hecha por su software.
  it('sin descanso reportado los minutos de descanso son null, no 0', () => {
    const j = componerJornada([
      asiento('inicio_jornada', T('06:00')),
      asiento('fin_jornada', T('14:00')),
    ]);
    expect(j.minutosDescanso).toBeNull();
    expect(j.minutosDescanso).not.toBe(0);
    // Y sin descanso conocido no se puede restar: los efectivos también son null.
    expect(j.minutosEfectivos).toBeNull();
    expect(j.minutosBrutos).toBe(480);
  });

  it('falta una punta: no se estima la hora que falta', () => {
    const soloInicio = componerJornada([asiento('inicio_jornada', T('06:00'))]);
    expect(soloInicio.minutosBrutos).toBeNull();
    expect(soloInicio.huecos.map((h) => h.clase)).toContain('sin_fin');
    expect(fraseDelHueco(soloInicio)).toContain(FRASE_REGISTRO_INCOMPLETO);
    // NO es «sin registro declarado»: sí reportó, a medias. Son dos huecos
    // distintos y se dicen distinto.
    expect(sinRegistroDeclarado(soloInicio)).toBe(false);

    const soloFin = componerJornada([asiento('fin_jornada', T('17:00'))]);
    expect(soloFin.minutosBrutos).toBeNull();
    expect(soloFin.huecos.map((h) => h.clase)).toContain('sin_inicio');
  });

  // Un descanso abierto NO se ignora para sumar los cerrados: eso daría una
  // cifra MENOR a la real presentada como si fuera completa.
  it('un descanso abierto deja los minutos de descanso en null', () => {
    const j = componerJornada([
      asiento('inicio_jornada', T('06:00')),
      asiento('inicio_descanso', T('10:00')),
      asiento('fin_descanso', T('10:30')),
      asiento('inicio_descanso', T('14:00')),   // nunca regresó
      asiento('fin_jornada', T('18:00')),
    ]);
    expect(j.descansos).toHaveLength(2);
    expect(j.descansos[1].fin).toBeNull();
    expect(j.descansos[1].minutos).toBeNull();
    // NO son 30 minutos: hay un descanso cuya duración no se sabe.
    expect(j.minutosDescanso).toBeNull();
    expect(j.minutosEfectivos).toBeNull();
    expect(j.huecos.map((h) => h.clase)).toContain('descanso_abierto');
  });

  it('aHoras conserva el null y jamás cae a 0', () => {
    expect(aHoras(null)).toBeNull();
    expect(aHoras(0)).toBe(0);          // medido y cero es OTRA cosa, y vale
    expect(aHoras(90)).toBe(1.5);
    expect(aHoras(615)).toBe(10.25);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LAS MARCAS MAL CAPTURADAS — no se reordenan, no se «arreglan» solas
// ═══════════════════════════════════════════════════════════════════════════

describe('lo que se niega a calcular', () => {
  it('el fin antes del inicio se dice, no se reordena', () => {
    const j = componerJornada([
      asiento('inicio_jornada', T('18:00')),
      asiento('fin_jornada', T('08:00')),
    ]);
    expect(j.minutosBrutos).toBeNull();
    expect(j.huecos.map((h) => h.clase)).toContain('fin_antes_de_inicio');
    expect(fraseDelHueco(j)).toContain('corregirlo a mano');
  });

  it('más de 24 horas no es un día largo: son dos marcas mal capturadas', () => {
    const j = componerJornada([
      asiento('inicio_jornada', '2026-08-27T06:00:00-06:00'),
      asiento('fin_jornada', '2026-08-29T06:00:00-06:00'),
    ]);
    expect(j.minutosBrutos).toBeNull();
    expect(j.huecos.map((h) => h.clase)).toContain('duracion_imposible');
  });

  it('nunca lanza, ni con fechas ilegibles', () => {
    expect(() => componerJornada([
      asiento('inicio_jornada', 'no es una fecha'),
      asiento('fin_jornada', T('17:00')),
    ])).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA PROCEDENCIA NO SE MEZCLA SIN DECIRLO
// ═══════════════════════════════════════════════════════════════════════════

describe('la procedencia', () => {
  // Un día cuyo inicio declaró el chofer y cuyo fin derivó el GPS no es un día
  // «de ocho horas»: es una resta entre una declaración y una observación.
  it('marca como mezclada la jornada con puntas de origen distinto', () => {
    const j = componerJornada([
      asiento('inicio_jornada', T('06:00'), 'declarado_operador'),
      asiento('fin_jornada', T('17:00'), 'gps'),
    ]);
    expect(j.mezclada).toBe(true);
  });

  it('no la marca cuando las dos puntas vienen de lo mismo', () => {
    const j = componerJornada([
      asiento('inicio_jornada', T('06:00'), 'gps'),
      asiento('fin_jornada', T('17:00'), 'gps'),
    ]);
    expect(j.mezclada).toBe(false);
  });

  // La lista es cerrada y la pantalla y el CSV leen de aquí, para que digan lo
  // mismo. Y ningún rótulo puede prometer más de lo que la fuente sostiene.
  it('las cuatro procedencias tienen rótulo y alcance, y ninguno miente', () => {
    const cuatro: Procedencia[] = ['declarado_operador', 'hito_viaje', 'gps', 'capturado_contralor'];
    for (const p of cuatro) {
      expect(ROTULO_PROCEDENCIA[p]?.length).toBeGreaterThan(0);
      expect(ALCANCE_PROCEDENCIA[p]?.length).toBeGreaterThan(0);
    }
    // El GPS prueba que la UNIDAD se movió, no que él la manejara. Es la
    // distinción que evita convertir una posición en una acusación.
    expect(ALCANCE_PROCEDENCIA.gps).toContain('no que el operador la manejara');
    expect(ALCANCE_PROCEDENCIA.hito_viaje).toContain('él no declaró jornada');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ANULAR NO ES BORRAR — el expediente conserva las dos versiones
// ═══════════════════════════════════════════════════════════════════════════

describe('los asientos anulados', () => {
  const anulado = {
    anuladoEn: T('20:00'),
    anuladoPorEmail: 'contralor@flota.mx',
    anuladoMotivo: 'El operador dictó mal la hora.',
  };

  it('un anulado no cuenta para las cifras pero SIGUE en el expediente', () => {
    const j = componerJornada([
      asiento('inicio_jornada', T('04:00'), 'declarado_operador', anulado),
      asiento('inicio_jornada', T('06:00'), 'capturado_contralor'),
      asiento('fin_jornada', T('17:00')),
    ]);
    // La cifra sale de la marca VIVA (06:00), no de la anulada (04:00).
    expect(j.minutosBrutos).toBe(660);
    expect(j.inicio!.momento).toBe(T('06:00'));
    // Y la anulada no desaparece: es la historia de la corrección.
    expect(j.anulados).toHaveLength(1);
    expect(j.anulados[0].anuladoMotivo).toContain('dictó mal');
  });

  it('estaVivo distingue anulado de vigente', () => {
    expect(estaVivo(asiento('inicio_jornada', T('06:00')))).toBe(true);
    expect(estaVivo(asiento('inicio_jornada', T('06:00'), 'declarado_operador', anulado))).toBe(false);
  });

  it('un día cuyas únicas marcas están anuladas es un día sin registro', () => {
    const j = componerJornada([
      asiento('inicio_jornada', T('06:00'), 'declarado_operador', anulado),
    ]);
    expect(sinRegistroDeclarado(j)).toBe(true);
    expect(j.minutosBrutos).toBeNull();
    expect(j.anulados).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LAS MARCAS SUELTAS — lo que no encaja no se tira en silencio
// ═══════════════════════════════════════════════════════════════════════════

describe('las marcas sueltas', () => {
  // Un asiento que existe en la base pero que ninguna vista enseña es un
  // asiento que nadie puede anular ni corregir: se queda fuera del documento
  // y aparece el día que alguien exporta la tabla cruda en un juicio.
  it('un fin de descanso sin su inicio queda SUELTO, no desaparece', () => {
    const j = componerJornada([
      asiento('inicio_jornada', T('06:00')),
      asiento('fin_descanso', T('13:45')),   // nadie marcó la salida
      asiento('fin_jornada', T('17:00')),
    ]);
    expect(j.descansos).toHaveLength(0);
    expect(j.sueltos).toHaveLength(1);
    expect(j.sueltos[0].tipo).toBe('fin_descanso');
    // NO abre un descanso hacia atrás: sería inventar a qué hora empezó.
    expect(j.minutosDescanso).toBeNull();
  });

  it('una segunda marca de jornada del mismo tipo también queda suelta', () => {
    const j = componerJornada([
      asiento('inicio_jornada', T('06:00')),
      asiento('inicio_jornada', T('07:00')),
      asiento('fin_jornada', T('17:00')),
    ]);
    expect(j.inicio!.momento).toBe(T('06:00'));
    expect(j.sueltos).toHaveLength(1);
    expect(j.sueltos[0].momento).toBe(T('07:00'));
  });

  it('un día bien formado no tiene sueltos', () => {
    const j = componerJornada([
      asiento('inicio_jornada', T('06:00')),
      asiento('inicio_descanso', T('13:00')),
      asiento('fin_descanso', T('13:45')),
      asiento('fin_jornada', T('17:00')),
    ]);
    expect(j.sueltos).toHaveLength(0);
  });

  // NINGUNA MARCA VIVA SE PIERDE. Es la invariante que hace auditable la
  // pantalla: todo lo vivo está en inicio, fin, descansos o sueltos.
  it('toda marca viva aparece en alguna parte del resultado', () => {
    const entrada = [
      asiento('inicio_jornada', T('06:00')),
      asiento('inicio_jornada', T('07:00')),
      asiento('fin_descanso', T('09:00')),
      asiento('inicio_descanso', T('13:00')),
      asiento('fin_descanso', T('13:45')),
      asiento('inicio_descanso', T('16:00')),
      asiento('fin_jornada', T('17:00')),
    ];
    const j = componerJornada(entrada);
    const vistos = new Set([
      ...(j.inicio ? [j.inicio.id] : []),
      ...(j.fin ? [j.fin.id] : []),
      ...j.descansos.flatMap((d) => [d.inicio.id, ...(d.fin ? [d.fin.id] : [])]),
      ...j.sueltos.map((a) => a.id),
    ]);
    for (const a of entrada) {
      expect(vistos.has(a.id), `la marca ${a.id} (${a.tipo}) se perdió`).toBe(true);
    }
  });
});

describe('fraseDelHueco', () => {
  it('no dice nada cuando no hay nada que decir', () => {
    const j = componerJornada([
      asiento('inicio_jornada', T('06:00')),
      asiento('inicio_descanso', T('13:00')),
      asiento('fin_descanso', T('13:45')),
      asiento('fin_jornada', T('17:00')),
    ]);
    expect(fraseDelHueco(j)).toBeNull();
  });

  // El día sin marcas gana sobre cualquier otro hueco: es el que no se puede
  // confundir con «trabajó poco».
  it('el día sin marcas manda sobre los demás huecos', () => {
    const j = componerJornada([]);
    expect(fraseDelHueco(j)).toBe(FRASE_SIN_REGISTRO);
  });
});
