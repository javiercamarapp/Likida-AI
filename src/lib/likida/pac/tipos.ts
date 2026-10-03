// ═══════════════════════════════════════════════════════════════════════════
// LA CAPA PAC (0226) — el contrato único que cualquier proveedor cumple.
//
// Un PAC es transporte: recibe el CFDI sin sellar, lo sella con el CSD que la
// flota cargó en SU bóveda, lo timbra ante el SAT y devuelve el hecho (uuid,
// XML timbrado, fecha). Cambiar de proveedor cambia UNA implementación de
// esta interfaz, no el flujo ni la base.
//
// El error viaja TIPIFICADO y con el mensaje del PAC TAL CUAL: el contador
// que ve "CFDI40147 - El campo LugarExpedicion…" puede actuar; un "algo
// falló" no. Las clases importan porque deciden qué es seguro hacer después:
//
//   · 'rechazado'      — el PAC contestó que NO. Reintentar con el mismo XML
//                        es seguro (no hay timbre); corregir y volver.
//   · 'red'            — AMBIGUO: no hubo respuesta (timeout, socket roto).
//                        El timbre PUDO haberse emitido. NO se reintenta a
//                        ciegas: se verifica en el panel del PAC primero
//                        (lección c5-3 del enviador, el mismo patrón).
//   · 'auth'           — credenciales malas/vencidas tras reintentar el
//                        token una vez. Es configuración, no el XML.
//   · 'no_configurado' — no hay PAC en las variables de entorno. Jamás se
//                        simula un timbre (regla de la casa: un uuid
//                        inventado es una falsificación).
// ═══════════════════════════════════════════════════════════════════════════

export interface TimbreOk {
  ok: true;
  /** El folio fiscal (UUID) que asignó el SAT. */
  uuid: string;
  /** El XML timbrado completo, tal cual regresó del PAC. */
  xmlTimbrado: string;
  /** Fecha de timbrado que reporta el PAC (ISO, sin zona: hora del SAT). */
  fechaTimbrado: string;
  selloSat: string | null;
  noCertificadoSat: string | null;
}

export interface TimbreError {
  ok: false;
  clase: 'rechazado' | 'red' | 'auth' | 'no_configurado';
  /** Código del PAC si lo dio (p. ej. "CFDI40147"). */
  codigo: string | null;
  /** El mensaje del PAC TAL CUAL — jamás resumido ni traducido. */
  mensaje: string;
}

export type ResultadoTimbre = TimbreOk | TimbreError;

export interface ProveedorPac {
  /** Identificador corto persistido en `ccp_timbre.proveedor` ('sw'…). */
  nombre: string;
  /** Timbra un CFDI SIN sellar (Sello/NoCertificado/Certificado ausentes —
   *  el PAC sella con el CSD de su bóveda). */
  timbrar(xmlSinSellar: string): Promise<ResultadoTimbre>;
  /**
   * Cancela un CFDI ya timbrado ante el SAT, a través del PAC.
   *
   * El motivo es el catálogo SAT c_MotivoCancelacion (01-04). Con '01' el SAT
   * exige el UUID del comprobante que lo sustituye (`folioSustitucion`); con
   * los demás NO debe ir.
   */
  cancelar(solicitud: SolicitudCancelacion): Promise<ResultadoCancelacion>;
}

/** c_MotivoCancelacion del SAT (CFDI 4.0). */
export type MotivoCancelacion = '01' | '02' | '03' | '04';

export const MOTIVOS_CANCELACION: Record<MotivoCancelacion, string> = {
  '01': 'Comprobante emitido con errores con relación (se sustituye por otro)',
  '02': 'Comprobante emitido con errores sin relación',
  '03': 'No se llevó a cabo la operación',
  '04': 'Operación nominativa relacionada en una factura global',
};

export interface SolicitudCancelacion {
  /** RFC del EMISOR (el CSD del emisor está en la bóveda del PAC). */
  rfcEmisor: string;
  uuid: string;
  motivo: MotivoCancelacion;
  /** UUID del CFDI sustituto. Obligatorio con motivo 01; prohibido con los demás. */
  folioSustitucion?: string;
}

/**
 * El resultado de pedir una cancelación. `en_proceso` NO es «cancelado»: el SAT
 * recibió la solicitud (SW código 201) y la cancelación puede quedar a la espera
 * de la aceptación del receptor; hasta ver el acuse/estatus en el SAT o el panel
 * del PAC, el CFDI se sigue tratando como vigente.
 */
export type ResultadoCancelacion =
  | {
      ok: true;
      estado: 'cancelado' | 'en_proceso';
      /** Código SAT/PAC por UUID (201, 202…), tal cual. */
      codigoSat: string;
      /** El acuse XML del SAT, si el PAC lo devolvió. */
      acuse: string | null;
      /** El SAT ya lo tenía cancelado (202): la petición repetida es inocua. */
      yaEstaba: boolean;
    }
  | {
      ok: false;
      clase: 'rechazado' | 'red' | 'auth' | 'no_configurado';
      codigo: string | null;
      /** El mensaje del PAC TAL CUAL. */
      mensaje: string;
    };
