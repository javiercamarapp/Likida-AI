import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 22 · BE-1 (ALTO) — un byte C1 cerraba la liquidación sin papel.
//
// El saneador reemplazaba `[^ -ÿ–—•€]`. Ese rango es 0x20–0xFF e INCLUYE los
// controles C1 (0x7F–0x9F), que la codificación WinAnsi de pdf-lib no puede
// escribir: `drawText` lanza, la generación del PDF muere, y la liquidación se
// cierra SIN PAPEL —de forma irreversible, porque los triggers 0036/0037 no
// dejan reabrirla— mientras al chofer se le dice que el contralor sí lo tiene.
//
// Y llega gratis: 0x92 es la comilla tipográfica de Windows-1252 (cualquier
// nombre pegado desde Word), y un OCR sobre un ticket con ruido produce bytes
// C1 sin esfuerzo.
//
// Se prueba contra el saneador REAL, extraído del fuente: replicarlo aquí
// sería probar la copia, no el código. Los bytes se construyen con
// `String.fromCharCode` a propósito — escribirlos literales en este archivo
// los volvería invisibles al leer el diff.
// ═══════════════════════════════════════════════════════════════════════════

const FUENTE = readFileSync('src/lib/likida/liquidacion/pdf.ts', 'utf8');

/** Los `.replace(...)` del saneador `wa` del módulo, aplicados en su orden. */
function sanearComoElModulo(s: string): string {
  const cuerpo = FUENTE.slice(FUENTE.indexOf('const wa ='), FUENTE.indexOf('const text = (s: string'));
  const reglas = [...cuerpo.matchAll(/\.replace\((\/[^/]+\/[gu]*), '([^']*)'\)/g)];
  // Si el saneador se reescribe de otra forma, esta prueba tiene que romperse
  // ruidosamente en vez de pasar por vacío sobre cero reglas.
  expect(reglas.length).toBeGreaterThan(4);
  let out = s;
  for (const [, re, rep] of reglas) {
    const m = /^\/(.*)\/([gu]*)$/.exec(re)!;
    out = out.replace(new RegExp(m[1], m[2]), rep);
  }
  return out;
}

const REEMPLAZO = '?';

describe('BE-1: los controles C1 no llegan a WinAnsi', () => {
  it('ningún byte 0x7F–0x9F sobrevive al saneador', () => {
    for (let c = 0x7f; c <= 0x9f; c++) {
      const crudo = String.fromCharCode(c);
      const salida = sanearComoElModulo(`Juan${crudo}Perez`);
      expect(salida.includes(crudo), `el byte 0x${c.toString(16)} pasó entero`).toBe(false);
      expect(salida).toBe(`Juan${REEMPLAZO}Perez`);
    }
  });

  it('la comilla tipográfica de Windows-1252 (0x92): el caso que llega pegando desde Word', () => {
    const salida = sanearComoElModulo(`Transportes Bajio${String.fromCharCode(0x92)}s`);
    expect(salida.includes(String.fromCharCode(0x92))).toBe(false);
  });

  it('y lo que SÍ se puede imprimir se conserva: acentos, guion largo, viñeta, euro', () => {
    const salida = sanearComoElModulo('Pérez — diésel • €');
    expect(salida).toContain('Pérez');
    expect(salida).toContain('—');
    expect(salida).toContain('•');
    expect(salida).toContain('€');
  });
});
