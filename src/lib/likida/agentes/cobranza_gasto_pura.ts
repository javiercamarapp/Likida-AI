import { TZ_MX, mxn, fechaCorta } from '@/lib/formato';
import { tierPendiente } from './cobranza_pura';

// ═══════════════════════════════════════════════════════════════════════════
// EL MOTOR PURO DE LA COBRANZA POR GASTO (0525) — sin I/O.
//
// La cobranza por viaje (0089) dice «llevas N días con el viaje X sin mandarme
// comprobantes». Esta dice QUÉ comprobante falta de QUÉ gasto:
//
//   · sin_foto       — el gasto existe (capturado por oficina o importado) y no
//                      tiene foto ni CFDI: no hay ningún comprobante.
//   · foto_ilegible  — hay foto, pero la lectura salió por debajo del umbral y no
//                      hay CFDI: el ticket no se pudo leer, hace falta otra foto.
//   · sin_cfdi       — hay ticket legible pero el concepto exige factura (diésel,
//                      casetas…) y el gasto no trae CFDI.
//   · cfdi_cancelado — el CFDI del gasto salió CANCELADO ante el SAT: ya no es un
//                      comprobante, hay que reponerlo.
//
// Separado de `cobranza_gasto.ts` (que toca la base) por la misma razón que
// `cobranza_pura.ts`: la página lo corre en el navegador (vista previa del
// mensaje) sin arrastrar `supabaseAdmin`. NUNCA inventa una cifra: cada línea del
// mensaje sale de columnas del gasto; lo que no está se dice como falta, no se
// rellena.
// ═══════════════════════════════════════════════════════════════════════════

export type MotivoComprobante = 'sin_foto' | 'foto_ilegible' | 'sin_cfdi' | 'cfdi_cancelado';

export const MOTIVOS_COMPROBANTE: readonly MotivoComprobante[] = ['cfdi_cancelado', 'sin_foto', 'foto_ilegible', 'sin_cfdi'];

/** Lo que el chofer debe hacer, en sus palabras. */
export const QUE_FALTA: Record<MotivoComprobante, string> = {
  sin_foto: 'falta la foto del ticket',
  foto_ilegible: 'la foto no se lee, manda otra más clara',
  sin_cfdi: 'falta la factura (CFDI)',
  cfdi_cancelado: 'la factura salió cancelada, pide una nueva',
};

/** Rótulos para el tablero. */
export const ROTULO_MOTIVO: Record<MotivoComprobante, string> = {
  sin_foto: 'Sin foto ni factura',
  foto_ilegible: 'Foto ilegible',
  sin_cfdi: 'Ticket sin factura (CFDI)',
  cfdi_cancelado: 'Factura cancelada',
};

export interface ConfigGasto {
  /** Encendida: el agente cobra por gasto. Nace APAGADA (0525). */
  porGasto: boolean;
  /** Días desde que el gasto se capturó a los que se insiste (1 a 5, ascendentes). */
  tiersGasto: number[];
  /** Mensajes por chofer y día (1 a 3). */
  maxMensajesDia: number;
  /** Conceptos cuyo comprobante debe ser CFDI. */
  conceptosCfdi: string[];
  /** Confianza OCR por debajo de la cual la foto es ilegible. */
  umbralFoto: number;
}

export const CONFIG_GASTO_DEFAULT: ConfigGasto = {
  porGasto: false,
  tiersGasto: [1, 3, 7],
  maxMensajesDia: 1,
  conceptosCfdi: ['diesel', 'caseta'],
  umbralFoto: 0.5,
};

export const CONCEPTOS_VALIDOS = ['diesel', 'caseta', 'factura', 'alimentacion', 'hospedaje', 'transporte', 'flete', 'otro'] as const;

