import { logger } from '@/lib/logger';
import { enviarConFallback, type ResultadoEnvioConFallback } from '@/lib/meta/enviar_con_fallback';
import { normalizarTelefonoWa } from '../wa_ventana';
import { CONFIG_CONDUCTOR_DEFAULT, inicioDiaMx, type ConfigConductor } from './config';
import {
  destinatariosEscalacion, ubicacionConocida, type Destino,
} from './escalamiento';
import {
  anotarAvisoAlChofer, cerrarAvisoReclamado, leerAgenteChoferHabilitado, leerConfigConductor, liberarAvisoReclamado, marcarHitoEscalado, reclamarAviso,
  leerCicloServicio, registrarEvento, type EventoHito, type ViajeContexto,
} from './repo';
import { cicloDelServicio, type CicloServicioFila } from './ciclo_servicio';
import { cerrarHitosDeViajesVencidos, contarEnviadosPorChofer, leerAvisosDeHitos, leerHitosDeViajes, leerMuestrasGps, leerSitiosGeometriaDeViajes, hayEmergenciaDeTelefono, leerViajesAvisables, sembrarHitos } from './trabajo';
import type { MuestraGps, SitiosViaje, UnidadDeViaje } from './ciclo_gps';
import { clavesPoleoDe, lapsoMaxCompuertaMin, puedeEscribirAlChofer } from './compuerta_movimiento';
import { aplicarCompuertaAgente, conCompuertaAlChofer } from './compuerta_agente';
import { leerSenalesDeUnidades, senalesApagadas, type SenalesConduccion } from './senales_conduccion';
import { planificar, type AccionPlan, type AvisoReclamado, type MotivoNada } from './planificador';
import { armarEscalacion, armarRecordatorio, armarSolicitud, type MensajeSaliente, type MotivoEscalacion } from './solicitudes';
import type { HitoFila } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// EL MOTOR DEL CRON `conductor-hitos` — pedir, perseguir y escalar.
//
// Cada pasada:
//   1. SIEMBRA los cinco hitos de los viajes abiertos y aceptados (RPC, idempotente).
//   2. Lee los viajes activos, sus hitos, los avisos ya reclamados y cuántos
//      mensajes proactivos recibió hoy cada chofer.
//   3. Por viaje, `planificar` decide UNA acción (nada / chofer / escalar).
//   4. EJECUTA con CLAIM PRIMERO: el aviso se reclama insertando en
//      `viaje_hito_aviso` (unique (hito, ciclo, clase, nivel)) ANTES de mandar.
//      Quien pierde el insert no manda nada: dos corridas solapadas del cron (Vercel
//      entrega at-least-once) no duplican un WhatsApp.
//
// ── EL ENVÍO Y LOS RECHAZOS ────────────────────────────────────────────────
//   · Todo sale por `enviarConFallback`: ventana 24 h → texto con botones; fuera
//     de ventana → la plantilla del catálogo. Nunca `sendText` directo.
//   · Un rechazo REINTENTABLE (timeout, 429, 5xx) YA dejó el mensaje en `wa_outbox`
//     (el cliente de Meta lo encola), que lo entrega con su backoff: el claim se
//     CIERRA como «en cola» y no se suelta, o la corrida siguiente lo mandaría
//     otra vez y el aviso saldría doble. Cinco seguidos paran la corrida (es
//     Meta diciendo «hoy no», no cinco teléfonos malos).
//   · Un rechazo NO reintentable (plantilla sin aprobar, número inválido) deja el
//     claim con `ok = false`: la escalera avanza al siguiente nivel en vez de
//     repetir el mismo fallo cada 5 minutos, y el motivo queda a la vista.
//
// Todo el acceso a datos y a Meta entra por `PuertosConductor`: el motor se
// prueba entero con puertos en memoria, y `puertosReales()` los ata a Supabase.
// ═══════════════════════════════════════════════════════════════════════════

