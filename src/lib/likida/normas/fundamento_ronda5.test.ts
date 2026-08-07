import { describe, it, expect } from 'vitest';
import { guardiaFundamento, citasEnTexto } from './fundamento';

// DOS CRÍTICOS REINCIDENTES de la auditoría 5 (agéntico), con la salida real que
// el auditor transcribió. Los dos venían de las rondas 3 y 4.
//
// ── 1. La guardia DETECTA la cita inventada, escribe en el log que la quitó, y
//       manda el texto IDÉNTICO.
//
// `FORMA_DE_CITA` se fue ensanchando ronda tras ronda; la limpieza de
// `CITA_DESCONOCIDA` era una copia a mano de cuatro `replace` que no se ensanchó
// con ella. Resultado con `permitidas = []`:
//
//   ENTRA : "Ese gasto no aplica conforme al 45-Z de la Ley del ISR."
//   citas : ["DESCONOCIDA"]  forzado: true  quitadas: ["DESCONOCIDA"]
//   SALE  : idéntico                                  ← no se quitó nada
//
// Media guardia que además MIENTE: quien lea el log cree que la cita inventada
// nunca llegó al operador.
//
// ── 2. Basta alejar la ley 45 caracteres para que la cita inventada desaparezca
//       de la detección.
//
// La ventana `[^.]{0,45}` que liga el número al nombre de la ley era CODICIOSA,
// así que el patrón de la cita PERMITIDA se estiraba hasta el último "ISR" de la
// frase y se tragaba la inventada dentro de su propio match. Al borrarse para
// buscar lo que sobra, la inventada se iba con ella.

describe('citas inventadas: detectar y BORRAR, no solo detectar', () => {
  const inventadas: Array<[string, string]> = [
    ['sufijo pegado a la ley', 'Ese gasto no aplica conforme al 45-Z de la Ley del ISR.'],
    ['número en palabras', 'No es deducible por el artículo veintisiete fracción tres de la LISR.'],
    ['regla en palabras', 'Te lo permite la regla dos punto nueve fracción uno de la RFA.'],
  ];

  for (const [nombre, texto] of inventadas) {
    it(`${nombre}: se detecta Y se borra del texto`, () => {
      const r = guardiaFundamento(texto, []);
      expect(r.forzado).toBe(true);
      expect(r.quitadas).toContain('DESCONOCIDA');
      // Lo que fallaba: el texto salía igual que entró.
      expect(r.reply).not.toBe(texto);
    });
  }

  it('el log no puede decir "quitadas" sobre un texto intacto', () => {
    for (const [, texto] of inventadas) {
      const r = guardiaFundamento(texto, []);
      // La invariante que faltaba: si se reporta algo quitado, el texto cambió.
      if (r.quitadas.length > 0) expect(r.reply).not.toBe(texto);
    }
  });
});

describe('una cita permitida no puede tapar a una inventada en la misma frase', () => {
  const MIXTA =
    'No es deducible conforme al artículo 27, fracción III de la LISR, y además el 45-Z de la Ley del ISR lo confirma.';

  it('se detectan LAS DOS', () => {
    const citas = citasEnTexto(MIXTA);
    expect(citas).toContain('lisr-27-fr-III');
    expect(citas).toContain('DESCONOCIDA');
  });

  it('la inventada se borra y la permitida se queda', () => {
    const r = guardiaFundamento(MIXTA, ['lisr-27-fr-III']);
    expect(r.forzado).toBe(true);
    expect(r.reply).not.toContain('45-Z');
    // Lo que NO se puede perder al arreglar: la cita legítima sobrevive entera.
    expect(r.reply).toContain('artículo 27, fracción III de la LISR');
  });

  // El límite: una cita permitida sola no se toca. Si esta prueba se pusiera roja
  // significaría que la guardia empezó a borrar fundamento legítimo, que es el
  // daño opuesto y peor: el operador se queda sin saber por qué no le deducen.
  it('una cita permitida sola sale intacta', () => {
    const t = 'No es deducible conforme al artículo 27, fracción III de la LISR.';
    const r = guardiaFundamento(t, ['lisr-27-fr-III']);
    expect(r.reply).toBe(t);
    expect(r.forzado).toBe(false);
  });
});
