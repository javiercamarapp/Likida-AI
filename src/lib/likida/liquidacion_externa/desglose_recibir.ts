// ═══════════════════════════════════════════════════════════════════════════
// RECIBIR UN DESGLOSE DE BITÁCORA (T-A1-15): validar → idempotencia → operador → reglas y guardas → Excel → Storage →
// insertar → programar los correos.
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
//   · ORDEN de escritura: primero el archivo, luego la fila. Un fallo de Storage lanza (reintentable) sin dejar fila.
//   · Un operador sin correo no recibe, pero coordinador/RH/archivo sí (T-A1-14); se abre la excepción que lo dice.
//   · Likida no recalcula: el total es el de la fuente (o la suma de sus renglones, marcado como calculado).
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import { logger } from '@/lib/logger';
import { DatoInvalido } from '../errores';
import { huellaContenido } from './esquema';
import {
  aLiquidacionExterna, claveDeBitacora, claveDeLiquidacion, UnidadesMezcladas, type DesgloseBitacora, type RenglonBitacora,
} from './desglose_contrato';
import {
  aplicarRenombres, colapsarRenglonViaje, guardasPreEnvio,
  type ConfigGuardasEnvio, type MotivoRetencion, type Renombre,
} from './desglose_reglas';
import { generarDesgloseXlsx } from './desglose_xlsx';
import { resolverDestinatarios, type MotivoFaltante } from './correo_destinatarios';
import {
  buscarPorClave, resolverOperadorDestino, resolverViajeIds, insertarLiquidacionExterna, registrarEvento,
  type LiquidacionExterna, type NuevaLiquidacionExterna, type OperadorDestino, type TipoEvento,
} from './repo';
import {
  leerConfigCorreo, leerContactoOperador, listarCoordinadores, insertarDesglose, insertarEntregas, abrirExcepcion, subirXlsx,
  CONFIG_CORREO_POR_DEFECTO,
  type ConfigCorreo, type ContactoOperador, type Coordinador, type MetaDesglose, type NuevaEntrega, type TipoExcepcion,
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
}