/** Cuántos rechazos reintentables seguidos paran la corrida. */
export const TOPE_RECHAZOS_SEGUIDOS = 5;
/** Viajes que se procesan por pasada (el resto se atiende en la siguiente). */
export const TOPE_VIAJES_POR_PASADA = 400;

export interface NuevoAviso {
  tenantId: string;
  viajeId: string;
  hitoId: string;
  operadorId: string | null;
  ciclo: number;
  clase: AvisoReclamado['clase'];
  nivel: number;
}

export interface CierreAviso {
  ok: boolean;
  canal: 'texto' | 'botones' | 'plantilla' | 'ninguno';
  motivo: string | null;
  ult4: string | null;
}

export interface PuertosConductor {
  sembrar(limite: number): Promise<number>;
  /** Omite los hitos pendientes de los viajes abiertos desde hace demasiado (0661). Opcional: los puertos de prueba no lo traen. */
  cerrarVencidos?(): Promise<number>;
  viajesActivos(limite: number): Promise<ViajeContexto[]>;
  hitosDe(viajeIds: string[]): Promise<HitoFila[]>;
  avisosDe(hitoIds: string[]): Promise<Array<AvisoReclamado & { hitoId: string }>>;
  enviadosHoyPorChofer(operadorIds: string[], desde: Date): Promise<Record<string, number>>;
  configDe(tenantId: string): Promise<ConfigConductor>;
  /** T-A5-42: los ciclos por servicio de la flota (0807). Opcional: sin puerto, o sin filas, todos los viajes siguen el ciclo actual. */
  ciclosDe?(tenantId: string): Promise<CicloServicioFila[]>;
  reclamar(a: NuevoAviso): Promise<'ganado' | 'perdido' | 'fallo'>;
  cerrarAviso(a: NuevoAviso, c: CierreAviso): Promise<void>;
  liberarAviso(a: NuevoAviso): Promise<void>;
  /** Tras mandar al chofer: sube el contador y fija la hora del primer aviso. */
  anotarAvisoChofer(h: HitoFila, ahora: Date): Promise<void>;
  marcarEscalado(h: HitoFila, nivel: 1 | 2, ahora: Date): Promise<boolean>;
  enviar(telefono: string, m: MensajeSaliente, contexto: string, tenantId: string, ahora: Date): Promise<ResultadoEnvioConFallback>;
  destinatarios(tenantId: string, terminalId: string | null, nivel: 1 | 2): Promise<Destino[]>;
  ubicacion(v: ViajeContexto, hs: readonly HitoFila[], ahora: Date): Promise<string>;
  evento(h: HitoFila, evento: EventoHito, detalle: Record<string, string | number | boolean | null>): Promise<void>;
  /**
   * T-A5-36: las muestras de GPS de las unidades desde `desde` (llave `<tenant>|<unidad>`) y los sitios de los viajes, para la compuerta
   * «unidad detenida». Opcionales: un puerto que no los trae, con la compuerta ENCENDIDA, no manda nada (falla cerrado).
   */
  muestrasUnidad?(unidades: UnidadDeViaje[], desde: Date): Promise<Map<string, MuestraGps[]>>;
  sitiosDe?(viajes: Array<{ id: string; tenantId: string }>): Promise<Map<string, SitiosViaje>>;
  /**
   * T-A5-68: la señal de conducción del proveedor de telemática (ignición, velocidad, teléfono en la mano) → `senalExtra` de la compuerta,
   * para que «atasco» (quieto pero conduciendo) no cuente como unidad detenida. Opcional: sin puerto, o sin lectura, rige la regla solo-GPS.
   */
  senalesConduccion?: SenalesConduccion;
}

/**
 * T-A5-36: ¿la compuerta «unidad detenida» deja escribirle al chofer de CADA viaje? Una lectura por pasada (no por viaje). Apagada
 * (por omisión) no lee nada. Encendida y con un fallo de lectura, o sin puerto o sin unidad, el viaje NO se escribe: ante la duda,
 * silencio. No se registran coordenadas.
 */
