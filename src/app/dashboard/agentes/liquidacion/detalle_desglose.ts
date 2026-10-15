// ═══════════════════════════════════════════════════════════════════════════
// EL DETALLE DE UN DESGLOSE (T-A1-29): de las filas de la base a lo que el panel pinta.
//
// `armarDetalle` es PURA (sin base, sin Storage): recibe lo ya leído. `cargarDetalle` lee y firma la descarga.
// Reglas:
//   · nada de esto va en la URL salvo el id del desglose (sin cifras);
//   · un correo se enseña enmascarado (`an***@dominio`): el panel dice A QUIÉN, no regala la dirección;
//   · una lectura que falla es `error`, jamás «no hay entregas»;
//   · la descarga es una URL firmada de 24 h; si no se pudo firmar, el detalle sigue y lo dice (`descargaUrl: null`).
// ═══════════════════════════════════════════════════════════════════════════

import type { LiquidacionExterna } from '@/lib/likida/liquidacion_externa/repo';
import type { Desglose, EntregaCorreo, Excepcion, TipoExcepcion } from '@/lib/likida/liquidacion_externa/repo_correo';
import type { DestinoVista, EstadoDestino } from './desgloses';

export type RolDetalle = 'operador' | 'coordinador' | 'rh' | 'archivo';

export interface DestinatarioDetalle {
  rol: RolDetalle;
  /** Enmascarado: `an***@dominio`. */
  correo: string;
  destino: DestinoVista;
  /** Cuándo pasó el último cambio (rebote, entrega o salida). */
  en: string | null;
}

export interface GeneracionDetalle {
  generacion: number;
  /** Cómo nació: salió sola, por el reclamo de un operador, o a mano. */
  origen: 'auto' | 'reclamo' | 'manual';
  creadaEn: string;
  entregas: number;
}

export interface ExcepcionDetalle { tipo: TipoExcepcion; desde: string }

export interface RenglonDetalle { descripcion: string; monto: number }

export interface DetalleDesglose {
  liquidacionId: string;
  bitacora: string;
  terminal: string | null;
  operador: string | null;
  periodoDesde: string;
  periodoHasta: string;
  moneda: 'MXN' | 'USD';
  neto: number;
  percepciones: RenglonDetalle[];
  deducciones: RenglonDetalle[];
  destinatarios: DestinatarioDetalle[];
  generaciones: GeneracionDetalle[];
  /** Por rol: ya hay un envío saliendo (jamás se reenvía encima). */
  enCurso: Record<'operador' | 'coordinador' | 'rh', boolean>;
  retenido: null | { por: 'neto' | 'revision'; liberable: boolean };
  excepciones: ExcepcionDetalle[];
  descargaUrl: string | null;
  /** `desglose-<bitacora>.xlsx`, ya saneado. */
  descargaNombre: string;
}

export type LecturaDetalle =
  | { estado: 'error' }
  | { estado: 'no_encontrado' }
  | { estado: 'ok'; detalle: DetalleDesglose };

const EN_CURSO = new Set(['pendiente', 'enviando']);
const ORDEN_ROL: Record<RolDetalle, number> = { operador: 0, coordinador: 1, rh: 2, archivo: 3 };
const ESTADO_DE_ENTREGA: Record<EntregaCorreo['estado'], EstadoDestino> = {
  rebotada: 'no_entregado', queja: 'no_entregado', fallida: 'no_entregado', pendiente: 'pendiente', enviando: 'pendiente',
  enviada: 'enviado', entregada: 'entregado', omitida: 'omitido',
};
/** Las retenciones que una persona puede decidir enviar (espejo de `TIPOS_LIBERABLES` de `liberar_envio.ts`). */
const LIBERABLES: readonly TipoExcepcion[] = ['neto_negativo', 'tipo_sin_regla'];

/** `ana.prueba@ejemplo.test` ⇒ `an***@ejemplo.test`. */
export function enmascararCorreo(correo: string): string {
  const i = correo.lastIndexOf('@');
  if (i < 1) return '***';
  return `${correo.slice(0, Math.min(2, i))}***${correo.slice(i)}`;
}

/** `desglose-<bitacora>.xlsx` sin nada que un sistema de archivos o un encabezado HTTP no acepte. */
export function nombreDescarga(bitacora: string): string {
  const limpia = bitacora.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return `desglose-${limpia || 'bitacora'}.xlsx`;
}

export interface EntradaDetalle {
  liq: LiquidacionExterna;
  desglose: Desglose;
  entregas: EntregaCorreo[];
  excepciones: Excepcion[];
  descargaUrl: string | null;
}

