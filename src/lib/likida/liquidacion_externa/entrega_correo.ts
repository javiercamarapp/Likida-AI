// ═══════════════════════════════════════════════════════════════════════════
// ENTREGA DEL DESGLOSE POR CORREO (T-A1-16): reclamar → enviar con Resend → anotar el estado → reintentar.
//
// Una fila de `liquidacion_entrega_correo` es UN destinatario de UNA generación de UN desglose. Este servicio la saca de la
// cola (lease atómico, `reclamarEntregas`), arma un correo SOBRIO con el .xlsx adjunto y anota el resultado.
//
// Reglas que garantiza (cada una tiene su prueba):
//   · Asunto y cuerpo NUNCA llevan importes ni el nombre de la flota: el dato va solo en el adjunto.
//   · Idempotencia fuerte: la `Idempotency-Key` es `liqcorreo:<liquidación>:g<generación>:<rol>`, estable entre reintentos
//     (Resend la respeta 24 h). Una fila reclamada que YA trae `resend_id`, o cuyo intento previo quedó ambiguo (red caída
//     mientras se enviaba) y ya pasó la vigencia de la llave, NO se reenvía sola: pasa a `fallida` «sin confirmar» para que
//     una persona decida (un doble envío de un pago no se arregla).
//   · Reintento: 429/5xx/red/descarga fallida ⇒ vuelve a `pendiente` con espera 2/4/8/16 min; al 5.º intento, `fallida`.
//   · 400/422 y demás 4xx del destinatario ⇒ `fallida` sin reintento + excepción para la oficina.
//   · 401/403 (llave o dominio sin verificar) no es culpa del destinatario: la fila NO gasta intento, se queda `pendiente` y
//     el resumen lo reporta como «correo no configurado». Igual `sin_configurar`. Jamás se dice «enviado» sin que Resend acepte.
//   · `enviar_desde_hora` (hora de México): antes de esa hora la fila se libera sin gastar intento.
//   · Primer destinatario aceptado del rol `operador` ⇒ la liquidación pasa de `pendiente` a `enviada` (transición condicional).
//   · Los logs llevan el correo enmascarado (`a***@dominio`), nunca completo.
// ═══════════════════════════════════════════════════════════════════════════

import { hoyMx } from '@/lib/formato';
import { createHash } from 'node:crypto';
import { logger } from '@/lib/logger';
import { enviarCorreo, type OpcionesEnvio, type ResultadoEnvio } from '@/lib/correo/enviar';
import type { Correo } from '@/lib/correo/plantilla';
import { aInstanteMx } from '../peajes/formatos';
import { leerPorId, registrarEvento, transicionar, type TipoEvento } from './repo';
import {
  abrirExcepcion, firmarXlsx, leerConfigCorreo, leerDesglose, marcarEnviada, marcarFallida, reclamarEntregas, reprogramarEntrega,
  CONFIG_CORREO_POR_DEFECTO,
  type ConfigCorreo, type EntregaCorreo, type TipoExcepcion,
} from './repo_correo';

// ── Constantes ──────────────────────────────────────────────────────────────

/** Al 5.º intento fallido la entrega pasa a `fallida`. */
export const MAX_INTENTOS_CORREO = 5;
/** Lote por pasada del cron (maxDuration = 60 s). El resto sale en la siguiente. */
export const LIMITE_POR_PASADA = 25;
/** Presupuesto de tiempo de una pasada: lo que no alcance se libera sin gastar intento. */
const PRESUPUESTO_MS = 40_000;
/** Vigencia de la `Idempotency-Key` en Resend, con 1 h de margen. */
const VIGENCIA_LLAVE_MS = 23 * 3_600_000;
const ESPERA_CONFIG_MS = 15 * 60_000;
const MARCA_AMBIGUO = 'ambiguo:';
const TIPO_XLSX_CORREO = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ── Puertos ─────────────────────────────────────────────────────────────────

/** Quién envía de verdad. Por omisión Resend (`enviarCorreo`); T-A1-27 aporta SMTP/Graph del cliente. */
export type EnvioCorreoPuerto = (para: string, correo: Correo, op: OpcionesEnvio) => Promise<ResultadoEnvio>;

export interface ContextoLiquidacion {
  claveExterna: string; periodoDesde: string; periodoHasta: string;
  /** A37-A1-liquidaciones-10: la bitácora REAL del desglose (`liquidacion_desglose.bitacora`). Sin ella se infiere de la clave. */
  bitacora?: string;
}

