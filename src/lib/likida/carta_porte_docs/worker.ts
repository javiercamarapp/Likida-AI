// ═══════════════════════════════════════════════════════════════════════════
// EL WORKER DE LA BANDEJA DE CARTA PORTE (cron `carta-porte-docs`, 0640-0642).
//
// Hasta hoy un documento «recibido» solo se extraía si la petición que lo recibió alcanzaba el reloj (correo,
// WhatsApp) o si alguien apretaba «Procesar»: los de lease vencido y los de fallo reintentable (modelo,
// presupuesto) se quedaban donde estaban, y la promesa «lo verás en la bandeja en un momento» no tenía quién la
// cumpliera. Este motor la cumple:
//
//   1. PROCESA lo pendiente con `procesarDocumento`, que reclama con `cp_documento_reclamar` (0420: lease de
//      120 s + tope de 5 intentos). Aquí solo se ELIGE (`documentosPendientes`): dos corridas solapadas listan
//      lo mismo y gana una al reclamar — la otra ve `no_reclamable` y sigue.
//   2. Un fallo REINTENTABLE (modelo, archivo no leído, presupuesto) lo vuelve a elegir con una espera creciente
//      (15, 30, 60, 120 min); el presupuesto agotado además no gasta un intento. A los 5 intentos el documento
//      es TERMINAL (`fallido`, intentos = 5): nadie lo reclama más y la oficina se entera UNA vez.
//   3. AVISA a la oficina (jefe de tráfico) UNA vez por documento y tipo, con el candado de la 0641:
//        · `hallazgos`: un documento (llegó por correo, WhatsApp o el panel: 0692) quedó por revisar con un bloqueo o con
//          lectura poco segura — el «marcar dudas y mandar al equipo» que pidió el cliente;
//        · `agotado`: no se pudo leer tras todos los intentos.
//
// ── LA REGLA DEL OUTBOX (la de la ronda 06, `aadb8a7a` y `3d9dee7c`) ───────────────────────────────────────
// Un rechazo REINTENTABLE (timeout, 429, 5xx) YA dejó el mensaje en `wa_outbox`, que lo entrega con su backoff.
// Soltar el candado ahí haría que la pasada siguiente lo mandara otra vez y el outbox entregara el primero:
// aviso doble. El candado se queda cerrado («en cola»); solo un rechazo DEFINITIVO (plantilla sin aprobar,
// número inválido) lo suelta, y eso no manda nada, así que reintentar es gratis.
//
// Todo el acceso a datos y a Meta entra por `DepsWorker`: el motor se prueba entero con dobles en memoria.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { parametrosAvisoOficina, type ResultadoAvisoOficina } from '@/lib/meta/aviso_oficina';
import { UMBRAL_CRITICO } from './campos';
import type { DocPendiente, DocumentoFila, TipoAvisoDoc, TipoEvento } from './repo';
import type { ResultadoProceso } from './servicio';

/** Documentos que se eligen por pasada (el reloj y el presupuesto de IA acotan cuántos alcanzan). */
export const TOPE_DOCS_POR_PASADA = 25;
/** Margen mínimo que debe quedar en el reloj para empezar a extraer un documento nuevo (una extracción con IA tarda). */
export const MARGEN_EXTRACCION_MS = 25_000;
/** Fallos de modelo SEGUIDOS que paran la pasada (es el proveedor diciendo «hoy no», no cinco documentos malos). */
export const TOPE_FALLOS_MODELO_SEGUIDOS = 4;
/** Avisos a la oficina por pasada: la oficina no necesita una avalancha, y el resto sale en la siguiente. */
export const TOPE_AVISOS_POR_PASADA = 10;
/** Rechazos DEFINITIVOS seguidos que paran los avisos (una plantilla sin aprobar rebota para todos). */
export const TOPE_AVISOS_RECHAZADOS_SEGUIDOS = 3;

