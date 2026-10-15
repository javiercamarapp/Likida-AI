// ═══════════════════════════════════════════════════════════════════════════
// EL WORKER DE ENVÍOS AL TMS (T-A3-28) — la segunda pasada del cron `carta-porte-docs`.
//
// Qué resuelve (33c4d51b 17:56–20:16): «el agente va a estar escuchando… lo va a generar y lo va a subir al TMS, todo
// automático». El documento que la oficina aprobó dejó un envío en `cp_envio_tms` (T-A3-04); aquí se reclama, se
// pre-chequea, se arma la plantilla y se SUBE por el puerto `SalidaTms`. La decisión de qué estado sigue es la máquina
// pura (`envio_estados.ts`); el acceso a datos, el repo de envíos (`repo_envios.ts`); este archivo solo las junta.
//
//   reclamar(≤10) → releer envío y documento → (versión cambió / ya no está aprobado ⇒ `descartado`)
//     → pendiente_prechequeo / pendiente_reque: prechequear (cliente, caja, reque) → listo | pendiente_reque | revisar
//     → listo / error_transitorio: armar plantilla, sha256, `enviando`, UN `cargarPlantilla` con la llave de idempotencia
//     → resultado: enviado | pendiente_reque | error_transitorio | rechazado_tms (+ evento y, si toca, la alerta única).
//
// ── MODO MANUAL ─────────────────────────────────────────────────────────────
// `cp_salida_config.modo === 'descarga'`, o una flota sin conector (`SIN_TMS`): no se consulta ni se sube nada. El envío
// llega a `listo` (si no tiene bloqueos) y ahí espera a que una persona descargue la plantilla y la suba a mano. No se
// reintenta: se vuelve a mirar cada `ESPERA_LISTO_MANUAL_MIN` solo para no perderlo si la flota pasa a modo API.
//
// ── IDEMPOTENCIA Y LEASE ────────────────────────────────────────────────────
// La llave es `envio.idempotencyKey` (sha256 de flota|documento|versión|plantilla). Un envío en `enviando` cuyo lease
// venció (la pasada murió entre el POST y guardar el resultado) se recupera REENVIANDO con la MISMA llave: el TMS (o su
// adaptador) contesta `duplicado:true` y el envío queda `enviado` sin segundo efecto. Dos pasadas solapadas no reciben el
// mismo envío (lease de la base); si un UPDATE condicional pierde la carrera, esa pasada no escribe nada.
//
// ── EL +1 DEL RECLAMO ───────────────────────────────────────────────────────
// `cp_envio_reclamar` suma 1 a `intentos` al reclamar. La máquina cuenta `intentos` POR FASE (prechequeos fallidos,
// fallos transitorios) y el resultado que ella devuelve es el valor ABSOLUTO que se escribe; por eso aquí se le entrega
// `intentos - 1` (se deshace el +1 del reclamo) y, al soltar un envío sin tocarlo, se escribe ese mismo valor.
//
// ── CIRCUITO ────────────────────────────────────────────────────────────────
// `TOPE_FALLOS_TMS_SEGUIDOS` fallos transitorios SEGUIDOS de una flota abren su circuito en esta pasada: no se manda
// nada más a ESE TMS (los envíos restantes de la flota se sueltan sin gastarles un intento) y se alerta al operador UNA
// vez. Un `auth` (credencial caducada) lo abre de inmediato: cada llamada fallaría igual. Otras flotas siguen.
//
// No timbra, no crea viajes y no importa nada del camino del timbre. Todo entra por `DepsEnvios`: se prueba con dobles.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import { logger } from '@/lib/logger';
import { aXlsxPlantillaTms, MIME_XLSX } from './exportacion';
import { siguienteEstado, TOPE_TRANSITORIOS, type EnvioEnMaquina, type EventoEnvio, type MotivoAlerta, type Transicion } from './envio_estados';
import { prechequear } from './prechequeo';
import { construirPlantilla } from './plantilla_tms';
import type { DocumentoFila, EstadoEnvioTms, TipoEvento } from './repo';
import type { CambiosEnvio, EnvioDetalle, EnvioReclamado, ResultadoReclamo } from './repo_envios';
import type { ConfigSalida } from './salida_config';
import { SIN_TMS, type EntradaCarga, type ResultadoCarga, type SalidaTms } from './tms_puerto';

