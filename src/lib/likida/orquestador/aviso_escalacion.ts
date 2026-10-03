import { correoConfigurado, enviarCorreo } from '@/lib/correo/enviar';
import { avisoEscalacionAsistente } from '@/lib/correo/avisos';
import { logger } from '@/lib/logger';
import { fechaHoraMx } from '@/lib/formato';
import { agentePorId, leerConfigNotificaciones, MAX_DESTINATARIOS, repartoDe, usuariosAvisables, type ConfigNotificaciones, type UsuarioAvisable } from '../agentes/notificaciones';
import { ETIQUETA_DESTINO, ETIQUETA_MOTIVO, type Destino, type Motivo } from './escalamiento';
import { rolPuedeLeerTarea } from './permisos';

// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO SALIENTE DE UNA TAREA ESCALADA — «la escalación AVISA de verdad».
//
// Hasta la 0650 la tarea que el asistente deja para una persona solo vivía en una tabla: si nadie abría el
// tablero de viajes en vivo, nadie se enteraba (la auditoría 05 lo llamó «la escalación no le llega a nadie»).
// Ahora hay un aviso saliente, con estas decisiones de producto:
//
//  1. ESTÁ EN EL CATÁLOGO DE AVISOS (agente `orquestador`, evento `escalado`, `notificaciones.ts`) y NACE APAGADO:
//     lo enciende el dueño en la pestaña Notificaciones. Mientras esté apagado la tarea se marca `omitido: apagado`
//     (y NO se manda tarde cuando alguien lo encienda: una tarea de hace tres semanas no es una alerta).
//  2. UN CORREO POR TAREA, no por «marca de insistencia» (las marcas 1/5/20 de `avisar()` callarían una emergencia
//     nueva porque ya hubo un aviso hoy). La llave del claim es la propia tarea (`aviso_estado`, mig. 0651).
//  3. EL CLAIM VA ANTES DEL ENVÍO (UPDATE condicional sobre pendiente + reclamo vencido): dos corridas solapadas —el
//     cron escalar y la creación en caliente— no mandan dos correos. Un envío que falla se reintenta a los 10 min,
//     hasta 3 intentos; luego `agotado` (se ve en la tarea).
//  4. QUIÉN RECIBE: las cuentas que el dueño marcó, que pueden abrir la pantalla Y que pueden LEER esa tarea (una
//     tarea de dinero —diferencia de liquidación, duda fiscal— no llega al encargado: `rolPuedeLeerTarea`). Si la tarea va
//     DIRIGIDA al contador (`destino = 'contador'`) también le llega a sus cuentas activas con correo: la pantalla del asistente
//     no es suya, por eso no sale del reparto por pantalla, pero la tarea es de él (R09-3: antes ningún contador la recibía).
//  5. TOPE: a lo más 3 correos por flota y por corrida; el resto espera a la siguiente (sin perderse).
//  6. NUNCA LANZA y nunca decide nada: manda un correo con el resumen YA limpio (sin teléfonos, correos ni ligas).
// ═══════════════════════════════════════════════════════════════════════════

export const MAX_INTENTOS_AVISO = 3;
export const REINTENTO_AVISO_MIN = 10;
export const TOPE_AVISOS_POR_FLOTA_Y_CORRIDA = 3;
export const EVENTO_AVISO = 'escalado' as const;

export interface TareaParaAviso {
  id: string;
  tenantId: string;
  estado: string;
  avisoEstado: string;
  avisoIntentos: number;
  destino: Destino;
  motivo: Motivo;
  viajeFolio: string | null;
  resumen: string;
}

export type EstadoFinalAviso = 'enviado' | 'omitido' | 'agotado' | 'pendiente';

export type ResultadoAvisoTarea =
  | 'enviado' | 'omitido_apagado' | 'omitido_sin_canal' | 'omitido_sin_destinatario'
  | 'reintentara' | 'agotado' | 'ocupado' | 'ya_avisada' | 'no_aplica' | 'sin_config' | 'error';

export interface DepsAvisoEscalacion {
  leerTarea(tenantId: string, id: string): Promise<TareaParaAviso | null>;
  /** UPDATE condicional: pendiente, con intentos por debajo del máximo y sin reclamo reciente. Suma un intento. */
  reclamar(tenantId: string, id: string): Promise<boolean>;
  /** Cierra (o anota) el estado del aviso. Solo toca una tarea que sigue pendiente. */
  marcar(tenantId: string, id: string, estado: EstadoFinalAviso, detalle: string | null): Promise<void>;
  config(tenantId: string): Promise<{ ok: ConfigNotificaciones } | { error: string }>;
  usuarios(tenantId: string): ReturnType<typeof usuariosAvisables>;
  canalListo(): boolean;
  enviar(destinatarios: string[], correo: ReturnType<typeof avisoEscalacionAsistente>): Promise<{ ok: true } | { ok: false; motivo: string }>;
  nombreFlota(tenantId: string): Promise<string | null>;
  ahora(): Date;
}