export interface DepsWorker {
  pendientes(limite: number): Promise<DocPendiente[]>;
  procesar(tenantId: string, id: string, signal?: AbortSignal): Promise<ResultadoProceso>;
  /** `null` = la base no tiene la 0641: los avisos quedan apagados (sin candado atómico se repetirían). */
  agotados(limite: number): Promise<Array<{ tenantId: string; id: string }> | null>;
  /**
   * M3 (0672): cierra como `fallido` terminal los `procesando` con los intentos agotados y el lease vencido (zombis), para que
   * `agotados` los vea y la oficina se entere. `null` = la base no tiene la 0672. Opcional: un doble sin él no cierra nada.
   */
  cerrarZombis?(): Promise<Array<{ tenantId: string; id: string }> | null>;
  porAvisar(umbral: number, limite: number): Promise<Array<{ tenantId: string; id: string }> | null>;
  leer(tenantId: string, id: string): Promise<DocumentoFila | null>;
  reclamarAviso(tenantId: string, id: string, tipo: TipoAvisoDoc): Promise<'ganado' | 'perdido' | 'sin_migracion'>;
  liberarAviso(tenantId: string, id: string, tipo: TipoAvisoDoc): Promise<boolean>;
  telefonoOficina(tenantId: string): Promise<string | null>;
  avisar(telefono: string, texto: string, parametros: [string, string, string], contexto: Record<string, unknown>): Promise<ResultadoAvisoOficina>;
  /** Mejor esfuerzo: una base sin la 0642 no admite estos tipos de evento y eso no debe tumbar nada. */
  evento(tenantId: string, id: string, tipo: TipoEvento, detalle: Record<string, unknown>): Promise<void>;
  ahora(): number;
  /** Señal de aborto para una extracción (la que el cron acota al reloj restante). */
  senal?(ms: number): AbortSignal | undefined;
}

export interface OpcionesWorker {
  /** `Date.now()` a partir del cual la pasada deja de tomar documentos nuevos (corta ANTES del claim). */
  venceEn: number;
  /** URL base de la bandeja; la liga de cada documento es `<url>/<id>`. */
  urlBandeja: string;
  limite?: number;
}

export interface ResultadoWorker {
  pendientes: number;
  procesados: number;
  /** Extracciones que fallaron (reintentables o no). */
  fallidos: number;
  /** Documentos que otra invocación ya tenía o terminó (no es un error). */
  yaTomados: number;
  /** Archivos con varios embarques que esta pasada partió (0670): cada embarque nace como documento hijo y entra a la siguiente pasada. */
  divididos: number;
  /** Excepciones de infraestructura al procesar (la base, Storage): el lease vence solo y se reintenta. */
  errores: number;
  cortadosPorReloj: number;
  /** Alguna flota topó su techo de IA (diario o de fondo): sus documentos se saltaron en esta pasada; las demás siguieron. */
  paradaPorPresupuesto: boolean;
  /** Documentos NO intentados por el techo de su flota (ya agotado en esta pasada). */
  omitidosPorPresupuesto: number;
  paradaPorFallosSeguidos: boolean;
  agotados: number;
  /** M3: documentos `procesando` sin intentos y con el lease vencido que esta pasada cerró como fallidos. */
  zombisCerrados: number;
  /** M1: archivos partidos cuyos hijos ya existían (reabiertos o sin archivo) y de los que se avisó a la oficina. */
  divisionesAvisadas: number;
  hallazgos: number;
  avisosEnviados: number;
  /** Rechazos reintentables: el aviso YA está en `wa_outbox` y el candado se quedó cerrado. NO se reenvía. */
  avisosEnCola: number;
  /** Rechazos definitivos: no salió nada y el candado se soltó para reintentar. */
  avisosFallidos: number;
  avisosPerdidos: number;
  sinTelefono: number;
  /** La base no tiene la 0641: no hay candado atómico y los avisos quedaron apagados. */
  avisosSinMigracion: boolean;
  fallos: string[];
}