/** Envíos que toma una pasada (la subida de cada uno es una llamada de red: pocos y bien hechos). */
export const TOPE_ENVIOS_POR_PASADA = 10;
/** Fallos transitorios SEGUIDOS de una misma flota que abren su circuito en la pasada (patrón `TOPE_FALLOS_MODELO_SEGUIDOS`). */
export const TOPE_FALLOS_TMS_SEGUIDOS = 4;
/** Reloj que debe sobrar para empezar una subida: la llamada tiene su propio tope y falta el guardado del resultado. */
export const MARGEN_ENVIO_MS = 25_000;
/** Tope de una llamada `cargarPlantilla` (se acorta al reloj restante). */
export const TIMEOUT_CARGA_MS = 20_000;
/** Cada cuánto se vuelve a mirar un envío `listo` que espera la subida manual (6 h): no ocupa el reclamo de cada pasada. */
export const ESPERA_LISTO_MANUAL_MIN = 360;
/** «Nadie lo reclama más»: el reclamo de la base trata `proxima_revision` NULA como «ya le toca», así que lo agotado se aparta con una fecha lejana. */
export const SIN_MAS_REVISIONES = '9999-12-31T00:00:00.000Z';

const VIVOS: ReadonlyArray<EstadoEnvioTms> = ['pendiente_prechequeo', 'pendiente_reque', 'listo', 'error_transitorio', 'enviando'];

export interface DepsEnvios {
  reclamar(limite: number): Promise<ResultadoReclamo>;
  leerEnvio(tenantId: string, id: string): Promise<EnvioDetalle | null>;
  /** UPDATE condicional por estado de origen; `false` = otra pasada ya lo movió. */
  actualizarEnvio(tenantId: string, id: string, desde: EstadoEnvioTms[], cambios: CambiosEnvio): Promise<boolean>;
  marcarAlerta(tenantId: string, id: string): Promise<'ganado' | 'perdido' | 'sin_migracion'>;
  liberarAlerta(tenantId: string, id: string): Promise<boolean>;
  leerDocumento(tenantId: string, id: string): Promise<DocumentoFila | null>;
  leerConfig(tenantId: string): Promise<ConfigSalida>;
  /** El puerto de ESA flota. `SIN_TMS` si no tiene conector (modo manual). */
  salida(tenantId: string): Promise<SalidaTms>;
  /** La bitácora del documento: un fallo se LANZA (sin rastro no hay operación). */
  evento(tenantId: string, documentoId: string, tipo: TipoEvento, detalle: Record<string, unknown>): Promise<void>;
  /** El documento vuelve a «por revisar» con el motivo (no hay nada que enviar hasta que una persona lo corrija). */
  devolverARevision(tenantId: string, documentoId: string, versionDoc: number, motivo: string): Promise<void>;
  /** El aviso de la alerta única de UN envío (reque agotado, rechazo, transitorios agotados). T-A3-30 lo lleva a la oficina. */
  alertarEnvio(a: { tenantId: string; envioId: string; documentoId: string; motivo: MotivoAlerta; destinatario: string; mensaje: string }): Promise<void>;
  /** Alerta de infraestructura al operador del sistema (nunca lanza). */
  alertarOperador(evento: string, detalle: Record<string, unknown>): Promise<unknown>;
  ahora(): number;
  senal?(ms: number): AbortSignal | undefined;
}

export interface OpcionesEnvios {
  /** `Date.now()` a partir del cual no se empieza ninguna subida (el mismo reloj que el de la extracción). */
  venceEn: number;
  limite?: number;
}

