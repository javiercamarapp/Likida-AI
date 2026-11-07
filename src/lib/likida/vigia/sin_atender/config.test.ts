import { describe, it, expect } from 'vitest';
import { CONFIG_SIN_ATENDER_POR_OMISION as D, normalizarConfigSinAtender, validarConfigSinAtender } from './config';

describe('configuración del motor sin atender', () => {
  it('los valores por omisión coinciden con los del Vigía', () => {
    expect(D.umbralMin).toBe(30);
    expect(D.umbralCriticoMin).toBe(10);
    expect(D.insistenciaMin).toBe(2);
    expect(D.palabrasClave).toEqual(['embarque', 'embarques']);
    expect(D.ventanaRespuestaMin).toBeNull();
    expect(D.vistaPreviaMax).toBe(0);
  });

  it('null, undefined y vacío dan los valores por omisión sin avisos', () => {
    for (const x of [null, undefined, {}]) {
      const r = normalizarConfigSinAtender(x);
      expect(r.config).toEqual(D);
      expect(r.avisos).toEqual([]);
    }
  });

  it('acota fuera de rango y lo dice en texto llano', () => {
    const r = normalizarConfigSinAtender({ umbralMin: 99999, umbralCriticoMin: 0, vistaPreviaMax: 500, maxAlertasPorChat: -3 });
    expect(r.config.umbralMin).toBe(1440);
    expect(r.config.umbralCriticoMin).toBe(1);
    expect(r.config.vistaPreviaMax).toBe(80);
    expect(r.config.maxAlertasPorChat).toBe(1);
    expect(r.avisos.length).toBe(4);
  });

  it('valores no numéricos o NaN vuelven al default', () => {
    const r = normalizarConfigSinAtender({ umbralMin: Number.NaN, insistenciaMin: 'x' as unknown as number });
    expect(r.config.umbralMin).toBe(30);
    expect(r.config.insistenciaMin).toBe(2);
  });

  it('palabras: recorta, deduplica, tope de 30 y de 40 caracteres', () => {
    const muchas = Array.from({ length: 50 }, (_, i) => `palabra${i}`);
    const r = normalizarConfigSinAtender({ palabrasUrgentes: [...muchas, 'x'.repeat(200)], palabrasClave: [' Retraso ', 'retraso', '', 7 as unknown as string] });
    expect(r.config.palabrasUrgentes).toHaveLength(30);
    expect(r.config.palabrasClave).toEqual(['Retraso']);
    expect(normalizarConfigSinAtender({ palabrasUrgentes: ['x'.repeat(200)] }).config.palabrasUrgentes[0]).toHaveLength(40);
  });

  it('zona, festivos, noche y hashes inválidos se descartan', () => {
    const r = normalizarConfigSinAtender({
      zona: 'No/Existe', festivos: ['2026-02-30', '2026-12-25', '2026-12-25'], noche: { desdeHora: 25, hastaHora: 7 },
      equipoHashes: ['ABCDEF123456', 'zz', 5 as unknown as string],
    });
    expect(r.config.zona).toBe(D.zona);
    expect(r.config.festivos).toEqual(['2026-12-25']);
    expect(r.config.noche).toEqual({ desdeHora: 20, hastaHora: 7 });
    expect(r.config.equipoHashes).toEqual(['abcdef123456']);
  });

  it('ventanaRespuestaMin acepta null y acota números', () => {
    expect(normalizarConfigSinAtender({ ventanaRespuestaMin: null }).config.ventanaRespuestaMin).toBeNull();
    expect(normalizarConfigSinAtender({ ventanaRespuestaMin: 0 }).config.ventanaRespuestaMin).toBe(1);
    expect(normalizarConfigSinAtender({ ventanaRespuestaMin: 45 }).config.ventanaRespuestaMin).toBe(45);
  });

  it('validar rechaza con mensaje llano en vez de corregir', () => {
    for (const malo of [null, 3, [], { umbralMin: 0 }, { umbralMin: 1.5 }, { palabrasClave: 'a' }, { palabrasClave: ['x'.repeat(41)] },
      { zona: 'No/Existe' }, { festivos: ['2026-02-30'] }, { noche: { desdeHora: 30, hastaHora: 1 } }, { equipoHashes: ['no es hash'] }, { ventanaRespuestaMin: 0 }]) {
      const r = validarConfigSinAtender(malo);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(10);
    }
  });

  it('validar acepta una configuración correcta y completa el resto', () => {
    const r = validarConfigSinAtender({ umbralMin: 5, umbralCriticoMin: 2, palabrasClave: ['retraso'], ventanaRespuestaMin: null });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.valor.umbralMin).toBe(5); expect(r.valor.maxAlertasPorChat).toBe(3); }
  });
});
