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
import type { Enviador, EntradaEnvioCliente, ResultadoEnvioCliente } from './enviar';
import type {
  AdjuntoRef, Clasificacion, ConfigVigia, Contacto, Conversacion, EstadoMensajeSaliente, Intencion, MensajeVigia, Riesgo, TipoEvento,
} from './tipos';

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

export interface RepoVigia {
  config(tenantId: string): Promise<ConfigVigia>;
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
  }>): Promise<void>;
  /** El cliente fue atendido: se apaga el reloj del SLA, la insistencia y la escalera. */
  marcarRespondida(tenantId: string, conversacionId: string, ahora: Date): Promise<void>;
  cerrarConversacion(tenantId: string, conversacionId: string, ahora: Date): Promise<void>;

  evento(tenantId: string, e: NuevoEvento): Promise<boolean>;
  registrarOptOut(tenantId: string, contactoId: string, ahora: Date): Promise<void>;
  marcarAvisoPrivacidad(tenantId: string, contactoId: string, ahora: Date): Promise<void>;
  destinatarioNivel(tenantId: string, contacto: Contacto, nivel: 1 | 2): Promise<Destinatario | null>;

  conversacionesEnEspera(limite: number): Promise<FilaEnEspera[]>;
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
  /** Envío al cliente (inyectable para pruebas); por omisión `enviarAlCliente`. */
  /** Manda un archivo (URL firmada) dentro de la ventana de 24 h; por omisión `sendDocument` de Meta. */
  enviarDocumento?: (telefono: string, link: string, nombre: string, pie?: string) => Promise<{ ok: true; id: string | null } | { ok: false; error: string; codigo?: number }>;
  enviarCliente?: (e: EntradaEnvioCliente, enviar?: Enviador, opciones?: { confirmacionDeBaja?: boolean }) => Promise<ResultadoEnvioCliente>;
  ahora?: () => Date;
}