/** Los motivos que no admiten esperar a la siguiente revisión: el correo sale con tono urgente. */
const MOTIVOS_URGENTES: ReadonlySet<Motivo> = new Set<Motivo>(['posible_emergencia']);
export const esUrgente = (m: Motivo): boolean => MOTIVOS_URGENTES.has(m);

/** Armado puro del correo de una tarea (para probar el texto y para el aviso). */
export function correoDeTarea(t: Pick<TareaParaAviso, 'destino' | 'motivo' | 'viajeFolio' | 'resumen'>, flota: string | null) {
  return avisoEscalacionAsistente({
    flota, destino: ETIQUETA_DESTINO[t.destino], motivo: ETIQUETA_MOTIVO[t.motivo], folio: t.viajeFolio, resumen: t.resumen, urgente: esUrgente(t.motivo), alContador: t.destino === 'contador',
  });
}

/** Las cuentas de contador a las que va dirigida una tarea de `destino = 'contador'` (sin repetir correo ni cuentas ya incluidas). */
function contadoresDestinatarios(t: Pick<TareaParaAviso, 'destino' | 'motivo'>, usuarios: readonly UsuarioAvisable[], yaIncluidos: readonly { email: string }[]): Array<{ id: string; nombre: string | null; email: string; rol: string }> {
  if (t.destino !== 'contador') return [];
  const vistos = new Set(yaIncluidos.map((u) => u.email.toLowerCase()));
  const r: Array<{ id: string; nombre: string | null; email: string; rol: string }> = [];
  for (const u of usuarios) {
    const email = u.email?.trim() ?? '';
    if (u.rol !== 'contador' || email === '' || vistos.has(email.toLowerCase()) || !rolPuedeLeerTarea(u.rol, t)) continue;
    vistos.add(email.toLowerCase());
    r.push({ id: u.id, nombre: u.nombre, email, rol: u.rol });
  }
  return r;
}

/** Evalúa una tarea y, si corresponde, manda UN correo. Nunca lanza. */
export async function avisarEscalacion(tenantId: string, tareaId: string, deps: DepsAvisoEscalacion): Promise<ResultadoAvisoTarea> {
  try {
    const t = await deps.leerTarea(tenantId, tareaId);
    if (!t || t.tenantId !== tenantId || t.estado !== 'abierta') return 'no_aplica';
    if (t.avisoEstado !== 'pendiente') return 'ya_avisada';
    if (t.avisoIntentos >= MAX_INTENTOS_AVISO) {
      await deps.marcar(tenantId, t.id, 'agotado', 'se agotaron los intentos de envío');
      return 'agotado';
    }

    const agente = agentePorId('orquestador');
    if (!agente) return 'error';

    // Sin config legible no hay autorización para escribirle a nadie: no se consume nada y se reintenta después.
    const conf = await deps.config(tenantId);
    if ('error' in conf) return 'sin_config';
    if (!conf.ok.eventos.includes(EVENTO_AVISO)) {
      await deps.marcar(tenantId, t.id, 'omitido', 'apagado: la flota no encendió este aviso');
      return 'omitido_apagado';
    }
    if (!deps.canalListo()) {
      await deps.marcar(tenantId, t.id, 'omitido', 'sin canal: el correo no está configurado en este entorno');
      return 'omitido_sin_canal';
    }
    const reparto = repartoDe(await deps.usuarios(tenantId), conf.ok, agente);
    const reciben = [...reparto.reciben.filter((u) => rolPuedeLeerTarea(u.rol, t)), ...contadoresDestinatarios(t, await deps.usuarios(tenantId), reparto.reciben)].slice(0, MAX_DESTINATARIOS);
    if (reciben.length === 0) {
      await deps.marcar(tenantId, t.id, 'omitido', 'sin destinatario: nadie marcado puede leer esta tarea');
      return 'omitido_sin_destinatario';
    }

    if (!(await deps.reclamar(tenantId, t.id))) return 'ocupado';

    const correo = correoDeTarea(t, await deps.nombreFlota(tenantId));
    const envio = await deps.enviar(reciben.map((u) => u.email), correo);
    if (envio.ok) {
      // R09-5: el correo YA salió. Si sellarlo falla (la base parpadeó), un fallo aquí dejaba la tarea pendiente y reclamable: a los
      // 10 min se reenviaba, hasta 3 veces. Se reintenta el sello y, si de verdad no se pudo, se dice SIN lanzar: el aviso salió.
      await sellarEnviado(deps, tenantId, t.id, `a ${reciben.length} ${reciben.length === 1 ? 'cuenta' : 'cuentas'} (${fechaHoraMx(deps.ahora().toISOString())})`);
      logger.info('orquestador.aviso_enviado', { tenantId, tarea: t.id, destinatarios: reciben.length, motivo: t.motivo });
      return 'enviado';
    }
    // El intento ya se contó en el claim: con el último agotado, se dice; si no, la siguiente corrida lo reintenta tras la espera.
    const detalle = `el envío falló: ${envio.motivo}`.slice(0, 200);
    if (t.avisoIntentos + 1 >= MAX_INTENTOS_AVISO) {
      await deps.marcar(tenantId, t.id, 'agotado', detalle);
      logger.error('orquestador.aviso_agotado', { tenantId, tarea: t.id, motivo: envio.motivo });
      return 'agotado';
    }
    await deps.marcar(tenantId, t.id, 'pendiente', detalle);
    logger.warn('orquestador.aviso_fallo', { tenantId, tarea: t.id, motivo: envio.motivo });
    return 'reintentara';
  } catch (e) {
    logger.error('orquestador.aviso_error', { tenantId, tarea: tareaId, err: e instanceof Error ? e.message : String(e) });
    return 'error';
  }
}

