// ═══════════════════════════════════════════════════════════════════════════
// PUERTO `SalidaTms` — contrato de salida de la plantilla al TMS del cliente.
//
// La plantilla que arma el agente (normal o «nueva») se sube al TMS por su API,
// al mismo proceso donde hoy la sube una persona; la subida manual siempre sigue
// disponible (modo `SIN_TMS`).
//
// ── LO ACORDADO Y LO NO ACORDADO ────────────────────────────────────────────
//   · ACORDADO: `cargarPlantilla` (subir el archivo al proceso normal del TMS).
//   · NO ACORDADO (hoy): las operaciones opcionales `consultarReque`,
//     `consultarCaja`, `consultarCatalogo` y `consultarEstadoCcp`. Solo se
//     acordaron liquidaciones, CCP y peajes por fechas. Dependen de que el TMS
//     las exponga; quien implemente el puerto puede omitirlas y quien lo use
//     debe tratar su ausencia como «desconocido».
//
// ── A37-A3-02 · ESTADO REAL: NO EXISTE ADAPTADOR DE PRODUCCIÓN ──────────────
//   Hoy NINGUNA flota tiene un `SalidaTms` real: `fijarProveedorSalida` no tiene llamadores de producción y toda flota cae en
//   `SIN_TMS` (rechaza siempre: FAIL-CLOSED, jamás finge un envío). Consecuencias, visibles en la configuración de la salida:
//   el modo API no se puede activar, el prechequeo de existencia queda «desconocido» y TODO envío termina en descarga manual.
//   NO se inventa el adaptador: depende de la API del cliente (autenticación, endpoint de carga, respuesta con `referencia`).
//   CUANDO EL CLIENTE LA ENTREGUE, el adaptador debe: (1) usar `idempotencyKey` (ya persistente en `cp_envio_tms.idempotency_key`)
//   como llave de idempotencia ANTE el TMS y NO un almacén en memoria (en serverless se pierde entre invocaciones); (2) devolver
//   `referencia` para que `cp_envio_tms.referencia_tms` permita casar el CCP timbrado; (3) clasificar los errores en
//   `ClaseErrorCarga`; (4) traer pruebas de contrato. Hasta entonces la automatización de la subida NO está entregada.
//
// ESTE MÓDULO NO TIMBRA y no importa nada del camino del timbre (PAC, CFDI):
// una prueba vigila los imports. Es solo tipos y una constante.
// ═══════════════════════════════════════════════════════════════════════════

export type TipoPlantilla = 'normal' | 'nueva';

export interface EntradaCarga {
  tenantId: string;
  /** Misma llave → mismo efecto: el TMS (o el adaptador) no duplica la carga. */
  idempotencyKey: string;
  archivo: Uint8Array;
  nombre: string;
  mime: string;
  plantilla: TipoPlantilla;
  metadatos: { clienteInterno: string | null; folio: string | null };
}

export type ClaseErrorCarga =
  | 'transitorio'
  | 'auth'
  | 'validacion'
  | 'reque_inexistente'
  | 'duplicado_distinto'
  | 'permanente';

export interface ErrorFila {
  hoja?: string;
  fila?: number;
  campo?: string;
  detalle: string;
}

export type ResultadoCarga =
  | { ok: true; referencia: string | null; duplicado: boolean }
  | {
      ok: false;
      clase: ClaseErrorCarga;
      mensajeLlano: string;
      errores: ErrorFila[];
      reintentarEnMs?: number;
    };

export type Existencia = 'existe' | 'no_existe' | 'desconocido';

export interface ConsultaExistencia {
  tenantId: string;
  clienteInterno: string;
  caja: string | null;
  folio: string | null;
}

export interface RefCcp {
  tenantId: string;
  referencia: string;
}

/** Estado del CCP en el TMS; vocabulario mínimo, no acordado todavía con el TMS. */
export type EstadoCcp = 'desconocido' | 'recibido' | 'en_proceso' | 'timbrado' | 'rechazado';

export interface SalidaTms {
  cargarPlantilla(e: EntradaCarga, signal?: AbortSignal): Promise<ResultadoCarga>;
  /** NO ACORDADA: depende de que el TMS la exponga. */
  consultarReque?(e: ConsultaExistencia): Promise<Existencia>;
  /** NO ACORDADA: depende de que el TMS la exponga. */
  consultarCaja?(e: ConsultaExistencia): Promise<Existencia>;
  /** NO ACORDADA: `null` = el TMS no sabe responder. */
  consultarCatalogo?(catalogo: string, clave: string): Promise<boolean | null>;
  /** NO ACORDADA: depende de que el TMS la exponga. */
  consultarEstadoCcp?(ref: RefCcp): Promise<EstadoCcp>;
}

/** Flota sin TMS conectado: modo manual (se descarga la plantilla y se sube a mano). Nunca lanza. */
export const SIN_TMS: SalidaTms = {
  async cargarPlantilla(): Promise<ResultadoCarga> {
    return {
      ok: false,
      clase: 'permanente',
      mensajeLlano: 'Esta flota no tiene conectado el sistema del cliente: descarga la plantilla y súbela a mano.',
      errores: [],
    };
  },
};

/** El proveedor del puerto FALLÓ (p. ej. no se pudieron leer las credenciales): NO es «sin conector». El worker suelta el envío
 *  sin cambiarle el estado y sin avisar «listo para subir a mano» (A37-S33-09). Jamás sube nada (fail-closed). */
export const SALIDA_NO_DISPONIBLE: SalidaTms = {
  async cargarPlantilla(): Promise<ResultadoCarga> {
    return { ok: false, clase: 'transitorio', mensajeLlano: 'El sistema del cliente no está disponible por ahora: se reintenta en unos minutos.', errores: [] };
  },
};

/** ¿Esta salida NO puede subir nada ahora (sin conector, o el proveedor falló)? Para las pantallas: ambas bloquean activar el modo API. */
export function sinConexionUtil(p: SalidaTms): boolean { return p === SIN_TMS || p === SALIDA_NO_DISPONIBLE; }
