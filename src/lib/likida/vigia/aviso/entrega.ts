// ═══════════════════════════════════════════════════════════════════════════
// ENTREGA DEL AVISO DE VIAJE (T-A4-19).
//
// Lo que pidió el cliente: dejar de mandar a mano caja, placas, unidad y operador. Los grupos de WhatsApp en vivo son
// IMPOSIBLES (la 0484 lo dice: depende de la API de grupos de Meta y no está simulada), así que el aviso sale por dos canales:
//
//   · `cliente_1a1`      mensaje directo al contacto del cliente. Pasa por `enviarAlCliente` (vigia/enviar.ts), o sea por TODAS
//                        sus puertas: agente encendido, contacto de ESTA flota, activo, con consentimiento y sin baja, texto
//                        acotado, y el selector de ventana de 24 h (dentro: texto; fuera: plantilla, jamás texto libre).
//                        Lo único propio de aquí es QUÉ plantilla viaja: `vigia_aviso_viaje_v1` (o `vigia_aviso_cambio_v1`
//                        si es un reenvío), con solo los campos que `datos.valores` ya trae filtrados por privacidad
//                        (T-A4-12): licencia, vigencia y teléfono del operador no existen en `datos` y no pueden viajar.
//   · `ejecutivo_copia`  la copia va a una PERSONA de la flota, que la pega en su propio chat con el cliente. El aviso queda
//                        `enviado` cuando el ejecutivo pulsa «Copiar y marcar enviado» (T-A4-22; acción `copiar`); este
//                        módulo no toca a Meta para eso. Opcionalmente (acción `avisar_ejecutivo`) le manda el texto al
//                        WhatsApp del ejecutivo —un aviso a la oficina, `aviso_operacion_v1` fuera de ventana— UNA sola vez
//                        por aviso, y eso no cambia el estado del aviso.
//
// Garantías:
//   1. Reclamo atómico (`vigia_aviso_reclamar`): dos llamadas simultáneas o repetidas del mismo aviso → un solo envío.
//   2. Cualquier cosa que impida enviar se decide ANTES de reclamar y NO consume el aviso (agente o aviso apagados, fuera de
//      la ventana de envío): el aviso sigue `aprobado` para la siguiente pasada.
//   3. Un envío fallido cierra el aviso como `fallido` con un motivo llano (≤ 200). `fallido` no se vuelve a reclamar solo:
//      solo una persona lo vuelve a `aprobado`. Así no hay reintento infinito ni doble envío.
//   4. Nada de contenido del aviso, nombres ni teléfonos en logs: este módulo no loguea.
//
// Los datos y los envíos entran por `DepsEntrega` (puertos): la implementación con base y Meta la cablea T-A4-21. Módulo sin
// base propia; el selector real de Meta es el valor por omisión de `enviar`.
// ═══════════════════════════════════════════════════════════════════════════
import { TZ_MX, diaEnZona } from '@/lib/formato';
import { logger } from '@/lib/logger';
import { opcionesDeEnvio, PLANTILLA } from '@/lib/meta/plantillas_catalogo';
import { enviarConFallback, type ResultadoEnvioConFallback } from '@/lib/meta/enviar_con_fallback';
import { enviarAlCliente, type Enviador } from '../enviar';
import { aLineaPlantilla } from '../redactor';
import type { Contacto } from '../tipos';
import type { CanalAviso, EstadoAviso } from './repo';

/** (#132001) la plantilla no existe o no está aprobada en Meta. */
const PLANTILLA_NO_APROBADA = 132001;
const POR_CONFIRMAR = 'por confirmar';
const MAX_ERROR = 200;
const ZONA_POR_DEFECTO = TZ_MX;

/** El aviso tal como lo necesita la entrega (una fila de `vigia_aviso`). */
export interface AvisoParaEntrega {
  id: string;
  tenantId: string;
  filaId: string;
  clienteId: string | null;
  version: number;
  estado: EstadoAviso;
  canal: CanalAviso;
  texto: string;
  /** `vigia_aviso.datos`: `valores` (campo → texto ya filtrado por privacidad) y `cita` (ISO). Se lee con defensa. */
  datos: Record<string, unknown>;
}