/** Sella «enviado» con hasta 3 intentos. Nunca lanza: tras un envío exitoso, un error de la base no debe convertirse en otro correo. */
async function sellarEnviado(deps: DepsAvisoEscalacion, tenantId: string, id: string, detalle: string): Promise<void> {
  let ultimo = '';
  for (let i = 0; i < 3; i++) {
    try { await deps.marcar(tenantId, id, 'enviado', detalle); return; } catch (e) { ultimo = e instanceof Error ? e.message : String(e); }
  }
  logger.error('orquestador.aviso_enviado_sin_sello', { tenantId, tarea: id, err: ultimo });
}

export interface ResumenAvisos { revisadas: number; enviadas: number; omitidas: number; reintentables: number; agotadas: number; topadas: number }

/**
 * El barrido del cron: las tareas abiertas con el aviso pendiente, más viejas primero, con tope por flota y por corrida.
 * `venceEn` corta ANTES de cada envío (el correo no se manda con el reloj vencido).
 */
export async function avisarEscalacionesPendientes(
  pendientes: ReadonlyArray<{ tenantId: string; id: string }>,
  deps: DepsAvisoEscalacion,
  opciones: { venceEn?: number; tope?: number } = {},
): Promise<ResumenAvisos> {
  const r: ResumenAvisos = { revisadas: 0, enviadas: 0, omitidas: 0, reintentables: 0, agotadas: 0, topadas: 0 };
  const tope = opciones.tope ?? TOPE_AVISOS_POR_FLOTA_Y_CORRIDA;
  const mandadas = new Map<string, number>();
  for (const p of pendientes) {
    if (opciones.venceEn !== undefined && Date.now() >= opciones.venceEn) break;
    if ((mandadas.get(p.tenantId) ?? 0) >= tope) { r.topadas++; continue; }
    r.revisadas++;
    const res = await avisarEscalacion(p.tenantId, p.id, deps);
    if (res === 'enviado') { r.enviadas++; mandadas.set(p.tenantId, (mandadas.get(p.tenantId) ?? 0) + 1); }
    else if (res.startsWith('omitido')) r.omitidas++;
    else if (res === 'reintentara') r.reintentables++;
    else if (res === 'agotado') r.agotadas++;
  }
  return r;
}

/** Las dependencias reales que no tocan la base (la parte con acceso a datos vive en `fuentes_reales.ts`). */
export function depsDeCorreo(): Pick<DepsAvisoEscalacion, 'config' | 'usuarios' | 'canalListo' | 'enviar' | 'ahora'> {
  return {
    config: (tenantId) => {
      const agente = agentePorId('orquestador');
      return agente ? leerConfigNotificaciones(tenantId, agente) : Promise.resolve({ error: 'el agente no está en el catálogo de avisos' });
    },
    usuarios: usuariosAvisables,
    canalListo: correoConfigurado,
    enviar: async (destinatarios, correo) => {
      const r = await enviarCorreo(destinatarios, correo);
      return r.ok ? { ok: true } : { ok: false, motivo: r.motivo };
    },
    ahora: () => new Date(),
  };
}
