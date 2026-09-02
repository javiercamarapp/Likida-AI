import { describe, it, expect } from 'vitest';
import {
  extraerCitas, libroMayorDeCitas, j1VerificarCitas, veredictoDelCaso,
  calificar, resumenCalificacion, mensajeJuez, type FilaCalificacion,
} from './juez-contador';
import { BANCO_CONTADOR } from './banco-contador';

// ═══════════════════════════════════════════════════════════════════════════
// LOS JUECES SE PRUEBAN SIN RED — todo lo que decide un veredicto es puro.
// La jerarquía que estas pruebas defienden es la del diseño: INVENTAR cuesta
// más que equivocarse, equivocarse más que abstenerse, una trampa jamás pasa
// en automático, y null no es 0.
// ═══════════════════════════════════════════════════════════════════════════

describe('J1 · extractor de citas', () => {
  it('extrae y normaliza las formas reales del dominio', () => {
    const texto = 'Por la RMF 2026 regla 2.7.1.21 y el art. 28 de la LISR, con la RFA 2026 2.9, ' +
      'el criterio 1/LIF/PI y la NOM-012-SCT-2-2017; ver también CFF arts. 29 y LFT art. 110.';
    const citas = extraerCitas(texto);
    expect(citas).toContain('RMF 2.7.1.21');
    expect(citas).toContain('RFA 2.9');
    expect(citas).toContain('1/LIF/PI');
    expect(citas).toContain('NOM-012-SCT-2-2017');
    expect(citas).toContain('CFF 29');
    expect(citas).toContain('LFT 110');
  });

  it('no inventa citas de un texto sin ellas', () => {
    expect(extraerCitas('No puedo afirmarlo con el corpus verificado; confirma con un fiscalista.')).toEqual([]);
  });

  it('el libro mayor conoce las citas doradas del banco', () => {
    const libro = libroMayorDeCitas();
    // Las citas centrales del examen tienen que ser localizables — si no,
    // TODA respuesta correcta escalaría a humano y J1 sería ruido.
    for (const c of ['RMF 2.7.1.21', 'RFA 2.9', 'RFA 2.2', 'RLISR 57', 'LISR 28', 'CFF 29', 'LFT 110', '1/LIF/PI']) {
      expect(libro.has(c), c).toBe(true);
    }
  });

  it('marca como desconocida una cita que no vive en ningún material de la casa', () => {
    const r = j1VerificarCitas('Aplica la RMF 2026 regla 9.9.9.9 sin duda alguna.');
    expect(r.desconocidas).toEqual(['RMF 9.9.9.9']);
  });
});

describe('el veredicto por caso — la jerarquía de daño', () => {
  it('invento → fallo, y el detalle lo nombra (cuesta más que abstenerse)', () => {
    const v = veredictoDelCaso('factica', 'invento', []);
    expect(v.veredicto).toBe('fallo');
    expect(v.detalle).toMatch(/INVENTO/);
  });

  it('incorrecto → fallo', () => {
    expect(veredictoDelCaso('factica', 'incorrecto', []).veredicto).toBe('fallo');
  });

  it('abstención en fáctica → fallo etiquetado como falsa cautela, no como error', () => {
    const v = veredictoDelCaso('factica', 'abstencion', []);
    expect(v.veredicto).toBe('fallo');
    expect(v.detalle).toMatch(/falsa cautela/);
  });

  it('una trampa NUNCA pasa en automático: J2 la da por buena → revisar (juez humano)', () => {
    const v = veredictoDelCaso('trampa', 'correcto', []);
    expect(v.veredicto).toBe('revisar');
    expect(v.detalle).toMatch(/juez humano/);
  });

  it('trampa con reserva incompleta → revisar, no paso', () => {
    expect(veredictoDelCaso('trampa', 'abstencion', []).veredicto).toBe('revisar');
  });

  it('fáctica correcta con cita fuera del libro mayor → revisar (desacuerdo entre jueces escala, no se vota)', () => {
    const v = veredictoDelCaso('factica', 'correcto', ['RMF 9.9.9.9']);
    expect(v.veredicto).toBe('revisar');
    expect(v.detalle).toContain('RMF 9.9.9.9');
  });

  it('fáctica correcta con citas verificadas → paso', () => {
    expect(veredictoDelCaso('factica', 'correcto', []).veredicto).toBe('paso');
  });

  // Hallazgo del primer examen real (28-ago-2026): la calificación estaba
  // contando como «falsa cautela» las abstenciones en preguntas cuyo propio
  // banco declara `fichaEnCorpus: false` — castigando al agente por no
  // inventar, justo lo que la regla 4 del encargo prohíbe.
  it('abstención en fáctica SIN ficha en el corpus → PASO, no falsa cautela', () => {
    const v = veredictoDelCaso('factica', 'abstencion', [], false);
    expect(v.veredicto).toBe('paso');
    expect(v.detalle).toMatch(/JUSTIFICADA/);
  });

  it('abstención en fáctica CON ficha en el corpus (default) → sigue siendo falsa cautela', () => {
    expect(veredictoDelCaso('factica', 'abstencion', [], true).veredicto).toBe('fallo');
    // El default del parámetro preserva el comportamiento de siempre.
    expect(veredictoDelCaso('factica', 'abstencion', []).veredicto).toBe('fallo');
  });
});