export interface ResultadoEnvios {
  /** La base no tiene la 0790: la salida queda apagada sin romper el cron. */
  sinMigracion: boolean;
  reclamados: number;
  enviados: number;
  /** Subidas que el TMS reconoció como ya recibidas (recuperación de un lease vencido). */
  duplicados: number;
  /** Quedaron esperando el requerimiento. */
  pendientesReque: number;
  /** Quedaron `listo`, esperando la subida a mano (modo descarga o flota sin conector). */
  enEsperaManual: number;
  /** Fallo transitorio: se reintenta con espera creciente. */
  reintentos: number;
  rechazados: number;
  /** El envío ya no valía (documento cambiado, no aprobado o inexistente). */
  descartados: number;
  devueltosARevision: number;
  alertas: number;
  alertasFallidas: number;
  circuitosAbiertos: number;
  credencialesCaducadas: number;
  /** Soltados sin intentar (circuito abierto o reloj). */
  soltados: number;
  cortadosPorReloj: number;
  /** El UPDATE condicional perdió: otra pasada o una persona movió el envío. */
  conflictos: number;
  errores: number;
  fallos: string[];
}

export const resultadoEnviosVacio = (): ResultadoEnvios => ({
  sinMigracion: false, reclamados: 0, enviados: 0, duplicados: 0, pendientesReque: 0, enEsperaManual: 0, reintentos: 0, rechazados: 0, descartados: 0,
  devueltosARevision: 0, alertas: 0, alertasFallidas: 0, circuitosAbiertos: 0, credencialesCaducadas: 0, soltados: 0, cortadosPorReloj: 0, conflictos: 0,
  errores: 0, fallos: [],
});

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 200);
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const iso = (ms: number): string => new Date(ms).toISOString();

interface Circuito { fallos: number; abierto: boolean }

interface Contexto {
  deps: DepsEnvios;
  opts: OpcionesEnvios;
  r: ResultadoEnvios;
  circuitos: Map<string, Circuito>;
  /** Una lectura de config y de puerto por flota y pasada. */
  config: Map<string, ConfigSalida>;
  puertos: Map<string, SalidaTms>;
}

/** La pasada completa de envíos. NUNCA lanza por un envío: cada uno se aísla; solo las lecturas de la cola suben. */
export async function correrWorkerEnvios(deps: DepsEnvios, opts: OpcionesEnvios): Promise<ResultadoEnvios> {
  const r = resultadoEnviosVacio();
  // Sin reloj para siquiera empezar una subida: ni se reclama (un lease que nadie usa retrasa al envío para la pasada siguiente).
  if (deps.ahora() + MARGEN_ENVIO_MS >= opts.venceEn) { r.cortadosPorReloj = 1; return r; }

  const reclamo = await deps.reclamar(Math.min(opts.limite ?? TOPE_ENVIOS_POR_PASADA, TOPE_ENVIOS_POR_PASADA));
  if (!reclamo.ok) { r.sinMigracion = true; return r; }
  r.reclamados = reclamo.envios.length;

  const ctx: Contexto = { deps, opts, r, circuitos: new Map(), config: new Map(), puertos: new Map() };
  for (const rec of reclamo.envios) {
    try {
      await procesarEnvio(ctx, rec);
    } catch (e) {
      // La base o la bitácora fallaron en ESTE envío: no tumba el lote. El lease vence solo y se reintenta.
      r.errores++;
      r.fallos.push(`envío ${rec.id.slice(0, 8)}: ${msg(e)}`);
      logger.error('cp_envios.envio_fallo', { envioId: rec.id, err: msg(e) });
    }
  }
  return r;
}

// ── Un envío ────────────────────────────────────────────────────────────────

const circuitoDe = (ctx: Contexto, tenantId: string): Circuito => {
  let c = ctx.circuitos.get(tenantId);
  if (!c) { c = { fallos: 0, abierto: false }; ctx.circuitos.set(tenantId, c); }
  return c;
};

