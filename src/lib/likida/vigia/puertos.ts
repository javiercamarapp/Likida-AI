// ═══════════════════════════════════════════════════════════════════════════
// LOS PUERTOS DEL VIGÍA: lo que el servicio necesita del mundo.
//
// `servicio.ts` (la orquestación) no importa Supabase, Meta ni un modelo: pide
// estas interfaces. La implementación real vive en `repo.ts` (base) y
// `deps.ts` (cableado); las pruebas usan `repo.fixture.ts`, un doble en memoria
// que respeta las mismas garantías que la base (dedupe por wamid, una respuesta
// del agente por entrante, reclamo condicional de estados).
//
// REGLA DE ORO DE CADA MÉTODO: lleva `tenantId` y lo usa en TODA consulta. No
// existe un método que reciba solo un id.
// ═══════════════════════════════════════════════════════════════════════════
import type { PuertoModelo } from './clasificador';
import type { PuertoPulir } from './redactor';
import type { ServicioEstatusViaje } from './estatus_viaje';
import type { ArchivoParaEnviar } from './adjuntos';
import type { RespuestaRapida } from './respuestas_rapidas';
import type { Enviador, EntradaEnvioCliente, ResultadoEnvioCliente } from './enviar';
import type {
  AdjuntoRef, Clasificacion, ConfigVigia, Contacto, Conversacion, DatosAvisoCorreo, DestinatarioAviso, EstadoCorreo, EstadoMensajeSaliente, Intencion,
  MensajeVigia, NivelDirector, Riesgo, TipoEvento,
} from './tipos';
import type { enviarCorreo } from '@/lib/correo/enviar';

export interface ResultadoRecibir {
  mensajeId: string;
  conversacionId: string;
  duplicado: boolean;
}

export interface NuevoSaliente {
  conversacionId: string;
  /** El mensaje entrante al que contesta (llave de «una respuesta del agente por entrante»). */
  respuestaA: string | null;
  autor: 'agente' | 'humano';
  texto: string;
  estado: Extract<EstadoMensajeSaliente, 'borrador' | 'pendiente_aprobacion' | 'aprobado'>;
  intencion: Intencion | null;
  riesgo: Riesgo | null;
  datosRespaldo: Record<string, unknown> | null;
  senales: string[];
  autoenviado: boolean;
  aprobadoPor: string | null;
}

export interface CambioReclamo {
  aprobadoPor?: string | null;
  editado?: boolean;
  texto?: string;
  motivoRechazo?: string | null;
}

export interface NuevoEvento {
  conversacionId?: string | null;
  tipo: TipoEvento;
  /** Si se da, es la llave de idempotencia: la segunda inserción NO inserta. */
  clave?: string | null;
  nivel?: number | null;
  actorUserId?: string | null;
  destinatarioHash?: string | null;
  detalle?: Record<string, unknown>;
}

export interface FilaEnEspera {
  conversacion: Conversacion;
  contacto: Contacto;
  config: ConfigVigia;
}

export interface Destinatario {
  userId: string | null;
  telefono: string;
}

/** El reclamo ganado de UN correo de respaldo: quien lo tiene (y su token) es el único que lo manda. */
export interface ReclamoCorreo { id: string; token: string }

/** Un correo de respaldo cuyo arriendo venció sin cerrarse (la corrida murió a media): el cron lo retoma. */
export interface CorreoVencido {
  tenantId: string;
  id: string;
  conversacionId: string;
  clave: string;
  nivel: NivelDirector;
  directorId: string | null;
  destino: string;
  datos: DatosAvisoCorreo;
}

/**
 * Condición para que una escritura del BARRIDO no pise a quien contestó mientras corría: solo se aplica si el hilo sigue en el MISMO
 * ciclo de espera que se leyó (`sin_respuesta_desde` igual; `null` = ya no esperaba, nunca coincide) y, si se pide, su nivel de
 * escalamiento sigue por debajo del que se va a escribir. `actualizarConversacion` devuelve `false` si no se aplicó.
 */
export interface GuardaConversacion { sinRespuestaDesde: string; nivelMenorA?: number }

