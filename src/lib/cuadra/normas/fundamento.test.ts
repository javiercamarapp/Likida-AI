import { describe, it, expect } from 'vitest';
import { citasEnTexto, guardiaFundamento } from './fundamento';

// ═══════════════════════════════════════════════════════════════════════════
// EL MODELO NO TECLEA UN ARTÍCULO DE MEMORIA.
//
// Gemela de `guardiaCifras`, para normas. Un LLM sabe que existe "el artículo 27
// fracción III de la LISR" y lo escribirá con total aplomo aunque nadie se lo
// haya dado — y también escribirá "artículo 32 fracción XX" con el mismo aplomo.
//
// Frente a un contralor con fiscalista, una cita inventada cuesta más que un
// número mal: el número se corrige, la credibilidad no. Y es lo que el producto
// vende — "cada veredicto trae su fundamento".
//
// Misma asimetría que con las cifras: quitar una cita legítima cuesta que el
// mensaje sea menos preciso; dejar pasar una inventada cuesta la venta.
// ═══════════════════════════════════════════════════════════════════════════

describe('citasEnTexto', () => {
  it('reconoce las formas en que el modelo escribe una norma', () => {
    expect(citasEnTexto('No es deducible por LISR 27-III.')).toContain('lisr-27-fr-III');
    expect(citasEnTexto('la RFA 2026 regla 2.9 permite el 15%')).toContain('rfa-2026-2.9');
    expect(citasEnTexto('el estímulo del LIF 2026 art. 20, ap. A')).toContain('lif-2026-art-20-A');
  });

  it('aguanta cómo lo escribe de verdad, no solo la forma canónica', () => {
    // El modelo no copia y pega: reformula.
    expect(citasEnTexto('según el artículo 27 fracción III de la LISR')).toContain('lisr-27-fr-III');
    expect(citasEnTexto('el art. 28 fr. V de la Ley del ISR')).toContain('lisr-28-fr-V');
  });

  it('no inventa citas donde no las hay', () => {
    expect(citasEnTexto('Mándame la foto del ticket')).toEqual([]);
    expect(citasEnTexto('Comprobaste $4,812.00 de 5 tickets')).toEqual([]);
  });

  it('detecta una norma que NO existe en el índice como cita desconocida', () => {
    // Lo importante: que se note que hay una cita, aunque no la reconozcamos.
    const r = citasEnTexto('conforme al artículo 999 fracción XL de la LISR');
    expect(r).toContain('DESCONOCIDA');
  });
});

