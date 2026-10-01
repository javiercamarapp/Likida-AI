// ═══════════════════════════════════════════════════════════════════════════
// LA BITÁCORA CONCILIADA — tres estados y NINGUNA acusación con el dato a medias.
//
//   cuadra         el cobro del proveedor tiene un gasto de caseta que lo
//                  respalda (monto y día) y ninguna otra evidencia lo contradice.
//   sin_respaldo   el proveedor cobró, hay tickets de caseta cargados para el
//                  periodo y NINGUNO respalda este cobro, y el GPS (cuando
//                  existe) tampoco lo confirma. Es un hecho sobre los datos de
//                  Likida —«no encontramos respaldo»—, NO una afirmación de que
//                  el cobro sea indebido.
//   por_verificar  el dato no alcanza para afirmar nada, o hay una señal que un
//                  humano debe mirar. SIEMPRE con motivo accionable.
//
// La regla de oro: ante la duda, por_verificar. Esta función es PURA.
// ═══════════════════════════════════════════════════════════════════════════

export type EstadoConciliado = 'cuadra' | 'sin_respaldo' | 'por_verificar';

export type MotivoVerificacion =
  | 'gasto_y_gps'            // cuadra: gasto + GPS confirma
  | 'gasto'                  // cuadra: gasto; el GPS no aportó (sin datos)
  | 'gps_no_coincide'        // por verificar: cuadra con gasto pero el GPS dice que la unidad estaba lejos
  | 'unidad_distinta'        // por verificar: el TAG es de una unidad y el gasto de otra
  | 'monto_distinto'         // por verificar: hay gasto cercano pero el monto no cuadra
  | 'ambigua'                // por verificar: dos gastos igual de buenos
  | 'sin_fecha'              // por verificar: la línea no trae fecha legible
  | 'contraparte_reclamada'  // por verificar: su gasto ya lo usó otra línea idéntica
  | 'sin_gastos_cargados'    // por verificar: no hay ningún ticket de caseta cargado en el periodo
  | 'solo_gps'               // por verificar: el GPS confirma el paso pero falta el gasto
  | 'sin_gasto_sin_gps'      // sin respaldo: sin gasto, GPS sin datos
  | 'sin_gasto_gps_lejos';   // sin respaldo: sin gasto y el GPS no la ubica en la caseta

export interface EntradaVerificacion {
  estatus: 'cuadra' | 'no_cuadra' | 'sin_contraparte';
  /** `detalle` de la línea (jsonb del cruce). */
  detalle: Record<string, unknown> | null;
  gpsVeredicto: 'confirma' | 'no_coincide' | 'sin_datos' | null;
  /** El motivo de `sin_datos` (gps_detalle.motivo), si lo hay. */
  gpsMotivo?: string | null;
}

export interface Verificacion {
  estado: EstadoConciliado;
  motivo: MotivoVerificacion;
  /** Frase para el contralor: qué se encontró y, si aplica, qué falta. */
  explicacion: string;
}

const MOTIVOS_GPS: Record<string, string> = {
  sin_hora: 'el archivo no trae la hora del cobro',
  sin_fecha: 'la línea no trae fecha',
  sin_unidad: 'no se sabe qué unidad cruzó (TAG sin dar de alta)',
  sin_caseta: 'la caseta no está en el catálogo con coordenadas',
  caseta_ambigua: 'el nombre de la caseta coincide con varias del catálogo',
  sin_posiciones_ventana: 'la unidad no tiene posiciones GPS cerca de la hora del cobro',
  muestras_insuficientes: 'las posiciones GPS no alcanzan para concluir',
};

export const textoMotivoGps = (m: string | null | undefined): string =>
  (m && MOTIVOS_GPS[m]) || 'el GPS no aportó datos';