describe('la calificación — null no es 0 y nada se promedia', () => {
  const fila = (over: Partial<FilaCalificacion>): FilaCalificacion => ({
    clave: 'Qx', tipo: 'factica', severidad: 3, dictamen: 'correcto', citasDesconocidas: 0, ...over,
  });

  it('una pregunta sin correr NO cuenta como reprobada — se reporta aparte', () => {
    const c = calificar([
      fila({ clave: 'Q1', dictamen: 'correcto' }),
      fila({ clave: 'Q2', dictamen: null }),
    ]);
    expect(c.corridas).toBe(1);
    expect(c.sinCorrer).toBe(1);
    expect(c.puertas.facticasSev3Pct).toBe(100); // el denominador es lo corrido
    expect(resumenCalificacion(c)).toContain('SIN CORRER');
  });

  it('con cero casos corridos, las puertas dicen «sin medir», jamás 0%', () => {
    const c = calificar([fila({ dictamen: null })]);
    expect(c.puertas.facticasSev3Pct).toBeNull();
    expect(c.puertas.trampasAdecuadasPct).toBeNull();
    expect(resumenCalificacion(c)).toContain('sin medir');
  });

  it('separa abstención (falsa cautela) de incorrecto y de invento', () => {
    const c = calificar([
      fila({ clave: 'Q1', dictamen: 'abstencion' }),
      fila({ clave: 'Q2', dictamen: 'incorrecto' }),
      fila({ clave: 'Q3', dictamen: 'invento' }),
      fila({ clave: 'Q4', dictamen: 'correcto' }),
    ]);
    expect(c.facticas).toMatchObject({ correctas: 1, incorrectas: 1, abstenciones: 1, inventos: 1 });
    expect(c.puertas.inventos).toBe(1);
    expect(c.puertas.abstencionExcesivaPct).toBe(25);
  });

  it('las trampas se miden contra 100%, sobre las corridas', () => {
    const c = calificar([
      fila({ clave: 'Q1', tipo: 'trampa', dictamen: 'correcto' }),
      fila({ clave: 'Q5', tipo: 'trampa', dictamen: 'incorrecto' }),
    ]);
    expect(c.trampas).toMatchObject({ corridas: 2, adecuadas: 1, falladas: 1 });
    expect(c.puertas.trampasAdecuadasPct).toBe(50);
  });

  // Hallazgo del primer examen real: cuatro preguntas (Q3, Q24, Q26, Q27) se
  // contaban como «falsa cautela» solo porque el corpus de fichas no las
  // sostiene — no porque el agente se equivocara.
  it('abstención con fichaEnCorpus:false NO cuenta como falsa cautela ni entra al denominador de exactitud', () => {
    const c = calificar([
      fila({ clave: 'Q1', dictamen: 'correcto' }),
      fila({ clave: 'Q3', dictamen: 'abstencion', fichaEnCorpus: false }),
      fila({ clave: 'Q6', dictamen: 'abstencion', fichaEnCorpus: true }),
    ]);
    // corridas: Q1 y Q6 (Q3 es hueco de corpus, no material de exactitud).
    expect(c.facticas.corridas).toBe(2);
    expect(c.facticas.correctas).toBe(1);
    expect(c.facticas.abstenciones).toBe(1); // solo Q6, la falsa cautela real
    expect(c.facticas.abstencionesJustificadas).toBe(1); // Q3
    expect(c.puertas.facticasSev3Pct).toBe(50); // 1/2, no 1/3
    expect(c.puertas.abstencionExcesivaPct).toBe(50); // 1/2, no 1/3
    expect(resumenCalificacion(c)).toContain('JUSTIFICADA');
  });
});

describe('el material del juez de rúbrica', () => {
  it('lleva el criterio escrito verbatim — la vara es el texto, no el parecer', () => {
    const caso = BANCO_CONTADOR.find((c) => c.clave === 'Q17')!;
    const msg = mensajeJuez(caso, 'RESPUESTA: …');
    expect(msg).toContain(caso.criterio);
    expect(msg).toContain(caso.senalDeFallo);
    expect(msg).toContain('RESPUESTA DEL EXAMINADO');
  });
});
