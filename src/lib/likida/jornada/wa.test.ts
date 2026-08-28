import { describe, it, expect } from 'vitest';
import {
  interpretarMarcaJornada,
  interpretarConformidadJornada,
  mensajeMarca,
  resumenParaOperador,
} from './wa';
import type { Asiento, Procedencia, TipoAsiento } from './modelo';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE EL OPERADOR ESCRIBE, Y LO QUE LIKIDA LE CONTESTA.
//
// Dos riesgos distintos viven aquí y las pruebas los separan:
//
//   · RECONOCER DE MÁS. Un reconocedor que se come el mensaje de otro no falla
//     ruidosamente: falla registrando el hecho equivocado. Y aquí el hecho
//     equivocado es un dato laboral que después se le enseña a un inspector.
//   · PROMETER DE MÁS. El acuse dice «anoté», no «trabajaste»: lo que se guarda
//     es su declaración, y el mensaje tiene que sonar a recibo, no a veredicto.
// ═══════════════════════════════════════════════════════════════════════════

describe('interpretarMarcaJornada', () => {
  it('reconoce las formas reales de cada marca', () => {
    const casos: Array<[string, TipoAsiento]> = [
      ['inicio jornada', 'inicio_jornada'],
      ['Inicio de jornada', 'inicio_jornada'],
      ['ya inicio mi turno'.replace('ya ', ''), 'inicio_jornada'],
      ['fin de jornada', 'fin_jornada'],
      ['Termine mi jornada', 'fin_jornada'],
      ['voy a comer', 'inicio_descanso'],
      ['paro a descansar', 'inicio_descanso'],
      ['ya comi', 'fin_descanso'],
      ['regreso del descanso', 'fin_descanso'],
    ];
    for (const [texto, esperado] of casos) {
      expect(interpretarMarcaJornada(texto), `«${texto}»`).toBe(esperado);
    }
  });

  // Acentos, mayúsculas, signos y emoji: el chofer escribe como escribe.
  it('aguanta acentos, mayúsculas, puntuación y emoji', () => {
    expect(interpretarMarcaJornada('INICIO JORNADA')).toBe('inicio_jornada');
    expect(interpretarMarcaJornada('Terminé mi jornada.')).toBe('fin_jornada');
    expect(interpretarMarcaJornada('inicio  de   jornada')).toBe('inicio_jornada');
    expect(interpretarMarcaJornada('fin de jornada 🚛')).toBe('fin_jornada');
  });

  // ── UNA PREGUNTA NO DECLARA NADA ────────────────────────────────────────
  // `limpiar` le quita los signos y la volvería indistinguible de la
  // afirmación. Se descarta ANTES de limpiar, igual que en los hitos.
  it('una pregunta nunca marca', () => {
    expect(interpretarMarcaJornada('¿ya termine mi jornada?')).toBeNull();
    expect(interpretarMarcaJornada('inicio jornada?')).toBeNull();
  });

  it('lo que no está en la lista sigue su camino', () => {
    for (const t of [
      'ya llegué', 'se ponchó una llanta', 'buenos días', 'ok', '👍',
      'cargué 300 litros', 'voy saliendo', 'gracias',
    ]) {
      expect(interpretarMarcaJornada(t), `«${t}» no debería marcar`).toBeNull();
    }
  });

  // Lo que trae más contexto no es una marca: es una conversación, y tratarla
  // como marca asentaría una hora que el operador no quiso declarar.
  it('un mensaje largo no es una marca', () => {
    const largo = 'inicio jornada pero antes quiero avisarte que la unidad trae una fuga de aceite y no sé si aguante';
    expect(largo.length).toBeGreaterThan(60);
    expect(interpretarMarcaJornada(largo)).toBeNull();
  });

  it('vacío, espacios y no-texto devuelven null sin lanzar', () => {
    expect(interpretarMarcaJornada('')).toBeNull();
    expect(interpretarMarcaJornada('   ')).toBeNull();
    expect(interpretarMarcaJornada(undefined)).toBeNull();
  });

  // ── CERO SOLAPE CON LOS OTROS RECONOCEDORES DE LA FILA ──────────────────
  // Los hitos hablan de llegar y descargar; la asistencia, de choques. Ninguna
  // frase de este módulo puede parecerse a las de aquéllos.
  it('ninguna frase de jornada se confunde con un hito o una emergencia', () => {
    for (const t of [
      'ya llegue', 'ya descargue', 'llegue al cliente', 'ya cargue',
      'choque', 'me quede varado', 'se poncho una llanta', 'voy en camino',
    ]) {
      expect(interpretarMarcaJornada(t), `«${t}» se coló como marca de jornada`).toBeNull();
    }
  });
});

