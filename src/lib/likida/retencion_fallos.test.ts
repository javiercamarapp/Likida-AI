import { describe, expect, it } from 'vitest';
import { fallosDePurgas, type ResultadosPurgas } from './retencion_fallos';

const LIMPIO: ResultadosPurgas = {
  storage: { fallidos: 0 }, mcpOauth: {}, llmPresupuesto: {}, cartaPorteDocs: { fallidos: 0 },
  agentesDatos: [{ nombre: 'a', ok: true }], buzonRecepcionesPurgadas: 0, vinculacionPortal: 0,
  ledgers: [{ nombre: 'l', ok: true }],
};

describe('A37-S09-01: fallosDePurgas', () => {
  it('todo limpio = sin fallos', () => expect(fallosDePurgas(LIMPIO)).toEqual([]));
  it('storage con fallidos, o que lanzó (null), es fallo', () => {
    expect(fallosDePurgas({ ...LIMPIO, storage: { fallidos: 2 } })).toEqual(['storage: 2 archivo(s) sin borrar']);
    expect(fallosDePurgas({ ...LIMPIO, storage: null })).toEqual(['storage: la corrida lanzó']);
  });
  it('cartaPorteDocs, buzón, ledgers y agentes también', () => {
    const f = fallosDePurgas({
      ...LIMPIO, cartaPorteDocs: null, buzonRecepcionesPurgadas: null,
      ledgers: [{ nombre: 'evento_stripe', ok: false, error: 'x' }], agentesDatos: [{ nombre: 'wa', ok: false }],
    });
    expect(f).toEqual(expect.arrayContaining([
      'carta_porte_docs: la corrida lanzó', 'buzon_recepcion: no se pudo', 'ledgers/evento_stripe: x', 'agentes_datos/wa: falló',
    ]));
  });
});