export async function evaluarCompuertaDeViajes(
  p: Pick<PuertosConductor, 'muestrasUnidad' | 'sitiosDe' | 'senalesConduccion'>,
  viajes: readonly ViajeContexto[], configs: ReadonlyMap<string, ConfigConductor | null>, ahora: Date,
): Promise<Map<string, { permitido: boolean; razon: string }>> {
  const salida = new Map<string, { permitido: boolean; razon: string }>();
  const activos = viajes.filter((v) => configs.get(v.tenantId)?.compuertaMovimientoActiva === true);
  if (activos.length === 0) return salida;
  const cierra = (razon: string) => { for (const v of activos) salida.set(v.id, { permitido: false, razon }); return salida; };
  if (!p.muestrasUnidad) return cierra('sin_puerto_gps');

  const conUnidad = activos.filter((v) => v.unidadId);
  const unidades = [...new Map(conUnidad.map((v) => [`${v.tenantId}|${v.unidadId}`, { tenantId: v.tenantId, unidadId: v.unidadId! }])).values()];
  // T-A5-37: la lectura cubre el lapso que exige la cadencia de poleo (poleo × muestras), no solo la ventana corta; sin poleo, la de siempre.
  const ventanaMax = Math.max(...activos.map((v) => lapsoMaxCompuertaMin(configs.get(v.tenantId) ?? CONFIG_CONDUCTOR_DEFAULT)));
  let muestras = new Map<string, MuestraGps[]>();
  let sitios = new Map<string, SitiosViaje>();
  try {
    muestras = unidades.length > 0 ? await p.muestrasUnidad(unidades, new Date(ahora.getTime() - (ventanaMax + 5) * 60_000)) : muestras;
    sitios = p.sitiosDe && conUnidad.length > 0 ? await p.sitiosDe(conUnidad) : sitios;
  } catch (e) {
    logger.error('conductor.compuerta_lectura_fallo', { err: e instanceof Error ? e.message : String(e) });
    return cierra('lectura_fallida');
  }
  // T-A5-68: una lectura de la señal de conducción por unidad (nunca lanza; sin puerto o sin dato = solo-GPS).
  const senales = await leerSenalesDeUnidades(p.senalesConduccion, conUnidad.map((v) => v.unidadId!), ahora);
  for (const v of activos) {
    const posiciones = v.unidadId ? (muestras.get(`${v.tenantId}|${v.unidadId}`) ?? []) : [];
    const r = puedeEscribirAlChofer({
      posiciones, clavesPoleo: clavesPoleoDe(v.unidadId, posiciones), // T-A5-37: cadencia por unidad/proveedor
      sitioDelViaje: sitios.get(v.id) ?? null, config: configs.get(v.tenantId)!, ahora,
      senalExtra: v.unidadId ? (senales.get(v.unidadId) ?? null) : null,
    });
    salida.set(v.id, r);
  }
  return salida;
}

export interface ResultadoConductor {
  sembrados: number;
  /** Hitos pendientes de viajes abiertos vencidos que esta pasada dejó de perseguir (0661). */
  vencidosCerrados?: number;
  /** `true` = la lista de trabajo llegó al tope: había más viajes que atender (se atienden en pasadas siguientes, repartidos). */
  viajesTruncados?: boolean;
  viajes: number;
  /** T-A5-27: los viajes en seguimiento de esta pasada según quién los aceptó (solo conteos). */
  viajesPorOrigen?: { chofer: number; importacion: number; otro: number };
  solicitudes: number;
  recordatorios: number;
  escalaciones: number;
  yaReclamados: number;
  rechazosReintentables: number;
  configIlegible: number;
  sinDestinatario: number;
  cortadosPorReloj: number;
  /** `true` = la corrida se detuvo por rechazos masivos de Meta. */
  cortadaPorRechazoMasivo: boolean;
  fallos: string[];
  saltados: Partial<Record<MotivoNada, number>>;
}

const ult4 = (tel: string): string | null => {
  const d = normalizarTelefonoWa(tel).slice(-4);
  return /^\d{1,4}$/.test(d) ? d : null;
};