export interface RepoVigia {
  config(tenantId: string): Promise<ConfigVigia>;
  /** 0647: las respuestas rápidas APROBADAS de la flota. Falla hacia `[]` (el borrador sale como siempre), nunca lanza por una base sin migrar. */
  respuestasRapidas(tenantId: string): Promise<RespuestaRapida[]>;
  /** 0647: cuenta un uso de una respuesta rápida. Mejor esfuerzo: nunca lanza. */
  usarRespuestaRapida(tenantId: string, id: string): Promise<void>;
  /** 0484: ¿el cliente tiene algún grupo CRÍTICO? Falla hacia `false` (el plazo general), nunca lanza por una base sin migrar. */
  clienteCritico(tenantId: string, clienteId: string): Promise<boolean>;
  /** El contacto ACTIVO o dado de baja de ese número; `null` si no está en ninguna allowlist (o está suprimido). */
  contactoPorTelefono(telefono: string): Promise<Contacto | null>;
  nombreFlota(tenantId: string): Promise<string>;
  nombreCliente(tenantId: string, clienteId: string): Promise<string | null>;

  recibir(a: { tenantId: string; contactoId: string; wamid: string | null; tipo: string; texto: string; ahora: Date }): Promise<ResultadoRecibir>;
  conversacion(tenantId: string, id: string): Promise<Conversacion | null>;
  mensaje(tenantId: string, id: string): Promise<MensajeVigia | null>;
  contactoDe(tenantId: string, conversacionId: string): Promise<Contacto | null>;
  /** El id del último mensaje ENTRANTE del hilo (para el botón «Yo me encargo» de un escalamiento). */
  ultimoEntranteId(tenantId: string, conversacionId: string): Promise<string | null>;
  entrantesRecientes(tenantId: string, conversacionId: string, desde: Date, limite: number): Promise<Array<{ texto: string | null; creadoEn: string }>>;

  anotarClasificacion(tenantId: string, mensajeId: string, c: Pick<Clasificacion, 'intencion' | 'confianza' | 'clasificador' | 'senales'>): Promise<void>;
  crearSaliente(tenantId: string, n: NuevoSaliente): Promise<{ id: string; creado: boolean }>;
  /** Cambio de estado CONDICIONAL: solo si el mensaje sigue en alguno de `de`. `null` = otro lo ganó. */
  reclamarEstado(tenantId: string, mensajeId: string, de: EstadoMensajeSaliente[], a: EstadoMensajeSaliente, cambio?: CambioReclamo): Promise<MensajeVigia | null>;
  marcarEnviado(tenantId: string, mensajeId: string, a: { via: 'texto' | 'botones' | 'plantilla'; wamid: string | null; ahora: Date }): Promise<void>;
  marcarFallido(tenantId: string, mensajeId: string, error: string): Promise<void>;
  marcarAvisoGerente(tenantId: string, mensajeId: string, ahora: Date): Promise<void>;
  aprobacionesSinEditar(tenantId: string, intencion: Intencion): Promise<number>;
  /** Ids de los salientes del hilo que siguen pendientes de decisión. */
  pendientesDeHilo(tenantId: string, conversacionId: string): Promise<string[]>;

  actualizarConversacion(tenantId: string, id: string, parche: Partial<{
    viajeId: string | null; molestiaNivel: number; molestiaMotivos: string[]; molestiaEn: string | null;
    escalamientoNivel: number; escaladoEn: string | null; control: 'agente' | 'humano'; tomadaPor: string | null; tomadaEn: string | null;
    atendidaEn: string | null; atendidaPor: string | null;
  }>, guarda?: GuardaConversacion): Promise<boolean>;
  /** El cliente fue atendido: se apaga el reloj del SLA, la insistencia y la escalera. */
  marcarRespondida(tenantId: string, conversacionId: string, ahora: Date): Promise<void>;
  cerrarConversacion(tenantId: string, conversacionId: string, ahora: Date): Promise<void>;

