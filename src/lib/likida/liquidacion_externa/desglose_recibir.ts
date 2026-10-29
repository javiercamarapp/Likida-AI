// ═══════════════════════════════════════════════════════════════════════════
// RECIBIR UN DESGLOSE DE BITÁCORA (T-A1-15): validar → idempotencia → operador → reglas y guardas → Excel → Storage →
// insertar (UNA transacción, RPC 0857) → programar los correos.
//
// Es el equivalente, para el canal CORREO, de `recibirLiquidacionExterna` (flujo PDF anterior, que NO se toca). Un desglose por
// bitácora; la clave de idempotencia sale de la bitácora (`claveDeBitacora`).
//
// Reglas que este servicio garantiza:
//   · MISMA clave + MISMA huella  ⇒ `idempotente`: no inserta nada ni reenvía nada.
//   · MISMA clave + OTRA huella   ⇒ NO sobrescribe y NO envía (el operador pudo haber recibido ya el primero): abre la
//     excepción `correccion_pendiente` con el neto de antes y el de después. Una persona decide mandar la corrección con
//     la clave `…-R1` (docs/operacion/liquidacion-externa.md).
//   · Una guarda que retiene (neto negativo, concepto prohibido, tipo sin regla…) inserta la liquidación `pendiente`
//     con su motivo, SIN entregas, y abre una excepción por motivo.
//   · ORDEN de escritura: primero el archivo, luego TODO lo demás en UNA transacción (RPC 0857; sin ella, el camino anterior,
//     no atómico, que se avisa en el log). Un fallo lanza (reintentable) sin dejar nada a medias, y una recepción que SÍ quedó
//     a medias (misma huella, sin encabezado o sin entregas ni retención) se RESCATA en vez de contestar «idempotente».
//   · Un operador sin correo no recibe, pero coordinador/RH/archivo sí (T-A1-14); se abre la excepción que lo dice.
//   · Likida no recalcula: el total es el de la fuente (o la suma de sus renglones, marcado como calculado).
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import { logger } from '@/lib/logger';
import { DatoInvalido, OperadorDeBaja } from '../errores';
import { huellaContenido, huellaDesglose } from './esquema';
import type { LiquidacionExternaNormalizada } from './esquema';
import {
  aLiquidacionExterna, claveDeBitacora, claveDeLiquidacion, UnidadesMezcladas, type DesgloseBitacora, type RenglonBitacora, type TipoOperadorDesglose,
} from './desglose_contrato';
import {
  aplicarRenombres, colapsarRenglonViaje, guardasPreEnvio,
  MARCA_RETENIDA_OMITIDA, type ConfigGuardasEnvio, type MotivoRetencion, type Renombre,
} from './desglose_reglas';
import { generarDesgloseXlsx } from './desglose_xlsx';
import { resolverDestinatarios, resolverRevisores, type MotivoFaltante } from './correo_destinatarios';
import { hoyMx } from '@/lib/formato';
import { perfilDeTenant } from '@/lib/auth/perfil_tenant';
import {
  buscarPorClave, resolverOperadorDestino, resolverViajeIds, insertarLiquidacionExterna, registrarEvento,
  type LiquidacionExterna, type NuevaLiquidacionExterna, type OperadorDestino, type TipoEvento,
} from './repo';
import {
  leerConfigCorreo, leerContactoOperador, listarCoordinadores, insertarDesglose, insertarEntregas, abrirExcepcion, subirXlsx,
  recibirDesgloseAtomico, desgloseIncompleto, listarExcepciones, resolverExcepcion, CONFIG_CORREO_POR_DEFECTO, modoPrimerMesVigente,
  omitirEntregasPendientes,
  type PedidoRecepcionAtomica, type RecepcionAtomica, type Lectura, type ConfigCorreo, type ContactoOperador, type Coordinador, type MetaDesglose, type NuevaEntrega, type TipoExcepcion,
} from './repo_correo';

// ── Dependencias (puertos) ──────────────────────────────────────────────────

