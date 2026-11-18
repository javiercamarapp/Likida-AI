// Rótulos del cierre: del código estable (comprobación, estado, error) a la clave del diccionario. Un módulo plano, sin 'use server' ni
// 'use client', para que lo compartan la pantalla, el formulario y las acciones.
import type { TrDe } from '@/lib/i18n/tr_tipos';
import type { ClaveComprobacion, CodigoErrorCierre, EstadoComprobacion, EstadoCierre } from '@/lib/backoffice/cierre';

type Clave = Parameters<TrDe<'admin_backoffice'>>[0];

export const ROTULO_COMPROBACION: Record<ClaveComprobacion, Clave> = {
  cobrado_dos_vias: 'cierre.c_cobrado',
  neto_recalculado: 'cierre.c_neto',
  usd_con_tipo_cambio: 'cierre.c_usd',
  libro_cuadra: 'cierre.c_libro',
  pagadas_sin_evidencia: 'cierre.c_sin_evidencia',
};

/** Qué dice cada comprobación, en una línea (bajo su nombre en la tabla). */
export const AYUDA_COMPROBACION: Record<ClaveComprobacion, Clave> = {
  cobrado_dos_vias: 'cierre.c_cobrado_ayuda',
  neto_recalculado: 'cierre.c_neto_ayuda',
  usd_con_tipo_cambio: 'cierre.c_usd_ayuda',
  libro_cuadra: 'cierre.c_libro_ayuda',
  pagadas_sin_evidencia: 'cierre.c_sin_evidencia_ayuda',
};

export const ROTULO_ESTADO_COMPROBACION: Record<EstadoComprobacion, Clave> = {
  ok: 'cierre.e_ok',
  falla: 'cierre.e_falla',
  no_evaluable: 'cierre.e_no_evaluable',
  aviso: 'cierre.e_aviso',
};

export const ROTULO_ESTADO_CIERRE: Record<EstadoCierre, Clave> = {
  abierto: 'cierre.estado_abierto',
  listo: 'cierre.estado_listo',
  cerrado: 'cierre.estado_cerrado',
};

export const MENSAJE_ERROR_CIERRE: Record<CodigoErrorCierre, Clave> = {
  tabla_no_disponible: 'cierre.err_tabla',
  periodo_invalido: 'cierre.err_periodo',
  mes_en_curso: 'cierre.err_mes_en_curso',
  ya_cerrado: 'cierre.err_ya_cerrado',
  sin_borrador: 'cierre.err_sin_borrador',
  estado_incorrecto: 'cierre.err_estado',
  bloqueantes: 'cierre.err_bloqueantes',
  conflicto: 'cierre.err_conflicto',
  tipo_cambio_invalido: 'cierre.err_tipo_cambio',
  motivo_corto: 'cierre.err_motivo',
};

export const ROTULO_FALTANTE: Record<string, Clave> = {
  facturas: 'reporte.falta_facturas',
  facturas_truncadas: 'reporte.falta_facturas_truncadas',
  desglose_iva: 'reporte.falta_desglose_iva',
  costo_ia: 'reporte.falta_costo_ia',
  tipo_cambio: 'reporte.falta_tipo_cambio',
  gastos: 'reporte.falta_gastos',
  comisiones: 'reporte.falta_comisiones',
};