export const dependenciasDesglosePorOmision: DependenciasDesglose = {
  ahora: () => new Date(),
  // Sin las migraciones 0785-0787 la lectura no está disponible: se usa el defecto (canal anterior, sin reglas).
  leerConfig: async (t) => {
    const l = await leerConfigCorreo(t);
    return l.ok ? l.valor : CONFIG_CORREO_POR_DEFECTO;
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
};

// ── Resultado ───────────────────────────────────────────────────────────────

export type ResultadoDesglose =
  /** Se guardó. `retenida`: quedó pendiente de decisión humana, sin entregas. */
  | { estado: 'creada'; liquidacionId: string; claveExterna: string; entregas: number; retenida: boolean; motivos: MotivoRetencion[]; excepciones: TipoExcepcion[] }
  /** Misma clave y mismo contenido: no se hizo nada. */
  | { estado: 'idempotente'; liquidacionId: string; claveExterna: string }
  /** Misma clave, otro contenido: nada se sobrescribió ni se envió; hay una excepción abierta. */
  | { estado: 'correccion_pendiente'; liquidacionId: string; claveExterna: string }
  | { estado: 'operador_no_encontrado'; claveExterna: string };

export interface OpcionesDesglose {
  /** `sistema_origen` que queda en la liquidación. */
  sistemaOrigen?: string;
}

const SISTEMA_ORIGEN_DEFECTO = 'desglose-bitacora';

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

/** Lo que verá el operador: renombres del contralor y renglón de viaje. Solo reagrupa/renombra; el neto no cambia. */
function presentar(d: DesgloseBitacora, c: ConfigCorreo): { percepciones: RenglonBitacora[]; deducciones: RenglonBitacora[] } {
  const renombres = renombresDeConfig(c.renombres);
  const percepciones = aplicarRenombres(
    colapsarRenglonViaje(d.percepciones, {
      activa: c.agruparViaje, etiqueta: c.etiquetaViaje, conceptosOrigen: c.conceptosViaje, tipoOperador: d.tipoOperador,
    }),
    renombres,
  );
  return { percepciones, deducciones: aplicarRenombres(d.deducciones, renombres) };
}

// ── El servicio ─────────────────────────────────────────────────────────────

/**
 * Recibe UN desglose de bitácora. Lanza `CampoInvalido` si el desglose no cumple el contrato (el llamador responde 400)
 * y el error de Storage/base si algo no se pudo escribir (reintentable: nada quedó a medias antes de la fila).
 */
export async function recibirDesglose(
  tenantId: string, d: DesgloseBitacora, deps: DependenciasDesglose = dependenciasDesglosePorOmision, opciones: OpcionesDesglose = {},
): Promise<ResultadoDesglose> {
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
  const liq = conversion.liquidacion;
  const claveExterna = liq.claveExterna;
  const huella = huellaContenido(liq);
  const ahora = deps.ahora();

  // (2) idempotencia / corrección
  const existente = await deps.buscarPorClave(tenantId, claveExterna);
  if (existente) {
    if (existente.huella === huella) return { estado: 'idempotente', liquidacionId: existente.id, claveExterna };
    await deps.abrirExcepcion(tenantId, claveExterna, 'correccion_pendiente', {
      bitacora: d.bitacora, netoAntes: existente.total, netoDespues: liq.total,
    }, ahora);
    logger.warn('liqcorreo.correccion_pendiente', { clave: claveExterna });
    return { estado: 'correccion_pendiente', liquidacionId: existente.id, claveExterna };
  }

  // (3) operador
  let operador: OperadorDestino;
  try {
    operador = await deps.resolverOperador(tenantId, d.operador.numeroEmpleado);
  } catch (e) {
    if (!(e instanceof DatoInvalido)) throw e;
    await deps.abrirExcepcion(tenantId, claveExterna, 'operador_no_encontrado', { bitacora: d.bitacora }, ahora);
    return { estado: 'operador_no_encontrado', claveExterna };
  }

  // (4) reglas del contralor y guardas previas al envío (sobre lo que el operador va a ver)
  const config = await deps.leerConfig(tenantId);
  const vista = presentar(d, config);
  const decision = guardasPreEnvio({ ...d, ...vista }, guardasDeConfig(config));
  const retenida = decision.decision === 'retener';

  // (5) Excel → Storage (primero el archivo; si falla, lanza y no queda fila)
  const bytes = generarDesgloseXlsx({
    operador: operador.nombre,
    ...(d.unidad !== undefined ? { unidad: d.unidad } : {}),
    bitacora: d.bitacoras !== undefined ? liq.viajes.join(', ') : d.bitacora,
    ...(d.numeroLiquidacion !== undefined ? { numeroLiquidacion: d.numeroLiquidacion } : {}),
    ...(d.numeroPago !== undefined ? { numeroPago: d.numeroPago } : {}),
    desde: d.desde, hasta: d.hasta, dias: conversion.dias,
    percepciones: vista.percepciones, deducciones: vista.deducciones,
    neto: liq.total,
  });
  const xlsxRuta = await deps.subirXlsx(tenantId, claveExterna, huella, bytes);
  const xlsxSha256 = sha256Hex(bytes);

  // (6) fila + encabezado + evento
  const viajeIds = await deps.resolverViajeIds(tenantId, liq.viajes);
  const creada = await deps.insertarLiquidacion({
    tenantId, datos: liq, huella, operadorId: operador.id, viajeIds,
    pdfRuta: null, pdfOrigen: 'generado', pdfSha256: null,
  });
  await deps.insertarDesglose(tenantId, {
    liquidacionExternaId: creada.id, bitacora: d.bitacora, terminal: d.terminal ?? null, poliza: d.poliza,
    unidad: d.unidad ?? null, tipoOperador: d.tipoOperador ?? null, dias: conversion.dias,
    ...(d.numeroLiquidacion !== undefined ? { numeroLiquidacion: d.numeroLiquidacion } : {}),
    ...(d.numeroPago !== undefined ? { numeroPago: d.numeroPago } : {}),
    ...(d.bitacoras !== undefined ? { bitacoras: liq.viajes } : {}),
    totalOrigen: conversion.totalOrigen === 'origen' ? 'tms' : 'calculado',
    retenidaMotivo: retenida ? decision.detalle.join(' ') : null,
  });
  await deps.registrarEvento(tenantId, creada.id, 'recibida', {
    origen: liq.sistemaOrigen, canal: 'correo', renglones: liq.conceptos.length, retenida, viajesEnLikida: viajeIds.length,
  });

  const excepciones: TipoExcepcion[] = [];
  const abrir = async (tipo: TipoExcepcion, detalle: Record<string, unknown>) => {
    await deps.abrirExcepcion(tenantId, claveExterna, tipo, { bitacora: d.bitacora, ...detalle }, ahora);
    excepciones.push(tipo);
  };

  // (4 bis) retenida: sin entregas, una excepción por motivo
  if (retenida) {
    for (const m of decision.motivos) await abrir(MOTIVO_A_EXCEPCION[m], { motivo: m });
    return { estado: 'creada', liquidacionId: creada.id, claveExterna, entregas: 0, retenida: true, motivos: decision.motivos, excepciones };
  }

  // (7) destinatarios → una entrega por destino
  const contacto = await deps.leerContacto(tenantId, operador.id);
  const coordinador = contacto?.coordinadorId ? await deps.leerCoordinador(tenantId, contacto.coordinadorId) : null;
  const { destinos, faltantes } = resolverDestinatarios({
    operador: { correo: contacto?.correo ?? null, rebotadoEn: contacto?.correoRebotadoEn ?? null },
    coordinador: coordinador ? { correo: coordinador.correo, activo: coordinador.activo } : null,
    config: {
      rhCorreos: config.rhCorreos, archivoCorreo: config.archivoCorreo,
      enviaCoordinador: config.enviaCoordinador, enviaRh: config.enviaRh,
    },
  });
  const entregas = await deps.insertarEntregas(tenantId, destinos.map((x) => ({
    liquidacionExternaId: creada.id, rol: x.rol, correo: x.correo, xlsxRuta, xlsxSha256, disparo: 'auto' as const,
  })));
  for (const f of faltantes) await abrir(FALTANTE_A_EXCEPCION[f.motivo], { rol: f.rol, motivo: f.motivo });

  return { estado: 'creada', liquidacionId: creada.id, claveExterna, entregas, retenida: false, motivos: [], excepciones };
}
