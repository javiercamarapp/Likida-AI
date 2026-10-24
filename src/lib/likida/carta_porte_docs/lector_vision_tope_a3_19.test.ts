import { describe, expect, it } from 'vitest';
import { extraerDocumento } from './extractor';
import { llmFalso } from './llm_falso.fixture';
import { visionFalsaM6 } from './evaluacion/dorado.fixture';
import { CAMPOS_DOC, CAMPOS_MERCANCIA, UMBRAL_CRITICO } from './campos';
import type { ContenidoDoc } from './contenido';

// A37-A3-19: un escaneo leído por el lector de visión (formato C) no puede pasar sin confirmación con 0.92.
describe('extraerDocumento · lector de visión sobre un escaneo', () => {
  it('la confianza de los campos críticos queda por debajo del umbral (los confirma una persona)', async () => {
    const c: ContenidoDoc = { formato: 'pdf_escaneado', texto: null, imagenes: ['data:image/png;base64,AAAA'], tabla: null, xml: null, avisos: [] };
    const llm = llmFalso(() => { throw new Error('no se debía llamar'); });
    const r = await extraerDocumento(c, { llm, formatoEntrada: 'C', vision: visionFalsaM6() } as never);
    let n = 0;
    for (const d of CAMPOS_DOC) {
      const v = r.extraccion.campos[d.clave];
      if (d.critico && v && v.origen === 'llm' && v.valor) { n++; expect(v.confianza, d.clave).toBeLessThan(UMBRAL_CRITICO); }
    }
    for (const fila of r.extraccion.mercancias) {
      for (const d of CAMPOS_MERCANCIA) {
        const v = fila[d.clave];
        if (d.critico && v && v.origen === 'llm' && v.valor) { n++; expect(v.confianza, d.clave).toBeLessThan(UMBRAL_CRITICO); }
      }
    }
    expect(n).toBeGreaterThan(0);
  });
});
