import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { destinatarioEnmascarado } from './client';
import { redactarTexto } from '@/lib/logger';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD (22-ago-2026) · SEG-7 — el teléfono con espacios se salvaba
// del redactor.
//
// Los logs de ARCO (`meta/client.ts`) y los de conversación (`conv.ts`)
// pasaban `{ telefono }` crudo, confiando en el redactor del logger. Su regex
// pide los dígitos PEGADOS (`\b\+?521?\d{10}\b`), y el número de una solicitud
// ARCO llega como lo escribió el titular: con espacios, guiones o paréntesis.
// Ese salía entero — y es la peor fila posible para filtrarlo: la de alguien
// ejerciendo sus derechos sobre ese mismo dato (LFPDPPP art. 21).
// ═══════════════════════════════════════════════════════════════════════════

describe('la premisa: el redactor NO cubre un teléfono con separadores', () => {
  it('pegado sí se redacta', () => {
    expect(redactarTexto('llamé al 9993700779')).toContain('[TEL]');
    expect(redactarTexto('llamé al 5219993700779')).toContain('[TEL]');
  });

  it('con espacios o guiones NO — por eso hay que enmascarar antes', () => {
    expect(redactarTexto('llamé al 999 370 0779')).toContain('999 370 0779');
    expect(redactarTexto('llamé al +52 1 999-370-0779')).toContain('999-370-0779');
  });
});

describe('destinatarioEnmascarado', () => {
  it('deja cuatro dígitos y ninguna forma de teléfono', () => {
    expect(destinatarioEnmascarado('999 370 0779')).toBe('***0779');
    expect(destinatarioEnmascarado('+52 1 999-370-0779')).toBe('***0779');
    // Y lo que sale ya no lo toca el redactor: no parece teléfono.
    expect(redactarTexto(destinatarioEnmascarado('999 370 0779'))).toBe('***0779');
  });

  it('la misma persona da la misma marca escriba como escriba su número', () => {
    const formas = ['9993700779', '999 370 0779', '(999) 370-0779', '+52 1 999 370 0779'];
    expect(new Set(formas.map(destinatarioEnmascarado)).size).toBe(1);
  });

  it('un valor corto o basura no revienta ni inventa dígitos', () => {
    expect(destinatarioEnmascarado('12')).toBe('***');
    expect(destinatarioEnmascarado('')).toBe('***');
  });
});

describe('ningún log de estos dos archivos manda el teléfono crudo', () => {
  const RAIZ = join(__dirname, '..', '..', '..');

  it.each(['src/lib/meta/client.ts', 'src/lib/likida/conv.ts'])('%s', (archivo) => {
    const texto = readFileSync(join(RAIZ, archivo), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // Un `logger.x('evento', { telefono })` o `{ telefono,` — el objeto de log
    // con la variable cruda dentro.
    // La variable SUELTA dentro del objeto de log (`{ telefono }` o
    // `{ telefono,`), no la que va como argumento de una función que la
    // enmascara — `destinatarioEnmascarado(telefono)` es justamente lo que
    // debe haber.
    const crudos = (texto.match(/logger\.\w+\([^)]*?\{[\s\S]*?\}/g) ?? [])
      .filter((bloque) => /[{,]\s*telefono\s*[,}\n]/.test(bloque));
    expect(crudos, `logs con el teléfono crudo: ${crudos.join(' | ')}`).toEqual([]);
  });
});