describe('interpretarConformidadJornada', () => {
  it('reconoce las formas de conformidad', () => {
    for (const t of [
      'confirmo mi jornada', 'Confirmo jornada', 'estoy de acuerdo con mi jornada',
      'así fue mi jornada', 'es correcta mi jornada',
    ]) {
      expect(interpretarConformidadJornada(t), `«${t}»`).toBe(true);
    }
  });

  // ── EL LISTÓN DE LA «PRUEBA PLENA» ES MÁS ALTO QUE UN PULGAR ARRIBA ─────
  // El párrafo tercero del art. 132 fr. XXXIV pide que se ACREDITE el acuerdo
  // entre trabajador y patrón. Un «ok» pelón es un acuse de recibo, no un
  // acuerdo sobre el contenido del registro — y tratarlo como tal fabricaría
  // una prueba plena que el operador nunca dio.
  it('un «ok» pelón NO es conformidad', () => {
    for (const t of ['ok', 'sí', 'si', 'va', 'órale', 'gracias', '👍', 'ya', 'sale']) {
      expect(interpretarConformidadJornada(t), `«${t}» no puede valer como acuerdo`).toBe(false);
    }
  });

  it('todas las frases de conformidad exigen la palabra «jornada»', () => {
    // La invariante escrita en el encabezado del módulo, probada de verdad:
    // si alguien añade «de acuerdo» a secas, esto lo caza.
    const sinJornada = ['de acuerdo', 'estoy de acuerdo', 'correcto', 'está bien'];
    for (const t of sinJornada) {
      expect(interpretarConformidadJornada(t), `«${t}» no menciona la jornada`).toBe(false);
    }
  });

  it('una pregunta no confirma', () => {
    expect(interpretarConformidadJornada('¿confirmo mi jornada?')).toBe(false);
  });

  it('una marca de jornada no es una conformidad, y al revés', () => {
    expect(interpretarConformidadJornada('inicio jornada')).toBe(false);
    expect(interpretarMarcaJornada('confirmo mi jornada')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL ACUSE — un recibo de su declaración, no un veredicto sobre su día
// ═══════════════════════════════════════════════════════════════════════════

describe('mensajeMarca', () => {
  const momento = new Date('2026-08-27T06:12:00-06:00');

  it('dice la hora ANOTADA y usa el verbo «anoté»', () => {
    const m = mensajeMarca('inicio_jornada', 'asentado', momento, null);
    expect(m).toContain('06:12');
    expect(m).toContain('Anoté');
    // NO afirma que trabajó: afirma que lo anotó. Es lo que Likida sabe.
    expect(m).not.toContain('trabajaste');
  });

  it('cada tipo de marca tiene su acuse y ninguno viene vacío', () => {
    const tipos: TipoAsiento[] = ['inicio_jornada', 'fin_jornada', 'inicio_descanso', 'fin_descanso'];
    for (const t of tipos) {
      const m = mensajeMarca(t, 'asentado', momento, null);
      expect(m.length).toBeGreaterThan(20);
      expect(m).toContain('06:12');
    }
  });

  // El mensaje reentregado por Meta no vuelve a saludar: dice que ya lo tenía.
  it('lo repetido se acusa como ya anotado, no como error', () => {
    const m = mensajeMarca('inicio_jornada', 'ya_estaba', momento, null);
    expect(m).toContain('Ya lo tenía anotado');
  });

  it('un fallo pide reintentar y NO finge que quedó', () => {
    const m = mensajeMarca('fin_jornada', 'fallo', momento, null);
    expect(m).toContain('No pude anotarlo');
    expect(m).not.toContain('Anoté');
  });

  // ── LA ATRIBUCIÓN AL DÍA ANTERIOR SE LE DICE AL OPERADOR ────────────────
  // Es una decisión del sistema sobre un dato laboral suyo. Invisible sería
  // que su jornada del martes apareciera bajo el lunes sin que él lo supiera.
  it('avisa cuando la marca cerró la jornada de otro día', () => {
    const m = mensajeMarca('fin_jornada', 'asentado', momento, '2026-08-26');
    expect(m).toContain('2026-08-26');
    expect(m).toContain('traías abierta');
  });

  it('no lo menciona cuando la marca se quedó en su propio día', () => {
    const m = mensajeMarca('fin_jornada', 'asentado', momento, null);
    expect(m).not.toContain('traías abierta');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL RESUMEN QUE PERSIGUE LA «PRUEBA PLENA»
//
// Para poder acordar algo hay que verlo primero. Se le enseña EXACTAMENTE lo
// que quedó escrito, incluidas las marcas que no puso él — y si falta algo, se
// dice, en vez de enseñarle un total redondo construido con una hora que nadie
// declaró.
// ═══════════════════════════════════════════════════════════════════════════

let n = 0;
function asiento(
  tipo: TipoAsiento,
  momento: string,
  procedencia: Procedencia = 'declarado_operador',
): Asiento {
  n += 1;
  return {
    id: `a-${n}`, tipo, momento, procedencia,
    origenRef: null, waMessageId: null, viajeId: null,
    registradoPorEmail: null, nota: null, corrigeA: null,
    anuladoEn: null, anuladoPorEmail: null, anuladoMotivo: null,
  };
}
const T = (hhmm: string) => `2026-08-27T${hhmm}:00-06:00`;

describe('resumenParaOperador', () => {
  it('enseña el día completo con su total y pide la conformidad', () => {
    const r = resumenParaOperador('2026-08-27', [
      asiento('inicio_jornada', T('06:00')),
      asiento('inicio_descanso', T('13:00')),
      asiento('fin_descanso', T('13:45')),
      asiento('fin_jornada', T('17:00')),
    ]);
    expect(r).toContain('2026-08-27');
    expect(r).toContain('06:00');
    expect(r).toContain('17:00');
    expect(r).toContain('45 min');
    expect(r).toContain('10.25 h');
    // La frase exacta con la que se pide el acuerdo del párrafo tercero.
    expect(r).toContain('confirmo mi jornada');
  });

  // ── LA FRASE QUE NO SE PUEDE PERDER ─────────────────────────────────────
  // Sin las dos puntas no hay total, y el resumen lo DICE en vez de suponerlo.
  it('sin poder calcular el total, lo dice y NO lo supone', () => {
    const r = resumenParaOperador('2026-08-27', [asiento('inicio_jornada', T('06:00'))]);
    expect(r).toContain('no lo puedo calcular');
    expect(r).toContain('No lo voy a suponer');
    expect(r).toContain('Fin: no lo tengo anotado');
    // Y en ningún caso un cero.
    expect(r).not.toContain('Total: 0');
  });

  it('un día sin ninguna marca no enseña ceros', () => {
    const r = resumenParaOperador('2026-08-27', []);
    expect(r).toContain('Inicio: no lo tengo anotado');
    expect(r).toContain('Fin: no lo tengo anotado');
    expect(r).toContain('No lo voy a suponer');
    expect(r).not.toContain('0 h');
  });

  // «No me reportaste ninguno» ≠ «no descansaste». La primera es lo que Likida
  // sabe; la segunda sería una afirmación en contra del propio operador.
  it('sin descansos dice que no se los reportaron, no que no descansó', () => {
    const r = resumenParaOperador('2026-08-27', [
      asiento('inicio_jornada', T('06:00')),
      asiento('fin_jornada', T('14:00')),
    ]);
    expect(r).toContain('no me reportaste ninguno');
    expect(r).not.toContain('no descansaste');
  });

  it('un descanso sin regreso se dice abierto, no se cierra solo', () => {
    const r = resumenParaOperador('2026-08-27', [
      asiento('inicio_jornada', T('06:00')),
      asiento('inicio_descanso', T('13:00')),
      asiento('fin_jornada', T('17:00')),
    ]);
    expect(r).toContain('sin regreso anotado');
  });

  // ── LAS MARCAS QUE NO PUSO ÉL SE LE ENSEÑAN COMO TALES ──────────────────
  // No puede acordar un registro cuyo origen no ve. Y el GPS prueba que la
  // unidad se movió, no que él la manejara: decírselo es lo que hace que su
  // conformidad valga.
  it('cada hora dice de dónde salió, en su idioma', () => {
    const r = resumenParaOperador('2026-08-27', [
      asiento('inicio_jornada', T('06:00'), 'gps'),
      asiento('fin_jornada', T('17:00'), 'capturado_contralor'),
    ]);
    expect(r).toContain('lo saqué del GPS de la unidad');
    expect(r).toContain('lo capturó la oficina');
  });

  it('lo que él declaró se le reconoce como suyo', () => {
    const r = resumenParaOperador('2026-08-27', [
      asiento('inicio_jornada', T('06:00'), 'declarado_operador'),
      asiento('fin_jornada', T('17:00'), 'hito_viaje'),
    ]);
    expect(r).toContain('me lo dijiste tú');
    expect(r).toContain('lo saqué de tu aviso del viaje');
  });
});
