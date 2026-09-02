import { describe, it, expect } from 'vitest';
import {
  evaluarRiesgoDia,
  evaluarRiesgoSemana,
  evaluarDesdeAsientos,
  ROTULO_VEREDICTO,
  LEYENDA_VEREDICTOS,
  type PoliticaFlota,
  type Veredicto,
} from './riesgo';
import { componerJornada, type Asiento, type Procedencia, type TipoAsiento } from './modelo';
import { LEYENDA_NOM_087 } from './topes';

// ═══════════════════════════════════════════════════════════════════════════
// LAS TRES COSAS QUE ESTE MOTOR NUNCA DICE, PROBADAS UNA POR UNA.
//
//   1. Nunca dice «cumple». Certificar cumplimiento es un dictamen jurídico.
//   2. Nunca estima. Sin dato, el veredicto es que falta el dato.
//   3. Nunca evalúa la NOM-087: sus topes son de CONDUCCIÓN y esto es JORNADA.
//
// Un «cumple» falso es peor que un hueco declarado, y aquí el hueco tiene
// nombre, artículo y motivo.
// ═══════════════════════════════════════════════════════════════════════════

let n = 0;
function asiento(
  tipo: TipoAsiento,
  momento: string,
  procedencia: Procedencia = 'declarado_operador',
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
  };
}

const T = (hhmm: string, dia = '2026-08-27') => `${dia}T${hhmm}:00-06:00`;

