import { describe, expect, it } from 'vitest';
import { COLUMNAS_DOC, COLUMNAS_LISTA, aDocumento } from './repo';

describe('las columnas de la bandeja', () => {
  const lista = COLUMNAS_LISTA.split(',').map((c) => c.trim());
  const completa = COLUMNAS_DOC.split(',').map((c) => c.trim());

  it('la lista liviana NO trae el texto ni la extracción (60 KB + decenas de KB por documento), y trae todo lo demás', () => {
    expect(lista).not.toContain('texto_extracto');
    expect(lista).not.toContain('extraccion');
    expect(completa.filter((c) => !lista.includes(c)).sort()).toEqual(['extraccion', 'texto_extracto']);
  });

  it('lo que la bandeja y las métricas necesitan SÍ viene', () => {
    for (const c of ['estado', 'validacion', 'nivel_modelo', 'perfil_id', 'costo_usd', 'tiempo_revision_seg', 'ultimo_error', 'intentos', 'cliente_id', 'viaje_id', 'riesgo_inyeccion']) {
      expect(lista, c).toContain(c);
    }
  });

  it('un renglón liviano se lee sin tronar: texto y extracción quedan en null', () => {
    const d = aDocumento({
      id: 'x', tenant_id: 't', canal: 'manual', formato: 'excel', nombre_archivo: 'a.xlsx', bytes: 1, sha256: 'a'.repeat(64), estado: 'por_revisar', version: 1,
      riesgo_inyeccion: false, retener_hasta: '2027-01-01', created_at: '2026-10-01', updated_at: '2026-10-01',
    });
    expect(d).toMatchObject({ textoExtracto: null, extraccion: null, validacion: null, nivelModelo: null, tokensIn: 0, costoUsd: 0 });
  });
});