function nuevoAviso(v: ViajeContexto, h: HitoFila, clase: AvisoReclamado['clase'], nivel: number, operadorId: string | null): NuevoAviso {
  return { tenantId: v.tenantId, viajeId: v.id, hitoId: h.id, operadorId, ciclo: h.ciclo, clase, nivel };
}

export async function correrConductor(
  p: PuertosConductor,
  opts: { ahora?: Date; venceEn?: number } = {},
): Promise<ResultadoConductor> {
  const ahora = opts.ahora ?? new Date();
  const r: ResultadoConductor = {
    sembrados: 0, viajes: 0, solicitudes: 0, recordatorios: 0, escalaciones: 0, yaReclamados: 0,
    rechazosReintentables: 0, configIlegible: 0, sinDestinatario: 0, cortadosPorReloj: 0,
    cortadaPorRechazoMasivo: false, fallos: [], saltados: {},
  };
  const salta = (m: MotivoNada) => { r.saltados[m] = (r.saltados[m] ?? 0) + 1; };

  r.sembrados = await p.sembrar(500);
  if (p.cerrarVencidos) {
    // Limpiar lo vencido es higiene: si falla, la pasada sigue (se dice, no se calla).
    try { r.vencidosCerrados = await p.cerrarVencidos(); } catch (e) {
      r.fallos.push(`cerrar vencidos: ${e instanceof Error ? e.message : String(e)}`);
      logger.error('conductor.cerrar_vencidos_fallo', { err: e instanceof Error ? e.message : String(e) });
    }
  }

  const viajes = await p.viajesActivos(TOPE_VIAJES_POR_PASADA);
  r.viajes = viajes.length;
  r.viajesPorOrigen = { chofer: 0, importacion: 0, otro: 0 };
  for (const v of viajes) {
    const o = v.aceptadoOrigen === 'importacion' ? 'importacion' : v.aceptadoOrigen === 'chofer' ? 'chofer' : 'otro';
    r.viajesPorOrigen[o]++;
  }
  if (viajes.length >= TOPE_VIAJES_POR_PASADA) {
    // El «tope mudo»: antes la lista se cortaba sin decirlo. Ahora el corte es un reparto entre flotas y además se avisa.
    r.viajesTruncados = true;
    logger.warn('conductor.viajes_truncados', { tope: TOPE_VIAJES_POR_PASADA });
  }
  if (viajes.length === 0) return r;

  const hitos = await p.hitosDe(viajes.map((v) => v.id));
  const porViaje = new Map<string, HitoFila[]>();
  for (const h of hitos) porViaje.set(h.viajeId, [...(porViaje.get(h.viajeId) ?? []), h]);

  const avisos = await p.avisosDe(hitos.map((h) => h.id));

  // La config se lee UNA vez por flota. Si no se puede leer, SUS viajes se saltan
  // esta pasada: operar contra una estrategia que no se pudo consultar es operar
  // con datos equivocados (el criterio de `escalar_viaje.ts`, B4).
  const configs = new Map<string, ConfigConductor | null>();
  const ciclos = new Map<string, CicloServicioFila[]>();
  for (const t of new Set(viajes.map((v) => v.tenantId))) {
    try {
      configs.set(t, await p.configDe(t));
      // T-A5-42: el ciclo se lee con la config; si no se puede leer, la flota se salta (perseguir hitos que su servicio no tiene sería operar a ciegas).
      if (p.ciclosDe) ciclos.set(t, await p.ciclosDe(t));
    } catch (e) {
      configs.set(t, null);
      logger.error('conductor.config_ilegible', { tenant: t, err: e instanceof Error ? e.message : String(e) });
    }
  }

  // El «día» del tope diario por chofer es el de la zona de SU flota (config.zonaHoraria). Con una sola
  // zona (lo normal) es UNA consulta con todos los choferes, igual que antes; con varias, una por zona.
  const choferesPorZona = new Map<string, Set<string>>();
  for (const v of viajes) {
    const zona = configs.get(v.tenantId)?.zonaHoraria ?? CONFIG_CONDUCTOR_DEFAULT.zonaHoraria;
    choferesPorZona.set(zona, (choferesPorZona.get(zona) ?? new Set<string>()).add(v.operadorId));
  }
  const enviadosHoy: Record<string, number> = {};
  for (const [zona, choferes] of choferesPorZona) {
    Object.assign(enviadosHoy, await p.enviadosHoyPorChofer([...choferes], inicioDiaMx(ahora, zona)));
  }

  let rechazosSeguidos = 0;
  let compuerta: Promise<Map<string, { permitido: boolean; razon: string }>> | undefined;
  for (const v of viajes) {
    if (opts.venceEn !== undefined && Date.now() >= opts.venceEn) {
      r.cortadosPorReloj = viajes.length - viajes.indexOf(v);
      logger.warn('conductor.corte_por_reloj', { pendientes: r.cortadosPorReloj });
      break;
    }
    const config = configs.get(v.tenantId);
    if (!config) { r.configIlegible++; continue; }

    const hs = porViaje.get(v.id) ?? [];
    const accion: AccionPlan = planificar({
      viaje: v, hitos: hs, config, ahora,
      ciclo: p.ciclosDe ? cicloDelServicio(ciclos.get(v.tenantId) ?? [], v.servicio ?? null) : undefined,
      enviadosHoyChofer: enviadosHoy[v.operadorId] ?? 0,
      avisos: avisos.filter((a) => hs.some((h) => h.id === a.hitoId)),
    });
    if (accion.tipo === 'nada') { salta(accion.motivo); continue; }

    try {
      if (accion.tipo === 'chofer') {
        // T-A5-36: al chofer no se le escribe en marcha. ANTES del claim: un «no» no es un intento y no consume un recordatorio;
        // la siguiente pasada vuelve a decidir (el planificador devuelve lo mismo mientras siga vencido). Se lee una sola vez, y solo
        // si hay un mensaje por mandar.
        compuerta ??= evaluarCompuertaDeViajes(p, viajes, configs, ahora);
        const veredicto = (await compuerta).get(v.id);
        if (veredicto && !veredicto.permitido) { salta('compuerta_movimiento'); continue; }

        const claim = nuevoAviso(v, accion.hito, accion.clase, accion.nivel, v.operadorId);
        const gano = await p.reclamar(claim);
        if (gano === 'perdido') { r.yaReclamados++; continue; }
        if (gano === 'fallo') { r.fallos.push(`reclamo ${v.id}`); continue; }

        const msg = accion.nivel === 0
          ? armarSolicitud(accion.hito, v, ahora, config.zonaHoraria)
          : armarRecordatorio(accion.hito, v, accion.nivel, accion.minutosPendiente);
        const envio = await p.enviar(v.operadorTelefono!, msg, `conductor.${accion.clase}`, v.tenantId, ahora);

        if (envio.ok) {
          rechazosSeguidos = 0;
          await p.cerrarAviso(claim, { ok: true, canal: envio.via, motivo: envio.motivo, ult4: ult4(v.operadorTelefono!) });
          await p.anotarAvisoChofer(accion.hito, ahora);
          await p.evento(accion.hito, 'solicitado', { nivel: accion.nivel, canal: envio.via });
          enviadosHoy[v.operadorId] = (enviadosHoy[v.operadorId] ?? 0) + 1;
          if (accion.clase === 'solicitud') r.solicitudes++; else r.recordatorios++;
        } else if (envio.bloqueadoPorCompuerta) {
          // A37-A5-04: lo detuvo una compuerta de seguridad (agente apagado/ilegible, emergencia abierta): NUNCA llegó a Meta. No es un
          // aviso entregado ni un intento: se suelta el claim, no se anota el aviso y la escalera no avanza (al habilitarse arranca de cero).
          await p.liberarAviso(claim);
          salta('compuerta_agente');
        } else if (envio.reintentable) {
          // El texto YA está en `wa_outbox` (client.ts), que lo entrega con su backoff. Soltar el claim haría que
          // la siguiente corrida lo mande otra vez y el outbox entregue el primero: dos avisos al chofer. Se
          // CIERRA como «en cola» y el aviso cuenta para la escalera (el recordatorio sí va a llegar).
          await p.cerrarAviso(claim, { ok: true, canal: 'texto', motivo: 'en_cola_outbox', ult4: ult4(v.operadorTelefono!) });
          await p.anotarAvisoChofer(accion.hito, ahora);
          r.rechazosReintentables++;
          rechazosSeguidos++;
          r.fallos.push(`${accion.clase} ${v.folio ?? v.id}: ${envio.mensaje} (queda en la cola de WhatsApp; no se reenvía)`);
        } else {
          await p.cerrarAviso(claim, { ok: false, canal: 'ninguno', motivo: envio.mensaje.slice(0, 200), ult4: ult4(v.operadorTelefono!) });
          // Cuenta como avisado a efectos de la escalera: sigue al siguiente nivel, no repite el fallo.
          await p.anotarAvisoChofer(accion.hito, ahora);
          r.fallos.push(`${accion.clase} ${v.folio ?? v.id}: ${envio.mensaje}`);
        }
      } else {
        const hecho = await escalar(p, v, hs, accion, avisos, ahora, r);
        if (hecho === 'reintentable') rechazosSeguidos++; else rechazosSeguidos = 0;
      }
    } catch (e) {
      // Un viaje que revienta no tumba el lote: el claim ya decidió qué quedó hecho.
      r.fallos.push(`${v.folio ?? v.id}: ${e instanceof Error ? e.message : 'error inesperado'}`);
      logger.error('conductor.viaje_fallo', { viaje: v.id, err: e instanceof Error ? e.message : String(e) });
    }

    if (rechazosSeguidos >= TOPE_RECHAZOS_SEGUIDOS) {
      r.cortadaPorRechazoMasivo = true;
      r.cortadosPorReloj = viajes.length - viajes.indexOf(v) - 1;
      logger.error('conductor.rechazo_masivo', { rechazosSeguidos, pendientes: r.cortadosPorReloj });
      break;
    }
  }
  logger.info('conductor.corrida', {
    viajes: r.viajes, solicitudes: r.solicitudes, recordatorios: r.recordatorios, escalaciones: r.escalaciones, fallos: r.fallos.length,
  });
  return r;
}

