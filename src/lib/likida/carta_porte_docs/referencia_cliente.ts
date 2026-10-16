// ═══════════════════════════════════════════════════════════════════════════
// REFERENCIA COMERCIAL DEL CLIENTE EN EL REQUERIMIENTO + TABLERO DE PENDIENTES (T-A3-65, migración 0832).
//
// La referencia (la que el cliente necesita para cobrar) NO es un campo del CCP ni obliga al tránsito: es asunto de
// Comercial y de la carta de instrucciones. Se captura en el requerimiento, FUERA del documento fiscal. Por cliente se
// puede EXIGIR (`exige_referencia`, default no) y entonces el tablero lista los viajes con carga hecha y sin
// referencia, con su antigüedad, para que el ejecutivo la pida («ya no llevo quién me falta»).
//
// Reglas de siempre:
//   · NADA bloquea el viaje ni el timbrado: el aviso es informativo (`bloquea: false` por construcción).
//   · La referencia no entra al XML del CCP (la prueba lo vigila sobre el código del exportador y del convertidor).
//   · «Con y sin» se compara por cliente, sin juicio: cuántos viajes la traen y cuánto tarda en llegar.
// Todo es PURO; quien llama carga los insumos (referencia_cliente_puerto.ts) con el tenant de la SESIÓN.
// ═══════════════════════════════════════════════════════════════════════════

export const REFERENCIA_MAX = 60;
export const MS_HORA = 3_600_000;

/** Un viaje del tenant con lo que el tablero necesita. `cargaHechaEn` = cuándo se cargó (null = aún no). */
export interface ViajeReferencia {
  viajeId: string;
  clienteId: string | null;
  cargaHechaEn: string | null;
  referencia: string | null;
  /** Cuándo se capturó la referencia (para medir cuánto tardó «con» exigencia). */
  referenciaCapturadaEn?: string | null;
}

export interface ReglaReferencia { clienteId: string; exige: boolean }
export interface ClienteRef { id: string; nombre: string }

export type LecturaReferencia = { ok: true; referencia: string | null } | { ok: false; motivo: 'larga' | 'caracteres_invalidos' };

/** Limpia lo que escribió una persona: espacios de más fuera; vacío = sin referencia (no es error: es opcional). */
export function leerReferencia(crudo: string | null | undefined): LecturaReferencia {
  const t = String(crudo ?? '').replace(/\s+/g, ' ').trim();
  if (t === '') return { ok: true, referencia: null };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(t)) return { ok: false, motivo: 'caracteres_invalidos' };
  if ([...t].length > REFERENCIA_MAX) return { ok: false, motivo: 'larga' };
  return { ok: true, referencia: t };
}

const tiene = (v: string | null | undefined): boolean => v !== null && v !== undefined && v.trim() !== '';

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export interface PendienteReferencia { viajeId: string; cargaHechaEn: string; antiguedadHoras: number }
export interface ClientePendiente {
  clienteId: string;
  clienteNombre: string;
  pendientes: number;
  /** Antigüedad (horas, enteras hacia abajo) del más viejo. */
  masAntiguoHoras: number;
  viajes: PendienteReferencia[];
}
export interface Tablero { total: number; clientes: ClientePendiente[] }

function exigen(reglas: readonly ReglaReferencia[]): Set<string> {
  return new Set(reglas.filter((r) => r.exige).map((r) => r.clienteId));
}

/**
 * Viajes con carga hecha y SIN referencia de los clientes que la exigen. Cliente sin la exigencia (o sin regla): nada.
 * Orden: cliente con el pendiente más antiguo primero (desempata por nombre); dentro, el viaje más antiguo primero.
 */