export interface DependenciasDesglose {
  ahora: () => Date;
  leerConfig: (tenantId: string) => Promise<ConfigCorreo>;
  buscarPorClave: (tenantId: string, clave: string) => Promise<LiquidacionExterna | null>;
  /** Lanza `DatoInvalido` si el operador no existe, está de baja o los datos no coinciden. */
  resolverOperador: (tenantId: string, numeroEmpleado: string) => Promise<OperadorDestino>;
  resolverViajeIds: (tenantId: string, folios: string[]) => Promise<string[]>;
  leerContacto: (tenantId: string, operadorId: string) => Promise<ContactoOperador | null>;
  leerCoordinador: (tenantId: string, coordinadorId: string) => Promise<Coordinador | null>;
  subirXlsx: (tenantId: string, claveExterna: string, huella: string, bytes: Uint8Array) => Promise<string>;
  insertarLiquidacion: (n: NuevaLiquidacionExterna) => Promise<LiquidacionExterna>;
  insertarDesglose: (tenantId: string, m: MetaDesglose) => Promise<boolean>;
  insertarEntregas: (tenantId: string, filas: NuevaEntrega[]) => Promise<number>;
  abrirExcepcion: (
    tenantId: string, claveExterna: string, tipo: TipoExcepcion, detalle: Record<string, unknown>, ahora: Date,
  ) => Promise<{ id: number; nueva: boolean }>;
  registrarEvento: (tenantId: string, liquidacionId: string, tipo: TipoEvento, detalle?: Record<string, unknown>) => Promise<void>;
  /** Cierra las excepciones abiertas de esa clave y tipo (la corrección ya se mandó). Opcional: sin ella se deja para resolver a mano. */
  resolverExcepciones?: (tenantId: string, claveExterna: string, tipo: TipoExcepcion, ahora: Date) => Promise<number>;
  /**
   * RPC 0857: liquidación + encabezado + evento + entregas en UNA transacción (y repara lo que quedó a medias). Opcional: si no
   * se da, o la base aún no tiene la 0857 (`no_disponible`), se usa el camino anterior, no atómico, y se avisa en el log.
   */
  recibirAtomico?: (tenantId: string, pedido: PedidoRecepcionAtomica) => Promise<Lectura<RecepcionAtomica>>;
  /** ¿Una liquidación con la misma huella quedó a medias (sin encabezado, o sin retención y sin entregas)? Se rescata. */
  desgloseIncompleto?: (tenantId: string, liquidacionId: string) => Promise<boolean>;
  /**
   * A1-01 / A1-02: pasa a `omitida` las entregas `pendiente` de esas liquidaciones (idempotente; una `enviando` termina su envío); devuelve cuántas. Opcional:
   * sin ella (pruebas) no se omite nada aparte; la corrección y el corte dependen de ella para ser a prueba de una RPC anterior a la 0940.
   */
  omitirPendientes?: (tenantId: string, liquidacionIds: string[], motivo: string) => Promise<number>;
}

export const dependenciasDesglosePorOmision: DependenciasDesglose = {
  ahora: () => new Date(),
  // Sin las migraciones 0785-0787 la lectura no está disponible: se usa el defecto (canal anterior, sin reglas)... salvo bajo
  // `cinco_agentes` (H759-2): ahí «sin configuración» NO puede significar «sin corte» (el histórico saldría como correos reales), así
  // que falla cerrado: lanza (reintentable; la RPC no deja nada a medias) en vez de asumir el defecto.
  leerConfig: async (t) => {
    const l = await leerConfigCorreo(t);
    if (l.ok) return l.valor;
    if ((await perfilDeTenant(t)) === 'cinco_agentes') {
      throw new Error('liqcorreo.recepcion: no se pudo leer la configuración de envío (fecha de corte) de una flota que la exige; se reintenta, no se asume «sin corte».');
    }
    return CONFIG_CORREO_POR_DEFECTO;
  },
  buscarPorClave,
  resolverOperador: (t, numeroEmpleado) => resolverOperadorDestino(t, { id: null, telefono: null, numeroEmpleado }),
  resolverViajeIds,
  leerContacto: async (t, id) => {
    const l = await leerContactoOperador(t, id);
    return l.ok ? l.valor : null;
  },
  leerCoordinador: async (t, id) => {
    const l = await listarCoordinadores(t);
    return l.ok ? (l.valor.find((c) => c.id === id) ?? null) : null;
  },
  subirXlsx,
  insertarLiquidacion: insertarLiquidacionExterna,
  insertarDesglose,
  insertarEntregas,
  abrirExcepcion,
  registrarEvento,
  resolverExcepciones: async (t, clave, tipo, ahora) => {
    const l = await listarExcepciones(t, { clave, tipo });
    if (!l.ok) return 0;
    let n = 0;
    for (const e of l.valor) if (await resolverExcepcion(t, e.id, ahora)) n += 1;
    return n;
  },
  recibirAtomico: recibirDesgloseAtomico,
  desgloseIncompleto,
  omitirPendientes: omitirEntregasPendientes,
};