describe('guardiaFundamento', () => {
  it('deja pasar una cita que una tool devolvió en el turno', () => {
    const r = guardiaFundamento('El diésel en efectivo se limita al 15% (RFA 2026 regla 2.9).', ['rfa-2026-2.9']);
    expect(r.forzado).toBe(false);
    expect(r.reply).toContain('RFA 2026 regla 2.9');
  });

  it('QUITA una cita que ninguna tool devolvió', () => {
    const r = guardiaFundamento('No es deducible por LISR 27-III.', []);
    expect(r.forzado).toBe(true);
    expect(r.reply).not.toMatch(/LISR 27-III/);
  });

  it('quita la INVENTADA y conserva la legítima', () => {
    const r = guardiaFundamento(
      'Por RFA 2026 regla 2.9 puedes deducir el 15%, y por LISR 32-XX no lo demás.',
      ['rfa-2026-2.9'],
    );
    expect(r.forzado).toBe(true);
    expect(r.reply).toContain('RFA 2026 regla 2.9');
    expect(r.reply).not.toMatch(/32-XX/);
  });

  it('un texto sin citas pasa intacto y sin trabajo', () => {
    const t = 'Ya cuadré tu viaje, todo en orden 👍';
    const r = guardiaFundamento(t, []);
    expect(r.forzado).toBe(false);
    expect(r.reply).toBe(t);
  });

  it('el mensaje sigue siendo legible tras quitar la cita', () => {
    // Quitar el paréntesis no puede dejar "por  ." ni frases rotas: el operador
    // lee esto en WhatsApp.
    const r = guardiaFundamento('El gasto no es deducible (LISR 27-III) según revisé.', []);
    expect(r.reply).not.toMatch(/\(\s*\)/);
    expect(r.reply).not.toMatch(/\s{2,}/);
  });

  it('una norma NO VINCULANTE no se presenta como obligación', () => {
    // Nivel 6: el plazo del portal de una gasolinera no es una obligación
    // fiscal. Es el error que `normas/README.md` señala explícitamente.
    const r = guardiaFundamento(
      'Estás obligado a facturar en 72 horas por la política del portal.',
      ['politica-portales-plazos-facturacion'],
    );
    expect(r.forzado).toBe(true);
    expect(r.reply).not.toMatch(/obligad/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LOS REGEX SE CONSTRUYEN EN CALIENTE, ASÍ QUE HAY QUE MEDIRLOS.
//
// `patronesDe` compila expresiones a partir de datos del índice, y `citasEnTexto`
// las corre contra un texto que viene de un LLM — o sea, entrada que no
// controlamos, dentro de un webhook con 60s de presupuesto. Un backtracking
// catastrófico ahí no se ve como un bug: se ve como un mensaje que nunca llegó.
//
// Medido: 0.065 ms por llamada con texto normal, 2 ms con entradas
// adversariales de 4,800 caracteres. Los cuantificadores acotados (`[^.]{0,45}`)
// son lo que lo sostiene — si alguien los cambia por `.*`, esto lo caza.
// ═══════════════════════════════════════════════════════════════════════════
describe('coste y resistencia de la detección', () => {
  it('no explota con entradas diseñadas para maximizar caminos', () => {
    const adversariales = [
      'LISR ' + 'a'.repeat(2000) + ' artículo 27 fracción III',
      'artículo '.repeat(500) + '27 fracción III LISR',
      'LISR 27-III '.repeat(400),
      'art. ' + '1'.repeat(3000),
    ];
    for (const t of adversariales) {
      const t0 = Date.now();
      citasEnTexto(t);
      guardiaFundamento(t, []);
      expect(Date.now() - t0, `posible ReDoS con ${t.length} chars`).toBeLessThan(500);
    }
  });

  // SE SALTA BAJO `--coverage`: 100 llamadas instrumentadas cuestan ~107 ms
  // contra los ~7 ms reales, así que el umbral mediría la instrumentación. En
  // `npm test` corre a plena fuerza.
  it.skipIf(process.env.CUADRA_COBERTURA === '1')('un mensaje normal cuesta una fracción de milisegundo', () => {
    const t = 'El diésel en efectivo se limita al 15% por RFA 2026 regla 2.9, y el resto no es deducible por LISR 27-III.';

    // MEJOR DE NUEVE, y con un presupuesto acorde a lo que esta prueba de verdad
    // vigila. Medía 100 llamadas contra 100 ms en una sola corrida, y se cayó con
    // 126 ms el 28-jul con la máquina cargada — un microbenchmark dentro de una
    // suite de 103 archivos en paralelo mide la carga, no el algoritmo.
    //
    // Lo que esto caza es ReDoS: un patrón catastrófico en `FORMA_DE_CITA` no
    // tarda 126 ms, tarda SEGUNDOS. Con 500 ms sigue detectándolo por tres
    // órdenes de magnitud y deja de romperse por ruido. Un umbral que falla al
    // azar no protege de nada: enseña a reintentar el CI sin leerlo.
    const medir = () => {
      const t0 = Date.now();
      for (let i = 0; i < 100; i++) citasEnTexto(t);
      return Date.now() - t0;
    };
    let mejor = medir();
    for (let i = 0; i < 8; i++) mejor = Math.min(mejor, medir());
    expect(mejor).toBeLessThan(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA GUARDIA NO PUEDE ROMPER EL MENSAJE QUE PROTEGE.
//
// Dos hallazgos de la auditoría 3, ambos en el camino feliz de la demo:
//
// 1. `limpiar()` colapsaba TODO espacio repetido con `\s{2,}`, y `\n` es
//    espacio. El resumen de WhatsApp es multilínea —viñetas, párrafos— y salía
//    convertido en un párrafo corrido cada vez que la guardia actuaba.
//
// 2. El resumen DETERMINÍSTICO del motor trae citas correctas puestas por
//    `engine.ts`. Si `guardiaCifras` lo sustituye y esta guardia corre después
//    con `permitidas=[]`, se las quita: la guardia corrompiendo la fuente
//    autoritativa que existe para no depender del modelo.
// ═══════════════════════════════════════════════════════════════════════════
describe('guardiaFundamento — no rompe el mensaje', () => {
  it('conserva los saltos de línea al quitar una cita', () => {
    const multi = 'Listo, cuadré tu viaje 👇\n• Comprobado: $4,812.00\n• Sobró $188.00\n\nOjo con esto:\n• Falta la factura por LISR 27-III.';
    const r = guardiaFundamento(multi, []);
    expect(r.forzado).toBe(true);
    expect(r.reply.split('\n').length, 'se comió los saltos de línea').toBeGreaterThan(4);
    expect(r.reply).toContain('• Comprobado');
  });

  it('no deja renglones con espacios sobrantes tras quitar la cita', () => {
    const r = guardiaFundamento('• Falta la factura (LISR 27-III).\n• Otra cosa.', []);
    for (const l of r.reply.split('\n')) expect(l).not.toMatch(/\s{2,}/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA COMA. Hallazgo crítico de la auditoría 3.
//
// "artículo 27, fracción III de la LISR" es la puntuación más natural del
// español y la que un modelo escribe sin pensar. El patrón exigía solo espacios
// entre el número y la palabra "fracción", así que esa forma NO se detectaba:
// una cita fiscal no autorizada pasaba entera al operador.
//
// Y el reverso, peor: una cita LEGÍTIMA escrita así tampoco se reconocía, no se
// protegía, y la limpieza genérica de citas desconocidas se la comía a medias —
// dejando el texto mutilado.
// ═══════════════════════════════════════════════════════════════════════════
describe('guardiaFundamento — la puntuación natural del español', () => {
  const conComa = 'No es deducible por el artículo 27, fracción III de la LISR.';

  it('detecta la cita escrita con coma', () => {
    expect(citasEnTexto(conComa)).toContain('lisr-27-fr-III');
  });

  it('la QUITA si ninguna tool la autorizó', () => {
    const r = guardiaFundamento(conComa, []);
    expect(r.forzado).toBe(true);
    expect(r.reply).not.toMatch(/27/);
  });

  it('la CONSERVA entera si la tool la devolvió', () => {
    // El reverso del bug: una cita legítima con coma se mutilaba.
    const r = guardiaFundamento(conComa, ['lisr-27-fr-III']);
    expect(r.forzado).toBe(false);
    expect(r.reply).toBe(conComa);
  });

  it('aguanta otras separaciones que también escribe un modelo', () => {
    for (const t of [
      'el art. 27, fr. III de la LISR',
      'LISR, artículo 27, fracción III',
      'artículo 27 — fracción III de la LISR',
    ]) expect(citasEnTexto(t), t).toContain('lisr-27-fr-III');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 4 · CRÍTICO — el arreglo de la coma abrió un agujero peor.
//
// Al ensanchar los patrones para cazar "artículo 27, fracción III" se añadió un
// patrón SIN instrumento, con el argumento de que "la fracción ya identifica la
// norma sin ambigüedad". Identifica el NÚMERO, no la LEY. Y los patrones nunca
// tuvieron frontera al final del número, así que "2.9" calza dentro de "2.9.1".
//
// La diferencia con el hueco anterior es de grado, no de tipo: antes la guardia
// se quedaba callada ante una cita inventada; aquí la CERTIFICA como si una tool
// la hubiera autorizado. Un fiscalista que busque "RFA 2026 regla 2.9.1" no
// encuentra nada, y el producto queda como que inventa fundamentos.
// ═══════════════════════════════════════════════════════════════════════════

describe('una cita no se aprueba por el número: tiene que ser la misma LEY', () => {
  it('artículo y fracción correctos, pero de OTRO instrumento, no son la norma permitida', () => {
    // CFF 27-III es el registro del RFC: nada que ver con pagos en efectivo.
    const t = 'Ese diésel no es deducible por el artículo 27, fracción III del Código Fiscal de la Federación.';
    expect(citasEnTexto(t)).not.toContain('lisr-27-fr-III');
  });

  it('y la guardia NO la deja pasar intacta aunque la tool haya autorizado la de la LISR', () => {
    const t = 'No es deducible por el artículo 27, fracción III de la Ley del IVA.';
    const r = guardiaFundamento(t, ['lisr-27-fr-III']);
    expect(r.forzado).toBe(true);
  });
});

describe('el número de la norma termina donde termina: sin frontera se aprueban subreglas inventadas', () => {
  it('"regla 2.9.1" no es la regla 2.9', () => {
    const t = 'Esto lo permite conforme a la RFA 2026 regla 2.9.1 para el autotransporte.';
    expect(citasEnTexto(t)).not.toContain('rfa-2026-2.9');
  });

  it('"artículo 570" no es el artículo 57', () => {
    expect(citasEnTexto('el artículo 570 del RLISR')).not.toContain('rlisr-57');
  });

  it('"artículo 29-A9" no es el artículo 29-A', () => {
    expect(citasEnTexto('el artículo 29-A9 del CFF')).not.toContain('cff-29-A');
  });

  it('la guardia fuerza cuando el texto trae la subregla inventada', () => {
    const t = 'Esto lo permite la RFA 2026 regla 2.9.1.';
    expect(guardiaFundamento(t, ['rfa-2026-2.9']).forzado).toBe(true);
  });
});

describe('lo que el arreglo NO debe romper (regresión de la ronda 3)', () => {
  it('la cita legítima con coma sigue reconociéndose y conservándose entera', () => {
    const t = 'No es deducible según el artículo 27, fracción III de la LISR.';
    expect(citasEnTexto(t)).toContain('lisr-27-fr-III');
    const r = guardiaFundamento(t, ['lisr-27-fr-III']);
    expect(r.forzado).toBe(false);
    expect(r.reply).toBe(t);
  });

  it('la regla 2.9 de verdad sigue reconociéndose', () => {
    expect(citasEnTexto('conforme a la RFA 2026 regla 2.9')).toContain('rfa-2026-2.9');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 4 · CRÍTICO REINCIDENTE — formas de cita que el detector no veía.
//
// `FORMA_DE_CITA` era una lista de formas CONOCIDAS, no un detector de "esto
// tiene pinta de referencia legal". Si el modelo no pegaba la palabra
// "artículo"/"regla"/"fracción" a un dígito, o ponía la sigla DESPUÉS del
// número, la cita inventada ni siquiera llegaba a CITA_DESCONOCIDA: salía
// intacta hacia el contralor.
//
// La ronda 3 lo reportó, se declaró arreglado y el commit no tocó el regex.
// ═══════════════════════════════════════════════════════════════════════════

describe('una cita inventada se detecta aunque no traiga la palabra "artículo"', () => {
  // CORREGIDA EN LA AUDITORÍA 6. Esta prueba usaba como ejemplo de "cita
  // inventada" una cita a una norma que SÍ está en el índice, y exigía que
  // saliera `DESCONOCIDA`. Eso no era la protección: era el bug. `27-III LISR`
  // es LISR 27-III escrito al revés, y tratarlo como desconocido lo BORRABA del
  // mensaje aunque la tool lo hubiera devuelto ese mismo turno.
  //
  // Lo que la prueba quería fijar —que esta forma no pase inadvertida— se fija
  // mejor abajo: sin permiso se quita igual, y ahora el log dice QUÉ norma se
  // citó sin autorización en vez de un genérico "DESCONOCIDA".
  it('sigla DESPUÉS del número: "27-III LISR" se atribuye a su norma', () => {
    expect(citasEnTexto('No es deducible: 27-III LISR.')).toContain('lisr-27-fr-III');
  });

  it('y sin permiso se quita igual, nombrando la norma en el log', () => {
    const r = guardiaFundamento('No es deducible: 27-III LISR.', []);
    expect(r.forzado).toBe(true);
    expect(r.quitadas).toContain('lisr-27-fr-III');
  });

  it('número con sufijo junto al nombre de la ley: "45-Z de la Ley del ISR"', () => {
    const t = 'Ese gasto no aplica conforme al 45-Z de la Ley del ISR, así que te lo dejo como no deducible.';
    expect(citasEnTexto(t)).toContain('DESCONOCIDA');
  });

  it('el número escrito en palabras: "artículo veintisiete fracción tres"', () => {
    const t = 'No es deducible por el artículo veintisiete fracción tres de la LISR.';
    expect(citasEnTexto(t)).toContain('DESCONOCIDA');
  });

  it('y la guardia fuerza el texto en los tres casos', () => {
    for (const t of [
      'No es deducible: 27-III LISR.',
      'Ese gasto no aplica conforme al 45-Z de la Ley del ISR.',
      'No es deducible por el artículo veintisiete fracción tres de la LISR.',
    ]) expect(guardiaFundamento(t, []).forzado, t).toBe(true);
  });
});

describe('el detector ensanchado no puede confundir un folio ni una fecha con una cita', () => {
  it('deja en paz el cuadre normal, que es la mayoría de los mensajes', () => {
    const t = 'Listo, cuadré tu viaje 👇\n• Comprobado: $5,000.00\n• Anticipo: $6,000.00\n• Sobró $1,000.00 del anticipo';
    expect(citasEnTexto(t)).toEqual([]);
    expect(guardiaFundamento(t, []).forzado).toBe(false);
  });

  it('deja en paz folios, fechas y RFC', () => {
    for (const t of [
      'Tu folio es A-4501 y el ticket es del 2026-07-28.',
      'La factura F-129 está timbrada al RFC XAXX010101000.',
      'El viaje 2026-014 ya quedó.',
    ]) expect(citasEnTexto(t), t).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA CITA SIN NINGUNA PALABRA CLAVE.
//
// Hallazgo REINCIDENTE: viene de la ronda 3, la ronda 4 comprobó que nunca se
// atacó, y de sus tres formas quedaba una viva — "conforme al 27-III", que no
// lleva "artículo", ni "fracción", ni sigla delante del número. Salía [NADA]:
// ni siquiera llegaba a DESCONOCIDA, así que pasaba entera y sin log.
//
// `27-III` es la forma más corta de escribir una cita fiscal en español y la que
// un modelo usa cuando ya nombró la ley en la frase anterior.
// ═══════════════════════════════════════════════════════════════════════════
describe('guardiaFundamento — la cita desnuda', () => {
  it('"conforme al 27-III" se detecta como cita', () => {
    expect(citasEnTexto('No es deducible conforme al 27-III.')).not.toEqual([]);
  });

  it('y se quita si ninguna tool la autorizó', () => {
    const r = guardiaFundamento('No es deducible conforme al 27-III.', []);
    expect(r.forzado).toBe(true);
    expect(r.reply).not.toMatch(/27-III/);
  });

  it('otras formas desnudas también', () => {
    for (const t of ['aplica el 28-V', 'según 2.9 de la RFA', 'por el 20-A']) {
      expect(citasEnTexto(t), t).not.toEqual([]);
    }
  });

  it('NO marca números que no son citas', () => {
    // Falso positivo caro: si "3095" o "2026-05-01" contaran como cita, la
    // guardia mutilaría folios y fechas del mensaje.
    for (const t of [
      'Tu folio es 3095',
      'Comprobaste $4,812.00 de 5 tickets',
      'El viaje va del 2026-05-01 al 2026-05-03',
      'Son 25 litros a 28.59',
    ]) expect(citasEnTexto(t), t).toEqual([]);
  });
});
