import type { DocumentoRow } from '@/lib/likida/analytics';

export type EstadoSinCfdi = {
  /** 'error': la lectura de `docs` falló (statement timeout, policy, etc.) —
   *  no se sabe cuántos comprobantes hay, así que no se afirma nada sobre
   *  cuántos les falta CFDI.
   *  'sin_datos': la lectura SÍ funcionó y no trajo ni un comprobante de
   *  combustible/caseta — el "no hay" es un hecho medido, no un fallback.
   *  'ok': hay comprobantes y el porcentaje es real. */
  estado: 'error' | 'sin_datos' | 'ok';
  pct: number | null;
  sinCfdi: number;
  total: number;
};

/**
 * AUDITORÍA 25, MEDIO — antes `docs?.filter(...) ?? []` colapsaba "la
 * consulta falló" (`docs === null`) y "no hay comprobantes de este concepto"
 * (`docs` vino vacío o sin diesel/caseta) en el MISMO string: «Sin
 * comprobantes de estos conceptos todavía». Con 340 cargas de diésel en
 * `porConcepto` y `getDocumentos` caída, esa frase es falsa — sí hay
 * comprobantes, solo que esta lectura no pudo verlos — y contradice al tile
 * vecino en la misma fila. Esta función separa los tres estados para que la
 * página nunca vuelva a fusionarlos.
 */
export function calcularSinCfdi(docs: DocumentoRow[] | null): EstadoSinCfdi {
  if (docs === null) {
    return { estado: 'error', pct: null, sinCfdi: 0, total: 0 };
  }
  const combustibleYCasetas = docs.filter((d) => d.concepto === 'diesel' || d.concepto === 'caseta');
  const sinCfdi = combustibleYCasetas.filter((d) => !d.cfdiUuid).length;
  const total = combustibleYCasetas.length;
  if (total === 0) {
    return { estado: 'sin_datos', pct: null, sinCfdi: 0, total: 0 };
  }
  return { estado: 'ok', pct: Math.round((sinCfdi / total) * 100), sinCfdi, total };
}