/** Un día declarado por el operador, de punta a punta, con descanso opcional. */
function dia(
  inicio: string,
  fin: string,
  opciones: { descanso?: [string, string]; procedencia?: Procedencia; fecha?: string } = {},
) {
  const f = opciones.fecha ?? '2026-08-27';
  const p = opciones.procedencia ?? 'declarado_operador';
  const marcas = [
    asiento('inicio_jornada', T(inicio, f), p),
    asiento('fin_jornada', T(fin, f), p),
  ];
  if (opciones.descanso) {
    marcas.push(asiento('inicio_descanso', T(opciones.descanso[0], f)));
    marcas.push(asiento('fin_descanso', T(opciones.descanso[1], f)));
  }
  return componerJornada(marcas);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. NUNCA DICE «CUMPLE»
// ═══════════════════════════════════════════════════════════════════════════

describe('el motor jamás certifica cumplimiento', () => {
  // El tipo `Veredicto` no tiene ese valor, y no es un olvido. Esta prueba
  // existe para que quitarlo sea un cambio deliberado y visible.
  it('no existe un rótulo de veredicto que diga «cumple»', () => {
    const rotulos = Object.values(ROTULO_VEREDICTO).join(' ').toLowerCase();
    expect(rotulos).not.toContain('cumple');
    expect(rotulos).not.toContain('en regla');
    expect(rotulos).not.toContain('conforme a la ley');
  });

  // Lo más cerca que llega de la buena noticia dice exactamente lo que midió
  // y nada más: «en lo registrado».
  it('el mejor veredicto posible se limita a lo registrado', () => {
    expect(ROTULO_VEREDICTO.sin_senal_de_exceso).toBe('Sin señal de exceso en lo registrado');
  });

  it('los cuatro veredictos tienen rótulo', () => {
    const cuatro: Veredicto[] = [
      'sin_registro_declarado', 'dato_insuficiente', 'exceso', 'sin_senal_de_exceso',
    ];
    for (const v of cuatro) expect(ROTULO_VEREDICTO[v]?.length).toBeGreaterThan(0);
  });

  it('la leyenda que acompaña los veredictos manda al abogado', () => {
    expect(LEYENDA_VEREDICTOS).toContain('abogado');
    expect(LEYENDA_VEREDICTOS).toContain('No');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. NUNCA ESTIMA
// ═══════════════════════════════════════════════════════════════════════════

describe('sin dato no hay veredicto', () => {
  it('un día sin marcas es «sin registro declarado», no cero horas', () => {
    const r = evaluarRiesgoDia(componerJornada([]), null);
    expect(r.veredicto).toBe('sin_registro_declarado');
    expect(r.horasExtraordinarias).toBeNull();
    expect(r.tipoJornada).toBeNull();
    // No inventa señales sobre un día del que no sabe nada.
    expect(r.senales).toHaveLength(0);
  });

  it('con una sola punta el veredicto es «dato insuficiente»', () => {
    const j = componerJornada([asiento('inicio_jornada', T('06:00'))]);
    const r = evaluarRiesgoDia(j, null);
    expect(r.veredicto).toBe('dato_insuficiente');
    expect(r.horasExtraordinarias).toBeNull();
  });

  it('con las marcas invertidas tampoco concluye', () => {
    const j = componerJornada([
      asiento('inicio_jornada', T('18:00')),
      asiento('fin_jornada', T('08:00')),
    ]);
    expect(evaluarRiesgoDia(j, null).veredicto).toBe('dato_insuficiente');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. NUNCA EVALÚA LA NOM-087
// ═══════════════════════════════════════════════════════════════════════════

describe('la NOM-087 se nombra y no se aplica', () => {
  // Se abstiene SIEMPRE, y lo dice citando la norma que no está aplicando.
  // Callarse sin nombrar lo que uno calla no es transparencia.
  it('todo veredicto declara que no juzga los tiempos de conducción', () => {
    const casos = [
      componerJornada([]),
      componerJornada([asiento('inicio_jornada', T('06:00'))]),
      dia('06:00', '14:00', { descanso: ['10:00', '10:40'] }),
      dia('04:00', '20:00', { descanso: ['12:00', '12:40'] }),
    ];
    for (const j of casos) {
      const r = evaluarRiesgoDia(j, null);
      expect(r.noEvaluado).toContain(LEYENDA_NOM_087);
    }
  });

  // 13 h de jornada rebasan el art. 68 (12 h) pero caben en las 14 h de
  // conducción del numeral 4.7 de la NOM. Son magnitudes distintas y el motor
  // solo habla de la que mide.
  it('el exceso que emite es el de la LFT, nunca el de la NOM', () => {
    const r = evaluarRiesgoDia(dia('05:00', '18:30', { descanso: ['12:00', '12:30'] }), null);
    const fundamentos = r.senales.map((s) => s.fundamento ?? '').join(' ');
    expect(fundamentos).toContain('LFT art. 68');
    expect(fundamentos).not.toContain('NOM-087');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL TOPE DURO DEL ART. 68 — el único rojo del día
// ═══════════════════════════════════════════════════════════════════════════

describe('el tope diario del art. 68', () => {
  it('más de doce horas efectivas es EXCESO, con su artículo', () => {
    // 05:00 → 18:30 = 13.5 h, menos 30 min de descanso = 13 h efectivas.
    const r = evaluarRiesgoDia(dia('05:00', '18:30', { descanso: ['12:00', '12:30'] }), null);
    expect(r.veredicto).toBe('exceso');
    const s = r.senales.find((x) => x.clase === 'exceso_tope_diario_lft_68');
    expect(s).toBeDefined();
    expect(s!.esExceso).toBe(true);
    expect(s!.fundamento).toContain('art. 68');
    expect(s!.dice).toContain('13 h');
  });

  it('doce horas exactas todavía no rebasan («no podrá ser MAYOR a doce»)', () => {
    // 06:00 → 18:30 = 12.5 h, menos 30 min = 12 h clavadas.
    const r = evaluarRiesgoDia(dia('06:00', '18:30', { descanso: ['12:00', '12:30'] }), null);
    expect(r.senales.some((s) => s.clase === 'exceso_tope_diario_lft_68')).toBe(false);
    expect(r.veredicto).not.toBe('exceso');
  });

  // ── EL ART. 64, QUE ES LO HONESTO ───────────────────────────────────────
  // Likida no sabe si el chofer podía salir de la caseta donde comió. Compara
  // la cifra que le da la razón al patrón (los efectivos), y si con los
  // descansos adentro SÍ rebasaría, lo DICE en vez de esconderlo.
  it('avisa cuando el día rebasaría contando los descansos (art. 64)', () => {
    // 05:30 → 18:30 = 13 h brutas; con 90 min de descanso, 11.5 h efectivas.
    const r = evaluarRiesgoDia(dia('05:30', '18:30', { descanso: ['12:00', '13:30'] }), null);
    expect(r.veredicto).not.toBe('exceso');   // con los efectivos no rebasa
    const s = r.senales.find((x) => x.clase === 'descanso_pudo_contar_lft_64');
    expect(s).toBeDefined();
    expect(s!.esExceso).toBe(false);
    expect(s!.fundamento).toContain('art. 64');
    expect(s!.dice).toContain('13 h');        // y enseña las dos cifras
    expect(s!.dice).toContain('11.5 h');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL TIEMPO EXTRAORDINARIO ES OBSERVACIÓN, NO ALERTA
//
// Rebasar el art. 61 no es una infracción: significa que hubo tiempo extra,
// que la ley permite y manda pagar al doble. Marcarlo en rojo entrenaría al
// contralor a ignorar el tablero, que es la forma más rápida de que la alerta
// que sí importa se pierda.
// ═══════════════════════════════════════════════════════════════════════════

describe('el tiempo extraordinario del art. 61', () => {
  it('diez horas diurnas son dos extras, y NO son un exceso', () => {
    const r = evaluarRiesgoDia(dia('06:00', '16:30', { descanso: ['12:00', '12:30'] }), null);
    expect(r.tipoJornada).toBe('diurna');
    expect(r.horasExtraordinarias).toBe(2);
    const s = r.senales.find((x) => x.clase === 'tiempo_extraordinario');
    expect(s!.esExceso).toBe(false);
    expect(s!.dice).toContain('No es una infracción');
    expect(r.veredicto).not.toBe('exceso');
  });

  // El tope contra el que se mide depende del TIPO de jornada del art. 60: una
  // jornada nocturna de 8 h ya trae una hora extra que la diurna no traería.
  it('la jornada nocturna se mide contra siete horas, no contra ocho', () => {
    // 21:00 → 05:00 = 8 h, todas nocturnas.
    const j = componerJornada([
      asiento('inicio_jornada', '2026-08-27T21:00:00-06:00'),
      asiento('fin_jornada', '2026-08-28T05:00:00-06:00'),
    ]);
    const r = evaluarRiesgoDia(j, null);
    expect(r.tipoJornada).toBe('nocturna');
    expect(r.horasExtraordinarias).toBe(1);
  });

  it('un día medido y sin tiempo extra da 0, que no es lo mismo que null', () => {
    const r = evaluarRiesgoDia(dia('08:00', '16:30', { descanso: ['12:00', '12:30'] }), null);
    expect(r.horasExtraordinarias).toBe(0);
    expect(r.horasExtraordinarias).not.toBeNull();
    expect(r.veredicto).toBe('sin_senal_de_exceso');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL DESCANSO DEL ART. 63 — «no lo anotó» ≠ «no descansó»
// ═══════════════════════════════════════════════════════════════════════════

describe('el descanso del art. 63', () => {
  it('sin descanso registrado NO se afirma que no descansó', () => {
    const r = evaluarRiesgoDia(dia('06:00', '14:00'), null);
    const s = r.senales.find((x) => x.clase === 'sin_descanso_registrado');
    expect(s).toBeDefined();
    expect(s!.esExceso).toBe(false);          // no es una infracción probada
    expect(s!.dice).toContain('no significa que no lo hubo');
    expect(s!.fundamento).toContain('art. 63');
  });

  it('un descanso por debajo de media hora sí es exceso, con su artículo', () => {
    const r = evaluarRiesgoDia(dia('06:00', '16:00', { descanso: ['12:00', '12:15'] }), null);
    const s = r.senales.find((x) => x.clase === 'descanso_bajo_minimo_lft_63');
    expect(s!.esExceso).toBe(true);
    expect(s!.fundamento).toContain('art. 63');
    expect(r.veredicto).toBe('exceso');
  });

  it('media hora exacta cumple el mínimo', () => {
    const r = evaluarRiesgoDia(dia('06:00', '16:00', { descanso: ['12:00', '12:30'] }), null);
    expect(r.senales.some((s) => s.clase === 'descanso_bajo_minimo_lft_63')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA COTA INFERIOR — probar el exceso, no descartarlo
//
// Un inicio derivado del GPS no es la hora en que el operador empezó a
// trabajar: es lo más temprano que Likida puede demostrar. La jornada real fue
// esa o MÁS larga, y la consecuencia lógica es asimétrica.
// ═══════════════════════════════════════════════════════════════════════════

describe('las marcas derivadas acotan por abajo', () => {
  it('un día derivado que NO rebasa queda en «dato insuficiente», nunca en verde', () => {
    const r = evaluarRiesgoDia(dia('08:00', '16:00', { procedencia: 'gps' }), null);
    expect(r.veredicto).toBe('dato_insuficiente');
    expect(r.veredicto).not.toBe('sin_senal_de_exceso');
    const s = r.senales.find((x) => x.clase === 'cota_inferior_derivada');
    expect(s).toBeDefined();
    expect(s!.dice).toContain('acota la jornada por abajo');
    expect(s!.dice).toContain('no descartarlo');
  });

  // La otra mitad de la asimetría: si con la cota YA se rebasa, la jornada
  // real también lo rebasa. El exceso queda probado y se dice exceso.
  it('un día derivado que SÍ rebasa es exceso probado', () => {
    const j = componerJornada([
      asiento('inicio_jornada', T('04:00'), 'gps'),
      asiento('fin_jornada', T('18:00'), 'gps'),
    ]);
    const r = evaluarRiesgoDia(j, null);
    expect(r.veredicto).toBe('exceso');
    // Y entonces NO pide más datos: ya no hacen falta para esta conclusión.
    expect(r.senales.some((s) => s.clase === 'cota_inferior_derivada')).toBe(false);
  });

  it('lo mismo vale para un hito de viaje', () => {
    const r = evaluarRiesgoDia(dia('08:00', '16:00', { procedencia: 'hito_viaje' }), null);
    expect(r.veredicto).toBe('dato_insuficiente');
  });

  // Lo capturado por el contralor es una declaración de una persona con
  // nombre: no es una cota, y no arrastra la reserva.
  it('lo capturado en oficina no es una cota inferior', () => {
    const r = evaluarRiesgoDia(dia('08:00', '16:00', { procedencia: 'capturado_contralor' }), null);
    expect(r.senales.some((s) => s.clase === 'cota_inferior_derivada')).toBe(false);
    expect(r.veredicto).toBe('sin_senal_de_exceso');
  });

  it('las puntas de origen distinto se declaran antes de restarlas', () => {
    const j = componerJornada([
      asiento('inicio_jornada', T('06:00'), 'declarado_operador'),
      asiento('fin_jornada', T('16:00'), 'gps'),
    ]);
    const r = evaluarRiesgoDia(j, null);
    const s = r.senales.find((x) => x.clase === 'procedencia_mezclada');
    expect(s).toBeDefined();
    expect(s!.dice).toContain('no es una sola medición');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LOS UMBRALES DE LA FLOTA — complementan la ley, no la reemplazan
// ═══════════════════════════════════════════════════════════════════════════

describe('la política de la flota', () => {
  const politica: PoliticaFlota = {
    horasMaxJornada: 10,
    minutosMinDescanso: 45,
    horasMinEntreJornadas: 9,
    fundamento: 'Cláusula 14 del contrato colectivo',
  };

  it('sin política declarada el motor sigue evaluando la ley', () => {
    const r = evaluarRiesgoDia(dia('05:00', '18:30', { descanso: ['12:00', '12:30'] }), null);
    expect(r.veredicto).toBe('exceso');       // el art. 68 no depende de la flota
  });

  it('un umbral propio más estricto que la ley sí marca', () => {
    // 11 h efectivas: caben en las 12 de la ley, no en las 10 de la flota.
    const r = evaluarRiesgoDia(dia('06:00', '17:30', { descanso: ['12:00', '12:30'] }), politica);
    const s = r.senales.find((x) => x.clase === 'exceso_tope_flota');
    expect(s!.esExceso).toBe(true);
    // El fundamento se transcribe COMO DE LA FLOTA: Likida no lo hace suyo.
    expect(s!.fundamento).toContain('declarado por la flota');
    expect(s!.fundamento).toContain('contrato colectivo');
  });

  // Una política toda en `null` NO es una política de ceros: es no declarada.
  it('una política sin umbrales no marca nada', () => {
    const vacia: PoliticaFlota = {
      horasMaxJornada: null, minutosMinDescanso: null,
      horasMinEntreJornadas: null, fundamento: null,
    };
    const r = evaluarRiesgoDia(dia('08:00', '16:30', { descanso: ['12:00', '12:30'] }), vacia);
    expect(r.senales.some((s) => s.clase === 'exceso_tope_flota')).toBe(false);
    expect(r.veredicto).toBe('sin_senal_de_exceso');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA SEMANA — y por qué se niega a concluir con huecos
// ═══════════════════════════════════════════════════════════════════════════

describe('evaluarRiesgoSemana', () => {
  /** El día natural `i` después de `desde`. Se suma con aritmética de fechas y
   *  no pegando números al string: `2026-08-27` más seis días es septiembre, y
   *  un `2026-08-33` produciría una fecha ilegible que el motor —con razón—
   *  reporta como día sin medir, y la prueba mediría eso en vez de lo suyo. */
  const masDias = (desde: string, i: number) =>
    new Date(Date.parse(`${desde}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);

  const dias = (horas: Array<[string, string] | null>, desde = '2026-08-24') =>
    horas.map((h, i) => {
      const f = masDias(desde, i);
      return {
        dia: f,
        jornada: h === null ? componerJornada([]) : dia(h[0], h[1], { fecha: f }),
      };
    });

  // SUMAR LO QUE SÍ SE MIDIÓ E IGNORAR EL HUECO DARÍA UN TOTAL MENOR AL REAL,
  // o sea, un falso «va bien» construido con los días que faltan.
  it('un solo día sin medir deja la semana en null, no en la suma parcial', () => {
    const r = evaluarRiesgoSemana(dias([['06:00', '14:00'], null, ['06:00', '14:00']]), null);
    expect(r.horasMedidas).toBeNull();
    expect(r.veredicto).toBe('dato_insuficiente');
    expect(r.diasSinDato).toHaveLength(1);
    expect(r.diasSinDato[0]).toBe('2026-08-25');
  });

  it('una ventana vacía tampoco concluye', () => {
    const r = evaluarRiesgoSemana([], null);
    expect(r.horasMedidas).toBeNull();
    expect(r.veredicto).toBe('dato_insuficiente');
  });

  it('con todos los días medidos suma y compara contra el tope del año', () => {
    // Seis días de 8 h = 48 h, que es el tope de 2026 clavado.
    const r = evaluarRiesgoSemana(dias(Array(6).fill(['06:00', '14:00'])), null);
    expect(r.anio).toBe(2026);
    expect(r.topeOrdinariaHoras).toBe(48);
    expect(r.horasMedidas).toBe(48);
    expect(r.senales.some((s) => s.clase === 'exceso_semanal')).toBe(false);
  });

  // ÉSTA ES LA PRUEBA DE LA REFORMA. 46 h en 2026 NO son un exceso: el tope de
  // ese año es 48. Un motor con 40 hardcodeadas marcaría en rojo a una flota
  // que va en regla, cuatro años antes de tiempo.
  it('46 horas en 2026 no son exceso — el tope de ese año es 48, no 40', () => {
    const r = evaluarRiesgoSemana(dias(Array(6).fill(['06:00', '13:40'])), null);
    expect(r.horasMedidas).toBeCloseTo(46, 1);
    expect(r.veredicto).not.toBe('exceso');
    expect(r.senales.some((s) => s.clase === 'exceso_semanal')).toBe(false);
  });

  it('por encima del tope del año sale la señal, con su fundamento', () => {
    // Seis días de 10 h = 60 h contra las 48 de 2026: 12 h por encima, que
    // rebasan también las 9 h extra del Transitorio Cuarto.
    const r = evaluarRiesgoSemana(dias(Array(6).fill(['06:00', '16:00'])), null);
    expect(r.horasMedidas).toBe(60);
    const s = r.senales.find((x) => x.clase === 'exceso_semanal');
    expect(s).toBeDefined();
    expect(s!.esExceso).toBe(true);
    expect(s!.fundamento).toContain('Transitorios Segundo y Cuarto');
    expect(r.veredicto).toBe('exceso');
  });

  // Sin tope verificado para ese año no hay contra qué comparar, y el producto
  // no inventa uno: reporta las horas y dice que no hay veredicto.
  it('un año anterior a 2026 reporta las horas SIN veredicto', () => {
    const previos = [
      { dia: '2025-06-02', jornada: dia('06:00', '16:00', { fecha: '2025-06-02' }) },
    ];
    const r = evaluarRiesgoSemana(previos, null);
    expect(r.horasMedidas).toBe(10);
    expect(r.topeOrdinariaHoras).toBeNull();
    expect(r.veredicto).toBe('dato_insuficiente');
  });

  it('más de seis días trabajados sin descanso marca el art. 69', () => {
    const r = evaluarRiesgoSemana(dias(Array(7).fill(['06:00', '12:00'])), null);
    const s = r.senales.find((x) => x.clase === 'sin_dia_de_descanso_lft_69');
    expect(s).toBeDefined();
    expect(s!.esExceso).toBe(true);
    expect(s!.fundamento).toContain('art. 69');
  });

  it('el descanso corto entre jornadas usa el umbral de la flota', () => {
    const politica: PoliticaFlota = {
      horasMaxJornada: null, minutosMinDescanso: null,
      horasMinEntreJornadas: 10, fundamento: 'Póliza de seguro',
    };
    // Termina a las 22:00 y arranca a las 05:00: siete horas de por medio.
    const ventana = [
      { dia: '2026-08-27', jornada: dia('12:00', '22:00', { fecha: '2026-08-27' }) },
      { dia: '2026-08-28', jornada: dia('05:00', '13:00', { fecha: '2026-08-28' }) },
    ];
    const r = evaluarRiesgoSemana(ventana, politica);
    const s = r.senales.find((x) => x.clase === 'exceso_tope_flota');
    expect(s).toBeDefined();
    expect(s!.dice).toContain('2026-08-28');
  });
});

describe('evaluarDesdeAsientos', () => {
  it('es el mismo veredicto que componer y evaluar por separado', () => {
    const marcas = [
      asiento('inicio_jornada', T('06:00')),
      asiento('fin_jornada', T('17:00')),
    ];
    expect(evaluarDesdeAsientos(marcas, null).veredicto)
      .toBe(evaluarRiesgoDia(componerJornada(marcas), null).veredicto);
  });
});