  evento(tenantId: string, e: NuevoEvento): Promise<boolean>;
  registrarOptOut(tenantId: string, contactoId: string, ahora: Date): Promise<void>;
  marcarAvisoPrivacidad(tenantId: string, contactoId: string, ahora: Date): Promise<void>;
  destinatarioNivel(tenantId: string, contacto: Contacto, nivel: 1 | 2): Promise<Destinatario | null>;
  /**
   * 0673: TODOS a quienes se avisa en ese nivel. La lista de directores de la flota (teléfono y/o correo); en el nivel 1 también el
   * gerente asignado al cliente. Sin lista ni asignado, el destino de siempre. Sin duplicados. Falla hacia el destino de siempre.
   */
  destinatariosNivel(tenantId: string, contacto: Contacto, nivel: NivelDirector): Promise<DestinatarioAviso[]>;
  /**
   * 0674: reclama el correo de respaldo de (aviso, persona). Insertar la llave ES reclamarla: `null` = otro lo lleva o ya salió.
   * Un arriendo vencido (la corrida que lo llevaba murió) se retoma. Lanza si la base no puede responder.
   */
  reclamarCorreo(tenantId: string, a: { conversacionId: string; clave: string; nivel: NivelDirector; directorId: string | null; destino: string; datos: DatosAvisoCorreo }): Promise<ReclamoCorreo | null>;
  /** 0674: deja el resultado del correo. Solo con el token vigente; `false` = el arriendo ya no era de quien lo cierra. */
  cerrarCorreo(tenantId: string, id: string, token: string, estado: Exclude<EstadoCorreo, 'enviando'>, detalle: string | null): Promise<boolean>;
  /** 0674: los correos `enviando` con arriendo vencido, de TODAS las flotas (el cron). Falla hacia `[]` si la base no tiene la migración. */
  correosVencidos(limite: number, ahora: Date): Promise<CorreoVencido[]>;

  /**
   * Las conversaciones que esta pasada debe mirar: sin las que ya llegaron al nivel 2 y por PRÓXIMO VENCIMIENTO (ver
   * `seleccionarEnEspera`), no por antigüedad: así una flota con plazo corto no queda detrás de hilos que ya no avisan nada.
   */
  conversacionesEnEspera(limite: number, ahora: Date): Promise<FilaEnEspera[]>;
  /**
   * Cierra los hilos cuyo cliente lleva esperando desde antes de `antesDe` (ciclo muerto: el cliente se fue, nadie contestó, ya se
   * escaló lo que se podía). Devuelve los cerrados. Si el cliente vuelve a escribir, abre una conversación nueva.
   */
  expirarCiclosInactivos(antesDe: Date, limite: number, ahora: Date): Promise<Array<{ tenantId: string; id: string }>>;
  aprobadosAtorados(antesDe: Date, limite: number): Promise<Array<{ tenantId: string; id: string }>>;
  purgar(limite: number): Promise<number>;

  estatus: ServicioEstatusViaje;
  /**
   * El archivo que se puede adjuntar, de ESE cliente en ESA flota, ya con una URL firmada de corta vida; `null` si no
   * existe, no es de ese cliente o no se pudo firmar. El `clienteId` sale del contacto, nunca del texto.
   */
  archivoAdjunto(a: { tenantId: string; clienteId: string; viajeId: string; clave: AdjuntoRef['clave'] }): Promise<ArchivoParaEnviar | null>;
}

export interface DepsVigia {
  repo: RepoVigia;
  modelo?: PuertoModelo | null;
  pulir?: PuertoPulir | null;
  enviar?: Enviador;
  /** 0674: envío del correo de respaldo (inyectable para pruebas); por omisión Resend vía `enviarCorreo`. */
  enviarCorreo?: typeof enviarCorreo;
  /** Espera entre reintentos del correo de respaldo (inyectable para pruebas); por omisión un `setTimeout`. */
  esperar?: (ms: number) => Promise<void>;
  /** Envío al cliente (inyectable para pruebas); por omisión `enviarAlCliente`. */
  /** Manda un archivo (URL firmada) dentro de la ventana de 24 h; por omisión `sendDocument` de Meta. */
  enviarDocumento?: (telefono: string, link: string, nombre: string, pie?: string) => Promise<{ ok: true; id: string | null } | { ok: false; error: string; codigo?: number }>;
  enviarCliente?: (e: EntradaEnvioCliente, enviar?: Enviador, opciones?: { confirmacionDeBaja?: boolean }) => Promise<ResultadoEnvioCliente>;
  ahora?: () => Date;
}
