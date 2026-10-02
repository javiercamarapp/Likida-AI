// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN FASE 1 — del archivo de «su sistema» al cuerpo de
// POST /v1/liquidaciones-externas (el importador que YA existe: 0370).
//
// La flota calcula la liquidación en su SAP/TMS; Likida solo la entrega. El
// archivo que mande (CSV, una fila por renglón de la liquidación) se agrupa por
// `clave_externa` y se convierte al cuerpo del contrato. Este módulo NO valida
// el contrato a fondo (eso lo hace el endpoint, estricto); solo arma el cuerpo y
// avisa de lo que haría fallar al agrupar: totales que no cuadran, renglones sin
// tipo, periodos incoherentes.
//
// Contrato del archivo (encabezados, sin distinguir mayúsculas ni acentos):
//   clave_externa*  numero_empleado*  periodo_desde*  periodo_hasta*  folios_viaje (separados por |)
//   concepto_clave  concepto*  tipo* (percepcion|deduccion)  monto*  total_sistema*  moneda
// El formato EXACTO del Excel de la flota (el formato que hoy copian y pegan) es un bloqueo
// declarado: cuando llegue se agrega una línea de alias en ALIAS.
// ═══════════════════════════════════════════════════════════════════════════

import { partirCsv } from '../conectores/tabla_propia/csv';
import { leerNumero, llaveEncabezado } from '../conectores/tabla_propia/validar';

export interface CuerpoLiquidacionExterna {
  claveExterna: string;
  sistemaOrigen: string;
  operador: { numeroEmpleado: string };
  viajes: string[];
  periodo: { desde: string; hasta: string };
  conceptos: Array<{ clave?: string; descripcion: string; tipo: 'percepcion' | 'deduccion'; monto: number }>;
  total: number;
  moneda: 'MXN' | 'USD';
}

export interface ProblemaLiquidacion { clave: string | null; fila: number | null; motivo: string }
export interface ResultadoLiquidacionesCsv { cuerpos: CuerpoLiquidacionExterna[]; problemas: ProblemaLiquidacion[] }

const ALIAS: Record<string, string[]> = {
  clave: ['clave_externa', 'folio_liquidacion', 'folio', 'liquidacion'],
  empleado: ['numero_empleado', 'no_empleado', 'empleado', 'num_empleado'],
  desde: ['periodo_desde', 'desde', 'fecha_inicio'],
  hasta: ['periodo_hasta', 'hasta', 'fecha_fin'],
  folios: ['folios_viaje', 'viajes', 'folios'],
  conceptoClave: ['concepto_clave', 'clave_concepto'],
  concepto: ['concepto', 'descripcion', 'descripcion_concepto'],
  tipo: ['tipo', 'tipo_concepto'],
  monto: ['monto', 'importe'],
  total: ['total_sistema', 'total', 'neto', 'neto_a_pagar'],
  moneda: ['moneda'],
};
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Excel guarda una fecha como NÚMERO DE SERIE (días desde 1899-12-30): 46023 es 2026-01-01. Al volcar la hoja a texto
 * llega así, y rechazarla obligaba a la oficina a reformatear su archivo. Se acepta SOLO un entero de cinco cifras (con
 * o sin fracción de hora, que se descarta) entre 2000-01-01 y 2099-12-31, para no confundir un número cualquiera con una
 * fecha; todo lo demás sigue sin ser fecha y se rechaza con el mismo mensaje.
 */
export function fechaDeSerialExcel(texto: string): string | null {
  const t = texto.trim();
  const corte = t.search(/[.,]/);
  const entera = corte === -1 ? t : t.slice(0, corte);
  const fraccion = corte === -1 ? '' : t.slice(corte + 1);
  if (!/^\d{5}$/.test(entera) || (corte !== -1 && !/^\d+$/.test(fraccion))) return null;
  const dias = Number(entera);
  if (dias < 36526 || dias > 73050) return null;
  return new Date(Date.UTC(1899, 11, 30) + dias * 86_400_000).toISOString().slice(0, 10);
}

/** `AAAA-MM-DD` tal cual, o la fecha de un número de serie de Excel; vacío si no es ninguna de las dos. */
export function fechaDeCelda(texto: string): string {
  const t = texto.trim();
  return FECHA.test(t) ? t : fechaDeSerialExcel(t) ?? t;
}
const centavos = (n: number) => Math.round(n * 100);