/** Lo que la entrega necesita saber de la flota en este momento. */
export interface ContextoEntrega {
  /** Kill switch del Vigía (`vigia_config.habilitado`). */
  agenteHabilitado: boolean;
  /** `vigia_aviso_config.habilitado` (sin fila = false). */
  avisoHabilitado: boolean;
  nombreFlota: string;
  /** `vigia_aviso_config.ventana_envio`: `{}` = sin restricción; `{ desde: 'HH:MM', hasta: 'HH:MM' }`. Otra forma = ilegible. */
  ventanaEnvio: unknown;
  zona: string;
  /** WhatsApp (solo dígitos) del ejecutivo que recibe el aviso a la oficina; `null` = no se avisa por WhatsApp. */
  telefonoEjecutivo: string | null;
  /** Liga al tablero de avisos (parámetro de `aviso_operacion_v1`). */
  urlBandeja: string | null;
}

export interface DepsEntrega {
  tenantId: string;
  contexto(): Promise<ContextoEntrega>;
  /** `vigia_aviso_reclamar`: el token si ESTA llamada ganó el aviso, `null` si lo lleva otra. */
  reclamar(avisoId: string): Promise<{ token: string } | null>;
  /** `vigia_aviso_cerrar`: `false` si el arriendo ya no era suyo. */
  cerrar(avisoId: string, token: string, estado: 'enviado' | 'fallido', error?: string): Promise<boolean>;
  /** El contacto del cliente destinatario (de ESTA flota), o `null` si no hay. */
  contactoDeCliente(clienteId: string): Promise<Contacto | null>;
  /** `true` solo la PRIMERA vez para ese aviso y versión (llave de idempotencia del aviso al ejecutivo). Sin esto no se avisa. */
  reservarAvisoAlEjecutivo?(avisoId: string, version: number): Promise<boolean>;
  enviar?: Enviador;
  ahora?: () => Date;
  /** Solo pruebas: espera entre reintentos del cierre (por omisión 150/500 ms). */
  esperaCierreMs?: number;
}

/** `copiar` = el ejecutivo pulsó «Copiar y marcar enviado». `automatico` = la pasada del cron / el envío directo. */
export type AccionEntrega = 'automatico' | 'copiar';

export type MotivoOmitido = 'agente_apagado' | 'aviso_apagado' | 'aviso_no_aprobado' | 'sin_telefono_ejecutivo' | 'ya_avisado';
export type MotivoDiferido = 'fuera_de_ventana' | 'ventana_ilegible';

export type ResultadoEntrega =
  | { estado: 'enviado'; via: 'texto' | 'botones' | 'plantilla' | 'copia_manual' }
  | { estado: 'avisado_ejecutivo'; via: 'texto' | 'botones' | 'plantilla' }
  | { estado: 'fallido'; motivo: string; mensaje: string }
  | { estado: 'omitido'; motivo: MotivoOmitido }
  | { estado: 'diferido'; motivo: MotivoDiferido }
  /** Otra llamada lleva este aviso (o ya lo cerró): esta no hizo nada. */
  | { estado: 'perdido' }
  /** El mensaje salió pero el arriendo ya no era nuestro al cerrarlo: no reenviar; lo cierra quien lo tenga. */
  | { estado: 'arriendo_perdido' };

// ─── ventana de envío ──────────────────────────────────────────────────────

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutos(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = HHMM.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function zonaValida(zona: string): boolean {
  try { diaEnZona(new Date(0), zona); return true; } catch { return false; }
}

/** Minutos desde la medianoche de `instante` en la zona. */
function minutosLocales(instante: Date, zona: string): number {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instante);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 'NaN');
  return g('hour') * 60 + g('minute');
}