// ── Resultado ───────────────────────────────────────────────────────────────

/**
 * A1-01: por qué un desglose se guarda pero NO se envía. `anterior_al_corte`: su periodo termina antes de `no_enviar_antes_de`
 * (la fecha de arranque); `enviado_por_origen`: el sistema de origen ya lo mandó (`enviadoOrigen`).
 */
export type MotivoOmision = 'anterior_al_corte' | 'enviado_por_origen';

const TEXTO_OMISION: Record<MotivoOmision, string> = {
  anterior_al_corte: 'omitida: el periodo termina antes de la fecha de corte del arranque',
  enviado_por_origen: 'omitida: el sistema de origen ya la envió',
};

/** ¿Este desglose se guarda sin enviarse? El corte compara el FIN del periodo (`hasta`, AAAA-MM-DD) con la fecha de corte configurada. */
export function motivoDeOmision(d: Pick<DesgloseBitacora, 'hasta' | 'enviadoOrigen'>, c: Pick<ConfigCorreo, 'noEnviarAntes'>): MotivoOmision | null {
  if (d.enviadoOrigen === true) return 'enviado_por_origen';
  if (c.noEnviarAntes !== null && d.hasta < c.noEnviarAntes) return 'anterior_al_corte';
  return null;
}

export type ResultadoDesglose =
  /** Se guardó. `retenida`: quedó pendiente de decisión humana, sin entregas. `omitida`: se guardó sin enviarse (A1-01); sus entregas nacen `omitida`. */
  | { estado: 'creada'; liquidacionId: string; claveExterna: string; entregas: number; retenida: boolean; motivos: MotivoRetencion[]; excepciones: TipoExcepcion[]; /** Clave de la liquidación que esta corrige (A37-A1-02). */ correccionDe?: string; omitida?: MotivoOmision }
  /**
   * Solo con `opciones.simular` (vista previa de la carga del panel): lo que PASARÍA, sin escribir nada (ni Storage, ni base, ni excepciones).
   * `correos` = correos que saldrían de verdad (0 si se omite); `omitidas` = entregas que nacerían `omitida`.
   */
  | { estado: 'simulada'; claveExterna: string; correos: number; omitidas: number; retenida: boolean; omitida: MotivoOmision | null }
  /** Misma clave y mismo contenido: no se hizo nada. */
  | { estado: 'idempotente'; liquidacionId: string; claveExterna: string }
  /** Misma clave, otro contenido: nada se sobrescribió ni se envió; hay una excepción abierta. */
  | { estado: 'correccion_pendiente'; liquidacionId: string; claveExterna: string }
  | { estado: 'operador_no_encontrado'; claveExterna: string }
  /**
   * Sin póliza no se envía (c3cc57d3 68:21), también por push/archivo: no se guarda NADA (así, cuando la póliza llegue, la
   * misma clave entra normal) y queda abierta la excepción `sin_poliza`, que se cierra sola cuando llega con póliza.
   */
  | { estado: 'sin_poliza'; claveExterna: string };

export interface OpcionesDesglose {
  /** `sistema_origen` que queda en la liquidación. */
  sistemaOrigen?: string;
  /**
   * A37-A1-02: la persona que administra DECIDIÓ mandar la corrección. Si la bitácora ya existe con otro contenido, en vez de
   * quedarse en `correccion_pendiente` se crea una liquidación NUEVA con la clave `<clave>-R<n>` (xlsx nuevo, llave de entrega
   * nueva) que el operador recibe rotulada «CORRECCIÓN»; la original queda como constancia (nunca se sobrescribe). Es idempotente:
   * reintentar la misma corrección no crea otra. Sin `existente` no hace nada especial (se recibe como una bitácora nueva).
   */
  correccion?: { motivo: string; actor: string };
  /** A1-01: vista previa. Hace TODO el cálculo (idempotencia, operador, reglas, destinatarios) pero no escribe nada: devuelve `simulada`. */
  simular?: boolean;
}

/** Tope de correcciones encadenadas de una misma bitácora (`-R1`…`-R20`): más allá es un error de integración, no una corrección. */
export const MAX_CORRECCIONES = 20;

const SISTEMA_ORIGEN_DEFECTO = 'desglose-bitacora';
/** Los orígenes con que se han guardado desgloses (pull/por omisión y POST): sus huellas ANTERIORES siguen reconociéndose. */
const ORIGENES_CON_HUELLA_ANTERIOR = [SISTEMA_ORIGEN_DEFECTO, 'desglose-bitacora-api'];

