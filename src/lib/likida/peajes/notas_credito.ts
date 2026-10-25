import { evaluarReclamo, type EstadoReclamo } from './reclamos_seguimiento';

// ═══════════════════════════════════════════════════════════════════════════
// CASAR UNA NOTA DE CRÉDITO CONTRA LOS RECLAMOS: «acreditado vs reclamado».
//
// El proveedor no contesta el reclamo: simplemente aparece una nota de crédito por
// un importe, SIN detalle de qué cruces cubre — «no sabes si fueron todos los que
// reclamaste». Este módulo propone a qué reclamo(s) corresponde, por suma exacta:
//   (a) un reclamo cuyo monto reclamable es igual al importe → `seguro`
//       (si hay dos o más reclamos del mismo monto, ninguno se elige: `sugerido`
//       con todas las opciones);
//   (b) un subconjunto de reclamos cuya suma es exactamente el importe →
//       `sugerido`; si hay varios subconjuntos válidos se listan todos;
//   (c) nada coincide → `sin_casar`.
// NUNCA confirma solo: toda propuesta exige confirmación manual (`confirmado:false`).
// La combinatoria está acotada: con más de `MAX_RECLAMOS_SUBCONJUNTO` reclamos
// abiertos (o si la búsqueda excede su presupuesto) responde `demasiados`.
//
// ESTADO (A37-S52-04): este módulo y `reclamosParaCasar` (repo.ts) TODAVÍA NO tienen llamador fuera de pruebas: ninguna pantalla ofrece
// la propuesta, así que el «acreditado» se sigue capturando a mano. Cablearlo a la pantalla de seguimiento es trabajo de producto pendiente.
//
// PURO: sin base, sin red; el reloj se inyecta. Dinero en centavos enteros.
// ═══════════════════════════════════════════════════════════════════════════

export const MAX_RECLAMOS_SUBCONJUNTO = 25;
/** Máximo de subconjuntos que se listan; más allá se dice `truncado`. */
export const MAX_PROPUESTAS = 10;
/** Presupuesto de nodos de la búsqueda: evita colgarse con casos patológicos. */
const PRESUPUESTO_NODOS = 2_000_000;

export interface NotaCredito {
  /** Importe de la nota (positivo). */
  importe: number;
  fecha?: string | null;
  referencia?: string | null;
}

export interface ReclamoParaCasar {
  id: string;
  estado: EstadoReclamo;
  /** Lo que aún se puede acreditar de este reclamo (reclamado − ya acreditado). */
  montoReclamable: number;
  fechaCobroMasAntiguo: string;
}

export type ResultadoCasado =
  | { tipo: 'seguro'; reclamoIds: [string]; confirmado: false; alertas: AlertaNota[] }
  | { tipo: 'sugerido'; opciones: string[][]; ambiguo: boolean; truncado: boolean; confirmado: false; alertas: AlertaNota[] }
  | { tipo: 'demasiados'; mensaje: string; confirmado: false; alertas: AlertaNota[] }
  | { tipo: 'sin_casar'; confirmado: false; alertas: AlertaNota[] };

export type AlertaNota = 'nota_mayor_que_reclamado' | 'importe_invalido';

const centavos = (n: number) => Math.round(n * 100);

/** Orden estable: el reclamo más antiguo primero (el plazo corre desde ahí), luego por id. */
function porAntiguedad(a: ReclamoParaCasar, b: ReclamoParaCasar): number {
  return a.fechaCobroMasAntiguo.localeCompare(b.fechaCobroMasAntiguo) || a.id.localeCompare(b.id);
}

