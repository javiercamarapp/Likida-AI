// ═══════════════════════════════════════════════════════════════════════════
// LA CAPA DE DESCARGA MASIVA DEL SAT (0231) — el contrato único que cualquier
// proveedor cumple.
//
// El servicio del SAT NO es una llamada, es un TRÁMITE de tres tiempos, y el
// contrato lo espeja tal cual porque fingir que es síncrono sería mentir
// sobre cuándo hay datos:
//
//   solicitar(rango, tipo) → requestId   el SAT acepta el trámite
//   verificar(requestId)   → estado      …y tarda: hasta 6 días por web
//                                        service, ~48 h por portal
//   descargar(paquete)     → XMLs        y el paquete vive 72 h, bajable 2
//                                        veces (v1.5 del SAT, may-2026)
//
// LOS DOS CAMINOS, Y POR QUÉ SE ARRANCA POR EL PRIMERO. La descarga masiva
// exige la e.firma del contribuyente (el CSD NO sirve para esto). Eso parte
// el mundo en dos:
//
//   · VÍA PAC ('sw') — la flota sube su e.firma a la bóveda del PAC, igual
//     que ya subió su CSD para timbrar (0226), y Likida solo dispara
//     solicitudes con el RFC. LIKIDA NUNCA TOCA LA e.firma. Cuesta (el
//     contrato del PAC), y es el que se construye hoy.
//   · VÍA DIRECTA ('sat_directo') — hablar al web service del SAT sin
//     intermediario (hay librería Node al día que implementa el ciclo). No
//     cuesta por CFDI, pero entonces la e.firma tiene que vivir DE ESTE LADO,
//     cifrada, y Likida pasa a custodiar la firma electrónica de sus
//     clientes. Es más responsabilidad, no menos trabajo.
//
// La decisión (27-ago-2026) es arrancar por el PAC y dejar la capa lista para
// el otro: `sat_directo` es un proveedor DECLARADO y no construido, y el
// resolvedor lo dice con esas palabras en vez de caerse o, peor, simular.
//
// El error viaja TIPIFICADO y con el mensaje del proveedor TAL CUAL, mismas
// clases que la capa PAC y por la misma razón — deciden qué es seguro hacer
// después:
//
//   · 'rechazado'      — el SAT/proveedor contestó que NO (rango inválido,
//                        e.firma vencida, tope alcanzado). Corregir y volver.
//   · 'red'            — no hubo respuesta. Para SOLICITAR es ambiguo: el
//                        trámite pudo quedar abierto del lado del SAT y
//                        re-solicitar quema el tope diario. Para VERIFICAR y
//                        DESCARGAR es inocuo: son lecturas, se reintenta.
//   · 'auth'           — credenciales del proveedor malas/vencidas tras
//                        reintentar el token una vez. Es configuración.
//   · 'sin_credencial' — no hay e.firma cargada en la bóveda del proveedor
//                        para ese RFC. Lo destraba la flota, no Likida.
//   · 'no_configurado' — no hay proveedor en las variables de entorno. Jamás
//                        se simula una descarga ni se inventa un CFDI.
// ═══════════════════════════════════════════════════════════════════════════

/** Qué buzón se pide. 'recibidos' es el que da el valor (lo que los comercios
 *  le timbraron a la flota); 'emitidos' es lo que la flota facturó. El SAT
 *  los partió en dos operaciones distintas desde la v1.5. */
export type TipoDescarga = 'recibidos' | 'emitidos';

export type ClaseErrorSat =
  | 'rechazado' | 'red' | 'auth' | 'sin_credencial' | 'no_configurado';

export interface ErrorSat {
  ok: false;
  clase: ClaseErrorSat;
  /** Código del proveedor/SAT si lo dio (p. ej. "5002"). */
  codigo: string | null;
  /** El mensaje del proveedor TAL CUAL — jamás resumido ni traducido. */
  mensaje: string;
}

export interface SolicitudOk {
  ok: true;
  /** El identificador del trámite. Con él se verifica y se descarga. */
  requestId: string;
}

/** El estado del trámite del lado del SAT. `paquetes` solo tiene sentido en
 *  'lista'; en cualquier otro estado es un arreglo vacío y NO se lee como
 *  "no hubo nada" (para eso está `estado`). */
export interface VerificacionOk {
  ok: true;
  estado: 'en_proceso' | 'lista' | 'error' | 'expirada';
  /** Los identificadores de paquete que el proveedor reporta listos. */
  paquetes: string[];
  /** Cuántos CFDI dice el SAT que trae el trámite. NULL cuando el proveedor
   *  no lo reporta — nunca se sustituye por 0: "no lo dijo" y "no hay
   *  ninguno" son cosas distintas. */
  cfdis: number | null;
  /** Lo que dijo el proveedor, tal cual, aunque el estado sea bueno. */
  mensaje: string | null;
}

export interface PaqueteOk {
  ok: true;
  /** Los XML del paquete, ya extraídos. Cada uno es un CFDI completo. */
  xmls: string[];
}

/** Lo que el proveedor sabe de la e.firma que la flota cargó EN SU BÓVEDA.
 *  Likida no tiene la credencial: solo puede preguntar si existe. */
export interface CredencialOk {
  ok: true;
  /** Número de serie del certificado (20 dígitos) — una REFERENCIA, no la
   *  credencial: con este número no se firma nada. */
  numero: string;
  /** Hasta cuándo sirve. Una e.firma vencida deja de descargar en silencio. */
  venceEn: string | null;
}

export type ResultadoSolicitud = SolicitudOk | ErrorSat;
export type ResultadoVerificacion = VerificacionOk | ErrorSat;
export type ResultadoPaquete = PaqueteOk | ErrorSat;
export type ResultadoCredencial = CredencialOk | ErrorSat;

export interface RangoDescarga {
  /** RFC del contribuyente cuyo buzón se pide (YYYY-MM-DD para las fechas). */
  rfc: string;
  desde: string;
  hasta: string;
  tipo: TipoDescarga;
}

export interface ProveedorDescargaSat {
  /** Identificador corto persistido en `sat_descarga_solicitud.proveedor`. */
  nombre: string;
  /** Abre el trámite ante el SAT. Devuelve el id con el que se sigue. */
  solicitar(rango: RangoDescarga): Promise<ResultadoSolicitud>;
  /** Pregunta en qué va. El SAT tarda: esto se llama muchas veces. */
  verificar(requestId: string): Promise<ResultadoVerificacion>;
  /** Baja un paquete y devuelve los XML que trae adentro. */
  descargar(paquete: string): Promise<ResultadoPaquete>;
  /** ¿Hay e.firma cargada en la bóveda del proveedor para este RFC? Es lo
   *  ÚNICO que Likida puede saber de la credencial, y basta para decir en
   *  pantalla qué falta y quién lo destraba. */
  credencial(rfc: string): Promise<ResultadoCredencial>;
}