/**
 * A37-A1-liquidaciones-09: ¿la huella guardada es la de este mismo contenido? La actual es canónica (sin orden de renglones ni
 * origen); las filas guardadas ANTES llevan `huellaContenido` (con el orden recibido y el `sistemaOrigen`), que se reconoce con el
 * origen de esta lectura y con los orígenes conocidos. Un contenido realmente distinto no coincide con ninguna.
 */
function mismaHuella(guardada: string, liq: LiquidacionExternaNormalizada): boolean {
  if (guardada === huellaDesglose(liq)) return true;
  return [liq.sistemaOrigen, ...ORIGENES_CON_HUELLA_ANTERIOR].some((o) => guardada === huellaContenido({ ...liq, sistemaOrigen: o }));
}

// ── Utilidades ──────────────────────────────────────────────────────────────

const sha256Hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

const MOTIVO_A_EXCEPCION: Record<MotivoRetencion, TipoExcepcion> = {
  neto_negativo: 'neto_negativo',
  concepto_prohibido: 'concepto_prohibido',
  tipo_sin_regla: 'tipo_sin_regla',
  sin_poliza: 'sin_poliza',
};

const FALTANTE_A_EXCEPCION: Record<MotivoFaltante, TipoExcepcion> = {
  operador_sin_correo: 'operador_sin_correo',
  correo_rebotado: 'operador_sin_correo',
  coordinador_sin_asignar: 'coordinador_sin_correo',
};

/**
 * La config guarda los renombres como JSON (`patron` en texto). Una entrada mal formada (sin `a`, regex inválida) se
 * ignora y se avisa en el log: una regla rota del contralor no debe tumbar la recepción de todos los desgloses.
 */
export function renombresDeConfig(crudo: readonly unknown[]): Renombre[] {
  const salida: Renombre[] = [];
  for (const r of crudo) {
    if (r === null || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.a !== 'string' || o.a.trim() === '') continue;
    let patron: RegExp | null = null;
    if (o.patron instanceof RegExp) patron = o.patron;
    else if (typeof o.patron === 'string' && o.patron !== '') {
      try {
        patron = new RegExp(o.patron, 'i');
      } catch {
        logger.warn('liqcorreo.renombre_invalido', {});
      }
    }
    if (patron) salida.push({ patron, a: o.a, ...(o.fusionar === true ? { fusionar: true } : {}) });
  }
  return salida;
}

function guardasDeConfig(c: ConfigCorreo): Partial<ConfigGuardasEnvio> {
  return {
    neto_negativo: c.netoNegativo,
    conceptos_prohibidos: c.conceptosProhibidos,
    tipos_que_reciben: c.tiposQueReciben as ConfigGuardasEnvio['tipos_que_reciben'],
  };
}

/** El renglón único «Pago de viaje» es de los foráneos; los locales conservan «Sueldo» y «Complemento» (c3cc57d3 46:21). */
export const SOLO_TIPOS_RENGLON_VIAJE: TipoOperadorDesglose[] = ['foraneo'];

/** Lo que verá el operador: renombres del contralor y renglón de viaje. Solo reagrupa/renombra; el neto no cambia. */
export function presentar(d: DesgloseBitacora, c: ConfigCorreo): { percepciones: RenglonBitacora[]; deducciones: RenglonBitacora[] } {
  const renombres = renombresDeConfig(c.renombres);
  const percepciones = aplicarRenombres(
    colapsarRenglonViaje(d.percepciones, {
      activa: c.agruparViaje, etiqueta: c.etiquetaViaje, conceptosOrigen: c.conceptosViaje, soloTipos: SOLO_TIPOS_RENGLON_VIAJE, tipoOperador: d.tipoOperador,
    }),
    renombres,
  );
  return { percepciones, deducciones: aplicarRenombres(d.deducciones, renombres) };
}

// ── El servicio ─────────────────────────────────────────────────────────────

/**
 * Recibe UN desglose de bitácora. Lanza `CampoInvalido` si el desglose no cumple el contrato (el llamador responde 400)
 * y el error de Storage/base si algo no se pudo escribir (reintentable: la RPC 0857 no deja nada a medias).
 */