export function casarNota(nota: NotaCredito, reclamosPendientes: readonly ReclamoParaCasar[]): ResultadoCasado {
  const objetivo = centavos(nota.importe);
  if (!Number.isFinite(nota.importe) || objetivo <= 0) return { tipo: 'sin_casar', confirmado: false, alertas: ['importe_invalido'] };

  const abiertos = reclamosPendientes
    .filter((r) => Number.isFinite(r.montoReclamable) && centavos(r.montoReclamable) > 0)
    .map((r) => ({ r, c: centavos(r.montoReclamable) }))
    .sort((a, b) => porAntiguedad(a.r, b.r));
  const total = abiertos.reduce((s, x) => s + x.c, 0);
  const alertas: AlertaNota[] = objetivo > total ? ['nota_mayor_que_reclamado'] : [];

  // (a) un reclamo con el monto exacto.
  const iguales = abiertos.filter((x) => x.c === objetivo);
  if (iguales.length === 1) return { tipo: 'seguro', reclamoIds: [iguales[0].r.id], confirmado: false, alertas };
  if (iguales.length > 1) {
    return { tipo: 'sugerido', opciones: iguales.map((x) => [x.r.id]), ambiguo: true, truncado: false, confirmado: false, alertas };
  }
  if (alertas.length) return { tipo: 'sin_casar', confirmado: false, alertas };

  // (b) subconjunto de suma exacta.
  if (abiertos.length > MAX_RECLAMOS_SUBCONJUNTO) {
    return {
      tipo: 'demasiados', confirmado: false, alertas,
      mensaje: `Hay ${abiertos.length} reclamos abiertos (más de ${MAX_RECLAMOS_SUBCONJUNTO}): casa la nota a mano.`,
    };
  }
  const restante: number[] = new Array(abiertos.length + 1).fill(0); // suma de los que faltan
  for (let i = abiertos.length - 1; i >= 0; i--) restante[i] = restante[i + 1] + abiertos[i].c;

  const encontrados: string[][] = [];
  let nodos = 0;
  let excedido = false;
  const actual: number[] = [];
  const buscar = (i: number, suma: number): void => {
    if (excedido || encontrados.length > MAX_PROPUESTAS) return;
    if (++nodos > PRESUPUESTO_NODOS) { excedido = true; return; }
    if (suma === objetivo) { if (actual.length >= 2) encontrados.push(actual.map((k) => abiertos[k].r.id)); return; }
    if (i >= abiertos.length || suma > objetivo || suma + restante[i] < objetivo) return;
    actual.push(i);
    buscar(i + 1, suma + abiertos[i].c);
    actual.pop();
    buscar(i + 1, suma);
  };
  buscar(0, 0);

  if (excedido) {
    return { tipo: 'demasiados', confirmado: false, alertas, mensaje: 'La búsqueda de combinaciones es demasiado grande: casa la nota a mano.' };
  }
  if (!encontrados.length) return { tipo: 'sin_casar', confirmado: false, alertas };
  const truncado = encontrados.length > MAX_PROPUESTAS;
  const opciones = encontrados.slice(0, MAX_PROPUESTAS);
  return { tipo: 'sugerido', opciones, ambiguo: opciones.length > 1, truncado, confirmado: false, alertas };
}

// ─── Acreditado vs reclamado ────────────────────────────────────────────────

export interface ReclamoParaResumen {
  id: string;
  estado: EstadoReclamo;
  fechaCobroMasAntiguo: string;
  montoReclamado: number;
  /** Solo lo ya CONFIRMADO a mano (peaje_reclamo.monto_acreditado). */
  montoAcreditado: number;
}

export interface ResumenAcreditacion {
  reclamado: number;
  acreditado: number;
  diferencia: number;
  /**
   * A37-A2-04: lo que de verdad falta por acreditar: SOLO reclamos abiertos (enviado / acreditado_parcial), cada uno con su
   * saldo (nunca compensado con lo acreditado de más en otro). Un preparado o un rechazado no es dinero pendiente.
   */
  pendiente: number;
  /** Reclamos enviados con saldo por acreditar que aún no tienen confirmación completa. */
  sinConfirmar: string[];
  /** De esos, los que ya superaron el plazo de 3 meses sin acreditarse por completo. */
  superaronPlazoSinRespuesta: string[];
  /** Lo acreditado supera lo reclamado: revisar (nota de más o reclamo sin registrar). */
  alertas: Array<'acreditado_mayor_que_reclamado'>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function resumirAcreditacion(reclamos: readonly ReclamoParaResumen[], hoy: string): ResumenAcreditacion {
  let rec = 0;
  let acr = 0;
  let pend = 0;
  const sinConfirmar: string[] = [];
  const vencidos: string[] = [];
  for (const r of reclamos) {
    // A37-A2-04: «reclamado» es lo que de verdad se le reclamó al proveedor. Un reclamo solo preparado (nunca enviado) o
    // rechazado no se suma: antes inflaba «Reclamado» y «Falta acreditar» ante el contralor.
    if (r.estado === 'preparado' || r.estado === 'rechazado') continue;
    rec += centavos(r.montoReclamado);
    acr += centavos(r.montoAcreditado);
    if (r.estado !== 'enviado' && r.estado !== 'acreditado_parcial') continue;
    if (centavos(r.montoReclamado) - centavos(r.montoAcreditado) <= 0) continue;
    pend += centavos(r.montoReclamado) - centavos(r.montoAcreditado);
    sinConfirmar.push(r.id);
    if (evaluarReclamo(r, hoy).alerta === 'vencido') vencidos.push(r.id);
  }
  return {
    reclamado: rec / 100, acreditado: acr / 100, diferencia: r2((rec - acr) / 100), pendiente: pend / 100,
    sinConfirmar, superaronPlazoSinRespuesta: vencidos,
    alertas: acr > rec ? ['acreditado_mayor_que_reclamado'] : [],
  };
}