export function cuerposDeLiquidacionesCsv(texto: string, sistemaOrigen = 'SAP (demo)'): ResultadoLiquidacionesCsv {
  const matriz = partirCsv(texto);
  const problemas: ProblemaLiquidacion[] = [];
  if (matriz.length === 0) return { cuerpos: [], problemas: [{ clave: null, fila: null, motivo: 'El archivo está vacío.' }] };
  const llaves = matriz[0].map(llaveEncabezado);
  const ix: Record<string, number> = {};
  for (const [k, alias] of Object.entries(ALIAS)) ix[k] = alias.map((a) => llaves.indexOf(a)).find((i) => i >= 0) ?? -1;
  const obligatorias = ['clave', 'empleado', 'desde', 'hasta', 'concepto', 'tipo', 'monto', 'total'];
  const faltan = obligatorias.filter((k) => ix[k] < 0);
  if (faltan.length) return { cuerpos: [], problemas: [{ clave: null, fila: null, motivo: `Faltan columnas: ${faltan.map((k) => ALIAS[k][0]).join(', ')}.` }] };

  const decimalComa = (matriz[0].length > 0) && texto.split(/\r?\n/, 1)[0].includes(';');
  const grupos = new Map<string, { filas: Array<{ fila: number; c: string[] }> }>();
  matriz.slice(1).forEach((c, k) => {
    const clave = (c[ix.clave] ?? '').trim();
    if (!clave) return void problemas.push({ clave: null, fila: k + 2, motivo: 'fila sin clave_externa' });
    (grupos.get(clave) ?? grupos.set(clave, { filas: [] }).get(clave)!).filas.push({ fila: k + 2, c });
  });

  const cuerpos: CuerpoLiquidacionExterna[] = [];
  for (const [clave, g] of grupos) {
    const p = g.filas[0].c;
    const err = (motivo: string, fila: number | null = g.filas[0].fila) => problemas.push({ clave, fila, motivo });
    const empleado = (p[ix.empleado] ?? '').trim(); const desde = fechaDeCelda(p[ix.desde] ?? ''); const hasta = fechaDeCelda(p[ix.hasta] ?? '');
    if (!empleado) { err('sin numero_empleado'); continue; }
    if (!FECHA.test(desde) || !FECHA.test(hasta) || desde > hasta) { err('periodo ilegible o incoherente (se espera AAAA-MM-DD, o una fecha de Excel, y desde ≤ hasta)'); continue; }
    const total = leerNumero(p[ix.total] ?? '', decimalComa);
    if (total === null) { err('total_sistema ilegible'); continue; }
    const conceptos: CuerpoLiquidacionExterna['conceptos'] = []; let ok = true;
    for (const { fila, c } of g.filas) {
      const tipo = (c[ix.tipo] ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const monto = leerNumero(c[ix.monto] ?? '', decimalComa);
      const desc = (c[ix.concepto] ?? '').trim();
      if (tipo !== 'percepcion' && tipo !== 'deduccion') { err(`tipo «${c[ix.tipo] ?? ''}» no es percepcion/deduccion`, fila); ok = false; continue; }
      if (monto === null || monto < 0) { err('monto ilegible o negativo (el signo lo da el tipo)', fila); ok = false; continue; }
      if (!desc) { err('concepto vacío', fila); ok = false; continue; }
      conceptos.push({ ...(ix.conceptoClave >= 0 && (c[ix.conceptoClave] ?? '').trim() ? { clave: c[ix.conceptoClave].trim() } : {}), descripcion: desc, tipo, monto });
    }
    if (!ok) continue;
    const suma = conceptos.reduce((s, x) => s + (x.tipo === 'percepcion' ? centavos(x.monto) : -centavos(x.monto)), 0);
    if (suma !== centavos(total)) { err(`el total del sistema (${total.toFixed(2)}) no es la suma de sus renglones (${(suma / 100).toFixed(2)}): no se entrega a ciegas`); continue; }
    const moneda = ix.moneda >= 0 && (p[ix.moneda] ?? '').trim().toUpperCase() === 'USD' ? 'USD' : 'MXN';
    const folios = ix.folios >= 0 ? (p[ix.folios] ?? '').split('|').map((s) => s.trim()).filter(Boolean) : [];
    cuerpos.push({ claveExterna: clave, sistemaOrigen, operador: { numeroEmpleado: empleado }, viajes: folios, periodo: { desde, hasta }, conceptos, total, moneda });
  }
  return { cuerpos, problemas };
}