const vacio = (): ResultadoWorker => ({
  pendientes: 0, procesados: 0, fallidos: 0, yaTomados: 0, divididos: 0, errores: 0, cortadosPorReloj: 0, paradaPorPresupuesto: false, omitidosPorPresupuesto: 0,
  paradaPorFallosSeguidos: false, agotados: 0, zombisCerrados: 0, divisionesAvisadas: 0, hallazgos: 0, avisosEnviados: 0, avisosEnCola: 0, avisosFallidos: 0, avisosPerdidos: 0,
  sinTelefono: 0, avisosSinMigracion: false, fallos: [],
});

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 200);

/** La pasada completa: procesar lo pendiente y, con el reloj que sobre, avisar a la oficina. */
export async function correrWorkerCartaPorte(deps: DepsWorker, opts: OpcionesWorker): Promise<ResultadoWorker> {
  const r = vacio();
  await procesarPendientes(deps, opts, r);
  // Los zombis se cierran ANTES de avisar: un documento recién cerrado entra a la lista de `agotados` en esta misma pasada.
  await cerrarZombis(deps, r);
  // Los avisos NO dependen del modelo: aunque el proveedor esté caído o el presupuesto agotado, la oficina se
  // entera de lo que ya está listo (o perdido). Necesitan poco reloj: un envío a Meta.
  await avisarOficinaDe(deps, opts, r);
  return r;
}

/** Reparte el lote por turnos entre flotas (conservando el orden dentro de cada una) y lo corta en `limite`. */
export function intercalarPorFlota(lista: DocPendiente[], limite: number): DocPendiente[] {
  const porFlota = new Map<string, DocPendiente[]>();
  for (const d of lista) {
    const cola = porFlota.get(d.tenantId);
    if (cola) cola.push(d); else porFlota.set(d.tenantId, [d]);
  }
  if (porFlota.size <= 1) return lista.slice(0, limite);
  const colas = [...porFlota.values()];
  const salida: DocPendiente[] = [];
  for (let ronda = 0; salida.length < limite; ronda++) {
    let hubo = false;
    for (const c of colas) {
      if (ronda < c.length && salida.length < limite) { salida.push(c[ronda]); hubo = true; }
    }
    if (!hubo) break;
  }
  return salida;
}

async function procesarPendientes(deps: DepsWorker, opts: OpcionesWorker, r: ResultadoWorker): Promise<void> {
  let lista: DocPendiente[];
  try {
    const limite = opts.limite ?? TOPE_DOCS_POR_PASADA;
    // Se pide de más y se reparte por flota: el orden de la base es «el más viejo primero» y una flota con muchos
    // recibidos (o con el techo de IA agotado) llenaría el lote y dejaría sin turno a las demás.
    lista = intercalarPorFlota(await deps.pendientes(limite * 4), limite);
  } catch (e) {
    r.errores++;
    r.fallos.push(`pendientes: ${msg(e)}`);
    logger.error('cp_worker.pendientes_fallo', { err: msg(e) });
    return;
  }
  r.pendientes = lista.length;
  let modeloSeguidos = 0;
  // Los techos de IA son POR FLOTA: la que agotó el suyo se salta; las demás siguen (aislamiento entre flotas).
  const flotasSinPresupuesto = new Set<string>();

  for (let i = 0; i < lista.length; i++) {
    const d = lista[i];
    // El corte va ANTES del claim: lo no intentado queda intacto y la pasada siguiente lo encabeza.
    if (deps.ahora() + MARGEN_EXTRACCION_MS >= opts.venceEn) {
      r.cortadosPorReloj = lista.length - i;
      break;
    }
    if (flotasSinPresupuesto.has(d.tenantId)) { r.omitidosPorPresupuesto++; continue; }
    try {
      const p = await deps.procesar(d.tenantId, d.id, deps.senal?.(Math.max(5_000, opts.venceEn - deps.ahora() - 8_000)));
      if (p.ok) {
        r.procesados++;
        if (p.estado === 'dividido') {
          r.divididos++;
          if ((p.reabiertos ?? 0) > 0 || (p.sinArchivo ?? 0) > 0) await avisarDivisionConPrevios(deps, opts, d, p.embarques, p.reabiertos ?? 0, p.sinArchivo ?? 0, r);
        }
        modeloSeguidos = 0;
        continue;
      }
      if (p.motivo === 'no_reclamable' || p.motivo === 'perdi_el_lease') { r.yaTomados++; continue; }
      r.fallidos++;
      r.fallos.push(`${p.motivo}${p.permanente ? ' (permanente)' : ''}: ${p.mensaje.slice(0, 120)}`);
      if (p.motivo === 'presupuesto') {
        // `run` es el tope de ESTE documento: el siguiente puede caber. `tenant`/`proposito` son techos de la flota:
        // lo que siga DE ESA FLOTA toparía igual (se salta); las demás flotas siguen. Sin alcance se asume el de la flota.
        if (p.alcance !== 'run') { r.paradaPorPresupuesto = true; flotasSinPresupuesto.add(d.tenantId); }
        continue;
      }
      if (p.motivo === 'modelo') {
        modeloSeguidos++;
        if (modeloSeguidos >= TOPE_FALLOS_MODELO_SEGUIDOS) {
          r.paradaPorFallosSeguidos = true;
          r.cortadosPorReloj = lista.length - i - 1;
          logger.error('cp_worker.modelo_caido', { seguidos: modeloSeguidos, pendientes: r.cortadosPorReloj });
          break;
        }
      } else {
        modeloSeguidos = 0;
      }
    } catch (e) {
      // La base o Storage fallaron en ESTE documento: no tumba el lote. El lease vence solo y el intento ya subió.
      r.errores++;
      r.fallos.push(`documento ${d.id.slice(0, 8)}: ${msg(e)}`);
      logger.error('cp_worker.documento_fallo', { documentoId: d.id, err: msg(e) });
    }
  }
}

