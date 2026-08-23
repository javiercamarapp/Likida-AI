import { describe, it, expect } from 'vitest';
import { parseOnboarding, siNo } from './onboarding';
import { aceptaPolitica } from './documentos';
import { declararOnboarding, onboardingFiscalListo, stackDeclarado, calificaEstimuloPeaje } from './preguntas';

function fd(pares: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(pares)) f.set(k, v);
  return f;
}

describe('siNo', () => {
  it('vacío no inventa un no', () => {
    expect(siNo('')).toBeUndefined();
    expect(siNo('talvez')).toBeUndefined();
  });
  it('si/no son booleanos', () => {
    expect(siNo('si')).toBe(true);
    expect(siNo('no')).toBe(false);
  });
});

describe('parseOnboarding', () => {
  it('sin el umbral de peaje → error, no un default fiscal', () => {
    const r = parseOnboarding(fd({}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/300 millones/);
  });

  it('fiscal mínimo: el resto vacío no se inventa', () => {
    const r = parseOnboarding(fd({ ingresos: 'menor', parte: 'no' }));
    expect(r).toEqual({
      ok: true,
      datos: {
        ingresosMenoresA300M: true,
        parteRelacionada: false,
        dedicacionExclusivaCarga: undefined,
        regimenElegible: undefined,
        transporteDedicado: undefined,
        hombreCamion: undefined,
        gps: undefined,
        erp: undefined,
        tag: undefined,
        monedero: undefined,
        stackOtro: undefined,
        pagoOperador: undefined,
        tanquePropio: undefined,
      },
    });
  });

  it('stack y operación se capturan cuando vienen', () => {
    const r = parseOnboarding(fd({
      ingresos: 'mayor', parte: 'si',
      dedicacion: 'si', regimen: 'no',
      gps: 'wialon', erp: 'contpaqi', tag: 'iave', monedero: 'ninguno',
      pagoOperador: 'viaje', tanquePropio: 'no',
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.datos.ingresosMenoresA300M).toBe(false);
      expect(r.datos.gps).toBe('wialon');
      expect(r.datos.pagoOperador).toBe('viaje');
      expect(r.datos.tanquePropio).toBe(false);
    }
  });
});

describe('aceptaPolitica', () => {
  it('rechaza vacío, de más de 8 MB y tipos que no son papel', () => {
    expect(aceptaPolitica({ size: 0, type: 'application/pdf' })).toMatch(/vacío/);
    expect(aceptaPolitica({ size: 9 * 1024 * 1024, type: 'application/pdf' })).toMatch(/8 MB/);
    expect(aceptaPolitica({ size: 100, type: 'application/zip' })).toMatch(/PDF/);
    expect(aceptaPolitica({ size: 100, type: 'application/pdf' })).toBeNull();
  });
});

describe('declararOnboarding → el motor de peaje', () => {
  it('con ingresos altos apaga el estímulo', () => {
    const patch = declararOnboarding({ ingresosMenoresA300M: false, parteRelacionada: false });
    expect(calificaEstimuloPeaje(patch)).toEqual({ elegible: false });
    expect(onboardingFiscalListo(patch)).toBe(true);
  });

  it('el stack queda como decisión, no como campo suelto', () => {
    const patch = declararOnboarding({
      ingresosMenoresA300M: true, parteRelacionada: false, gps: 'wialon', erp: 'archivo_contable',
    });
    expect(stackDeclarado(patch)).toMatchObject({ gps: 'wialon', erp: 'archivo_contable' });
  });

  it('un select vacío no escribe gps:ninguno inventado', () => {
    const patch = declararOnboarding({ ingresosMenoresA300M: true, parteRelacionada: false });
    expect(stackDeclarado(patch).gps).toBeNull();
  });
});

describe('declararHechos — campo a campo, sin inventar el umbral', () => {
  it('solo GPS no escribe ingresos ni parte relacionada', async () => {
    const { declararHechos, onboardingFiscalListo } = await import('./preguntas');
    const p = declararHechos({ gps: 'wialon' });
    expect(p.ingresosMenoresA300M).toBeUndefined();
    expect(p.parteRelacionada).toBeUndefined();
    expect(onboardingFiscalListo(p)).toBe(false);
  });
});
