import { describe, it, expect } from 'vitest';
import { detectarFicha, sugerirEquipoPorFicha } from './ficha_unidad';

// Fichas SINTÉTICAS (valores inventados) con los dos formatos que usan los grupos.
const FICHA_CAJA = 'Línea: AAA\nNúmero: XX123456\nPlacas: 000AAA\nEstado: Estado Ejemplo';
const FICHA_UNIDAD = 'Caja: ZZ-100\nUnidad: TC0000\nPlaca: 111BBB\nOperador: Fulano Ejemplo\nLicencia: 0000000\nResello: 01/01/2027\nCelular: 5500000000';

describe('detectarFicha', () => {
  it('reconoce la ficha de caja por sus etiquetas', () => {
    const f = detectarFicha(FICHA_CAJA);
    expect(f?.campos).toEqual(['linea', 'numero', 'placas', 'estado']);
    expect(f?.faltan).toEqual([]);
    expect(f?.conDatosPersonales).toBe(true);
  });

  it('reconoce la ficha de unidad y marca lo que falta SIN rellenarlo', () => {
    const f = detectarFicha('Caja: ZZ-100\nUnidad: TC0000\nOperador: Fulano Ejemplo');
    expect(f?.campos).toEqual(['caja', 'unidad', 'operador']);
    expect(f?.faltan).toEqual(['placas', 'licencia', 'resello', 'celular']);
    expect(detectarFicha(FICHA_UNIDAD)?.faltan).toEqual([]);
  });

  it('no devuelve ningún valor: solo nombres de campo', () => {
    expect(JSON.stringify(detectarFicha(FICHA_UNIDAD))).not.toMatch(/Fulano|0000000|111BBB|TC0000/);
  });

  it('exige al menos 3 campos distintos: una línea suelta o un mensaje normal no son ficha', () => {
    for (const t of ['Placas: 000AAA', 'Placas: 000AAA\nEstado: X', 'me ayudan con la placa y el operador', 'Línea: A\nLínea: B\nLínea: C', '', 'gracias']) {
      expect(detectarFicha(t), t).toBeNull();
    }
  });

  it('tolera acentos, mayúsculas y guiones; ignora textos enormes', () => {
    expect(detectarFicha('LÍNEA - AAA\nNÚMERO - XX1\nESTADO - Y')?.campos).toEqual(['linea', 'numero', 'estado']);
    expect(detectarFicha('Línea: A\n'.repeat(500))).toBeNull();
    expect(detectarFicha(undefined as unknown as string)).toBeNull();
  });
});

describe('sugerirEquipoPorFicha', () => {
  const equipo = [...Array(6).keys()].map(() => ({ autorHash: 'eq', texto: FICHA_CAJA }));
  const charla = [...Array(40).keys()].map(() => ({ autorHash: 'eq', texto: 'ok' }));
  const clientePocas = [{ autorHash: 'cl', texto: FICHA_CAJA }, ...[...Array(300).keys()].map(() => ({ autorHash: 'cl', texto: 'me confirman' }))];

  it('sugiere a quien escribe fichas seguido y NO al cliente que pegó una', () => {
    expect(sugerirEquipoPorFicha([...equipo, ...charla, ...clientePocas])).toEqual([{ autorHash: 'eq', fichas: 6, mensajes: 46 }]);
  });

  it('exige mínimo de fichas y de porcentaje', () => {
    expect(sugerirEquipoPorFicha(equipo.slice(0, 4))).toEqual([]);
    expect(sugerirEquipoPorFicha([...equipo, ...[...Array(1000).keys()].map(() => ({ autorHash: 'eq', texto: 'ok' }))])).toEqual([]);
  });

  it('sin mensajes, sin sugerencias', () => {
    expect(sugerirEquipoPorFicha([])).toEqual([]);
  });
});