/**
 * ¿Se permite enviar a esta hora? `{}` = sin restricción. `{ desde, hasta }` en HH:MM; si `desde` > `hasta` la ventana cruza
 * la medianoche (22:00–06:00). Cualquier otra forma (o `desde` = `hasta`) es ILEGIBLE y falla cerrado: no se envía.
 */
export function ventanaPermite(ventana: unknown, ahora: Date, zona: string): 'si' | 'no' | 'ilegible' {
  if (typeof ventana !== 'object' || ventana === null || Array.isArray(ventana)) return 'ilegible';
  const v = ventana as Record<string, unknown>;
  const claves = Object.keys(v);
  if (claves.length === 0) return 'si';
  const desde = minutos(v.desde);
  const hasta = minutos(v.hasta);
  if (claves.some((k) => k !== 'desde' && k !== 'hasta') || desde === null || hasta === null || desde === hasta) return 'ilegible';
  const z = zonaValida(zona) ? zona : ZONA_POR_DEFECTO;
  const ahoraMin = minutosLocales(ahora, z);
  const dentro = desde < hasta ? ahoraMin >= desde && ahoraMin < hasta : ahoraMin >= desde || ahoraMin < hasta;
  return dentro ? 'si' : 'no';
}

// ─── parámetros de la plantilla ────────────────────────────────────────────

const texto = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
};

function valoresDe(datos: Record<string, unknown>): Record<string, unknown> {
  const v = datos.valores;
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** DD/MM/AAAA HH:mm en la zona; `por confirmar` si no hay cita legible. */
function citaLegible(cita: unknown, zona: string): string {
  if (typeof cita !== 'string' || Number.isNaN(Date.parse(cita))) return POR_CONFIRMAR;
  const z = zonaValida(zona) ? zona : ZONA_POR_DEFECTO;
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(cita));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}

/**
 * Las 5 variables de `vigia_aviso_viaje_v1` / `vigia_aviso_cambio_v1`. SOLO sale de `datos.valores` (caja, placas, unidad,
 * operador): lo que privacidad no dejó ver no está ahí, y licencia / vigencia / teléfono jamás se leen. PURA.
 */
export function parametrosDelAviso(a: Pick<AvisoParaEntrega, 'datos'>, nombreFlota: string, zona: string): string[] {
  const v = valoresDe(a.datos);
  const par = (etq: string, num: unknown, placas: unknown): string => {
    const n = texto(num);
    if (!n) return POR_CONFIRMAR;
    const p = texto(placas);
    return p ? `${etq} ${n}, placas ${p}` : `${etq} ${n}`;
  };
  return [
    aLineaPlantilla(nombreFlota, 80) || POR_CONFIRMAR,
    aLineaPlantilla(par('caja', v.caja, v.placas_caja), 80),
    aLineaPlantilla(par('unidad', v.unidad, v.placas_unidad), 80),
    aLineaPlantilla(texto(v.operador_nombre) ?? POR_CONFIRMAR, 80),
    citaLegible(a.datos.cita, zona),
  ];
}

// ─── helpers ───────────────────────────────────────────────────────────────

const corto = (s: string): string => (s.length > MAX_ERROR ? `${s.slice(0, MAX_ERROR - 1)}…` : s);

const INTENTOS_CIERRE = 3;
const ESPERA_CIERRE_MS = [150, 500];

/** Cierra como `enviado` un aviso que YA salió: reintenta ante una excepción de base; `false` del repo = arriendo perdido (no se insiste). */
async function cerrarEnviadoConReintento(deps: DepsEntrega, id: string, token: string): Promise<'cerrado' | 'arriendo_perdido' | 'sin_cierre'> {
  for (let i = 0; i < INTENTOS_CIERRE; i++) {
    try {
      return (await deps.cerrar(id, token, 'enviado')) ? 'cerrado' : 'arriendo_perdido';
    } catch (e) {
      logger.warn('vigia.aviso.cierre_reintento', { avisoId: id, intento: i + 1, error: e instanceof Error ? e.message : String(e) });
      if (i < INTENTOS_CIERRE - 1) await new Promise((res) => setTimeout(res, deps.esperaCierreMs ?? ESPERA_CIERRE_MS[i]));
    }
  }
  return 'sin_cierre';
}

