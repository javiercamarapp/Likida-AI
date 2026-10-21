// ═══════════════════════════════════════════════════════════════════════════
// HALLAZGO 1 (auditoría A5 Conductor): `decidirFotoDocumento`/`motivoIlegible`
// (conductor/documentos_cierre.ts) ya tenían la lógica pura probada, pero el
// único punto de producción que las alimentaba nunca mandaba `metadatos` —así
// que la contingencia de foto ilegible era código MUERTO. Esta prueba fabrica
// imágenes REALES con `sharp` (igual que ocr_redimension_aud25.test.ts) y
// comprueba que `metadatosDeFoto` las mide de verdad, Y que ese dato real —
// no simulado— sí dispara `pedir_repetir`/`aceptar_revisar` en la lógica pura
// que ya existía.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { metadatosDeFoto, UMBRAL_LUMINANCIA_OSCURA } from './calidad_foto';
import { motivoIlegible, decidirFotoDocumento, PX_ANCHO_MIN_LEGIBLE } from '../conductor/documentos_cierre';

async function dataUrlDe(ancho: number, alto: number, color: { r: number; g: number; b: number }): Promise<string> {
  const buf = await sharp({ create: { width: ancho, height: alto, channels: 3, background: color } }).jpeg().toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

describe('metadatosDeFoto', () => {
  it('mide el ancho real en píxeles de una foto chica (< 800 px)', async () => {
    const dataUrl = await dataUrlDe(400, 300, { r: 230, g: 230, b: 230 }); // clara, pero chica
    const m = await metadatosDeFoto(dataUrl);
    expect(m).not.toBeNull();
    expect(m!.anchoPx).toBe(400);
    expect(m!.oscura).toBe(false);
  });

  it('mide el ancho real de una foto grande (≥ 800 px) y no la marca chica', async () => {
    const dataUrl = await dataUrlDe(1200, 900, { r: 230, g: 230, b: 230 });
    const m = await metadatosDeFoto(dataUrl);
    expect(m!.anchoPx).toBe(1200);
    expect(m!.anchoPx).toBeGreaterThanOrEqual(PX_ANCHO_MIN_LEGIBLE);
  });

  it('detecta una foto oscura por su luminancia media', async () => {
    const dataUrl = await dataUrlDe(1000, 800, { r: 10, g: 10, b: 10 }); // casi negra
    const m = await metadatosDeFoto(dataUrl);
    expect(m!.oscura).toBe(true);
    expect(m!.anchoPx).toBe(1000); // grande: lo único que la hace ilegible es la luminancia
  });

  it('una foto clara por encima del umbral de luminancia NO se marca oscura', async () => {
    const dataUrl = await dataUrlDe(1000, 800, { r: UMBRAL_LUMINANCIA_OSCURA + 40, g: UMBRAL_LUMINANCIA_OSCURA + 40, b: UMBRAL_LUMINANCIA_OSCURA + 40 });
    const m = await metadatosDeFoto(dataUrl);
    expect(m!.oscura).toBe(false);
  });

  it('borrosa nunca se marca todavía (sin detector real, fase 2 pendiente) — documentado, no fingido', async () => {
    const dataUrl = await dataUrlDe(1200, 900, { r: 230, g: 230, b: 230 });
    const m = await metadatosDeFoto(dataUrl);
    expect(m!.borrosa).toBeNull();
  });

  it('una imagen que sharp no puede leer da null (nunca lanza, nunca bloquea el viaje)', async () => {
    const m = await metadatosDeFoto('data:image/jpeg;base64,no_es_una_imagen_de_verdad');
    expect(m).toBeNull();
  });
});

describe('HALLAZGO 1 — integración: metadatos reales reactivan la contingencia de T-A5-54', () => {
  it('una foto chica (metadatos reales) dispara pedir_repetir en el primer intento, no se acepta en silencio', async () => {
    const dataUrl = await dataUrlDe(400, 300, { r: 230, g: 230, b: 230 });
    const m = await metadatosDeFoto(dataUrl);
    const decision = decidirFotoDocumento({ motivo: motivoIlegible(m), intentosPrevios: 0 });
    expect(decision.accion).toBe('pedir_repetir');
    expect(decision.intentos).toBe(1);
  });

  it('una foto oscura (metadatos reales) en el segundo intento se acepta marcada revisar, no se pierde', async () => {
    const dataUrl = await dataUrlDe(1000, 800, { r: 10, g: 10, b: 10 });
    const m = await metadatosDeFoto(dataUrl);
    const decision = decidirFotoDocumento({ motivo: motivoIlegible(m), intentosPrevios: 1 });
    expect(decision.accion).toBe('aceptar_revisar');
    expect(decision.intentos).toBe(2);
  });

  it('una foto legible (grande y clara) con metadatos reales se acepta de una, como antes', async () => {
    const dataUrl = await dataUrlDe(1200, 900, { r: 230, g: 230, b: 230 });
    const m = await metadatosDeFoto(dataUrl);
    const decision = decidirFotoDocumento({ motivo: motivoIlegible(m), intentosPrevios: 0 });
    expect(decision.accion).toBe('aceptar_ok');
  });
});