// ── Zombis (M3) ─────────────────────────────────────────────────────────────

async function cerrarZombis(deps: DepsWorker, r: ResultadoWorker): Promise<void> {
  if (!deps.cerrarZombis) return;
  try {
    const cerrados = await deps.cerrarZombis();
    if (cerrados === null) return;
    r.zombisCerrados = cerrados.length;
    if (cerrados.length > 0) logger.warn('cp_worker.zombis_cerrados', { cuantos: cerrados.length });
  } catch (e) {
    r.errores++;
    r.fallos.push(`zombis: ${msg(e)}`);
    logger.error('cp_worker.zombis_fallo', { err: msg(e) });
  }
}

// ── Avisar a la oficina ─────────────────────────────────────────────────────

/**
 * M1 (ronda 15): un archivo con varios embarques se partió y algunos hijos YA existían como documentos rechazados o fallidos
 * (se reabrieron) o ya resueltos pero purgados (no se vuelven a leer). Sin este aviso la oficina no se enteraba de que un
 * embarque volvió a la bandeja. Una vez por división: el padre queda `dividido` y no se vuelve a procesar. Mejor esfuerzo.
 */
async function avisarDivisionConPrevios(
  deps: DepsWorker, opts: OpcionesWorker, d: DocPendiente, embarques: number, reabiertos: number, sinArchivo: number, r: ResultadoWorker,
): Promise<void> {
  try {
    const tel = await deps.telefonoOficina(d.tenantId).catch(() => null);
    if (!tel) { r.sinTelefono++; logger.error('cp_worker.aviso_sin_telefono_de_oficina', { tenantId: d.tenantId, documentoId: d.id, tipo: 'division' }); return; }
    const doc = await deps.leer(d.tenantId, d.id);
    if (!doc) return;
    const liga = `${opts.urlBandeja}/${doc.id}`;
    const { texto, resumen } = armarAvisoDivision(doc, embarques, reabiertos, sinArchivo, liga);
    const envio = await deps.avisar(tel, texto, parametrosAvisoOficina('Carta Porte', resumen, liga), { agente: 'carta_porte', tenantId: d.tenantId, documentoId: d.id, tipo: 'division_con_previos' });
    r.divisionesAvisadas++;
    if (envio.ok || envio.reintentable || envio.encolado) {
      await deps.evento(d.tenantId, d.id, 'aviso_oficina', { tipo: 'division_con_previos', via: envio.ok ? envio.via : 'en_cola_outbox' }).catch(() => {});
    } else {
      r.fallos.push(`aviso division: ${envio.motivo.slice(0, 120)}`);
    }
  } catch (e) {
    r.errores++;
    r.fallos.push(`aviso division ${d.id.slice(0, 8)}: ${msg(e)}`);
    logger.error('cp_worker.aviso_division_fallo', { documentoId: d.id, err: msg(e) });
  }
}