async function procesarEnvio(ctx: Contexto, rec: EnvioReclamado): Promise<void> {
  const { deps, r } = ctx;
  const { tenantId } = rec;
  const envio = await deps.leerEnvio(tenantId, rec.id);
  if (!envio || !VIVOS.includes(envio.estado)) return; // otra pasada o una persona lo movió después del reclamo

  const documento = await deps.leerDocumento(tenantId, envio.documentoId);
  const invalido = motivoInvalido(documento, envio);
  if (invalido) { await descartar(ctx, envio, documento, invalido); return; }
  const doc = documento as DocumentoFila & { extraccion: NonNullable<DocumentoFila['extraccion']> };

  const config = await configDe(ctx, tenantId);
  const salida = await puertoDe(ctx, tenantId);
  const manual = config.modo === 'descarga' || salida === SIN_TMS;
  const ahora = new Date(deps.ahora());
  const intentosFase = Math.max(0, envio.intentos - 1);
  // Bloqueos abiertos: sin validación no se sabe, y lo que no se sabe no se envía.
  const bloqueos = doc.validacion ? doc.validacion.bloqueos : 1;
  const enMaquina = (estado: EstadoEnvioTms, intentos = intentosFase): EnvioEnMaquina => ({
    estado, intentos, alertaEnviada: envio.alertaEnviadaEn !== null, bloqueosAbiertos: bloqueos,
    agotado: (estado === 'pendiente_reque' && intentos > config.reintentosMax) || (estado === 'error_transitorio' && intentos > TOPE_TRANSITORIOS),
  });

  let estado: EstadoEnvioTms = envio.estado;

  // 1) Pre-chequeo (o aparición del reque): decide si el envío ya puede salir.
  if (estado === 'pendiente_prechequeo' || estado === 'pendiente_reque') {
    const ya = estado;
    let evento: EventoEnvio;
    let base = enMaquina(ya);
    let causa: string | null = null;
    if (manual) {
      evento = ya === 'pendiente_prechequeo' ? { tipo: 'prechequeo', accion: 'enviar' } : { tipo: 'reque_aparecio' };
    } else {
      const pre = await prechequear(doc.extraccion, { tenantId, salida, siTmsDesconocido: config.siTmsDesconocido });
      if (pre.accion === 'enviar') evento = ya === 'pendiente_prechequeo' ? { tipo: 'prechequeo', accion: 'enviar' } : { tipo: 'reque_aparecio' };
      else if (pre.accion === 'pendiente_reque') { causa = pre.motivo; evento = ya === 'pendiente_prechequeo' ? { tipo: 'prechequeo', accion: 'pendiente_reque', motivo: pre.motivo } : { tipo: 'reque_sigue_ausente' }; }
      else { evento = { tipo: 'prechequeo', accion: 'revisar', motivo: pre.motivo }; base = { ...base, estado: 'pendiente_prechequeo' }; }
    }
    const t = siguienteEstado(base, evento, config, ahora);
    if (!t.ok) { await soltar(ctx, envio, ya, intentosFase); r.fallos.push(`envío ${envio.id.slice(0, 8)}: ${t.razon}`); return; }
    // Si queda `listo` y se va a subir ahora, el lease se conserva; si no, se suelta.
    const seguirAEnviar = t.estado === 'listo' && !manual;
    const cambios = cambiosDe(t, { causa, soltar: !seguirAEnviar });
    if (t.estado === 'listo' && manual) cambios.proximaRevision = iso(deps.ahora() + ESPERA_LISTO_MANUAL_MIN * 60_000);
    if (!(await deps.actualizarEnvio(tenantId, envio.id, [ya], cambios))) { r.conflictos++; return; }
    await registrarTransicion(ctx, envio, doc, ya, t, causa, manual);
    if (!seguirAEnviar) return;
    estado = 'listo';
  } else if (manual) {
    // 2a) `listo` en modo manual: espera la subida a mano. Se vuelve a mirar mucho más tarde, sin reintentos.
    // Lo que no es `listo` (un transitorio o un `enviando` de cuando la flota tenía conector) no se toca: solo se aparta.
    if (estado === 'listo') {
      const ok = await deps.actualizarEnvio(tenantId, envio.id, ['listo'], { intentos: 0, proximaRevision: iso(deps.ahora() + ESPERA_LISTO_MANUAL_MIN * 60_000), soltarLease: true });
      if (ok) r.enEsperaManual++; else r.conflictos++;
    } else {
      await soltar(ctx, envio, estado, intentosFase, iso(deps.ahora() + ESPERA_LISTO_MANUAL_MIN * 60_000));
    }
    return;
  }

  // 2b) Subida.
  await subir(ctx, { envio, doc, config, salida, estado, enMaquina, intentosFase });
}