export interface DependenciasEntregaCorreo {
  ahora: () => Date;
  enviar: EnvioCorreoPuerto;
  leerConfig: (tenantId: string) => Promise<ConfigCorreo>;
  reclamar: (limite: number, ahora: Date) => Promise<EntregaCorreo[]>;
  leerContexto: (tenantId: string, liquidacionId: string) => Promise<ContextoLiquidacion | null>;
  descargarXlsx: (tenantId: string, ruta: string) => Promise<Uint8Array>;
  marcarEnviada: (tenantId: string, id: string, claimToken: string, resendId: string, ahora: Date) => Promise<boolean>;
  marcarFallida: (tenantId: string, id: string, claimToken: string | null, error: string) => Promise<boolean>;
  reprogramar: (tenantId: string, id: string, claimToken: string, intentos: number, proximo: Date, error: string | null) => Promise<boolean>;
  /** `true` si la liquidación pasó de `pendiente` a `enviada` en esta llamada. */
  liquidacionEnviada: (tenantId: string, liquidacionId: string, ahora: Date) => Promise<boolean>;
  registrarEvento: (tenantId: string, liquidacionId: string, tipo: TipoEvento, detalle?: Record<string, unknown>) => Promise<void>;
  abrirExcepcion: (tenantId: string, claveExterna: string, tipo: TipoExcepcion, detalle: Record<string, unknown>, ahora: Date) => Promise<unknown>;
}

export interface ResumenEntregasCorreo {
  reclamadas: number;
  enviadas: number;
  /** Quedaron `pendiente` con nuevo intento (429/5xx/red). */
  reintentar: number;
  fallidas: number;
  /** Correo sin llave, sin dominio verificado o sin «Responder a» configurado: no se gastó intento. */
  sinConfigurar: number;
  /** Antes de `enviar_desde_hora`. */
  fueraDeVentana: number;
  /** «Activar el envío» apagado (`activa=false`): no salió nada, no se gastó intento; la fila espera a que se encienda. */
  apagada: number;
  /** Pasadas a `fallida` «sin confirmar» (decisión humana). */
  sinConfirmar: number;
  /** Error inesperado en una fila (la fila queda reclamada hasta que venza su lease). */
  errores: number;
}

const RESUMEN_VACIO = (): ResumenEntregasCorreo => ({
  reclamadas: 0, enviadas: 0, reintentar: 0, fallidas: 0, sinConfigurar: 0, fueraDeVentana: 0, apagada: 0, sinConfirmar: 0, errores: 0,
});

// ── Utilidades puras ────────────────────────────────────────────────────────

/** 2, 4, 8, 16 minutos (mismo criterio que el reintento de WhatsApp). */
export function esperaCorreoMs(intentos: number): number {
  return Math.min(2 ** intentos, 30) * 60_000;
}

/** Ejemplo sintetico: la forma `a***@dominio` (primera letra del usuario y el dominio). Sin arroba: `***`. */
export function enmascararCorreo(correo: string): string {
  const i = correo.indexOf('@');
  if (i < 1) return '***';
  return `${correo[0]}***${correo.slice(i)}`;
}

/**
 * El detalle que devuelve el proveedor suele repetir la dirección («Invalid to: x@y»): antes de guardarlo (ultimo_error,
 * liquidacion_excepcion.detalle) o loguearlo, toda dirección se enmascara. El resto del texto se conserva.
 */