export function armarAvisoDivision(doc: DocumentoFila, embarques: number, reabiertos: number, sinArchivo: number, liga: string): { texto: string; resumen: string } {
  const nombre = doc.nombreArchivo.length > 60 ? `${doc.nombreArchivo.slice(0, 59)}…` : doc.nombreArchivo;
  const partes: string[] = [];
  if (reabiertos > 0) partes.push(`${reabiertos} ${reabiertos === 1 ? 'embarque ya estaba en la bandeja rechazado o fallido y se reabrió' : 'embarques ya estaban en la bandeja rechazados o fallidos y se reabrieron'} para revisarse de nuevo`);
  if (sinArchivo > 0) partes.push(`${sinArchivo} ${sinArchivo === 1 ? 'ya estaba resuelto y su archivo se purgó' : 'ya estaban resueltos y sus archivos se purgaron'} (no se vuelve a leer)`);
  return {
    texto: [`📄 El archivo «${nombre}» traía ${embarques} embarques:`, `${partes.join('; ')}.`, `Revísalo aquí: ${liga}`].join(' '),
    resumen: 'Un archivo de Carta Porte repitió embarques ya conocidos',
  };
}

async function avisarOficinaDe(deps: DepsWorker, opts: OpcionesWorker, r: ResultadoWorker): Promise<void> {
  let presupuesto = TOPE_AVISOS_POR_PASADA;
  let rechazadosSeguidos = 0;
  const telefonos = new Map<string, string | null>();
  const telefonoDe = async (tenantId: string): Promise<string | null> => {
    if (!telefonos.has(tenantId)) telefonos.set(tenantId, await deps.telefonoOficina(tenantId).catch(() => null));
    return telefonos.get(tenantId) ?? null;
  };

  const lotes: Array<{ tipo: TipoAvisoDoc; lista: Array<{ tenantId: string; id: string }> | null }> = [];
  try {
    lotes.push({ tipo: 'agotado', lista: await deps.agotados(TOPE_AVISOS_POR_PASADA) });
    lotes.push({ tipo: 'hallazgos', lista: await deps.porAvisar(UMBRAL_CRITICO, TOPE_AVISOS_POR_PASADA) });
  } catch (e) {
    r.errores++;
    r.fallos.push(`avisos: ${msg(e)}`);
    logger.error('cp_worker.avisos_lista_fallo', { err: msg(e) });
    return;
  }

  for (const { tipo, lista } of lotes) {
    if (lista === null) { r.avisosSinMigracion = true; continue; }
    for (const d of lista) {
      if (presupuesto <= 0 || rechazadosSeguidos >= TOPE_AVISOS_RECHAZADOS_SEGUIDOS) return;
      if (deps.ahora() + 3_000 >= opts.venceEn) return;

      const tel = await telefonoDe(d.tenantId);
      if (!tel) {
        // Sin a quién avisar no se reclama el candado: cuando capturen el teléfono, el aviso sale.
        r.sinTelefono++;
        logger.error('cp_worker.aviso_sin_telefono_de_oficina', { tenantId: d.tenantId, documentoId: d.id, tipo });
        continue;
      }
      try {
        const doc = await deps.leer(d.tenantId, d.id);
        if (!doc) continue;
        const claim = await deps.reclamarAviso(d.tenantId, d.id, tipo);
        if (claim === 'perdido') { r.avisosPerdidos++; continue; }
        if (claim === 'sin_migracion') { r.avisosSinMigracion = true; return; }
        presupuesto--;

        const { texto, resumen } = armarAviso(tipo, doc, `${opts.urlBandeja}/${doc.id}`);
        const envio = await deps.avisar(tel, texto, parametrosAvisoOficina('Carta Porte', resumen, `${opts.urlBandeja}/${doc.id}`), {
          agente: 'carta_porte', tenantId: d.tenantId, documentoId: d.id, tipo,
        });
        if (tipo === 'agotado') r.agotados++; else r.hallazgos++;

        if (envio.ok) {
          rechazadosSeguidos = 0;
          r.avisosEnviados++;
          await deps.evento(d.tenantId, d.id, tipo === 'agotado' ? 'reintentos_agotados' : 'aviso_oficina', { tipo, via: envio.via }).catch(() => {});
        } else if (envio.reintentable || envio.encolado) {
          // YA está en `wa_outbox` (reintentable, o token vencido 190/401 que también se encola): el candado se queda
          // cerrado y NO se reenvía; cada pasada de 5 min lo encolaría otra vez y el outbox entregaría todas las copias.
          rechazadosSeguidos = 0;
          r.avisosEnCola++;
          await deps.evento(d.tenantId, d.id, tipo === 'agotado' ? 'reintentos_agotados' : 'aviso_oficina', { tipo, via: 'en_cola_outbox' }).catch(() => {});
          r.fallos.push(`aviso ${tipo}: ${envio.motivo.slice(0, 120)} (queda en la cola de WhatsApp; no se reenvía)`);
        } else {
          // Rechazo definitivo: no salió nada. Se suelta el candado para reintentar cuando se arregle (plantilla aprobada).
          rechazadosSeguidos++;
          r.avisosFallidos++;
          await deps.liberarAviso(d.tenantId, d.id, tipo);
          r.fallos.push(`aviso ${tipo}: ${envio.motivo.slice(0, 120)}`);
        }
      } catch (e) {
        r.errores++;
        r.fallos.push(`aviso ${tipo} ${d.id.slice(0, 8)}: ${msg(e)}`);
        logger.error('cp_worker.aviso_fallo', { documentoId: d.id, tipo, err: msg(e) });
      }
    }
  }
}

