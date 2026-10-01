// ═══════════════════════════════════════════════════════════════════════════
// TIPOS DEL VIGÍA DE SERVICIO AL CLIENTE (Agente 4, mig. 0400).
//
// El Vigía atiende a los CLIENTES de la flota (el que espera su carga) por el
// mismo WhatsApp de Likida. Este archivo solo declara las formas que comparten
// el clasificador, el redactor, la política de envío y el servicio: no importa
// nada de infraestructura, para que las piezas puras se puedan probar sin base.
// ═══════════════════════════════════════════════════════════════════════════

export const INTENCIONES = [
  'ubicacion', 'eta', 'documentos', 'factura_pod', 'queja', 'pide_humano', 'baja', 'saludo', 'otro',
] as const;
export type Intencion = (typeof INTENCIONES)[number];

/** Las intenciones que piden un DATO del viaje (el resto no tiene qué consultar). */
export const INTENCIONES_DE_DATO: readonly Intencion[] = ['ubicacion', 'eta', 'documentos', 'factura_pod'];

export type Clasificador = 'reglas' | 'modelo' | 'ninguno';

export interface Clasificacion {
  intencion: Intencion;
  /** Intenciones de dato adicionales en el mismo mensaje («¿dónde va y a qué hora llega?»). */
  secundarias: Intencion[];
  confianza: number;
  clasificador: Clasificador;
  /** Marcas que NO cambian la intención pero sí la política (p. ej. `inyeccion`). */
  senales: string[];
}

export type ModoAprobacion = 'siempre' | 'autoenviar_bajo_riesgo';

export interface ConfigVigia {
  tenantId: string;
  habilitado: boolean;
  modoAprobacion: ModoAprobacion;
  autoenviarMinAprobaciones: number;
  slaRespuestaMin: number;
  escalarNivel2Min: number;
  retencionDias: number;
  avisoPrivacidadUrl: string | null;
}

/** Lo que vale cuando la flota no tiene fila: APAGADO (falla cerrado). */
export function configApagada(tenantId: string): ConfigVigia {
  return {
    tenantId, habilitado: false, modoAprobacion: 'siempre', autoenviarMinAprobaciones: 5,
    slaRespuestaMin: 30, escalarNivel2Min: 60, retencionDias: 180, avisoPrivacidadUrl: null,
  };
}

export type EstadoContacto = 'activo' | 'baja' | 'suprimido';

export interface Contacto {
  id: string;
  tenantId: string;
  clienteId: string;
  /** 52 + 10 dígitos. */
  telefono: string;
  nombre: string | null;
  gerenteUserId: string | null;
  estado: EstadoContacto;
  consentimientoEn: string | null;
  optoutEn: string | null;
  avisoPrivacidadEn: string | null;
}

export type ControlConversacion = 'agente' | 'humano';

export interface Conversacion {
  id: string;
  tenantId: string;
  contactoId: string;
  clienteId: string;
  viajeId: string | null;
  estado: 'activa' | 'cerrada';
  control: ControlConversacion;
  tomadaPor: string | null;
  ultimaEntradaEn: string | null;
  ultimaSalidaEn: string | null;
  sinRespuestaDesde: string | null;
  entradasSinRespuesta: number;
  molestiaNivel: number;
  molestiaMotivos: string[];
  molestiaEn: string | null;
  escalamientoNivel: number;
  escaladoEn: string | null;
  atendidaEn: string | null;
}

export type EstadoMensajeSaliente =
  | 'borrador' | 'pendiente_aprobacion' | 'aprobado' | 'enviado' | 'rechazado' | 'fallido' | 'descartado';

export type Riesgo = 'bajo' | 'medio' | 'alto';

export interface MensajeVigia {
  id: string;
  tenantId: string;
  conversacionId: string;
  direccion: 'entrante' | 'saliente';
  autor: 'cliente' | 'agente' | 'humano';
  wamid: string | null;
  tipo: string;
  texto: string | null;
  intencion: Intencion | null;
  estado: 'recibido' | EstadoMensajeSaliente;
  respuestaA: string | null;
  riesgo: Riesgo | null;
  autoenviado: boolean;
  editado: boolean;
  aprobadoPor: string | null;
  enviadoEn: string | null;
  via: 'texto' | 'botones' | 'plantilla' | null;
  error: string | null;
  senales: string[];
  createdAt: string;
}

export type TipoEvento =
  | 'entrante' | 'borrador' | 'aprobado' | 'rechazado' | 'enviado' | 'autoenviado' | 'fallo_envio'
  | 'tomada' | 'devuelta' | 'cerrada' | 'molestia' | 'sin_respuesta' | 'escalada' | 'sin_destinatario'
  | 'optout' | 'alta' | 'baja_manual' | 'suprimido' | 'spam' | 'sin_dato' | 'inyeccion' | 'otro_cliente';

export type MotivoEscalamiento = 'sin_respuesta' | 'molestia' | 'pide_humano' | 'sin_dato' | 'folio_ajeno';