// ── La subida ───────────────────────────────────────────────────────────────

interface EntradaSubida {
  envio: EnvioDetalle;
  doc: DocumentoFila & { extraccion: NonNullable<DocumentoFila['extraccion']> };
  config: ConfigSalida;
  salida: SalidaTms;
  estado: EstadoEnvioTms;
  enMaquina: (estado: EstadoEnvioTms, intentos?: number) => EnvioEnMaquina;
  intentosFase: number;
}

async function subir(ctx: Contexto, e: EntradaSubida): Promise<void> {
  const { deps, r, opts } = ctx;
  const { envio, doc, config, salida } = e;
  const { tenantId } = envio;
  const circuito = circuitoDe(ctx, tenantId);
  const intentosActuales = e.estado === 'listo' ? 0 : e.intentosFase;

  if (circuito.abierto) { await soltar(ctx, envio, e.estado, intentosActuales); return; }
  if (deps.ahora() + MARGEN_ENVIO_MS >= opts.venceEn) { r.cortadosPorReloj++; await soltar(ctx, envio, e.estado, intentosActuales); return; }

  // Armado: puro y determinista (mismo documento ⇒ mismos bytes ⇒ mismo sha256).
  const plantilla = construirPlantilla(doc.extraccion, { clienteInterno: null, plantilla: envio.plantilla });
  const archivo = aXlsxPlantillaTms(plantilla);
  const huella = sha256(archivo);

  // `listo`/`error_transitorio` ⇒ `enviando` (la máquina vuelve a revisar los bloqueos). Un `enviando` reclamado es la
  // recuperación de un lease vencido: ya está en el estado correcto y se reenvía con la MISMA llave.
  if (e.estado !== 'enviando') {
    const t = siguienteEstado(e.enMaquina(e.estado, intentosActuales), { tipo: 'iniciar_envio' }, config, new Date(deps.ahora()));
    if (!t.ok) { await soltar(ctx, envio, e.estado, intentosActuales); r.fallos.push(`envío ${envio.id.slice(0, 8)}: ${t.razon}`); return; }
    const cambios = cambiosDe(t, { causa: null, soltar: t.estado !== 'enviando' });
    if (t.estado === 'enviando') cambios.plantillaSha256 = huella;
    if (!(await deps.actualizarEnvio(tenantId, envio.id, [e.estado], cambios))) { r.conflictos++; return; }
    if (t.estado !== 'enviando') { await registrarTransicion(ctx, envio, doc, e.estado, t, null, false); return; }
  }

  const entrada: EntradaCarga = {
    tenantId, idempotencyKey: envio.idempotencyKey, archivo, nombre: nombreArchivo(doc, envio), mime: MIME_XLSX, plantilla: envio.plantilla,
    metadatos: { clienteInterno: doc.extraccion.campos.numero_cliente_interno?.valor ?? null, folio: doc.extraccion.campos.folio_cliente?.valor ?? null },
  };
  let res: ResultadoCarga;
  try {
    const restante = opts.venceEn - deps.ahora() - 5_000;
    res = await salida.cargarPlantilla(entrada, deps.senal?.(Math.max(1_000, Math.min(TIMEOUT_CARGA_MS, restante))));
  } catch (err) {
    // Un puerto que LANZA (red, timeout, abortado) es un fallo transitorio: el detalle va al log, no a la base.
    logger.warn('cp_envios.carga_lanzo', { envioId: envio.id, err: msg(err) });
    res = { ok: false, clase: 'transitorio', mensajeLlano: 'El sistema del cliente no respondió.', errores: [] };
  }
  await aplicarResultado(ctx, e, res, huella);
}

