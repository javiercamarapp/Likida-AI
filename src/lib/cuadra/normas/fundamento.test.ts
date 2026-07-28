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

  it('un mensaje normal cuesta una fracción de milisegundo', () => {
    const t = 'El diésel en efectivo se limita al 15% por RFA 2026 regla 2.9, y el resto no es deducible por LISR 27-III.';
    const t0 = Date.now();
    for (let i = 0; i < 100; i++) citasEnTexto(t);
    // 100 llamadas en menos de 100ms. Holgado a propósito: esto corre en CI, en
    // máquinas de las que no controlamos la carga.
    expect(Date.now() - t0).toBeLessThan(100);
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