export function tableroReferenciasPendientes(
  viajes: readonly ViajeReferencia[],
  reglas: readonly ReglaReferencia[],
  clientes: readonly ClienteRef[],
  ahora: Date,
): Tablero {
  const exige = exigen(reglas);
  const nombre = new Map(clientes.map((c) => [c.id, c.nombre]));
  const porCliente = new Map<string, PendienteReferencia[]>();
  for (const v of viajes) {
    if (!v.clienteId || !exige.has(v.clienteId) || tiene(v.referencia)) continue;
    const carga = ms(v.cargaHechaEn);
    if (carga === null) continue;
    const horas = Math.max(0, Math.floor((ahora.getTime() - carga) / MS_HORA));
    const lista = porCliente.get(v.clienteId) ?? [];
    lista.push({ viajeId: v.viajeId, cargaHechaEn: v.cargaHechaEn as string, antiguedadHoras: horas });
    porCliente.set(v.clienteId, lista);
  }
  const salida: ClientePendiente[] = [...porCliente.entries()].map(([clienteId, lista]) => {
    const viajesOrd = [...lista].sort((a, b) => b.antiguedadHoras - a.antiguedadHoras || a.viajeId.localeCompare(b.viajeId));
    return { clienteId, clienteNombre: nombre.get(clienteId) ?? 'Cliente sin nombre', pendientes: viajesOrd.length, masAntiguoHoras: viajesOrd[0].antiguedadHoras, viajes: viajesOrd };
  });
  salida.sort((a, b) => b.masAntiguoHoras - a.masAntiguoHoras || a.clienteNombre.localeCompare(b.clienteNombre));
  return { total: salida.reduce((s, c) => s + c.pendientes, 0), clientes: salida };
}

export interface AvisoReferencia { clienteId: string; texto: string; bloquea: false }

/** Un aviso por cliente con pendientes, para el ejecutivo. Informativo: jamás frena el viaje ni el timbrado. */
export function avisosReferencia(t: Tablero): AvisoReferencia[] {
  return t.clientes.map((c) => ({
    clienteId: c.clienteId,
    bloquea: false as const,
    texto: `${c.clienteNombre}: ${c.pendientes} ${c.pendientes === 1 ? 'viaje cargado sin referencia' : 'viajes cargados sin referencia'}; el más antiguo lleva ${c.masAntiguoHoras} h. Pídesela al cliente; el viaje y el timbrado siguen su curso.`,
  }));
}

export interface ComparacionCliente {
  clienteId: string;
  clienteNombre: string;
  exige: boolean;
  /** Viajes con carga hecha. */
  cargados: number;
  conReferencia: number;
  sinReferencia: number;
  /** Porcentaje (0–100, un decimal) de cargados con referencia; null si no hay cargados. */
  pctConReferencia: number | null;
  /** Promedio de horas entre la carga y la captura (solo viajes con ambas marcas); null si no hay dato. */
  horasPromedioHastaCaptura: number | null;
}

/** «Con y sin» la exigencia, por cliente: sirve para ver si exigirla cambia cuántas llegan y qué tan rápido. */
export function compararConSin(
  viajes: readonly ViajeReferencia[],
  reglas: readonly ReglaReferencia[],
  clientes: readonly ClienteRef[],
): ComparacionCliente[] {
  const exige = exigen(reglas);
  const nombre = new Map(clientes.map((c) => [c.id, c.nombre]));
  const acum = new Map<string, { cargados: number; con: number; horas: number[] }>();
  for (const v of viajes) {
    if (!v.clienteId || ms(v.cargaHechaEn) === null) continue;
    const a = acum.get(v.clienteId) ?? { cargados: 0, con: 0, horas: [] };
    a.cargados += 1;
    if (tiene(v.referencia)) {
      a.con += 1;
      const carga = ms(v.cargaHechaEn);
      const cap = ms(v.referenciaCapturadaEn);
      if (carga !== null && cap !== null) a.horas.push(Math.max(0, (cap - carga) / MS_HORA));
    }
    acum.set(v.clienteId, a);
  }
  const redondeo = (n: number): number => Math.round(n * 10) / 10;
  return [...acum.entries()]
    .map(([clienteId, a]): ComparacionCliente => ({
      clienteId,
      clienteNombre: nombre.get(clienteId) ?? 'Cliente sin nombre',
      exige: exige.has(clienteId),
      cargados: a.cargados,
      conReferencia: a.con,
      sinReferencia: a.cargados - a.con,
      pctConReferencia: a.cargados === 0 ? null : redondeo((a.con / a.cargados) * 100),
      horasPromedioHastaCaptura: a.horas.length === 0 ? null : redondeo(a.horas.reduce((s, h) => s + h, 0) / a.horas.length),
    }))
    .sort((x, y) => x.clienteNombre.localeCompare(y.clienteNombre) || x.clienteId.localeCompare(y.clienteId));
}