async function aplicarResultado(ctx: Contexto, e: EntradaSubida, res: ResultadoCarga, huella: string): Promise<void> {
  const { deps, r } = ctx;
  const { envio, doc, config } = e;
  const { tenantId } = envio;
  const circuito = circuitoDe(ctx, tenantId);
  const ahora = new Date(deps.ahora());
  const enviando = e.enMaquina('enviando', e.estado === 'listo' ? 0 : e.intentosFase);

  if (res.ok) {
    circuito.fallos = 0;
    const t = siguienteEstado(enviando, { tipo: 'resultado_envio', resultado: 'enviado' }, config, ahora);
    if (!t.ok) throw new Error(t.razon);
    const cambios: CambiosEnvio = {
      ...cambiosDe(t, { causa: null, soltar: true }), enviadoEn: iso(deps.ahora()), referenciaTms: res.referencia, plantillaSha256: huella, errores: [], ultimoError: null,
    };
    if (!(await deps.actualizarEnvio(tenantId, envio.id, ['enviando'], cambios))) {
      // El TMS lo recibió pero el envío ya no está `enviando` (p. ej. alguien lo marcó «subido a mano»): se deja constancia.
      r.conflictos++;
      await deps.evento(tenantId, doc.id, 'envio_error', { envioId: envio.id, causa: 'enviado_pero_estado_cambio', versionDoc: doc.version });
      return;
    }
    r.enviados++;
    if (res.duplicado) r.duplicados++;
    await deps.evento(tenantId, doc.id, 'envio_enviado', { envioId: envio.id, versionDoc: doc.version, duplicado: res.duplicado });
    return;
  }

  switch (res.clase) {
    case 'transitorio': {
      circuito.fallos++;
      const t = siguienteEstado(enviando, { tipo: 'resultado_envio', resultado: 'transitorio' }, config, ahora);
      if (!t.ok) throw new Error(t.razon);
      const cambios = cambiosDe(t, { causa: null, soltar: true });
      cambios.ultimoError = { codigo: 'transitorio' };
      cambios.plantillaSha256 = huella;
      // El TMS puede pedir esperar más que el backoff; nunca menos.
      if (t.proximaRevision && res.reintentarEnMs !== undefined && res.reintentarEnMs > 0) {
        cambios.proximaRevision = iso(Math.max(t.proximaRevision.getTime(), deps.ahora() + res.reintentarEnMs));
      }
      if (!(await deps.actualizarEnvio(tenantId, envio.id, ['enviando'], cambios))) { r.conflictos++; return; }
      r.reintentos++;
      await deps.evento(tenantId, doc.id, 'envio_error', { envioId: envio.id, clase: 'transitorio', intentos: t.intentos, agotado: t.agotado });
      await alertaDeLaMaquina(ctx, envio, doc, t);
      if (circuito.fallos >= TOPE_FALLOS_TMS_SEGUIDOS && !circuito.abierto) await abrirCircuito(ctx, tenantId, 'cp_tms_circuito_abierto', `El sistema del cliente falló ${circuito.fallos} veces seguidas: se detuvieron los envíos de esta pasada.`);
      return;
    }
    case 'auth': {
      // Credencial caducada: no es culpa del documento ni se reintenta en esta pasada. El envío vuelve a `listo` sin gastar intentos
      // y se retoma cuando alguien renueve la credencial; el operador se entera (la alerta ya tiene su piso de una hora).
      const cambios: CambiosEnvio = {
        estado: 'listo', intentos: 0, proximaRevision: iso(deps.ahora() + config.frecuenciaMin * 60_000), plantillaSha256: huella,
        ultimoError: { codigo: 'auth' }, soltarLease: true,
      };
      if (!(await deps.actualizarEnvio(tenantId, envio.id, ['enviando'], cambios))) { r.conflictos++; return; }
      r.credencialesCaducadas++;
      await deps.evento(tenantId, doc.id, 'envio_error', { envioId: envio.id, clase: 'auth' });
      if (!circuito.abierto) await abrirCircuito(ctx, tenantId, 'cp_tms_credencial', 'Las credenciales del sistema del cliente no son válidas (¿caducaron?): no se envía nada hasta renovarlas.');
      return;
    }
    case 'reque_inexistente': {
      // El TMS contestó bien: no es un fallo de red. Vuelve a esperar el requerimiento, como si el pre-chequeo lo hubiera dicho.
      circuito.fallos = 0;
      const t = siguienteEstado(e.enMaquina('pendiente_prechequeo', 0), { tipo: 'prechequeo', accion: 'pendiente_reque', motivo: 'El requerimiento no existe en el sistema del cliente.' }, config, ahora);
      if (!t.ok) throw new Error(t.razon);
      const cambios = cambiosDe(t, { causa: 'El requerimiento no existe en el sistema del cliente.', soltar: true });
      cambios.plantillaSha256 = huella;
      if (!(await deps.actualizarEnvio(tenantId, envio.id, ['enviando'], cambios))) { r.conflictos++; return; }
      r.pendientesReque++;
      await deps.evento(tenantId, doc.id, 'envio_pendiente_reque', { envioId: envio.id, intentos: t.intentos, origen: 'respuesta_del_tms' });
      await alertaDeLaMaquina(ctx, envio, doc, t);
      return;
    }
    default: {
      // validacion | duplicado_distinto | permanente: el TMS contestó que NO. Una persona corrige y reaprueba (envío nuevo).
      circuito.fallos = 0;
      const t = siguienteEstado(enviando, { tipo: 'resultado_envio', resultado: 'rechazado' }, config, ahora);
      if (!t.ok) throw new Error(t.razon);
      const cambios = cambiosDe(t, { causa: null, soltar: true });
      cambios.plantillaSha256 = huella;
      cambios.errores = res.errores; // `sanearErrores` (repo) deja solo hoja/fila/campo/código: jamás el valor ni el texto libre
      cambios.ultimoError = { codigo: res.clase };
      if (!(await deps.actualizarEnvio(tenantId, envio.id, ['enviando'], cambios))) { r.conflictos++; return; }
      r.rechazados++;
      await deps.evento(tenantId, doc.id, 'envio_rechazado', { envioId: envio.id, clase: res.clase, errores: res.errores.length });
      await alertaDeLaMaquina(ctx, envio, doc, t);
      return;
    }
  }
}

