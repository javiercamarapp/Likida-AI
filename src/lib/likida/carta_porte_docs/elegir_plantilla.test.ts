import { describe, expect, it } from 'vitest';
import type { CampoValor, Extraccion } from './campos';
import { AVISO_SELECTOR_PROVISIONAL, elegirPlantillaPorContenido, razonesSocialesEmbarcador } from './elegir_plantilla';

const cv = (valor: string | null): CampoValor => ({ valor, confianza: 0.9, evidencia: null, origen: 'llm' });
const ext = (campos: Record<string, string | null>): Extraccion => ({ campos: Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, cv(v)])), mercancias: [] });

describe('elegirPlantillaPorContenido (criterio provisional)', () => {
  it('una razón social ⇒ normal', () => {
    const e = elegirPlantillaPorContenido(ext({ origen_nombre: 'Embarcador Sintetico Uno SA' }));
    expect(e.plantilla).toBe('normal');
    expect(e.origen).toBe('contenido');
    expect(e.criterio_provisional).toBe(true);
    expect(e.avisos).toEqual([AVISO_SELECTOR_PROVISIONAL]);
  });

  it('dos razones sociales ⇒ nueva, con la bandera de criterio provisional', () => {
    const e = elegirPlantillaPorContenido(ext({ origen_nombre: 'Embarcador Sintetico Uno SA', origen_2_nombre: 'Embarcador Sintetico Dos SA' }));
    expect(e.plantilla).toBe('nueva');
    expect(e.criterio_provisional).toBe(true);
    expect(e.razones_sociales).toHaveLength(2);
  });

  it('el mismo nombre repetido (mayúsculas, acentos o espacios aparte) cuenta como una sola razón social', () => {
    const e = ext({ origen_nombre: 'Embarcador Sintético SA', origen_2_nombre: '  EMBARCADOR  SINTETICO SA'.replace('  ', ' ') });
    expect(razonesSocialesEmbarcador(e)).toHaveLength(1);
    expect(elegirPlantillaPorContenido(e).plantilla).toBe('normal');
  });

  it('sin orígenes o con nombres vacíos ⇒ normal; tres orígenes distintos ⇒ nueva', () => {
    expect(elegirPlantillaPorContenido(ext({})).plantilla).toBe('normal');
    expect(elegirPlantillaPorContenido(ext({ origen_nombre: '', origen_2_nombre: null })).plantilla).toBe('normal');
    expect(elegirPlantillaPorContenido(ext({ origen_nombre: 'A Sintetica', origen_2_nombre: 'B Sintetica', origen_3_nombre: 'C Sintetica' })).razones_sociales).toHaveLength(3);
  });

  it('no mira destinos: dos destinos con razones distintas y un origen siguen siendo normal', () => {
    expect(elegirPlantillaPorContenido(ext({ origen_nombre: 'A Sintetica', destino_nombre: 'D1', destino_2_nombre: 'D2' })).plantilla).toBe('normal');
  });

  it('la elección manual se respeta en los dos sentidos y no lleva criterio provisional', () => {
    const dos = ext({ origen_nombre: 'A Sintetica', origen_2_nombre: 'B Sintetica' });
    expect(elegirPlantillaPorContenido(dos, 'normal')).toMatchObject({ plantilla: 'normal', origen: 'manual', criterio_provisional: false, avisos: [] });
    expect(elegirPlantillaPorContenido(ext({ origen_nombre: 'A Sintetica' }), 'nueva')).toMatchObject({ plantilla: 'nueva', origen: 'manual', criterio_provisional: false });
    expect(elegirPlantillaPorContenido(dos, null).origen).toBe('contenido');
  });
});