type Escalacion = Extract<AccionPlan, { tipo: 'escalar' }>;

/**
 * A35-A5-02: el aviso por «Tengo un problema» tiene SU PROPIA llave de claim (nivel 5, libre en 0..9), aparte de la
 * escalera (1 y 2). Así una escalación previa por falta de respuesta no se come el aviso de una falla real.
 */
export const NIVEL_AVISO_PROBLEMA = 5;

/** Ejecuta una escalación (claim → destinatarios → envío → marca). Devuelve cómo terminó. */
async function escalar(
  p: PuertosConductor, v: ViajeContexto, hs: HitoFila[], a: Escalacion,
  avisos: ReadonlyArray<AvisoReclamado & { hitoId: string }>, ahora: Date, r: ResultadoConductor,
  motivoForzado?: MotivoEscalacion,
): Promise<'ok' | 'reintentable' | 'sin_envio' | 'perdido'> {
  const esProblema = motivoForzado === 'problema_reportado';
  const claim = nuevoAviso(v, a.hito, 'escalacion', esProblema ? NIVEL_AVISO_PROBLEMA : a.nivel, null);
  const gano = await p.reclamar(claim);
  if (gano === 'perdido') { r.yaReclamados++; return 'perdido'; }
  if (gano === 'fallo') { r.fallos.push(`reclamo escalación ${v.id}`); return 'sin_envio'; }

  const destinos = await p.destinatarios(v.tenantId, v.terminalId, a.nivel);
  if (destinos.length === 0) {
    // Esa flota no tiene a quién escalar: se marca igual (a la vista en el tablero) y se grita.
    r.sinDestinatario++;
    logger.error('conductor.escalacion_sin_destinatario', { tenant: v.tenantId, viaje: v.id, nivel: a.nivel });
    r.fallos.push(`${v.folio ?? v.id}: no hay a quién escalar (nivel ${a.nivel})`);
    if (esProblema) return fallaAvisoDeProblema(p, a, claim, 'sin_destinatario');
    await p.cerrarAviso(claim, { ok: false, canal: 'ninguno', motivo: 'sin_destinatario', ult4: null });
    await p.marcarEscalado(a.hito, a.nivel, ahora);
    return 'sin_envio';
  }

  const avisosAlChofer = avisos.filter((x) => x.hitoId === a.hito.id && x.ciclo === a.hito.ciclo && (x.clase === 'solicitud' || x.clase === 'recordatorio') && x.ok !== false).length; // A37-A5-04: solo los que SÍ salieron
  const ubic = await p.ubicacion(v, hs, ahora);
  const msg = armarEscalacion(a.hito, v, a.nivel, motivoForzado ?? a.motivo, avisosAlChofer, ubic);

  let entregados = 0;
  let reintentables = 0;
  let ultimoError = '';
  let canal: CierreAviso['canal'] = 'ninguno';
  for (const d of destinos) {
    const envio = await p.enviar(d.telefono, msg, `conductor.escalacion_n${a.nivel}`, v.tenantId, ahora);
    if (envio.ok) { entregados++; canal = envio.via; } else { ultimoError = envio.mensaje; if (envio.reintentable) reintentables++; }
  }

  if (entregados === 0 && reintentables === destinos.length) {
    // Todos los rechazos son reintentables: cada texto YA está en `wa_outbox`, que lo entrega. Soltar el claim
    // mandaría la escalación otra vez (aviso doble al jefe de tráfico). Se CIERRA como «en cola» y el nivel se
    // marca: la escalera avanza y el outbox es quien reintenta.
    await p.cerrarAviso(claim, { ok: true, canal: 'texto', motivo: 'en_cola_outbox', ult4: ult4(destinos[0].telefono) });
    await p.marcarEscalado(a.hito, a.nivel, ahora);
    r.rechazosReintentables++;
    r.fallos.push(`escalación ${v.folio ?? v.id}: ${ultimoError} (queda en la cola de WhatsApp; no se reenvía)`);
    return 'reintentable';
  }
  if (esProblema && entregados === 0) {
    r.fallos.push(`aviso de problema ${v.folio ?? v.id}: ${ultimoError}`);
    return fallaAvisoDeProblema(p, a, claim, ultimoError.slice(0, 200));
  }
  await p.cerrarAviso(claim, {
    ok: entregados > 0, canal: entregados > 0 ? canal : 'ninguno',
    motivo: entregados > 0 ? null : ultimoError.slice(0, 200), ult4: ult4(destinos[0].telefono),
  });
  await p.marcarEscalado(a.hito, a.nivel, ahora);
  await p.evento(a.hito, 'escalado', { nivel: a.nivel, destinatarios: destinos.length, entregados });
  if (entregados > 0) r.escalaciones++; else r.fallos.push(`escalación ${v.folio ?? v.id}: ${ultimoError}`);
  return entregados > 0 ? 'ok' : 'sin_envio';
}