async function cerrarFallido(
  deps: DepsEntrega, a: AvisoParaEntrega, token: string, motivo: string, mensaje: string,
): Promise<ResultadoEntrega> {
  const m = corto(mensaje);
  const ok = await deps.cerrar(a.id, token, 'fallido', m);
  return ok ? { estado: 'fallido', motivo, mensaje: m } : { estado: 'arriendo_perdido' };
}

// ─── entrada ───────────────────────────────────────────────────────────────

export async function entregarAviso(
  aviso: AvisoParaEntrega, deps: DepsEntrega, accion: AccionEntrega = 'automatico',
): Promise<ResultadoEntrega> {
  if (aviso.tenantId !== deps.tenantId) throw new Error('entregarAviso: el aviso pertenece a otra flota');
  const ahora = (deps.ahora ?? (() => new Date()))();
  const ctx = await deps.contexto();

  // 1. Lo que NO consume el aviso: sigue `aprobado` para la siguiente pasada.
  if (aviso.estado !== 'aprobado') return { estado: 'omitido', motivo: 'aviso_no_aprobado' };
  if (!ctx.avisoHabilitado) return { estado: 'omitido', motivo: 'aviso_apagado' };

  // «Copiar y marcar enviado»: la persona ya lo mandó por su cuenta; aquí solo se deja constancia. No toca a Meta, así que
  // ni el kill switch ni la ventana de envío aplican (no sale nada desde el sistema).
  if (accion === 'copiar') {
    if (aviso.canal !== 'ejecutivo_copia') throw new Error('entregarAviso: «copiar» solo aplica al canal ejecutivo_copia');
    const r = await deps.reclamar(aviso.id);
    if (!r) return { estado: 'perdido' };
    const ok = await deps.cerrar(aviso.id, r.token, 'enviado');
    return ok ? { estado: 'enviado', via: 'copia_manual' } : { estado: 'arriendo_perdido' };
  }

  // Todo lo que SALE desde el sistema respeta el kill switch y la ventana de envío.
  if (!ctx.agenteHabilitado) return { estado: 'omitido', motivo: 'agente_apagado' };
  const permite = ventanaPermite(ctx.ventanaEnvio, ahora, ctx.zona);
  if (permite === 'ilegible') return { estado: 'diferido', motivo: 'ventana_ilegible' };
  if (permite === 'no') return { estado: 'diferido', motivo: 'fuera_de_ventana' };

  const enviar = deps.enviar ?? enviarConFallback;
  if (aviso.canal === 'ejecutivo_copia') return avisarAlEjecutivo(aviso, ctx, deps, enviar);

  // 2. Canal 1:1: ganar el aviso y enviar.
  const r = await deps.reclamar(aviso.id);
  if (!r) return { estado: 'perdido' };
  try {
    return await enviarAlClienteConPlantilla(aviso, ctx, deps, enviar, r.token);
  } catch {
    // Nunca se suelta un aviso reclamado sin cerrarlo: quedaría trabado hasta que venza el arriendo.
    return cerrarFallido(deps, aviso, r.token, 'error_inesperado', 'No se pudo enviar el aviso por un error inesperado.');
  }
}