export function validarConfigGasto(cruda: Partial<ConfigGasto>): { ok: ConfigGasto } | { error: string } {
  const base = { ...CONFIG_GASTO_DEFAULT, ...cruda };
  const tiers = (base.tiersGasto ?? []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 60);
  if (tiers.length === 0 || tiers.length > 5) return { error: 'La cadencia por gasto necesita entre 1 y 5 valores, de 1 a 60 días.' };
  const ordenados = [...tiers].sort((a, b) => a - b);
  if (new Set(ordenados).size !== ordenados.length) return { error: 'La cadencia por gasto no puede repetir días.' };
  const max = Number(base.maxMensajesDia);
  if (!Number.isInteger(max) || max < 1 || max > 3) return { error: 'El tope de mensajes por chofer y día va de 1 a 3.' };
  const umbral = Number(base.umbralFoto);
  if (!Number.isFinite(umbral) || umbral < 0.1 || umbral > 0.95) return { error: 'El umbral de lectura de la foto va de 0.10 a 0.95.' };
  const conceptos = [...new Set((base.conceptosCfdi ?? []).map(String))];
  const invalido = conceptos.find((c) => !(CONCEPTOS_VALIDOS as readonly string[]).includes(c));
  if (invalido) return { error: `«${invalido}» no es un concepto de gasto.` };
  if (conceptos.length > 8) return { error: 'Demasiados conceptos.' };
  return {
    ok: {
      porGasto: Boolean(base.porGasto),
      tiersGasto: ordenados,
      maxMensajesDia: max,
      conceptosCfdi: conceptos,
      umbralFoto: Math.round(umbral * 100) / 100,
    },
  };
}

/** Lo mínimo de un gasto para decidir si falta su comprobante. */
export interface GastoParaCobrar {
  id: string;
  viajeId: string;
  folioViaje: string | null;
  concepto: string;
  monto: number;
  fecha: string | null;
  creadoEn: string;
  imagenUrl: string | null;
  cfdiUuid: string | null;
  ocrConfianza: number | null;
  cfdiEsquemaAlterno: boolean | null;
  estadoSat: string | null;
}

/**
 * ¿Qué comprobante falta de este gasto? `null` = no falta ninguno.
 *
 * El orden es el de la gravedad: un CFDI cancelado pesa más que una foto borrosa.
 * Un `ocrConfianza` nulo NO se lee como «ilegible»: es que la lectura no se midió
 * (gasto capturado a mano o por XML) y acusar de ilegible sin medir sería inventar.
 */
export function motivoFaltante(g: GastoParaCobrar, cfg: Pick<ConfigGasto, 'conceptosCfdi' | 'umbralFoto'>): MotivoComprobante | null {
  if (g.estadoSat === 'cancelado') return 'cfdi_cancelado';
  if (g.cfdiUuid) return null;
  if (!g.imagenUrl) return 'sin_foto';
  if (g.ocrConfianza !== null && g.ocrConfianza < cfg.umbralFoto) return 'foto_ilegible';
  if (!g.cfdiEsquemaAlterno && cfg.conceptosCfdi.includes(g.concepto)) return 'sin_cfdi';
  return null;
}

/** Días completos desde que el gasto se capturó (reloj de México no hace falta:
 *  son días transcurridos, no fecha de calendario). */
export function diasDesde(creadoEn: string, ahora: Date): number {
  const t = Date.parse(creadoEn);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((ahora.getTime() - t) / 86_400_000));
}

export const ROTULO_CONCEPTO_COBRANZA: Record<string, string> = {
  diesel: 'Diésel', caseta: 'Casetas', factura: 'Factura', alimentacion: 'Alimentos',
  hospedaje: 'Hospedaje', transporte: 'Transporte', flete: 'Flete', otro: 'Otro gasto',
};

export interface ItemCobro {
  gastoId: string;
  viajeId: string;
  folioViaje: string | null;
  operadorNombre: string | null;
  concepto: string;
  monto: number;
  fecha: string | null;
  motivo: MotivoComprobante;
  /** El tier que toca cobrar hoy (null = todavía no alcanza ninguno). */
  tier: number | null;
  dias: number;
}

export interface OperadorCobro {
  operadorId: string;
  nombre: string | null;
  telefono: string | null;
}

export interface GastoDeOperador extends GastoParaCobrar { operador: OperadorCobro }

export interface PlanCobroGasto {
  /** Un grupo por chofer con teléfono y al menos un gasto en tier: UN mensaje. */
  paraContactar: Array<{ operador: OperadorCobro; items: ItemCobro[] }>;
  /** Gastos en tier cuyo chofer no tiene teléfono: se dicen, no se pierden. */
  sinTelefono: Array<{ operador: OperadorCobro; items: ItemCobro[] }>;
  /** TODOS los gastos con comprobante faltante (en tier o no): lo que el tablero muestra. */
  pendientes: ItemCobro[];
}