/**
 * A35-A5-02: el aviso por «Tengo un problema» NO salió. Se SUELTA el claim (no se cierra como fallido) para que el
 * siguiente toque del chofer lo reintente de verdad en vez de toparse con un claim muerto, y queda el evento
 * `escalado` con `entregados: 0` en la bitácora del hito para que el supervisor lo vea en el tablero.
 */
async function fallaAvisoDeProblema(
  p: PuertosConductor, a: Escalacion, claim: NuevoAviso, motivo: string,
): Promise<'sin_envio'> {
  logger.error('conductor.aviso_problema_no_enviado', { tenant: a.hito.tenantId, viaje: a.hito.viajeId, hito: a.hito.id, motivo });
  await p.liberarAviso(claim);
  await p.evento(a.hito, 'escalado', { nivel: a.nivel, motivo: 'problema_reportado_sin_aviso', entregados: 0, causa: motivo });
  return 'sin_envio';
}

/**
 * El chofer apretó «Tengo un problema»: se escala YA al nivel 1, sin esperar a que
 * se agote la escalera. Mismo claim, mismo envío: un doble toque no avisa dos veces.
 */
export async function escalarPorProblema(
  p: PuertosConductor, v: ViajeContexto, hito: HitoFila, hs: HitoFila[], ahora: Date,
): Promise<'ok' | 'reintentable' | 'sin_envio' | 'ya_avisado'> {
  const r: ResultadoConductor = {
    sembrados: 0, viajes: 1, solicitudes: 0, recordatorios: 0, escalaciones: 0, yaReclamados: 0, rechazosReintentables: 0,
    configIlegible: 0, sinDestinatario: 0, cortadosPorReloj: 0, cortadaPorRechazoMasivo: false, fallos: [], saltados: {},
  };
  const avisos = await p.avisosDe([hito.id]);
  const res = await escalar(p, v, hs, { tipo: 'escalar', hito, nivel: 1, minutosPendiente: 0, motivo: 'sin_respuesta', ancla: ahora }, avisos, ahora, r, 'problema_reportado');
  if (res !== 'perdido') return res;
  // El claim ya existía. Solo es «ya avisado» si ese aviso de verdad salió (`ok = true`); con `false`, sin resultado o
  // sin poder leerlo NO se promete nada: se le dice al chofer que no hay confirmación.
  const previo = avisos.find((x) => x.hitoId === hito.id && x.ciclo === hito.ciclo && x.clase === 'escalacion' && x.nivel === NIVEL_AVISO_PROBLEMA);
  return previo?.ok === true ? 'ya_avisado' : 'sin_envio';
}