async function enviarAlClienteConPlantilla(
  a: AvisoParaEntrega, ctx: ContextoEntrega, deps: DepsEntrega, enviar: Enviador, token: string,
): Promise<ResultadoEntrega> {
  if (!a.clienteId) return cerrarFallido(deps, a, token, 'sin_destinatario', 'El aviso no tiene un cliente destinatario.');
  const contacto = await deps.contactoDeCliente(a.clienteId);
  if (!contacto) return cerrarFallido(deps, a, token, 'sin_destinatario', 'El cliente no tiene un contacto de WhatsApp registrado.');

  const nombrePlantilla = a.version > 1 ? PLANTILLA.vigiaAvisoCambio : PLANTILLA.vigiaAvisoViaje;
  const cuerpo = parametrosDelAviso(a, ctx.nombreFlota, ctx.zona);
  const visto: { ultimo: ResultadoEnvioConFallback | null } = { ultimo: null };

  // `enviarAlCliente` aplica sus puertas y arma SU plantilla genérica; aquí se cambia únicamente cuál plantilla viaja fuera
  // de la ventana (la de aviso de viaje) y se recuerda la respuesta cruda de Meta para registrar el código de rechazo.
  const conPlantillaDelAviso: Enviador = async (telefono, op) => {
    const resp = await enviar(telefono, {
      ...op,
      plantilla: { nombre: nombrePlantilla, ...opcionesDeEnvio(nombrePlantilla, { cuerpo }) },
      contexto: 'vigia.aviso',
    });
    visto.ultimo = resp;
    return resp;
  };

  const r = await enviarAlCliente({
    tenantId: a.tenantId, contacto, texto: a.texto, nombreFlota: ctx.nombreFlota, agenteHabilitado: ctx.agenteHabilitado,
  }, conPlantillaDelAviso);

  if (r.ok) {
    // A37-S62-03: el mensaje YA salió. Si el cierre falla por un bache, se reintenta; si no hay modo, NO se marca «fallido»
    // (diría «No se pudo enviar» de algo que el cliente recibió y alguien lo reintentaría, duplicándolo).
    const cierre = await cerrarEnviadoConReintento(deps, a.id, token);
    if (cierre === 'cerrado') return { estado: 'enviado', via: r.via };
    if (cierre === 'sin_cierre') logger.error('vigia.aviso.salio_sin_cierre', { avisoId: a.id, tenantId: a.tenantId });
    return { estado: 'arriendo_perdido' };
  }
  // Rechazo de plantilla no aprobada (132001): queda registrado con su código y SIN texto libre de respaldo desde aquí.
  const u = visto.ultimo;
  const codigo = u !== null && u.ok === false ? u.codigo : undefined;
  const motivo = codigo === PLANTILLA_NO_APROBADA ? 'plantilla_no_aprobada' : r.motivo;
  const mensaje = codigo === PLANTILLA_NO_APROBADA
    ? 'La plantilla del aviso aún no está aprobada en WhatsApp (132001): no se puede escribir fuera de las 24 h.'
    : r.mensaje;
  return cerrarFallido(deps, a, token, motivo, mensaje);
}

/** Aviso a la oficina: el texto al WhatsApp del ejecutivo, UNA vez por aviso y versión. No cambia el estado del aviso. */
async function avisarAlEjecutivo(
  a: AvisoParaEntrega, ctx: ContextoEntrega, deps: DepsEntrega, enviar: Enviador,
): Promise<ResultadoEntrega> {
  const tel = ctx.telefonoEjecutivo;
  if (!tel || !/^\d{10,15}$/.test(tel) || !deps.reservarAvisoAlEjecutivo) return { estado: 'omitido', motivo: 'sin_telefono_ejecutivo' };
  if (!(await deps.reservarAvisoAlEjecutivo(a.id, a.version))) return { estado: 'omitido', motivo: 'ya_avisado' };

  const resumen = a.version > 1 ? 'actualización de aviso de viaje lista para copiar' : 'aviso de viaje listo para copiar';
  const r = await enviar(tel, {
    texto: a.texto,
    plantilla: {
      nombre: PLANTILLA.avisoOperacion,
      ...opcionesDeEnvio(PLANTILLA.avisoOperacion, {
        cuerpo: [aLineaPlantilla(ctx.nombreFlota, 80) || POR_CONFIRMAR, resumen, ctx.urlBandeja ?? 'tu panel de Likida'],
      }),
    },
    contexto: 'vigia.aviso.ejecutivo',
    tenantId: a.tenantId,
  });
  if (r.ok) return { estado: 'avisado_ejecutivo', via: r.via };
  return { estado: 'fallido', motivo: 'rechazado_por_meta', mensaje: corto(r.mensaje) };
}
