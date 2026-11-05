import { describe, it, expect } from 'vitest';
import { ordenarAlertas } from './orden';
import type { AlertaSinAtender } from './tipos';

const base: AlertaSinAtender = {
  chatId: 'g', chatNombre: 'Grupo A', critico: false, nivel: 'normal', motivos: ['espera_sobre_umbral'], desde: '2026-10-14T16:00:00.000Z',
  ultimoEn: '2026-10-14T16:00:00.000Z', fotoEn: '2026-10-14T17:00:00.000Z', antiguedadMin: 60, umbralAplicadoMin: 30, excesoMin: 30,
  mensajesSinAtender: 1, preguntasSinAtender: 0, turno: 'dia', clave: 'k', vistaPrevia: null,
};
const a = (p: Partial<AlertaSinAtender>): AlertaSinAtender => ({ ...base, ...p });

describe('ordenarAlertas', () => {
  it('alta primero, luego urgencia/clave antes que pregunta, crítico, antigüedad, nombre e id', () => {
    const lista = [
      a({ chatId: 'z', clave: 'z' }),
      a({ chatId: 'y', antiguedadMin: 90, clave: 'y' }),
      a({ chatId: 'x', critico: true, clave: 'x' }),
      a({ chatId: 'p', nivel: 'alta', motivos: ['espera_sobre_umbral', 'pregunta'], clave: 'p' }),
      a({ chatId: 'u', nivel: 'alta', motivos: ['urgencia'], antiguedadMin: 1, clave: 'u' }),
      a({ chatId: 'b', chatNombre: 'Grupo B', clave: 'b' }),
    ];
    expect(ordenarAlertas(lista).map((x) => x.chatId)).toEqual(['u', 'p', 'x', 'y', 'z', 'b']);
  });

  it('no muta la entrada y es estable con empates totales', () => {
    const lista = [a({ chatId: 'b', clave: '2' }), a({ chatId: 'a', clave: '1' })];
    const copia = [...lista];
    expect(ordenarAlertas(lista).map((x) => x.chatId)).toEqual(['a', 'b']);
    expect(lista).toEqual(copia);
  });
});