// ── Piezas ──────────────────────────────────────────────────────────────────

function nombreArchivo(doc: DocumentoFila, envio: EnvioDetalle): string {
  return `plantilla-tms-${doc.id.slice(0, 8)}-v${envio.versionDoc}.xlsx`;
}

/** Por qué este envío ya no vale (nunca se envía un documento cambiado, no aprobado o sin lectura). `null` = vale. */
function motivoInvalido(doc: DocumentoFila | null, envio: EnvioDetalle): string | null {
  if (!doc) return 'documento_inexistente';
  if (doc.estado !== 'aprobado') return 'documento_no_aprobado';
  if (doc.version !== envio.versionDoc) return 'version_cambio';
  if (!doc.extraccion) return 'sin_extraccion';
  return null;
}

async function descartar(ctx: Contexto, envio: EnvioDetalle, doc: DocumentoFila | null, causa: string): Promise<void> {
  const { deps, r } = ctx;
  const ok = await deps.actualizarEnvio(envio.tenantId, envio.id, [envio.estado], { estado: 'descartado', proximaRevision: null, soltarLease: true });
  if (!ok) { r.conflictos++; return; }
  r.descartados++;
  if (doc) await deps.evento(envio.tenantId, doc.id, 'envio_error', { envioId: envio.id, causa, versionDoc: envio.versionDoc, versionActual: doc.version });
}

/** Suelta un envío SIN procesarlo: devuelve el lease y deshace el +1 del reclamo (`intentos`). `desde` = el estado en que está AHORA en la base. */
async function soltar(ctx: Contexto, envio: EnvioDetalle, desde: EstadoEnvioTms, intentos: number, proximaRevision?: string): Promise<void> {
  const cambios: CambiosEnvio = { intentos, soltarLease: true };
  if (proximaRevision !== undefined) cambios.proximaRevision = proximaRevision;
  if (await ctx.deps.actualizarEnvio(envio.tenantId, envio.id, [desde], cambios)) ctx.r.soltados++;
}

/** Los campos que se escriben para una transición de la máquina. */
function cambiosDe(t: Extract<Transicion, { ok: true }>, o: { causa: string | null; soltar: boolean }): CambiosEnvio {
  const proxima = t.proximaRevision ? t.proximaRevision.toISOString() : (t.agotado ? SIN_MAS_REVISIONES : null);
  return {
    estado: t.estado, intentos: t.intentos, proximaRevision: proxima, causaPendiente: t.estado === 'pendiente_reque' ? o.causa : null,
    soltarLease: o.soltar,
  };
}

