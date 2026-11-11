import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODELOS_EVALUADOS, modelFor, overridesRechazados, _reiniciarOverridesRechazados, type RolDinero } from './models';
import { modeloTienePrecio, modeloTieneRespaldo } from './openrouter';
import { logger } from '../logger';

// F16: en los roles que mueven dinero no se puede configurar un modelo sin evaluar.

const ENV: Record<RolDinero, string> = {
  ocr: 'LIKIDA_MODEL_OCR',
  cuadre: 'LIKIDA_MODEL_CUADRE',
  cuadre_fallback: 'LIKIDA_MODEL_CUADRE_FALLBACK',
  cartaporte_extractor: 'LIKIDA_MODEL_CARTAPORTE_EXTRACTOR',
  cartaporte_extractor_escala: 'LIKIDA_MODEL_CARTAPORTE_EXTRACTOR_ESCALA',
  cartaporte_extractor_escala2: 'LIKIDA_MODEL_CARTAPORTE_EXTRACTOR_ESCALA2',
};
const guardadas: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const v of Object.values(ENV)) { guardadas[v] = process.env[v]; delete process.env[v]; }
  _reiniciarOverridesRechazados();
});
afterEach(() => {
  for (const v of Object.values(ENV)) { if (guardadas[v] === undefined) delete process.env[v]; else process.env[v] = guardadas[v]; }
  vi.restoreAllMocks();
});

describe('modelos evaluados por rol de dinero', () => {
  it('LIKIDA_MODEL_OCR fuera de la lista devuelve el modelo por omisión y deja registro', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const porOmision = modelFor('ocr');
    process.env.LIKIDA_MODEL_OCR = 'proveedor/modelo-sin-evaluar';
    expect(modelFor('ocr')).toBe(porOmision);
    expect(overridesRechazados()).toEqual([expect.objectContaining({ role: 'ocr', slug: 'proveedor/modelo-sin-evaluar', porDefecto: porOmision, veces: 1 })]);
    expect(error).toHaveBeenCalledWith('llm.override_modelo_no_evaluado', expect.objectContaining({ role: 'ocr', slug: 'proveedor/modelo-sin-evaluar' }));
    // Un segundo uso suma al contador sin repetir el log.
    modelFor('ocr');
    expect(overridesRechazados()[0].veces).toBe(2);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('un modelo evaluado sí se respeta como override', () => {
    process.env.LIKIDA_MODEL_OCR = 'google/gemini-3.6-flash';
    expect(modelFor('ocr')).toBe('google/gemini-3.6-flash');
    expect(overridesRechazados()).toEqual([]);
  });

  it('el modelo por omisión de cada rol de dinero está en su propia lista', () => {
    for (const rol of Object.keys(ENV) as RolDinero[]) {
      expect(MODELOS_EVALUADOS[rol]).toContain(modelFor(rol));
    }
  });

  it('cada modelo de la lista tiene precio y respaldo entre proveedores', () => {
    const todos = new Set(Object.values(MODELOS_EVALUADOS).flat());
    for (const m of todos) {
      expect(modeloTienePrecio(m), `${m} sin entrada en PRICES`).toBe(true);
      expect(modeloTieneRespaldo(m), `${m} sin entrada en FALLBACK`).toBe(true);
    }
  });

  it('los roles que no mueven dinero siguen aceptando cualquier override', () => {
    const k = 'LIKIDA_MODEL_CHAT';
    const previa = process.env[k];
    process.env[k] = 'otro/modelo';
    try { expect(modelFor('chat')).toBe('otro/modelo'); } finally { if (previa === undefined) delete process.env[k]; else process.env[k] = previa; }
  });
});