export function armarDetalle(e: EntradaDetalle): DetalleDesglose {
  const { liq, desglose, entregas } = e;

  // Cada (rol, correo) enseña SU última generación: una reposición reemplaza a la anterior.
  const ultima = new Map<string, EntregaCorreo>();
  for (const x of entregas) {
    const k = `${x.rol}|${x.correo.toLowerCase()}`;
    const previa = ultima.get(k);
    if (!previa || x.generacion > previa.generacion) ultima.set(k, x);
  }
  const destinatarios: DestinatarioDetalle[] = [...ultima.values()]
    .sort((a, b) => ORDEN_ROL[a.rol] - ORDEN_ROL[b.rol] || a.correo.localeCompare(b.correo))
    .map((x) => ({
      rol: x.rol,
      correo: enmascararCorreo(x.correo),
      destino: { estado: ESTADO_DE_ENTREGA[x.estado], en: x.rebotadaEn ?? x.entregadaEn ?? x.enviadaEn },
      en: x.rebotadaEn ?? x.entregadaEn ?? x.enviadaEn,
    }));

  const porGen = new Map<number, GeneracionDetalle>();
  for (const x of entregas) {
    const g = porGen.get(x.generacion);
    if (g) { g.entregas += 1; if (x.creadaEn < g.creadaEn) g.creadaEn = x.creadaEn; continue; }
    porGen.set(x.generacion, {
      generacion: x.generacion, origen: x.disparo === 'reclamo' ? 'reclamo' : x.disparo === 'manual' ? 'manual' : 'auto',
      creadaEn: x.creadaEn, entregas: 1,
    });
  }
  const generaciones = [...porGen.values()].sort((a, b) => b.generacion - a.generacion);

  const enCurso = { operador: false, coordinador: false, rh: false };
  for (const x of entregas) if (x.rol !== 'archivo' && EN_CURSO.has(x.estado)) enCurso[x.rol] = true;

  const abiertas = e.excepciones.filter((x) => x.resueltaEn === null);
  const retenido = desglose.retenidaMotivo
    ? {
      por: (/neto/i.test(desglose.retenidaMotivo) ? 'neto' : 'revision') as 'neto' | 'revision',
      liberable: abiertas.filter((x) => ['neto_negativo', 'tipo_sin_regla', 'concepto_prohibido'].includes(x.tipo)).every((x) => LIBERABLES.includes(x.tipo)),
    }
    : null;

  return {
    liquidacionId: liq.id, bitacora: desglose.bitacora, terminal: desglose.terminal, operador: liq.operadorNombre,
    periodoDesde: liq.periodoDesde, periodoHasta: liq.periodoHasta, moneda: liq.moneda, neto: liq.total,
    percepciones: liq.conceptos.filter((c) => c.tipo === 'percepcion').map((c) => ({ descripcion: c.descripcion, monto: c.monto })),
    deducciones: liq.conceptos.filter((c) => c.tipo === 'deduccion').map((c) => ({ descripcion: c.descripcion, monto: c.monto })),
    destinatarios, generaciones, enCurso, retenido,
    excepciones: abiertas.map((x) => ({ tipo: x.tipo, desde: x.primeraVez })),
    descargaUrl: e.descargaUrl, descargaNombre: nombreDescarga(desglose.bitacora),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const leerIdDetalle = (v: string | undefined): string | null => (v && UUID.test(v) ? v.toLowerCase() : null);

const DIA_SEG = 24 * 3600;

/**
 * Lee y arma el detalle de UN desglose de esta flota. `error` si algo no se pudo leer (nunca un detalle recortado);
 * `no_encontrado` si el id no existe en la flota (un id de otra flota cae aquí: todo va anclado al tenant).
 */
export async function cargarDetalle(tenantId: string, id: string): Promise<LecturaDetalle> {
  try {
    const [{ leerPorId }, rc] = await Promise.all([
      import('@/lib/likida/liquidacion_externa/repo'), import('@/lib/likida/liquidacion_externa/repo_correo'),
    ]);
    const liq = await leerPorId(tenantId, id);
    if (!liq) return { estado: 'no_encontrado' };
    const [cab, ent, exc] = await Promise.all([
      rc.leerDesglose(tenantId, id), rc.entregasDe(tenantId, id), rc.listarExcepciones(tenantId, { clave: liq.claveExterna, limite: 100 }),
    ]);
    if (!cab.ok || !ent.ok || !exc.ok) return { estado: 'error' };
    if (!cab.valor) return { estado: 'no_encontrado' };

    // El archivo: el de la generación más reciente que lo tenga; un desglose retenido aún no tiene entregas y su archivo
    // ya está subido en la ruta direccionada por contenido.
    const conArchivo = [...ent.valor].filter((x) => x.xlsxRuta).sort((a, b) => b.generacion - a.generacion)[0];
    const ruta = conArchivo?.xlsxRuta ?? rc.rutaXlsxDesglose(tenantId, liq.claveExterna, liq.huella);
    let descargaUrl: string | null = null;
    try {
      descargaUrl = await rc.firmarXlsx(tenantId, ruta, DIA_SEG, nombreDescarga(cab.valor.bitacora));
    } catch {
      descargaUrl = null;
    }
    return { estado: 'ok', detalle: armarDetalle({ liq, desglose: cab.valor, entregas: ent.valor, excepciones: exc.valor, descargaUrl }) };
  } catch {
    return { estado: 'error' };
  }
}