/** Eventos y efectos de una transición del prechequeo (o del reque). La alerta única se decide aquí y se cobra con el candado. */
async function registrarTransicion(ctx: Contexto, envio: EnvioDetalle, doc: DocumentoFila, desde: EstadoEnvioTms, t: Extract<Transicion, { ok: true }>, causa: string | null, manual: boolean): Promise<void> {
  const { deps, r } = ctx;
  const { tenantId } = envio;
  if (t.devolverDocumento) {
    r.descartados++;
    r.devueltosARevision++;
    await deps.devolverARevision(tenantId, doc.id, doc.version, t.devolverDocumento.motivo);
    await deps.evento(tenantId, doc.id, 'envio_error', { envioId: envio.id, causa: 'devuelto_a_revision', versionDoc: doc.version });
    return;
  }
  if (t.estado === 'pendiente_reque') {
    r.pendientesReque++;
    // Un evento por cambio de fase y otro al agotar: no uno por cada revisión periódica.
    if (desde !== 'pendiente_reque' || t.agotado) {
      await deps.evento(tenantId, doc.id, 'envio_pendiente_reque', { envioId: envio.id, intentos: t.intentos, agotado: t.agotado, causa });
    }
    await alertaDeLaMaquina(ctx, envio, doc, t);
    return;
  }
  if (t.estado === 'listo' && desde === 'pendiente_reque') {
    // El reque apareció: el envío sigue su camino (la subida deja su propio evento).
    logger.info('cp_envios.reque_aparecio', { envioId: envio.id });
  }
  if (t.estado === 'listo' && manual) r.enEsperaManual++;
}

/** Si la máquina pidió la alerta única: toma el candado (la base decide quién avisa), avisa y deja el evento. */
async function alertaDeLaMaquina(ctx: Contexto, envio: EnvioDetalle, doc: DocumentoFila, t: Extract<Transicion, { ok: true }>): Promise<void> {
  if (!t.alerta) return;
  const { deps, r } = ctx;
  const { tenantId } = envio;
  const candado = await deps.marcarAlerta(tenantId, envio.id);
  if (candado !== 'ganado') return; // 'perdido' = ya se avisó; 'sin_migracion' = sin candado atómico no se avisa (se repetiría)
  try {
    await deps.alertarEnvio({
      tenantId, envioId: envio.id, documentoId: doc.id, motivo: t.alerta.motivo, destinatario: t.alerta.destinatario,
      mensaje: t.mensaje ?? 'El envío al sistema del cliente necesita atención.',
    });
    r.alertas++;
    await deps.evento(tenantId, doc.id, 'envio_alertado', { envioId: envio.id, motivo: t.alerta.motivo });
  } catch (e) {
    // El aviso NO salió: se suelta el candado para que una pasada futura pueda avisar (la máquina lo vuelve a pedir si sigue vigente).
    r.alertasFallidas++;
    r.fallos.push(`alerta ${envio.id.slice(0, 8)}: ${msg(e)}`);
    await deps.liberarAlerta(tenantId, envio.id).catch(() => false);
  }
}

async function abrirCircuito(ctx: Contexto, tenantId: string, codigo: string, error: string): Promise<void> {
  const c = circuitoDe(ctx, tenantId);
  c.abierto = true;
  ctx.r.circuitosAbiertos++;
  logger.error('cp_envios.circuito_abierto', { tenantId, codigo });
  await ctx.deps.alertarOperador('cron.carta_porte_salida', { error, codigo, tenantId });
}

async function configDe(ctx: Contexto, tenantId: string): Promise<ConfigSalida> {
  let c = ctx.config.get(tenantId);
  if (!c) { c = await ctx.deps.leerConfig(tenantId); ctx.config.set(tenantId, c); }
  return c;
}

async function puertoDe(ctx: Contexto, tenantId: string): Promise<SalidaTms> {
  let p = ctx.puertos.get(tenantId);
  if (!p) { p = await ctx.deps.salida(tenantId); ctx.puertos.set(tenantId, p); }
  return p;
}
