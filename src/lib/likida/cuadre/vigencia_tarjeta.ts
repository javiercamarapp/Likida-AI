// VIGENCIA de la regla «una tarjeta que no consta como de la empresa no acredita
// litros» (`tarjeta_no_empresa`, P0-6, LIF 2026 art. 20-A fr. IV).
//
// El fail-closed es para lo que se CIERRA desde que la regla existe. NO puede ser
// retroactivo: una liquidación cerrada antes de la regla no trae el tipo
// persistido, y si al reabrirla (detalle, ajuste firmado, reintento del PDF) el
// motor lo agregara, `derivoLaConfig` apagaría el desglose de todas las
// liquidaciones viejas con diésel pagado con tarjeta y el recálculo de un ajuste
// bajaría `litrosDieselAcreditables` a 0 sin que nadie cambiara nada fiscal.
//
// Criterio (no hay versión del motor sellada en `liquidacion`, y agregar la
// columna obligaría a una migración con orden de despliegue): la FECHA DE CIERRE
// de la liquidación (`liquidacion.created_at`, que el upsert por viaje no
// reescribe) contra esta constante.
//
// REGLA DE MANTENIMIENTO: la constante es el PRIMER instante posible de la
// regla en producción y NUNCA se mueve hacia delante. Si el despliegue real
// ocurre después, lo cerrado entre la constante y el despliegue se recalcula con
// la regla (deriva cosmética: el desglose se apaga, sin tocar dinero); moverla
// hacia delante, al revés, dejaría cerrar sin regla (estímulo concedido sin
// declaración). Antes de publicar, corre la consulta de impacto de
// docs/operacion/impacto-tarjeta-no-empresa.sql.
/** Los dos tipos de la regla (declaró que NO / no ha contestado): ambos nacen con ella. */
export const TIPOS_DE_TARJETA_AJENA: readonly string[] = ['tarjeta_no_empresa', 'tarjeta_sin_declarar'];

export const TARJETA_NO_EMPRESA_VIGENTE_DESDE = '2026-10-04T00:00:00-06:00';

/**
 * ¿Rige la regla para una liquidación con esta fecha de cierre?
 * `undefined`/`null` = todavía no hay cierre (cierre nuevo, o viaje sin
 * liquidación): rige. Una fecha ilegible también rige: ante la duda, fail-closed.
 */
export function reglaTarjetaRigeParaCierre(cerradaEn?: string | null): boolean {
  if (!cerradaEn) return true;
  const t = Date.parse(cerradaEn);
  if (!Number.isFinite(t)) return true;
  return t >= Date.parse(TARJETA_NO_EMPRESA_VIGENTE_DESDE);
}