export function clasificarVerificacion(e: EntradaVerificacion): Verificacion {
  const motivoCruce = typeof e.detalle?.motivo === 'string' ? e.detalle.motivo : null;

  if (e.estatus === 'cuadra') {
    if (e.gpsVeredicto === 'no_coincide') {
      return {
        estado: 'por_verificar', motivo: 'gps_no_coincide',
        explicacion: 'Cuadra con un gasto de caseta, pero el GPS ubica a la unidad lejos de la caseta a la hora del cobro. Revisa el TAG, la hora del proveedor y el catálogo.',
      };
    }
    if (e.detalle?.alerta === 'unidad_distinta') {
      return {
        estado: 'por_verificar', motivo: 'unidad_distinta',
        explicacion: 'Cuadra con un gasto de caseta, pero el TAG pertenece a otra unidad que la del viaje del gasto. Revisa si el TAG se prestó o si el gasto es de otro camión.',
      };
    }
    if (e.gpsVeredicto === 'confirma') {
      return { estado: 'cuadra', motivo: 'gasto_y_gps', explicacion: 'Respaldado por un gasto de caseta y confirmado por el GPS.' };
    }
    return { estado: 'cuadra', motivo: 'gasto', explicacion: 'Respaldado por un gasto de caseta (el GPS no aportó datos para esta línea).' };
  }

  if (e.estatus === 'no_cuadra') {
    if (motivoCruce === 'monto_distinto') {
      return { estado: 'por_verificar', motivo: 'monto_distinto', explicacion: 'Hay un gasto de caseta en el día pero su monto no coincide con el cobro del proveedor.' };
    }
    return { estado: 'por_verificar', motivo: 'ambigua', explicacion: 'Hay más de un gasto igual de posible para este cobro; un humano debe decidir cuál es.' };
  }

  // sin_contraparte
  if (motivoCruce === 'sin_fecha') {
    return { estado: 'por_verificar', motivo: 'sin_fecha', explicacion: 'La línea no trae una fecha legible: no se puede buscar su gasto. No se afirma nada.' };
  }
  if (motivoCruce === 'contraparte_ya_reclamada') {
    return { estado: 'por_verificar', motivo: 'contraparte_reclamada', explicacion: 'Su gasto ya respalda a otra línea idéntica del archivo: confirma si fueron dos cruces o un cobro duplicado.' };
  }
  const fondo = typeof e.detalle?.fondo_gastos === 'number' ? e.detalle.fondo_gastos : null;
  if (fondo === null || fondo === 0) {
    return {
      estado: 'por_verificar', motivo: 'sin_gastos_cargados',
      explicacion: 'No hay gastos de caseta cargados en el periodo del desglose: la falta de respaldo no dice nada de este cobro. Carga los tickets o los CFDI del periodo y vuelve a conciliar.',
    };
  }
  if (e.gpsVeredicto === 'confirma') {
    return { estado: 'por_verificar', motivo: 'solo_gps', explicacion: 'El GPS confirma que la unidad estuvo en la caseta, pero no hay un gasto que respalde el cobro. Falta el comprobante.' };
  }
  if (e.gpsVeredicto === 'no_coincide') {
    return {
      estado: 'sin_respaldo', motivo: 'sin_gasto_gps_lejos',
      explicacion: 'Ningún gasto de caseta respalda este cobro y el GPS no ubica a la unidad en la caseta a esa hora. No hay respaldo en los datos de Likida; no se afirma que el cobro sea indebido.',
    };
  }
  return {
    estado: 'sin_respaldo', motivo: 'sin_gasto_sin_gps',
    explicacion: `Ningún gasto de caseta respalda este cobro y el GPS no aporta evidencia: ${textoMotivoGps(e.gpsMotivo)}. No hay respaldo en los datos de Likida; no se afirma que el cobro sea indebido.`,
  };
}

export interface ResumenVerificacion {
  total: number;
  cuadra: number;
  sinRespaldo: number;
  porVerificar: number;
  /** Importe (pesos) por estado — para que el contralor vea cuánto dinero hay en cada cubeta. */
  montoCuadra: number;
  montoSinRespaldo: number;
  montoPorVerificar: number;
}

export function resumirVerificacion(items: ReadonlyArray<{ estado: EstadoConciliado; monto: number }>): ResumenVerificacion {
  const r: ResumenVerificacion = {
    total: items.length, cuadra: 0, sinRespaldo: 0, porVerificar: 0, montoCuadra: 0, montoSinRespaldo: 0, montoPorVerificar: 0,
  };
  for (const i of items) {
    if (i.estado === 'cuadra') { r.cuadra++; r.montoCuadra += i.monto; }
    else if (i.estado === 'sin_respaldo') { r.sinRespaldo++; r.montoSinRespaldo += i.monto; }
    else { r.porVerificar++; r.montoPorVerificar += i.monto; }
  }
  const redondear = (n: number) => Math.round(n * 100) / 100;
  r.montoCuadra = redondear(r.montoCuadra);
  r.montoSinRespaldo = redondear(r.montoSinRespaldo);
  r.montoPorVerificar = redondear(r.montoPorVerificar);
  return r;
}