/** Cómo llegó el documento, para el aviso (el aviso de dudas cubre los tres canales, 0692). */
function canalTexto(canal: DocumentoFila['canal']): string {
  return canal === 'correo' ? 'correo' : canal === 'whatsapp' ? 'WhatsApp' : 'el panel';
}

/** El texto para la oficina: corto, accionable y SIN datos de los campos extraídos (solo conteos y el nombre del archivo). */
export function armarAviso(tipo: TipoAvisoDoc, doc: DocumentoFila, liga: string): { texto: string; resumen: string } {
  const nombre = doc.nombreArchivo.length > 60 ? `${doc.nombreArchivo.slice(0, 59)}…` : doc.nombreArchivo;
  if (tipo === 'agotado') {
    return {
      texto: [
        `⚠️ No pude leer el documento «${nombre}» que llegó por ${canalTexto(doc.canal)}.`,
        'Pide el archivo de nuevo o captura el viaje a mano.',
        `Detalle: ${liga}`,
      ].join(' '),
      resumen: 'No pude leer un documento de Carta Porte',
    };
  }
  const bloqueos = doc.validacion?.bloqueos ?? 0;
  const dudas: string[] = [];
  if (bloqueos > 0) dudas.push(`${bloqueos} ${bloqueos === 1 ? 'dato bloquea' : 'datos bloquean'} la aprobación`);
  if (doc.confianzaMin !== null && doc.confianzaMin < UMBRAL_CRITICO) dudas.push('hay datos con lectura poco segura');
  return {
    texto: [
      `📄 Llegó por ${canalTexto(doc.canal)} el documento «${nombre}» y necesita tu revisión antes de crear el viaje:`,
      `${dudas.join(' y ') || 'tiene datos por confirmar'}.`,
      `Revísalo aquí: ${liga}`,
    ].join(' '),
    resumen: 'Documento de Carta Porte por revisar',
  };
}