export async function recibirDesglose(
  tenantId: string, d: DesgloseBitacora, depsEntrada: DependenciasDesglose = dependenciasDesglosePorOmision, opciones: OpcionesDesglose = {},
): Promise<ResultadoDesglose> {
  // En la vista previa ninguna excepción se abre (es lectura pura): el resto de las escrituras están más abajo, tras el retorno simulado.
  const deps: DependenciasDesglose = opciones.simular ? { ...depsEntrada, abrirExcepcion: async () => ({ id: 0, nueva: false }) } : depsEntrada;
  // (1) contrato → liquidación vigente + huella
  let conversion: ReturnType<typeof aLiquidacionExterna>;
  try {
    conversion = aLiquidacionExterna(d, { sistemaOrigen: opciones.sistemaOrigen ?? SISTEMA_ORIGEN_DEFECTO });
  } catch (e) {
    if (e instanceof UnidadesMezcladas) {
      // Visible en la pantalla de excepciones (T-A1-41); luego se relanza: el llamador responde 400 y nada se guarda.
      const clave = typeof d.numeroLiquidacion === 'string' && d.numeroLiquidacion !== ''
        ? claveDeLiquidacion(d.terminal, d.numeroLiquidacion) : claveDeBitacora(d.terminal, d.bitacora);
      await deps.abrirExcepcion(tenantId, clave, 'unidades_mezcladas', { bitacora: d.bitacora, unidades: e.unidades }, deps.ahora());
      logger.warn('liqcorreo.unidades_mezcladas', { clave });
    }
    throw e;
  }
  let liq = conversion.liquidacion;
  let claveExterna = liq.claveExterna;
  let huella = huellaDesglose(liq);
  const ahora = deps.ahora();

  // (2) idempotencia / corrección
  let existente = await deps.buscarPorClave(tenantId, claveExterna);
  // Misma huella pero a medias (un corte entre las escrituras del camino anterior, hallazgo A35-A1-01): NO es idempotente,
  // hay que completarla. `rescate` guarda esa fila y el resto del flujo la completa en vez de insertar otra.
  let rescate: LiquidacionExterna | null = null;
  if (existente) {
    if (mismaHuella(existente.huella, liq)) {
      if (!deps.desgloseIncompleto || !(await deps.desgloseIncompleto(tenantId, existente.id))) {
        return { estado: 'idempotente', liquidacionId: existente.id, claveExterna };
      }
      logger.warn('liqcorreo.recepcion_a_medias_rescate', { clave: claveExterna });
      rescate = existente;
      existente = null;
    }
  }
  // A37-A1-02: una persona que administra decidió mandar la corrección → liquidación nueva `<clave>-R<n>`, idempotente.
  let correccionDe: string | null = null;
  let correccionN = 0;
  /** A1-02: la original y las correcciones anteriores de esta bitácora: lo que la nueva corrección REEMPLAZA (sus claves, para cerrar excepciones). */
  const reemplazadas: Array<{ id: string; clave: string }> = [];
  if (existente && opciones.correccion) {
    const base = claveExterna;
    reemplazadas.push({ id: existente.id, clave: base });
    let n = 1;
    for (; n <= MAX_CORRECCIONES; n++) {
      const claveR = `${base}-R${n}`;
      const previa = await deps.buscarPorClave(tenantId, claveR);
      if (!previa) break;
      if (mismaHuella(previa.huella, { ...liq, claveExterna: claveR })) {
        // A1-02: reintentar una corrección ya recibida también deja las anteriores sin salir (un corte entre «guardar» y «omitir» no las salva).
        if (!opciones.simular) await omitirReemplazadas(tenantId, deps, reemplazadas);
        return { estado: 'idempotente', liquidacionId: previa.id, claveExterna: claveR };
      }
      reemplazadas.push({ id: previa.id, clave: claveR });
    }
    if (n > MAX_CORRECCIONES) throw new DatoInvalido(`Esta bitácora ya tiene ${MAX_CORRECCIONES} correcciones: revisa la integración, algo la está reenviando distinta cada vez.`);
    correccionDe = base;
    correccionN = n;
    claveExterna = `${base}-R${n}`;
    liq = { ...liq, claveExterna };
    huella = huellaDesglose(liq);
    existente = null;
  }
  if (existente) {
    // A37-A1-liquidaciones-15: el detalle de la excepción NO guarda importes (la migración 0786 promete «ids y motivos»; esta tabla
    // no tiene purga): la persona compara contra el origen. Solo se anota QUÉ cambió y que cambió el importe, sin la cifra.
    await deps.abrirExcepcion(tenantId, claveExterna, 'correccion_pendiente', {
      bitacora: d.bitacora, cambioElNeto: existente.total !== liq.total,
    }, ahora);
    logger.warn('liqcorreo.correccion_pendiente', { clave: claveExterna });
    return { estado: 'correccion_pendiente', liquidacionId: existente.id, claveExterna };
  }

  // (2b) sin póliza no se envía (misma regla que el pull). Nada se guarda: la póliza no entra en la huella, y una fila
  // guardada ahora haría «idempotente» a la misma bitácora cuando la póliza llegue.
  if (d.poliza === null || d.poliza === '') {
    await deps.abrirExcepcion(tenantId, claveExterna, 'sin_poliza', { bitacora: d.bitacora, desde: d.desde }, ahora);
    logger.warn('liqcorreo.sin_poliza', { clave: claveExterna });
    return { estado: 'sin_poliza', claveExterna };
  }

  // (3) operador
  let operador: OperadorDestino;
  try {
    operador = await deps.resolverOperador(tenantId, d.operador.numeroEmpleado);
  } catch (e) {
    if (!(e instanceof DatoInvalido)) throw e;
    // A37-A1-liquidaciones-12: la excepción distingue al operador DE BAJA (finiquito, reactivar) del que no existe (dar de alta).
    await deps.abrirExcepcion(tenantId, claveExterna, 'operador_no_encontrado', {
      bitacora: d.bitacora, motivo: e instanceof OperadorDeBaja ? 'baja' : 'no_existe',
    }, ahora);
    return { estado: 'operador_no_encontrado', claveExterna };
  }

  // (4) reglas del contralor y guardas previas al envío (sobre lo que el operador va a ver)
  const config = await deps.leerConfig(tenantId);
  const omision = motivoDeOmision(d, config);
  const vista = presentar(d, config);
  const decision = guardasPreEnvio({ ...d, ...vista }, guardasDeConfig(config));
  const retenida = decision.decision === 'retener';

  // (5) Excel → Storage (primero el archivo; si falla, lanza y no queda fila). En la vista previa no se genera ni se sube nada.
  let xlsxRuta = '';
  let xlsxSha256 = '';
  if (!opciones.simular) {
    const bytes = generarDesgloseXlsx({
      operador: operador.nombre,
      ...(d.unidad !== undefined ? { unidad: d.unidad } : {}),
      bitacora: `${d.bitacoras !== undefined ? liq.viajes.join(', ') : d.bitacora}${correccionDe ? ' — CORRECCIÓN' : ''}`,
      ...(d.numeroLiquidacion !== undefined ? { numeroLiquidacion: d.numeroLiquidacion } : {}),
      ...(d.numeroPago !== undefined ? { numeroPago: d.numeroPago } : {}),
      desde: d.desde, hasta: d.hasta, dias: conversion.dias,
      percepciones: vista.percepciones, deducciones: vista.deducciones,
      neto: liq.total,
    });
    xlsxRuta = await deps.subirXlsx(tenantId, claveExterna, huella, bytes);
    xlsxSha256 = sha256Hex(bytes);
  }

  // (6) destinatarios (solo LECTURAS, antes de escribir nada: un fallo aquí no deja medio desglose)
  let destinos: ReturnType<typeof resolverDestinatarios>['destinos'] = [];
  let faltantes: ReturnType<typeof resolverDestinatarios>['faltantes'] = [];
  // 0933 · «modo primer mes»: el revisor de cada departamento recibe TODO movimiento, enviado o retenido. Un buzón que ya recibe el
  // desglose por otro rol no se repite. En una retenida es la ÚNICA entrega (al operador, coordinador, RH y archivo no sale nada).
  const revisoresVigentes = modoPrimerMesVigente(config, hoyMx(ahora));
  if (!retenida) {
    const contacto = await deps.leerContacto(tenantId, operador.id);
    const coordinador = contacto?.coordinadorId ? await deps.leerCoordinador(tenantId, contacto.coordinadorId) : null;
    ({ destinos, faltantes } = resolverDestinatarios({
      operador: { correo: contacto?.correo ?? null, rebotadoEn: contacto?.correoRebotadoEn ?? null },
      coordinador: coordinador ? { correo: coordinador.correo, activo: coordinador.activo } : null,
      config: {
        rhCorreos: config.rhCorreos, archivoCorreo: config.archivoCorreo,
        enviaCoordinador: config.enviaCoordinador, enviaRh: config.enviaRh,
      },
    }));
  }
  const destinosRevisor = resolverRevisores(config.revisores, revisoresVigentes, new Set(destinos.map((x) => x.correo)));
  // A1-01: un desglose anterior al corte (o ya enviado por el origen) conserva sus entregas, pero nacen `omitida`: nadie recibe nada y la
  // oficina puede ver a quién le habría tocado. El estado viaja en la misma transacción (RPC 0940), así que no hay instante en que salgan.
  const entregasPedidas = [...destinos, ...destinosRevisor].map((x) => ({
    rol: x.rol, correo: x.correo, xlsxRuta, xlsxSha256, disparo: 'auto' as const,
    ...(omision ? { estado: 'omitida' as const, ultimoError: TEXTO_OMISION[omision] } : {}),
  }));
  if (opciones.simular) {
    return {
      estado: 'simulada', claveExterna, retenida, omitida: omision,
      correos: omision ? 0 : entregasPedidas.length, omitidas: omision ? entregasPedidas.length : 0,
    };
  }
  // A1-02: la corrección REEMPLAZA a la original (y a las correcciones anteriores): lo que de ellas siga esperando salir (ventana de
  // envío, espera, reintentos) se omite para que el operador reciba un solo correo y no el equivocado junto con el bueno. H759-7: se hace
  // DESPUÉS de garantizar la nueva (guardada en la transacción de abajo), nunca antes: si guardar fallara y nadie reintentara, la original
  // quedaría cancelada sin reemplazo. Si omitir falla, se lanza y el reintento de la corrección (idempotente) lo repite.
  const omitirOriginales = async (): Promise<void> => { if (correccionDe) await omitirReemplazadas(tenantId, deps, reemplazadas); };
  const viajeIds = await deps.resolverViajeIds(tenantId, liq.viajes);
  const nuevaLiquidacion: NuevaLiquidacionExterna = {
    tenantId, datos: liq, huella, operadorId: operador.id, viajeIds,
    pdfRuta: null, pdfOrigen: 'generado', pdfSha256: null,
  };
  const meta = {
    bitacora: d.bitacora, terminal: d.terminal ?? null, poliza: d.poliza,
    unidad: d.unidad ?? null, tipoOperador: d.tipoOperador ?? null, dias: conversion.dias,
    ...(d.numeroLiquidacion !== undefined ? { numeroLiquidacion: d.numeroLiquidacion } : {}),
    ...(d.numeroPago !== undefined ? { numeroPago: d.numeroPago } : {}),
    ...(d.bitacoras !== undefined ? { bitacoras: liq.viajes } : {}),
    ...(correccionN > 0 ? { correccionN } : {}),
    totalOrigen: (conversion.totalOrigen === 'origen' ? 'tms' : 'calculado') as 'tms' | 'calculado',
    retenidaMotivo: retenida ? `${omision ? MARCA_RETENIDA_OMITIDA : ''}${decision.detalle.join(' ')}` : null,
  };
  const detalleEvento = {
    origen: liq.sistemaOrigen, canal: 'correo', renglones: liq.conceptos.length, retenida, viajesEnLikida: viajeIds.length,
    ...(omision ? { omitida: omision } : {}),
    ...(correccionDe && opciones.correccion
      ? { correccion_de: correccionDe, motivo_correccion: opciones.correccion.motivo.slice(0, 300), actor: opciones.correccion.actor.slice(0, 120) }
      : {}),
  };

  // (7) fila + encabezado + evento + entregas: UNA transacción (RPC 0857). Sin ella, el camino anterior (no atómico).
  let liquidacionId: string;
  let entregas = 0;
  const atomica = deps.recibirAtomico
    ? await deps.recibirAtomico(tenantId, { liquidacion: nuevaLiquidacion, meta, evento: detalleEvento, entregas: entregasPedidas })
    : null;
  if (atomica && atomica.ok) {
    liquidacionId = atomica.valor.liquidacionId;
    entregas = atomica.valor.entregas;
    await omitirOriginales();
    // Una base sin la 0933 ignora las entregas de una retenida: el aviso al revisor se inserta aparte (idempotente por el índice único).
    if (retenida && destinosRevisor.length > 0 && atomica.valor.creada && entregas === 0) {
      try {
        await deps.insertarEntregas(tenantId, entregasPedidas.map((e) => ({ liquidacionExternaId: liquidacionId, ...e })));
      } catch (err) {
        logger.warn('liqcorreo.revisor_retenida_sin_0933', { clave: claveExterna, err: err instanceof Error ? err.message : String(err) });
      }
    }
    // Otra recepción concurrente ya lo guardó completo: no hay nada que abrir ni reenviar.
    if (!atomica.valor.creada && !atomica.valor.reparada) return { estado: 'idempotente', liquidacionId, claveExterna };
    // A1-01: cinturón y tirantes. Una base con la RPC anterior a la 0940 ignora `estado` y deja las entregas `pendiente`: se omiten ya.
    if (omision && entregas > 0 && deps.omitirPendientes) {
      try { await deps.omitirPendientes(tenantId, [liquidacionId], TEXTO_OMISION[omision]); } catch (e) {
        logger.error('liqcorreo.omitir_corte_fallo', { clave: claveExterna, err: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    }
  } else {
    if (deps.recibirAtomico) logger.warn('liqcorreo.recepcion_no_atomica', { motivo: 'la base no tiene la migracion 0857' });
    const creada = rescate ?? await deps.insertarLiquidacion(nuevaLiquidacion);
    liquidacionId = creada.id;
    await deps.insertarDesglose(tenantId, { liquidacionExternaId: liquidacionId, ...meta });
    if (!rescate) await deps.registrarEvento(tenantId, liquidacionId, 'recibida', detalleEvento);
    entregas = await deps.insertarEntregas(tenantId, entregasPedidas.map((e) => ({ liquidacionExternaId: liquidacionId, ...e })));
    await omitirOriginales();
  }

  // La póliza ya llegó: la excepción `sin_poliza` de esta clave (si la hubo) se cierra sola.
  if (deps.resolverExcepciones) {
    try { await deps.resolverExcepciones(tenantId, claveExterna, 'sin_poliza', ahora); } catch (e) {
      logger.warn('liqcorreo.sin_poliza_no_resolvio', { clave: claveExterna, err: e instanceof Error ? e.message : String(e) });
    }
  }

  // La corrección ya salió (o quedó retenida con su excepción): la pendiente de la original se cierra, y con ella las excepciones de
  // RETENCIÓN de la original y de las correcciones anteriores (A1-02: un original retenido quedaba «liberable» después de corregido).
  if (correccionDe && deps.resolverExcepciones) {
    for (const r of reemplazadas) {
      for (const tipo of ['correccion_pendiente', 'neto_negativo', 'concepto_prohibido', 'tipo_sin_regla'] as const) {
        try { await deps.resolverExcepciones(tenantId, r.clave, tipo, ahora); } catch (e) {
          logger.warn('liqcorreo.correccion_no_resolvio_excepcion', { clave: r.clave, tipo, err: e instanceof Error ? e.message : String(e) });
        }
      }
    }
  }

  const excepciones: TipoExcepcion[] = [];
  const abrir = async (tipo: TipoExcepcion, detalle: Record<string, unknown>) => {
    await deps.abrirExcepcion(tenantId, claveExterna, tipo, { bitacora: d.bitacora, ...detalle }, ahora);
    excepciones.push(tipo);
  };

  // retenida: sin entregas, una excepción por motivo. H759-M4: un desglose HISTÓRICO omitido (anterior al corte / ya enviado por el origen) no abre
  // excepciones (subir 1,000 viejos producía cientos de «sin correo de operador» / retenciones sobre datos que nadie va a enviar); su retenida_motivo
  // lleva la marca que impide liberarlo (`liberarEnvio`).
  if (retenida) {
    if (!omision) for (const m of decision.motivos) await abrir(MOTIVO_A_EXCEPCION[m], { motivo: m });
    return { estado: 'creada', liquidacionId, claveExterna, entregas: 0, retenida: true, motivos: decision.motivos, excepciones, ...(correccionDe ? { correccionDe } : {}), ...(omision ? { omitida: omision } : {}) };
  }

  if (!omision) for (const f of faltantes) await abrir(FALTANTE_A_EXCEPCION[f.motivo], { rol: f.rol, motivo: f.motivo });

  return { estado: 'creada', liquidacionId, claveExterna, entregas, retenida: false, motivos: [], excepciones, ...(correccionDe ? { correccionDe } : {}), ...(omision ? { omitida: omision } : {}) };
}

const MOTIVO_REEMPLAZADA = 'omitida: reemplazada por una corrección';

/** A1-02: lo que las liquidaciones reemplazadas tenían por salir pasa a `omitida`. Un fallo se lanza: sin esto saldrían dos correos. */
async function omitirReemplazadas(tenantId: string, deps: DependenciasDesglose, reemplazadas: ReadonlyArray<{ id: string }>): Promise<void> {
  if (!deps.omitirPendientes || reemplazadas.length === 0) return;
  const n = await deps.omitirPendientes(tenantId, reemplazadas.map((r) => r.id), MOTIVO_REEMPLAZADA);
  if (n > 0) logger.info('liqcorreo.correccion_omitio_pendientes', { entregas: n });
}
