import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROTULO_DIFERENCIA, rotuloDiferencia } from './rotulo-diferencia';

// AUDITORÍA 18, MEDIO (M10) — la dona "Dinero observado" pintaba "cfdi efos",
// "viatico excede fiscal" y "alimentacion transporte sin tarjeta credito" al
// lado de "Sobre política".
describe('rotuloDiferencia — cada tipo real del motor tiene rótulo en español (M10)', () => {
  it('cubre TODOS los valores de TipoDiferencia declarados en types/likida.ts', () => {
    const src = readFileSync(fileURLToPath(new URL('../../../../types/likida.ts', import.meta.url)), 'utf8');
    const bloque = src.slice(src.indexOf('export type TipoDiferencia ='), src.indexOf('export interface Diferencia'));
    const tipos = [...bloque.matchAll(/\|\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(tipos.length).toBeGreaterThan(30);
    expect(Object.keys(ROTULO_DIFERENCIA).sort()).toEqual([...tipos].sort());
  });

  it('los del escenario salen en español de oficina, no en snake_case', () => {
    expect(rotuloDiferencia('cfdi_efos')).toBe('Emisor en lista 69-B (EFOS)');
    expect(rotuloDiferencia('viatico_excede_fiscal')).toBe('Viático sobre el tope fiscal');
    expect(rotuloDiferencia('alimentacion_transporte_sin_tarjeta_credito')).toBe('Alimentación sin tarjeta de crédito');
    expect(rotuloDiferencia('sobre_politica')).toBe('Sobre política');
  });

  it('ningún rótulo trae guion bajo ni empieza en minúscula', () => {
    for (const r of Object.values(ROTULO_DIFERENCIA)) {
      expect(r).not.toContain('_');
      expect(r.charAt(0)).toBe(r.charAt(0).toUpperCase());
    }
  });

  it('`sin_comprobar` (la clave muerta) ya no está; `sin_comprobante` sí', () => {
    expect('sin_comprobar' in ROTULO_DIFERENCIA).toBe(false);
    expect(ROTULO_DIFERENCIA.sin_comprobante).toBe('Sin comprobante');
  });

  it('un tipo desconocido cae a texto legible, nunca vacío', () => {
    expect(rotuloDiferencia('tipo_que_no_existe')).toBe('Tipo que no existe');
    expect(rotuloDiferencia('')).toBe('—');
  });
});