// ═══════════════════════════════════════════════════════════════════════════
// LOS PUERTOS REALES — Supabase y Meta.
// ═══════════════════════════════════════════════════════════════════════════

export function puertosReales(): PuertosConductor {
  return {
    sembrar: sembrarHitos,
    cerrarVencidos: cerrarHitosDeViajesVencidos,
    viajesActivos: leerViajesAvisables, // A37-A5-02/03: sin emergencia abierta, baja ni oposición
    hitosDe: leerHitosDeViajes,
    avisosDe: leerAvisosDeHitos,
    enviadosHoyPorChofer: contarEnviadosPorChofer,
    // 0859: sin la marca explícita de la flota el Agente 5 se lee APAGADO (ningún motor le toma viajes) y, además, cada envío al chofer pasa por la base.
    configDe: async (t) => aplicarCompuertaAgente(await leerConfigConductor(t)),
    ciclosDe: leerCicloServicio,
    reclamar: reclamarAviso,
    cerrarAviso: cerrarAvisoReclamado,
    liberarAviso: liberarAvisoReclamado,
    anotarAvisoChofer: anotarAvisoAlChofer,
    marcarEscalado: marcarHitoEscalado,
    enviar: conCompuertaAlChofer((telefono, m, contexto, tenantId, ahora) => enviarConFallback(telefono, {
      texto: m.texto, botones: m.botones, plantilla: m.plantilla, contexto, tenantId, ahora,
    }), leerAgenteChoferHabilitado, { emergencia: hayEmergenciaDeTelefono }),
    destinatarios: destinatariosEscalacion,
    ubicacion: ubicacionConocida,
    evento: (h, evento, detalle) => registrarEvento(h, evento, detalle),
    muestrasUnidad: leerMuestrasGps,
    sitiosDe: leerSitiosGeometriaDeViajes,
    // T-A5-68: nace apagado (sin adaptador de proveedor real: BLOQUEO EXTERNO); con uno, se cambia aquí y todo el cron lo recibe.
    senalesConduccion: senalesApagadas,
  };
}
