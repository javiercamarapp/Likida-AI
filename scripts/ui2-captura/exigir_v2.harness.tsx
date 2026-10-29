// Prueba del aborto sin v2 (se corre con: npx vitest run --config scripts/ui2-captura/vitest.config.mts exigir_v2).
import { describe, expect, it } from 'vitest';
import { exigirV2Css, exigirV2Html } from './exigir_v2';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('el arnés aborta si lo que fotografía no es la UI v2', () => {
  it('acepta la raíz del chrome v2', () => {
    expect(() => exigirV2Html('<div class="tema-neutro x" data-ui="v2" style="a:b"><aside class="rv-sb"></aside></div>', 'ok')).not.toThrow();
    expect(() => exigirV2Html('<div data-ui="v2" class="tema-neutro"></div>', 'orden')).not.toThrow();
  });
  it('aborta con chrome v1', () => {
    expect(() => exigirV2Html('<div class="tema-neutro"><aside></aside></div>', 'v1')).toThrow(/ABORTO/);
  });
  it('aborta si la cadena solo está en un comentario, en texto o en otro elemento', () => {
    expect(() => exigirV2Html('<!-- data-ui="v2" --><div class="tema-neutro"></div>', 'c')).toThrow(/ABORTO/);
    expect(() => exigirV2Html('<p>data-ui="v2"</p><div class="tema-neutro"></div>', 't')).toThrow(/ABORTO/);
    expect(() => exigirV2Html('<span data-ui="v2"></span><div class="tema-neutro"></div>', 's')).toThrow(/ABORTO/);
  });
  it('aborta con un CSS sin reglas v2', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'exigir-'));
    const malo = path.join(d, 'v1.css'); writeFileSync(malo, '.card{color:red}');
    const bueno = path.join(d, 'v2.css'); writeFileSync(bueno, ':root [data-ui="v2"]{--surface:#fff}');
    expect(() => exigirV2Css(malo)).toThrow(/ABORTO/);
    expect(() => exigirV2Css(bueno)).not.toThrow();
  });
});
