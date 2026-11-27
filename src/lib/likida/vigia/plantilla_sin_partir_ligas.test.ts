import { describe, it, expect } from 'vitest';
import { redactarBorrador, aLineaPlantilla, type EntradaRedaccion } from './redactor';
import { MAX_PARAMETRO_PLANTILLA } from './enviar';
import { AHORA, estatus } from './datos.fixture';

/**
 * A60-AGEN-01. Fuera de la ventana de 24 h el texto al cliente viaja en el parámetro {{2}} de la plantilla, recortado a
 * `MAX_PARAMETRO_PLANTILLA` por `aLineaPlantilla`, que cortaba a ciegas con `slice`. Una URL de Maps partida SIGUE SIENDO
 * VÁLIDA y apunta a OTRO LUGAR: el cliente toca un pin que no es su unidad y lo cree suyo. El mismo riesgo está escrito en
 * `recortarSinPartirLigas` («nunca parte una liga»), que es el recorte del camino de texto libre.
 */
describe('el recorte del parámetro de plantilla nunca parte una liga', () => {
  const LIGA_MAPS = 'https://maps.google.com/?q=25.67412,-100.31256';

  it('cortando justo dentro de la liga, la liga NO sale a medias', () => {
    const texto = `${'a'.repeat(40)} Última posición del GPS (hace 25 min): ${LIGA_MAPS}`;
    // El tope cae dentro de la liga: a ciegas, el resultado terminaría en «?q=25.67412,».
    const tope = texto.length - 12;
    const salida = aLineaPlantilla(texto, tope);
    expect(salida.length).toBeLessThanOrEqual(tope);
    if (salida.includes('maps.google.com')) expect(salida).toContain(LIGA_MAPS);
    expect(salida).not.toMatch(/\?q=-?\d+\.\d+,(?!-?\d+\.\d+)/);
  });

  it('el borrador real de ubicación+eta recortado al tope de la plantilla no entrega una coordenada incompleta', () => {
    const base: EntradaRedaccion = {
      clasificacion: { intencion: 'ubicacion', secundarias: ['eta'], senales: [] },
      nombreContacto: 'María Pérez', nombreFlota: 'Transportes del Norte',
      viaje: { tipo: 'uno', estatus: estatus({ posicion: { lat: 25.67412, lng: -100.31256, medidaEn: new Date(AHORA.getTime() - 25 * 60_000).toISOString() } }) },
      ahora: AHORA, primerContacto: true, avisoPrivacidadUrl: 'https://app.likida.ai/privacidad',
    };
    const b = redactarBorrador(base);
    expect(b.texto).toContain('maps.google.com');
    expect(b.texto.length).toBeGreaterThan(MAX_PARAMETRO_PLANTILLA);
    const salida = aLineaPlantilla(b.texto, MAX_PARAMETRO_PLANTILLA);
    // O va la liga entera, o no va: media coordenada es una afirmación falsa.
    const medias = salida.match(/https?:\/\/maps\.google\.com\/\?q=[^\s|]*/g) ?? [];
    for (const m of medias) expect(m).toMatch(/\?q=-?\d+\.\d{5},-?\d+\.\d{5}$/);
  });

  it('sin ligas, el recorte sigue respetando el tope exacto (no cambia el contrato de Meta)', () => {
    expect(aLineaPlantilla('x'.repeat(1000), 50)).toHaveLength(50);
    expect(aLineaPlantilla('uno\n\ndos\ttres   cuatro')).not.toMatch(/[\n\t]/);
  });
});