export function sinCorreos(detalle: string): string {
  return detalle.replace(/[^\s@<>"',;:()\[\]]+@[^\s@<>"',;:()\[\]]+/g, (m) => enmascararCorreo(m));
}

/**
 * La Idempotency-Key: estable entre reintentos, distinta por generación y por rol. A37-A1-liquidaciones-05: el rol `rh`
 * admite varios buzones por generación; con la misma llave y otro destinatario Resend responde 409 (que aquí es
 * reintentable) y los buzones siguientes quedaban `fallida`. Para `rh` la llave lleva la huella del correo (normalizado,
 * nunca el correo). Los demás roles tienen UN correo por generación: su llave no cambia (un reintento en vuelo conserva la suya).
 */
export function llaveIdempotencia(e: Pick<EntregaCorreo, 'liquidacionExternaId' | 'generacion' | 'rol'> & { correo?: string }): string {
  const base = `liqcorreo:${e.liquidacionExternaId}:g${e.generacion}:${e.rol}`;
  if (e.rol !== 'rh' || !e.correo) return base;
  return `${base}:${createHash('sha256').update(e.correo.trim().toLowerCase(), 'utf8').digest('hex').slice(0, 12)}`;
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** «9 al 14 oct», «28 sep al 2 oct», «9 oct». Sin importes. Fecha ilegible ⇒ cadena vacía. */
export function rangoCorto(desde: string, hasta: string): string {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(desde);
  const h = /^(\d{4})-(\d{2})-(\d{2})/.exec(hasta);
  if (!d || !h) return '';
  const dd = Number(d[3]), hd = Number(h[3]), dm = Number(d[2]), hm = Number(h[2]);
  if (dm < 1 || dm > 12 || hm < 1 || hm > 12) return '';
  if (desde.slice(0, 10) === hasta.slice(0, 10)) return `${dd} ${MESES_CORTOS[dm - 1]}`;
  if (d[1] === h[1] && dm === hm) return `${dd} al ${hd} ${MESES_CORTOS[hm - 1]}`;
  return `${dd} ${MESES_CORTOS[dm - 1]} al ${hd} ${MESES_CORTOS[hm - 1]}`;
}

/** La bitácora sale de la clave `BIT-<terminal>-<bitácora>`; una clave de otra forma se usa completa. */
export function bitacoraDeClave(clave: string): string {
  const m = /^BIT-[^-]+-(.+)$/.exec(clave);
  if (m?.[1]) return m[1];
  const m2 = /^BIT-(.+)$/.exec(clave);
  return m2?.[1] ?? clave;
}

/** Asunto neutro y cuerpo de 3 líneas. NINGUNA cifra de dinero ni nombre de empresa: el dato va en el adjunto. */
export function armarCorreoDesglose(ctx: ContextoLiquidacion): { correo: Correo; nombreAdjunto: string } {
  const bitacora = ctx.bitacora && ctx.bitacora.trim() !== '' ? ctx.bitacora.trim() : bitacoraDeClave(ctx.claveExterna);
  const rango = rangoCorto(ctx.periodoDesde, ctx.periodoHasta);
  // A37-A1-02: una clave terminada en `-R<n>` es la CORRECCIÓN de un desglose ya enviado: el operador debe saberlo de inmediato.
  const esCorreccion = /-R\d+$/.test(ctx.claveExterna);
  const asunto = `${esCorreccion ? 'CORRECCIÓN — ' : ''}Desglose de pago — bitácora ${bitacora}${rango ? ` — ${rango}` : ''}`;
  const seguro = bitacora.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) || 'bitacora';
  return {
    nombreAdjunto: `desglose-${seguro}.xlsx`,
    correo: {
      asunto,
      avance: esCorreccion ? 'CORRECCIÓN: desglose de pago adjunto.' : 'Desglose de pago adjunto.',
      titulo: esCorreccion ? 'Desglose de pago (corrección)' : 'Desglose de pago',
      parrafos: [
        ...(esCorreccion ? ['CORRECCIÓN: este desglose reemplaza al que se envió antes de esta bitácora; el anterior ya no es válido.'] : []),
        `Va adjunto el desglose de pago de la bitácora ${bitacora}.`,
        'El detalle está en el archivo de Excel.',
        'Si algo no coincide, responde a este correo.',
      ],
      porQueLoRecibes: 'Recibes este correo como destinatario del desglose de pago.',
    },
  };
}

/** El instante en que abre la ventana de envío de HOY (hora de México). `null` si no hay hora configurada o no es válida. */
export function inicioVentanaHoy(ahora: Date, hora: number | null): Date | null {
  if (hora == null || !Number.isInteger(hora) || hora < 0 || hora > 23) return null;
  const iso = aInstanteMx(hoyMx(ahora), `${String(hora).padStart(2, '0')}:00:00`);
  return iso ? new Date(iso) : null;
}

const esTransitorio = (status: number | undefined): boolean =>
  status === 408 || status === 409 || status === 425 || status === 429 || (status !== undefined && status >= 500);
const esDeConfiguracion = (status: number | undefined): boolean => status === 401 || status === 403;

// ── Dependencias reales ─────────────────────────────────────────────────────

export function dependenciasEntregaCorreo(): DependenciasEntregaCorreo {
  return {
    ahora: () => new Date(),
    enviar: (para, correo, op) => enviarCorreo(para, correo, op),
    leerConfig: async (tenantId) => {
      const c = await leerConfigCorreo(tenantId);
      return c.ok ? c.valor : CONFIG_CORREO_POR_DEFECTO;
    },
    reclamar: async (limite, ahora) => {
      const r = await reclamarEntregas(limite, ahora);
      return r.ok ? r.valor : [];
    },
    leerContexto: async (tenantId, id) => {
      const l = await leerPorId(tenantId, id);
      if (!l) return null;
      // A37-A1-liquidaciones-10: la bitácora sale del encabezado del desglose; si no se puede leer, se infiere de la clave.
      let bitacora: string | undefined;
      try {
        const d = await leerDesglose(tenantId, id);
        if (d.ok && d.valor?.bitacora) bitacora = d.valor.bitacora;
      } catch { /* sin encabezado: se usa la clave */ }
      return { claveExterna: l.claveExterna, periodoDesde: l.periodoDesde, periodoHasta: l.periodoHasta, ...(bitacora ? { bitacora } : {}) };
    },
    descargarXlsx: async (tenantId, ruta) => {
      // La URL firmada se pide con el módulo que valida que la ruta sea de la flota; se descarga con tope de tiempo.
      const url = await firmarXlsx(tenantId, ruta, 120);
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`descarga del Excel: HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    },
    marcarEnviada,
    marcarFallida,
    reprogramar: reprogramarEntrega,
    liquidacionEnviada: (tenantId, id, ahora) =>
      transicionar(tenantId, id, ['pendiente'], { estado: 'enviada', enviada_en: ahora.toISOString() }),
    registrarEvento,
    abrirExcepcion,
  };
}

// ── Servicio ────────────────────────────────────────────────────────────────

/**
 * Procesa hasta `limite` entregas listas. Nunca lanza por una fila: lo que falle queda contado en `errores` y en el log, y
 * la fila vuelve a salir cuando venza su lease (con la misma Idempotency-Key).
 */
export async function procesarEntregasCorreo(
  deps: DependenciasEntregaCorreo = dependenciasEntregaCorreo(),
  limite: number = LIMITE_POR_PASADA,
): Promise<ResumenEntregasCorreo> {
  const resumen = RESUMEN_VACIO();
  const inicio = deps.ahora();
  const filas = await deps.reclamar(Math.max(1, Math.min(Math.trunc(limite), LIMITE_POR_PASADA)), inicio);
  resumen.reclamadas = filas.length;

  const configs = new Map<string, ConfigCorreo>();
  const configDe = async (tenantId: string): Promise<ConfigCorreo> => {
    const c = configs.get(tenantId);
    if (c) return c;
    const nueva = await deps.leerConfig(tenantId);
    configs.set(tenantId, nueva);
    return nueva;
  };

  for (const e of filas) {
    try {
      const ahora = deps.ahora();
      const agotado = ahora.getTime() - inicio.getTime() > PRESUPUESTO_MS;
      await procesarUna(e, ahora, agotado, deps, configDe, resumen);
    } catch (err) {
      resumen.errores += 1;
      logger.error('liqcorreo.entrega_error', {
        entrega: e.id, rol: e.rol, correo: enmascararCorreo(e.correo), err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (resumen.reclamadas > 0) logger.info('liqcorreo.pasada', { ...resumen });
  return resumen;
}

async function procesarUna(
  e: EntregaCorreo, ahora: Date, sinTiempo: boolean, deps: DependenciasEntregaCorreo,
  configDe: (tenantId: string) => Promise<ConfigCorreo>, resumen: ResumenEntregasCorreo,
): Promise<void> {
  const token = e.claimToken;
  if (!token) {
    // El reclamo siempre trae token; sin él no hay candado para escribir.
    resumen.errores += 1;
    logger.error('liqcorreo.sin_token', { entrega: e.id });
    return;
  }

  // 1. Doble envío de un pago: lo ya aceptado por el proveedor no se reenvía solo.
  if (e.resendId) {
    await deps.marcarFallida(e.tenantId, e.id, token, 'sin confirmar: ya hay un envío aceptado por el proveedor; decide una persona');
    resumen.sinConfirmar += 1;
    return;
  }
  const ambiguo = (e.ultimoError ?? '').startsWith(MARCA_AMBIGUO);
  if (ambiguo && ahora.getTime() - new Date(e.proximoIntentoEn).getTime() > VIGENCIA_LLAVE_MS) {
    await deps.marcarFallida(e.tenantId, e.id, token, 'sin confirmar: el intento anterior quedó ambiguo y la llave de idempotencia ya venció; decide una persona');
    resumen.sinConfirmar += 1;
    return;
  }

  // 2. Ventana de envío (hora de México) y presupuesto de tiempo: se libera sin gastar intento.
  const config = await configDe(e.tenantId);
  // 1b. Interruptor «Activar el envío» (A35-A1-04). La pantalla de configuración promete que apagado «no sale ningún
  // correo aunque haya desgloses listos», pero ni `recibirDesglose` ni el RPC de reclamo lo miraban: en el alta, con los
  // contactos reales ya cargados, un `POST /desgloses` de prueba mandaba nóminas de verdad. Este es el punto único por
  // donde sale un correo (también el reenvío manual y la liberación de retenidas pasan por la cola), así que se corta
  // aquí, ANTES de descargar el Excel o llamar al proveedor. No se gasta intento ni se falla la fila: queda pendiente y
  // sale sola cuando alguien enciende el envío. (Sin fila de config el valor por defecto es `activa=false`: tampoco sale.)
  if (!config.activa) {
    await deps.reprogramar(e.tenantId, e.id, token, e.intentos, new Date(ahora.getTime() + ESPERA_CONFIG_MS), e.ultimoError);
    resumen.apagada += 1;
    return;
  }
  // 1c. «Responder a» obligatorio (A37-A1-04). El correo promete «Si algo no coincide, responde a este correo»; sin `replyTo` la
  // respuesta cae en el buzón de campañas (`avisos@`), donde se descarta sin que nadie de la flota la vea. Fail-closed: no se
  // manda un correo con una promesa falsa a una persona. Igual que apagada: no se gasta intento, la fila espera la configuración.
  if (!config.responderA) {
    logger.warn('liqcorreo.sin_responder_a', { tenant: e.tenantId, entrega: e.id });
    await deps.reprogramar(e.tenantId, e.id, token, e.intentos, new Date(ahora.getTime() + ESPERA_CONFIG_MS), e.ultimoError);
    resumen.sinConfigurar += 1;
    return;
  }
  const abre = inicioVentanaHoy(ahora, config.enviarDesdeHora);
  if (abre && ahora.getTime() < abre.getTime()) {
    await deps.reprogramar(e.tenantId, e.id, token, e.intentos, abre, e.ultimoError);
    resumen.fueraDeVentana += 1;
    return;
  }
  if (sinTiempo) {
    await deps.reprogramar(e.tenantId, e.id, token, e.intentos, new Date(ahora.getTime() + 60_000), e.ultimoError);
    return;
  }

  // 3. Insumos del correo.
  if (!e.xlsxRuta) {
    await deps.marcarFallida(e.tenantId, e.id, token, 'la entrega no trae ruta del Excel');
    resumen.fallidas += 1;
    return;
  }
  const ctx = await deps.leerContexto(e.tenantId, e.liquidacionExternaId);
  if (!ctx) {
    await deps.marcarFallida(e.tenantId, e.id, token, 'la liquidación de esta entrega ya no existe');
    resumen.fallidas += 1;
    return;
  }

  let bytes: Uint8Array;
  try {
    bytes = await deps.descargarXlsx(e.tenantId, e.xlsxRuta);
  } catch (err) {
    await falloReintentable(e, token, ahora, `no se pudo leer el Excel: ${err instanceof Error ? err.message : String(err)}`, false, deps, resumen);
    return;
  }
  if (e.xlsxSha256 && createHash('sha256').update(bytes).digest('hex') !== e.xlsxSha256) {
    await deps.marcarFallida(e.tenantId, e.id, token, 'el Excel guardado no coincide con su huella; no se envía');
    resumen.fallidas += 1;
    return;
  }

  // 4. Enviar.
  const { correo, nombreAdjunto } = armarCorreoDesglose(ctx);
  const res = await deps.enviar(e.correo, correo, {
    idempotencyKey: llaveIdempotencia(e),
    adjuntos: [{ filename: nombreAdjunto, content: Buffer.from(bytes).toString('base64'), contentType: TIPO_XLSX_CORREO }],
    sobrio: true,
    ...(config.remitenteNombre ? { remitenteNombre: config.remitenteNombre } : {}),
    ...(config.responderA ? { replyTo: config.responderA } : {}),
  });

  // 5. Anotar el resultado (las seis ramas de ResultadoEnvio).
  if (res.ok) {
    const resendId = res.id || `sin-id-${e.id}`;
    const anotada = await deps.marcarEnviada(e.tenantId, e.id, token, resendId, ahora);
    if (!anotada) {
      // El proveedor aceptó pero el lease ya no es nuestro: NO se reintenta (ya salió). Queda para revisión.
      resumen.errores += 1;
      logger.error('liqcorreo.enviada_sin_anotar', { entrega: e.id, rol: e.rol, correo: enmascararCorreo(e.correo) });
      return;
    }
    resumen.enviadas += 1;
    if (e.rol === 'operador') {
      const cambio = await deps.liquidacionEnviada(e.tenantId, e.liquidacionExternaId, ahora);
      if (cambio) await deps.registrarEvento(e.tenantId, e.liquidacionExternaId, 'enviada', { canal: 'correo', rol: e.rol, generacion: e.generacion });
    }
    return;
  }

  if (res.motivo === 'sin_configurar') {
    await deps.reprogramar(e.tenantId, e.id, token, e.intentos, new Date(ahora.getTime() + ESPERA_CONFIG_MS), 'correo no configurado');
    resumen.sinConfigurar += 1;
    return;
  }

  if (res.motivo === 'red') {
    // Ambiguo: el POST pudo haberse aceptado. El reintento usa la misma llave.
    await falloReintentable(e, token, ahora, `${MARCA_AMBIGUO} ${sinCorreos(res.detalle)}`, true, deps, resumen);
    return;
  }

  // motivo === 'rechazado'
  if (esDeConfiguracion(res.status)) {
    await deps.reprogramar(e.tenantId, e.id, token, e.intentos, new Date(ahora.getTime() + ESPERA_CONFIG_MS), `correo no configurado (${sinCorreos(res.detalle)})`);
    resumen.sinConfigurar += 1;
    return;
  }
  if (esTransitorio(res.status)) {
    await falloReintentable(e, token, ahora, sinCorreos(res.detalle), false, deps, resumen);
    return;
  }
  // 4xx del destinatario (o rechazo local: sin destinatario válido, adjunto demasiado grande): sin reintento.
  await deps.marcarFallida(e.tenantId, e.id, token, `rechazado: ${sinCorreos(res.detalle)}`);
  resumen.fallidas += 1;
  if (e.rol === 'archivo') {
    // El buzón de archivo («Enviados») es una copia: que rebote no le pide nada al operador ni al coordinador, así que NO se
    // abre una excepción de ellos (el tipo `coordinador_sin_correo` mentiría). Queda la entrega `fallida` visible en el
    // detalle y este aviso en el log; un tipo de excepción propio exigiría una migración (ver notas de T-A1-26).
    logger.warn('liqcorreo.archivo_rebotado', { entrega: e.id, correo: enmascararCorreo(e.correo), detalle: sinCorreos(res.detalle) });
    return;
  }
  const tipo: TipoExcepcion = e.rol === 'operador' ? 'operador_sin_correo' : 'coordinador_sin_correo';
  await deps.abrirExcepcion(e.tenantId, ctx.claveExterna, tipo, {
    motivo: 'correo_invalido', rol: e.rol, correo: enmascararCorreo(e.correo), detalle: sinCorreos(res.detalle),
  }, ahora);
}

async function falloReintentable(
  e: EntregaCorreo, token: string, ahora: Date, detalle: string, ambiguo: boolean,
  deps: DependenciasEntregaCorreo, resumen: ResumenEntregasCorreo,
): Promise<void> {
  const intentos = e.intentos + 1;
  const texto = ambiguo && !detalle.startsWith(MARCA_AMBIGUO) ? `${MARCA_AMBIGUO} ${detalle}` : detalle;
  if (intentos >= MAX_INTENTOS_CORREO) {
    await deps.marcarFallida(e.tenantId, e.id, token, `${texto} (agotó ${MAX_INTENTOS_CORREO} intentos)`);
    resumen.fallidas += 1;
    return;
  }
  await deps.reprogramar(e.tenantId, e.id, token, intentos, new Date(ahora.getTime() + esperaCorreoMs(intentos)), texto);
  resumen.reintentar += 1;
}