/**
 * La cola del día. `previos` = tiers ya contactados por gasto. Un contacto consume
 * también los tiers menores (`tierPendiente`): insistir es escalar, no repetir.
 * Los grupos salen del más atrasado al más reciente (el orden con el que un humano
 * cobraría) y dentro de un grupo, lo más atrasado primero.
 */
export function planearCobroGasto(
  gastos: readonly GastoDeOperador[],
  cfg: ConfigGasto,
  previos: ReadonlyMap<string, readonly number[]>,
  ahora: Date,
): PlanCobroGasto {
  const pendientes: ItemCobro[] = [];
  const porOperador = new Map<string, { operador: OperadorCobro; items: ItemCobro[] }>();

  for (const g of gastos) {
    const motivo = motivoFaltante(g, cfg);
    if (motivo === null) continue;
    const dias = diasDesde(g.creadoEn, ahora);
    const tier = tierPendiente(dias, cfg.tiersGasto, [...(previos.get(g.id) ?? [])], false);
    const item: ItemCobro = {
      gastoId: g.id, viajeId: g.viajeId, folioViaje: g.folioViaje, operadorNombre: g.operador.nombre,
      concepto: g.concepto, monto: g.monto, fecha: g.fecha, motivo, tier, dias,
    };
    pendientes.push(item);
    if (tier === null) continue;
    const grupo = porOperador.get(g.operador.operadorId) ?? { operador: g.operador, items: [] };
    grupo.items.push(item);
    porOperador.set(g.operador.operadorId, grupo);
  }

  const ordenar = (a: ItemCobro, b: ItemCobro) => b.dias - a.dias || (a.gastoId < b.gastoId ? -1 : 1);
  const grupos = [...porOperador.values()].map((gr) => ({ ...gr, items: [...gr.items].sort(ordenar) }));
  grupos.sort((a, b) => b.items[0].dias - a.items[0].dias || (a.operador.operadorId < b.operador.operadorId ? -1 : 1));

  return {
    paraContactar: grupos.filter((gr) => gr.operador.telefono),
    sinTelefono: grupos.filter((gr) => !gr.operador.telefono),
    pendientes: pendientes.sort(ordenar),
  };
}

/** Cuántos mensajes más puede recibir hoy un chofer. */
export function cupoRestante(mensajesHoy: number, maxMensajesDia: number): number {
  return Math.max(0, maxMensajesDia - mensajesHoy);
}

/** Cuántos renglones caben en un mensaje antes de resumir. */
export const MAX_ITEMS_MENSAJE = 5;

function renglon(i: ItemCobro): string {
  const concepto = ROTULO_CONCEPTO_COBRANZA[i.concepto] ?? i.concepto;
  const cuando = i.fecha ? ` del ${fechaCorta(i.fecha)}` : '';
  const viaje = i.folioViaje ? ` (viaje ${i.folioViaje})` : '';
  return `· ${concepto} ${mxn(i.monto)}${cuando}${viaje}: ${QUE_FALTA[i.motivo]}`;
}

/** El mensaje FUSIONADO a un chofer: un renglón por gasto, con QUÉ falta de cada uno. */
export function armarMensajeGastos(
  items: readonly ItemCobro[],
  firma: string,
  instrucciones: string,
): string {
  const n = items.length;
  const lineas = [
    n === 1 ? 'Te falta el comprobante de 1 gasto: 📋' : `Te faltan comprobantes de ${n} gastos: 📋`,
    ...items.slice(0, MAX_ITEMS_MENSAJE).map(renglon),
  ];
  if (n > MAX_ITEMS_MENSAJE) lineas.push(`…y ${n - MAX_ITEMS_MENSAJE} más. Están todos en el panel.`);
  lineas.push('', 'Mándame por aquí la foto del ticket o el XML de la factura y lo anoto.');
  if (instrucciones) lineas.push('', instrucciones);
  if (firma) lineas.push('', `— ${firma}`);
  return lineas.join('\n');
}

