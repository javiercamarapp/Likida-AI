import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_REPETICIONES_FOTO_DIA, clasificarTipoDeFoto, decidirPrevalidacion, mensajeRepetirFoto, medirFotoParaPrevalidar,
  type MotivoFoto,
} from './calidad_foto';
import { fotoSintetica, type VarianteFoto } from './__fixtures__/fotos_sinteticas';
import { prevalidarFotoDeOperador } from './prevalidacion_foto';
import { reiniciarRechazosDeFoto, rechazosDeFotoHoy } from './repeticion_foto';

const ESPERADO: Array<[VarianteFoto, MotivoFoto | null]> = [
  ['buena', null], ['oscura', 'oscura'], ['quemada', 'quemada'], ['desenfocada', 'borrosa'], ['recortada', 'recortada'], ['chica', 'pequena'],
];

describe('prevalidación con fotos sintéticas (umbrales = supuestos calibrados aquí)', () => {
  it.each(ESPERADO)('%s → %s', async (variante, motivo) => {
    const r = await medirFotoParaPrevalidar(await fotoSintetica(variante));
    expect(r.error).toBe(false);
    expect(r.motivo).toBe(motivo);
  });

  it('un PDF o un XML no pasan por foto: motivo «tipo»', async () => {
    const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.7 contenido de prueba').toString('base64')}`;
    expect((await medirFotoParaPrevalidar(pdf)).motivo).toBe('tipo');
    const xml = `data:text/xml;base64,${Buffer.from('<?xml version="1.0"?><cfdi/>').toString('base64')}`;
    expect((await medirFotoParaPrevalidar(xml)).motivo).toBe('tipo');
  });

  it('contenido desconocido o ilegible falla ABIERTO: ni motivo ni bloqueo', async () => {
    const basura = 'data:image/jpeg;base64,no_es_una_imagen_de_verdad';
    const r = await medirFotoParaPrevalidar(basura);
    expect(r.motivo).toBeNull();
    expect(decidirPrevalidacion({ motivo: r.motivo, error: r.error, rechazosHoy: 0 })).not.toBe('repetir');
  });

  it('clasifica por bytes mágicos, no por el encabezado', () => {
    expect(clasificarTipoDeFoto(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('foto');
    expect(clasificarTipoDeFoto(new TextEncoder().encode('%PDF-1.4 xxxxxxx'))).toBe('no_foto');
    expect(clasificarTipoDeFoto(new TextEncoder().encode('algo cualquiera aquí'))).toBe('desconocido');
  });
});

describe('decidirPrevalidacion', () => {
  it('foto buena → ok; mala dentro del tope → repetir; con el tope cumplido → pasa con marca', () => {
    expect(decidirPrevalidacion({ motivo: null, error: false, rechazosHoy: 0 })).toBe('ok');
    expect(decidirPrevalidacion({ motivo: 'borrosa', error: false, rechazosHoy: MAX_REPETICIONES_FOTO_DIA - 1 })).toBe('repetir');
    expect(decidirPrevalidacion({ motivo: 'borrosa', error: false, rechazosHoy: MAX_REPETICIONES_FOTO_DIA })).toBe('pasa_con_marca');
  });
  it('un fallo interno nunca bloquea', () => {
    expect(decidirPrevalidacion({ motivo: 'oscura', error: true, rechazosHoy: 0 })).toBe('falla_abierta');
  });
  it('cada motivo tiene mensaje con la razón y cómo tomar la foto', () => {
    for (const m of ['tipo', 'diminuta', 'pequena', 'oscura', 'quemada', 'borrosa', 'recortada'] as MotivoFoto[]) {
      expect(mensajeRepetirFoto(m).length).toBeGreaterThan(40);
    }
  });
});

describe('prevalidarFotoDeOperador (tope diario)', () => {
  beforeEach(() => reiniciarRechazosDeFoto());
  const AHORA = Date.UTC(2026, 10, 10, 18, 0, 0);

  it('pide repetir hasta el tope y luego deja pasar la foto al OCR con marca', async () => {
    const mala = await fotoSintetica('desenfocada');
    for (let i = 0; i < MAX_REPETICIONES_FOTO_DIA; i += 1) {
      const r = await prevalidarFotoDeOperador('op-1', mala, AHORA);
      expect(r.accion).toBe('repetir');
    }
    expect(rechazosDeFotoHoy('op-1', AHORA)).toBe(MAX_REPETICIONES_FOTO_DIA);
    const ultima = await prevalidarFotoDeOperador('op-1', mala, AHORA);
    expect(ultima).toEqual({ accion: 'seguir', marca: 'borrosa' });
  });
  it('el tope es por operador y se reinicia al día siguiente', async () => {
    const mala = await fotoSintetica('oscura');
    for (let i = 0; i < MAX_REPETICIONES_FOTO_DIA; i += 1) await prevalidarFotoDeOperador('op-1', mala, AHORA);
    expect((await prevalidarFotoDeOperador('op-2', mala, AHORA)).accion).toBe('repetir');
    expect((await prevalidarFotoDeOperador('op-1', mala, AHORA + 86_400_000)).accion).toBe('repetir');
  });
  it('una foto buena sigue sin marca y sin gastar el tope', async () => {
    expect(await prevalidarFotoDeOperador('op-1', await fotoSintetica('buena'), AHORA)).toEqual({ accion: 'seguir', marca: null });
    expect(rechazosDeFotoHoy('op-1', AHORA)).toBe(0);
  });
});
