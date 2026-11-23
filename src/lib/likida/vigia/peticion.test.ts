import { describe, it, expect } from 'vitest';
import { esPeticion, tiposDeSolicitud } from './peticion';

// Textos SINTÉTICOS que imitan el habla telegráfica de los grupos; no vienen de ningún chat real.
describe('tiposDeSolicitud', () => {
  const casos: Array<[string, string[]]> = [
    ['ficha_unidad', ['nos apoyan con los datos de las cajitas de hoy', 'tenemos datos de la unidad?', 'faltan los datos del operador', 'me urgen los datos']],
    ['urgencia', ['me urge el sello', 'nos urgen las cajas', 'URGENTE confirmar', 'asap por favor']],
    ['cp_cruce', ['nos ayudan con la ccp de cruce', 'cp de cruce de estas cajas', 'falta el timbrado', 'carta porte pendiente']],
    ['hora_salida', ['me confirman hora de salida', 'a que hora sale la unidad', 'hr de llegada a planta', 'horarios de hoy']],
    ['caja_colocacion', ['hay cajas vacias para colocar mañana?', 'colocan la caja en el patio', 'dejar la caja a drop', 'cajita vacia disponible']],
    ['qr', ['me comparten el QR de la caja', 'falta el qr']],
    ['programa', ['programa de mañana', 'les comparto el forecast de la semana']],
    ['estatus', ['como vamos con el cruce?', 'estatus de las cargas', 'ya llego la unidad', 'actualizado de las cargas por favor']],
    ['sello_gps', ['me ayudan con el sello', 'link de rastreo por favor', 'cuenta espejo del gps']],
    ['pod_doda', ['necesitamos el POD sellado', 'falta el DODA', 'la remision firmada']],
  ];
  for (const [tipo, textos] of casos) {
    it(`reconoce ${tipo}`, () => {
      for (const t of textos) expect(tiposDeSolicitud(t), t).toContain(tipo);
    });
  }

  it('no etiqueta cortesías, vacío ni basura', () => {
    for (const t of ['gracias', 'ok', 'buenos dias', '', '   ', '👍', 'jajaja']) expect(tiposDeSolicitud(t), t).toEqual([]);
  });

  it('«no urge» no es cualquier cosa: la etiqueta es de LECTURA y prioridad.ts decide la negación', () => {
    expect(tiposDeSolicitud('ya se vió, no hay más')).toEqual([]);
  });

  it('nunca lanza con entrada rara', () => {
    expect(tiposDeSolicitud(undefined as unknown as string)).toEqual([]);
    expect(tiposDeSolicitud('a'.repeat(5000))).toEqual([]);
  });
});

describe('esPeticion', () => {
  it('pregunta, ruego o solicitud reconocible', () => {
    for (const t of ['¿llegó la caja?', 'me confirman por favor', 'nos apoyan con el sello', 'como vamos', 'necesitamos los datos', 'hora de salida de la unidad']) {
      expect(esPeticion(t), t).toBe(true);
    }
  });
  it('un aviso, una lista o un agradecimiento no piden nada', () => {
    for (const t of ['gracias', 'ok enterado', 'la caja ya está en el patio', 'Línea: INN / Número: XX1234', 'buen día', '', '.']) {
      expect(esPeticion(t), t).toBe(false);
    }
  });
});