/** Los 3 parámetros de la plantilla `cobranza_gastos_v1`: nombre, cuántos y el primero (una sola línea). */
export function parametrosPlantillaGastos(nombre: string | null, items: readonly ItemCobro[]): [string, string, string] {
  const primero = items[0];
  const resumen = primero
    ? `${ROTULO_CONCEPTO_COBRANZA[primero.concepto] ?? primero.concepto} ${mxn(primero.monto)}${primero.fecha ? ` del ${fechaCorta(primero.fecha)}` : ''}: ${QUE_FALTA[primero.motivo]}`
    : 'revisa tus gastos';
  return [
    (nombre ?? 'Operador').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Operador',
    String(items.length),
    resumen.replace(/\s+/g, ' ').slice(0, 160),
  ];
}

// ── Efectividad ─────────────────────────────────────────────────────────────

export interface ContactoMedible {
  tier: number;
  motivo: MotivoComprobante;
  enviado: boolean;
  creadoEn: string;
  resueltoEn: string | null;
  resueltoPor: 'chofer' | 'cierre' | null;
}

export interface Efectividad {
  /** Avisos que SALIERON (los no enviados no miden nada). */
  avisos: number;
  /** El comprobante llegó después del aviso. */
  resueltosPorChofer: number;
  /** El viaje se cerró con el comprobante aún faltando. */
  cerradosSinResolver: number;
  /** Aún abiertos (sin resolver ni cerrar). */
  abiertos: number;
  /** resueltosPorChofer / avisos; null con menos de 5 avisos (no se publica un % de 2 casos). */
  tasa: number | null;
  /** Mediana de horas entre el aviso y la resolución por el chofer; null si no hay ninguna. */
  medianaHoras: number | null;
  porTier: Array<{ tier: number; avisos: number; resueltos: number }>;
  porMotivo: Array<{ motivo: MotivoComprobante; avisos: number; resueltos: number }>;
}

export const MIN_AVISOS_PARA_TASA = 5;

export function calcularEfectividad(contactos: readonly ContactoMedible[]): Efectividad {
  const enviados = contactos.filter((c) => c.enviado);
  const horas: number[] = [];
  let resueltos = 0; let cerrados = 0; let abiertos = 0;
  const porTier = new Map<number, { avisos: number; resueltos: number }>();
  const porMotivo = new Map<MotivoComprobante, { avisos: number; resueltos: number }>();
  for (const c of enviados) {
    const t = porTier.get(c.tier) ?? { avisos: 0, resueltos: 0 };
    const m = porMotivo.get(c.motivo) ?? { avisos: 0, resueltos: 0 };
    t.avisos++; m.avisos++;
    if (c.resueltoPor === 'chofer' && c.resueltoEn) {
      resueltos++; t.resueltos++; m.resueltos++;
      const h = (Date.parse(c.resueltoEn) - Date.parse(c.creadoEn)) / 3_600_000;
      if (Number.isFinite(h) && h >= 0) horas.push(h);
    } else if (c.resueltoPor === 'cierre') cerrados++;
    else abiertos++;
    porTier.set(c.tier, t); porMotivo.set(c.motivo, m);
  }
  horas.sort((a, b) => a - b);
  const medio = Math.floor(horas.length / 2);
  const mediana = horas.length === 0 ? null : horas.length % 2 ? horas[medio] : (horas[medio - 1] + horas[medio]) / 2;
  return {
    avisos: enviados.length,
    resueltosPorChofer: resueltos,
    cerradosSinResolver: cerrados,
    abiertos,
    tasa: enviados.length >= MIN_AVISOS_PARA_TASA ? resueltos / enviados.length : null,
    medianaHoras: mediana === null ? null : Math.round(mediana * 10) / 10,
    porTier: [...porTier.entries()].map(([tier, v]) => ({ tier, ...v })).sort((a, b) => a.tier - b.tier),
    porMotivo: [...porMotivo.entries()].map(([motivo, v]) => ({ motivo, ...v })),
  };
}

/** El inicio del día calendario de México (ISO UTC), para contar mensajes «de hoy». */
export function inicioDelDiaMx(ahora: Date): Date {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: TZ_MX, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
  // México no tiene horario de verano desde 2022: UTC-6 todo el año. Se calcula con
  // el desfase REAL de esa fecha para no depender de esa suposición.
  const medianocheUtc = new Date(`${partes}T00:00:00Z`);
  const desfase = desfaseMxMs(medianocheUtc);
  return new Date(medianocheUtc.getTime() - desfase);
}

function desfaseMxMs(en: Date): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_MX, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(en);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const local = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  return local - en.getTime();
}
