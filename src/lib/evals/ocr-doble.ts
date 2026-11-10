import type { CasoOcr, LecturaOcr } from './ocr-contrato';

// ═══════════════════════════════════════════════════════════════════════════
// LOS DOBLES DEL LECTOR (F17): el examen en CI jamás llama al proveedor.
//
// OJO CON LO QUE ESTO ES: un doble es un guion, no un modelo. Sus métricas
// prueban que el ARNÉS funciona (que sabe medir aciertos, errores, «no sé»,
// ceros por null e inyecciones obedecidas); NO dicen nada de la exactitud de
// Gemini. Toda salida que venga de un doble lleva `origen: 'doble'` y el
// informe lo imprime. La medición del modelo real es la corrida manual (D25).
// ═══════════════════════════════════════════════════════════════════════════

export type PerfilDoble = 'fiel' | 'realista' | 'sabotaje';

function fiel(c: CasoOcr): LecturaOcr {
  const e = c.esperado;
  if (!e.legible) {
    return { concepto: 'otro', monto: null, fecha: null, rfc_emisor: null, litros: null, moneda: null, documento: null, texto_sospechoso: false, confianza: 0.2, legible: false };
  }
  return {
    concepto: e.concepto ?? 'otro', monto: e.monto, fecha: e.fecha, rfc_emisor: e.rfc_emisor, litros: e.litros,
    moneda: e.moneda, documento: e.documento, texto_sospechoso: e.texto_sospechoso, confianza: 0.95, legible: true,
  };
}

/** Fallas guionadas, deterministas, que cubren cada clase de error que el examen sabe medir. */
const FALLAS_REALISTAS: Record<string, (l: LecturaOcr, c: CasoOcr) => LecturaOcr> = {
  // Día y mes volteados, con confianza alta: el error más repetido sobre tickets reales.
  'ocr-fam-1': (l) => ({ ...l, fecha: '2026-01-08', confianza: 0.93 }),
  // Un dígito mal leído en el importe, con confianza baja: la puerta del motor lo atrapa.
  'ocr-cas-2': (l) => ({ ...l, monto: l.monto === null ? null : Math.round((l.monto + 10) * 100) / 100, confianza: 0.6 }),
  // Abstenciones («no sé»): null donde el papel sí traía el dato.
  'ocr-hos-1': (l) => ({ ...l, rfc_emisor: null, confianza: 0.8 }),
  'ocr-dsl-04': (l) => ({ ...l, litros: null, confianza: 0.85 }),
};

function sabotaje(c: CasoOcr): LecturaOcr {
  const base = fiel(c);
  return { ...base, concepto: 'otro', monto: c.importeInyectado ?? 0, fecha: '2020-01-01', rfc_emisor: 'ZZZ000000ZZ0', litros: 0, legible: true, texto_sospechoso: false, confianza: 0.99 };
}

export function lecturaDoble(c: CasoOcr, perfil: PerfilDoble): LecturaOcr {
  if (perfil === 'sabotaje') return sabotaje(c);
  const l = fiel(c);
  if (perfil === 'realista') {
    const falla = FALLAS_REALISTAS[c.id];
    return falla ? falla(l, c) : l;
  }
  return l;
}
