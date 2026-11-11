// F22 — El runbook de restauración debe traer el paso de reaplicar las bajas ARCO ANTES de abrir conexiones.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pasoArco = (md: string) => /reaplicar las bajas/i.test(md) && /antes de (abrir|repuntar)/i.test(md) && /solicitud_arco/.test(md) && /cancelacion/.test(md);

describe('runbook de restauración: paso ARCO', () => {
  it('sanidad: un runbook sin el paso falla la comprobación', () => {
    expect(pasoArco('# Ensayo\nVerifica filas, esquema y RLS.')).toBe(false);
  });
  it('el runbook real trae el paso y lo exige como criterio de aceptación', () => {
    const md = readFileSync(join(__dirname, '..', '..', 'docs', 'operacion', 'ensayo-restauracion.md'), 'utf8');
    expect(pasoArco(md)).toBe(true);
    expect(md).toMatch(/## Criterios de aceptación[\s\S]*paso ARCO/);
  });
});
