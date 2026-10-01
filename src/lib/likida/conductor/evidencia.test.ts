import { describe, expect, it } from 'vitest';
import { hitoParaEvidencia, mensajeEvidencia, tipoEvidenciaDeCaption } from './evidencia';
import { hitoVacio } from './memoria.fixture';
import type { HitoFila, TipoHito } from './tipos';

const AHORA = new Date('2026-10-02T20:00:00.000Z');
const hito = (tipo: TipoHito, minutosAtras: number | null, extra: Partial<HitoFila> = {}): HitoFila => {
  const iso = minutosAtras === null ? null : new Date(AHORA.getTime() - minutosAtras * 60_000).toISOString();
  return hitoVacio({ id: `h-${tipo}`, tipo, viajeId: 'v1', ...(iso ? { estado: 'recibido', fuente: 'texto', mensajeEn: iso, recibidoEn: iso } : {}), ...extra });
};

describe('tipoEvidenciaDeCaption', () => {
  it.each([
    ['sello', 'sello'], ['Sello de carga', 'sello'], ['SELLO!!', 'sello'], ['foto del sello', 'sello'],
    ['andén', 'anden'], ['mi anden', 'anden'], ['Rampa', 'anden'],
    ['recibido', 'recibido'], ['Sello de recibido', 'recibido'], ['acuse de recibido', 'recibido'],
  ])('«%s» → %s', (caption, tipo) => {
    expect(tipoEvidenciaDeCaption(caption)).toBe(tipo);
  });

  it.each(['', '   ', 'diésel 800', 'el sello de la gasolinera costó 50', 'mi sello de diésel', 'recibido el pago de la caseta', 'carta porte', 'ya llegué'])(
    '«%s» NO es evidencia de un hito (cae al camino de siempre)', (caption) => {
      expect(tipoEvidenciaDeCaption(caption)).toBeNull();
    },
  );

  it('undefined, demasiado largo o hostil: null', () => {
    expect(tipoEvidenciaDeCaption(undefined)).toBeNull();
    expect(tipoEvidenciaDeCaption(`sello${' '.repeat(200)}`)).toBeNull();
    expect(tipoEvidenciaDeCaption('sello<script>')).toBeNull();
  });
});

describe('hitoParaEvidencia', () => {
  it('el sello va a la salida de carga', () => {
    const hs = [hito('llegada_carga', 120), hito('salida_carga', 10)];
    expect(hitoParaEvidencia('sello', hs, AHORA)?.tipo).toBe('salida_carga');
  });

  it('el sello cae a la llegada a carga si todavía no hay salida', () => {
    expect(hitoParaEvidencia('sello', [hito('llegada_carga', 30), hito('salida_carga', null)], AHORA)?.tipo).toBe('llegada_carga');
  });

  it('el andén es el del lugar donde está: ya en descarga, es el de la descarga', () => {
    const hs = [hito('llegada_carga', 400), hito('salida_carga', 300), hito('llegada_descarga', 20)];
    expect(hitoParaEvidencia('anden', hs, AHORA)?.tipo).toBe('llegada_descarga');
  });

  it('el recibido va a la salida de descarga, o a la llegada a descarga', () => {
    expect(hitoParaEvidencia('recibido', [hito('llegada_descarga', 90), hito('salida_descarga', 5)], AHORA)?.tipo).toBe('salida_descarga');
    expect(hitoParaEvidencia('recibido', [hito('llegada_descarga', 90), hito('salida_descarga', null)], AHORA)?.tipo).toBe('llegada_descarga');
  });

  it('sin hito al cual colgarla: null (no se adivina)', () => {
    expect(hitoParaEvidencia('sello', [hito('llegada_carga', null), hito('salida_carga', null)], AHORA)).toBeNull();
    expect(hitoParaEvidencia('recibido', [hito('llegada_carga', 10)], AHORA)).toBeNull();
    expect(hitoParaEvidencia('otra', [hito('llegada_carga', 10)], AHORA)).toBeNull();
  });

  it('un hito de hace más de 12 h ya no admite fotos', () => {
    expect(hitoParaEvidencia('sello', [hito('salida_carga', 13 * 60)], AHORA)).toBeNull();
    expect(hitoParaEvidencia('sello', [hito('salida_carga', 11 * 60)], AHORA)?.tipo).toBe('salida_carga');
  });

  it('un hito omitido no cuenta (no hubo evento que respaldar)', () => {
    const omitido = hito('salida_carga', null, { estado: 'omitido', omitidoMotivo: 'inferido_por_llegada_descarga' });
    expect(hitoParaEvidencia('sello', [omitido], AHORA)).toBeNull();
  });

  it('un hito escalado sin respuesta del chofer tampoco', () => {
    const escalado = hito('salida_carga', null, { estado: 'escalado', escaladoEn: AHORA.toISOString(), escalacionNivel: 1 });
    expect(hitoParaEvidencia('sello', [escalado], AHORA)).toBeNull();
  });
});

describe('mensajeEvidencia', () => {
  it('cada desenlace dice la verdad', () => {
    expect(mensajeEvidencia('ok', 'sello')).toMatch(/Recibí la foto de el sello|foto de el sello/);
    expect(mensajeEvidencia('duplicada', 'anden')).toMatch(/ya la tenía/);
    expect(mensajeEvidencia('sin_hito', 'recibido')).toMatch(/Primero dime/);
    expect(mensajeEvidencia('fallo', 'sello')).toMatch(/No pude guardar/);
  });
});
