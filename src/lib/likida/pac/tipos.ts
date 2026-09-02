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
  /** La cancelación existe como contrato desde hoy; el flujo que la usa es
   *  fase posterior (exige motivo SAT y ventana). */
  cancelar(uuid: string, motivo: string): Promise<{ ok: boolean; mensaje: string }>;
}
