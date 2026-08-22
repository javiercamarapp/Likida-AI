// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18, B5 — la cuota semanal del diésel tenía escritor y no tenía
// lector: ni el fail-closed prometido, ni el contrato del archivo vigilado, y
// un campo (`estimulo_por_litro`) que invitaba a multiplicar 2.2× de más.
// Estas pruebas leen el archivo REAL del repo: si la rutina lo escribe mal
// (hueco de un viernes, aritmética que no cierra, nombre viejo del campo),
// fallan aquí antes de que lo descubra un contador.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsearCuotasDiesel, validarCuotasDiesel, cuotaDieselVigente } from './cuota_diesel';

const ARCHIVO = new URL('../../../../normas/datos/cuota-ieps-diesel.yaml', import.meta.url);
const tabla = parsearCuotasDiesel(readFileSync(ARCHIVO, 'utf8'));

describe('el archivo real cumple su contrato', () => {
  it('tiene semanas y todas cuadran: sábado a viernes, empalmadas, aritmética exacta', () => {
    expect(tabla.semanas.length).toBeGreaterThanOrEqual(4);
    expect(validarCuotasDiesel(tabla)).toEqual([]);
  });

  it('la cuota completa es la de la LIF 2026 / Acuerdo 179/2025', () => {
    expect(tabla.cuotaCompleta).toBe(7.3634);
  });

  it('la semana del 15-21-ago-2026 es la del hallazgo, dígito por dígito (DOF 14-ago, codNota 5796377)', () => {
    const s = cuotaDieselVigente(tabla, '2026-08-18')!;
    expect(s).not.toBeNull();
    expect(s.cuotaDisminuidaPorLitro).toBe(2.276);
    expect(s.reduccionShcpPorLitro).toBe(5.0874);
    expect(s.fuente.codNota).toBe('5796377');
    // El estímulo del transportista sobre 500 L: $1,138.00 — con la DISMINUIDA.
    expect(Math.round(500 * s.cuotaDisminuidaPorLitro * 100) / 100).toBe(1138);
    // La trampa del campo mal llamado: 2.2× de más.
    expect(Math.round(500 * s.reduccionShcpPorLitro * 100) / 100).toBe(2543.7);
  });
});

describe('fail-closed: sin cuota vigente para la fecha no hay cifra', () => {
  it('antes de la primera semana → null (no se toma "la más cercana")', () => {
    expect(cuotaDieselVigente(tabla, '2026-07-24')).toBeNull();
  });

  it('después de la última semana → null (no se cae al último valor conocido)', () => {
    const ultima = tabla.semanas[tabla.semanas.length - 1];
    const d = new Date(`${ultima.hasta}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    expect(cuotaDieselVigente(tabla, d.toISOString().slice(0, 10))).toBeNull();
    expect(cuotaDieselVigente(tabla, '2030-01-01')).toBeNull();
  });

  it('los bordes de una semana sí están cubiertos (sábado y viernes)', () => {
    expect(cuotaDieselVigente(tabla, '2026-08-15')?.cuotaDisminuidaPorLitro).toBe(2.276);
    expect(cuotaDieselVigente(tabla, '2026-08-21')?.cuotaDisminuidaPorLitro).toBe(2.276);
    expect(cuotaDieselVigente(tabla, '2026-08-14')?.cuotaDisminuidaPorLitro).toBe(2.5801);
  });

  it('una fecha con hora se recorta al día; una fecha inválida es null', () => {
    expect(cuotaDieselVigente(tabla, '2026-08-01T23:59:00Z')?.cuotaDisminuidaPorLitro).toBe(1.7747);
    expect(cuotaDieselVigente(tabla, 'ayer')).toBeNull();
  });
});

describe('el validador atrapa lo que la skill pide verificar', () => {
  const base = () => parsearCuotasDiesel(readFileSync(ARCHIVO, 'utf8'));

  it('un viernes perdido (hueco) se reporta', () => {
    const t = base();
    t.semanas.splice(1, 1);
    expect(validarCuotasDiesel(t).join('\n')).toMatch(/no empalma/);
  });

  it('una aritmética que no cierra se reporta', () => {
    const t = base();
    t.semanas[0].cuotaDisminuidaPorLitro += 0.01;
    expect(validarCuotasDiesel(t).join('\n')).toMatch(/reducción \+ disminuida/);
  });

  it('el nombre viejo del campo (`estimulo_por_litro`) no se acepta en silencio', () => {
    const txt = readFileSync(ARCHIVO, 'utf8').replace(/^(\s+)reduccion_shcp_por_litro:/m, '$1estimulo_por_litro:');
    expect(() => parsearCuotasDiesel(txt)).toThrow(/estimulo_por_litro/);
  });

  it('una semana incompleta no se cuela', () => {
    const txt = readFileSync(ARCHIVO, 'utf8') + '\n  - vigencia: 2026-08-22 a 2026-08-28\n    porcentaje_estimulo: 70\n';
    expect(() => parsearCuotasDiesel(txt)).toThrow(/incompleta/);
  });
});
