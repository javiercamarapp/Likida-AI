import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { CONFIG_CONDUCTOR_DEFAULT, validarConfigConductor } from './config';

// T-A5-67 — la constancia no es código muerto: la pantalla del Conductor la invoca, detrás de una perilla apagada de origen.
describe('constancia — cableado y perilla', () => {
  const pagina = readFileSync(new URL('../../../app/dashboard/agentes/conductores/page.tsx', import.meta.url), 'utf8');

  it('la página del Conductor lee los datos, arma la constancia y la pinta, solo con la perilla encendida', () => {
    expect(pagina).toMatch(/leerDatosConstancia\(/);
    expect(pagina).toMatch(/armarConstancia\(/);
    expect(pagina).toMatch(/<ConstanciaReportes /);
    expect(pagina).toMatch(/config\.constanciaReportesActiva !== true\) return undefined/);
  });

  it('nace apagada y solo un true explícito la enciende', () => {
    expect(CONFIG_CONDUCTOR_DEFAULT.constanciaReportesActiva).toBe(false);
    const base = { ...CONFIG_CONDUCTOR_DEFAULT };
    const activa = (v: unknown) => {
      const r = validarConfigConductor({ ...base, constanciaReportesActiva: v as boolean });
      if (!('ok' in r)) throw new Error(r.error);
      return r.ok.constanciaReportesActiva;
    };
    expect(activa(undefined)).toBe(false);
    expect(activa('true')).toBe(false);
    expect(activa(true)).toBe(true);
  });
});
