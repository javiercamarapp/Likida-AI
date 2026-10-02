// ═══════════════════════════════════════════════════════════════════════════
// MULTI-EMBARQUE — un Excel/CSV con N embarques se PARTE en N documentos hijos.
//
// Un documento de Carta Porte es UN embarque (un viaje). Los clientes grandes mandan a veces el plan del día: un solo
// Excel con varios folios. Hasta aquí se leía el primero y se avisaba «sube el resto por separado»; el resto se perdía
// si nadie leía el aviso. Ahora el archivo se parte:
//
//   · se detecta la columna del folio (la que el perfil del cliente ya mapea a `folio_cliente`, o, sin perfil, una
//     cabecera inequívoca: «Folio», «Folio embarque», «Embarque», «Shipment»…);
//   · las filas se agrupan por folio (una celda de folio vacía hereda el folio de la fila de arriba: Excel con celdas
//     combinadas) y las filas de TOTALES se descartan (los totales de un renglón no son de ningún embarque);
//   · cada grupo se vuelve un CSV propio (cabecera + sus filas): el archivo derivado de ese embarque, con SU huella
//     sha256, que entra a la bandeja como un documento más y sigue el camino de siempre (extracción, revisión,
//     aprobación, viaje). Todos los hermanos comparten la HUELLA BASE: el sha256 del archivo original.
//
// Este archivo es PURO: no toca base ni red. La atomicidad (padre `dividido` + hijos) vive en la RPC de la 0671.
//
// Lo que NO hace, a propósito: partir PDF, foto, XML o correo (un documento de esos formatos con varios embarques
// sigue leyéndose por el primero y el modelo lo dice en sus notas) y adivinar la columna del folio con nombres
// ambiguos («Pedido», «Referencia», «Orden»): una columna así puede traer un valor distinto por RENGLÓN de un mismo
// embarque, y partirlo en documentos de una fila sería peor que el problema. Sin una cabecera inequívoca ni perfil, el
// archivo se lee como hasta ahora.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import type { ContenidoDoc } from './contenido';
import { filasDeDatos, llaveColumna, tablaDeMapeos, tablasDe, type Perfil, type TablaLeida } from './perfiles';

/** Embarques máximos por archivo. Más que eso es un volcado de sistema, no el plan de un día: no se parte. */
export const MAX_EMBARQUES = 100;

/** Cabeceras que, tal cual, son el folio de UN embarque (ya normalizadas con `llaveColumna`). */
const CABECERAS_DE_FOLIO = new Set([
  'folio', 'folio embarque', 'folio de embarque', 'folio cliente', 'folio del cliente', 'folio viaje', 'folio de viaje',
  'no folio', 'num folio', 'numero de folio',
  'embarque', 'no embarque', 'num embarque', 'numero de embarque', 'id embarque', 'id de embarque', 'clave de embarque',
  'shipment', 'shipment id', 'shipment no', 'shipment number', 'no de shipment',
]);

export interface EmbarqueDetectado {
  /** 1..n, en el orden en que aparece el folio en el archivo. */
  indice: number;
  /** El folio tal como lo escribió el cliente (la primera escritura). */
  clave: string;
  filas: string[][];
}

export interface PlanDivision {
  hoja: string;
  encabezados: string[];
  /** El encabezado de la columna que trae el folio. */
  columnaFolio: string;
  embarques: EmbarqueDetectado[];
  /** De dónde salió la columna: el perfil del cliente o una cabecera inequívoca. */
  origenColumna: 'perfil' | 'cabecera';
  avisos: string[];
}

const claveDeFolio = (v: string): string => v.trim().toLowerCase().replace(/\s+/g, ' ');

/** La tabla y la columna del folio: la del perfil si lo mapea, o una cabecera inequívoca. */
function localizarColumnaFolio(c: ContenidoDoc, perfil: Perfil | null): { tabla: TablaLeida; columna: number; origen: 'perfil' | 'cabecera' } | null {
  const mapeos = perfil?.activa.mapeos ?? [];
  const delPerfil = mapeos.find((m) => !m.mercancia && m.campo === 'folio_cliente' && m.fuente.tipo === 'columna');
  if (delPerfil && delPerfil.fuente.tipo === 'columna') {
    const t = tablaDeMapeos(mapeos, c);
    const i = t ? t.llaves.indexOf(llaveColumna(delPerfil.fuente.encabezado)) : -1;
    if (t && i >= 0) return { tabla: t, columna: i, origen: 'perfil' };
    // El perfil mapea una columna que este archivo ya no trae: sin ella no hay folio que agrupar.
    return null;
  }
  for (const t of tablasDe(c)) {
    const i = t.llaves.findIndex((k) => CABECERAS_DE_FOLIO.has(k));
    if (i >= 0) return { tabla: t, columna: i, origen: 'cabecera' };
  }
  return null;
}

export interface EvaluacionDivision {
  /** El plan, si hay 2 a `MAX_EMBARQUES` embarques. */
  plan: PlanDivision | null;
  /** Cuántos embarques trae cuando son MÁS de `MAX_EMBARQUES` (no se parte; la lectura lo avisa). `null` en los demás casos. */
  exceso: number | null;
  /**
   * M2 (ronda 15): el libro trae varios embarques en la hoja del folio PERO también datos en otras hojas. Los hijos son CSV de UNA
   * tabla: partir solo se llevaría la hoja del folio y cada embarque perdería, sin aviso, las demás (detalle por folio, mercancías,
   * catálogos). Decisión: NO se parte; el libro entero se lee como un solo documento y se avisa. Es mejor un documento con todo
   * y un aviso claro que N documentos que callan lo que les falta.
   */
  variasHojas: { hojaDelFolio: string; otras: string[]; embarques: number } | null;
}

/**
 * ¿Este contenido trae más de un embarque? `plan: null` = no hay nada que partir (no es tabla, un solo folio, sin columna de
 * folio inequívoca, o son más de `MAX_EMBARQUES`: en ese caso `exceso` lo dice).
 */
export function evaluarDivision(c: ContenidoDoc, perfil: Perfil | null): EvaluacionDivision {
  const nada: EvaluacionDivision = { plan: null, exceso: null, variasHojas: null };
  if (!c.tabla || (c.formato !== 'excel' && c.formato !== 'csv')) return nada;
  const hallada = localizarColumnaFolio(c, perfil);
  if (!hallada) return nada;
  const { tabla, columna, origen } = hallada;
  const datos = filasDeDatos(tabla);

  const grupos = new Map<string, EmbarqueDetectado>();
  const avisos: string[] = [];
  let actual: EmbarqueDetectado | null = null;
  const huerfanas: string[][] = [];
  for (const fila of datos) {
    const celda = (fila[columna] ?? '').trim();
    if (celda !== '') {
      const k = claveDeFolio(celda);
      let g = grupos.get(k);
      if (!g) {
        g = { indice: grupos.size + 1, clave: celda.slice(0, 120), filas: [] };
        grupos.set(k, g);
      }
      actual = g;
    }
    if (actual) actual.filas.push(fila);
    else huerfanas.push(fila); // filas con datos ANTES del primer folio
  }
  if (grupos.size < 2) return nada;
  if (grupos.size > MAX_EMBARQUES) return { plan: null, exceso: grupos.size, variasHojas: null };
  const otras = (c.tabla ?? []).filter((h) => h.nombre !== tabla.hoja && h.filas.some((f) => f.some((x) => String(x ?? '').trim() !== ''))).map((h) => h.nombre);
  if (otras.length > 0) return { plan: null, exceso: null, variasHojas: { hojaDelFolio: tabla.hoja, otras, embarques: grupos.size } };
  if (huerfanas.length > 0) {
    // Heredan el primer folio: lo más probable es un renglón de mercancía del primer embarque con la celda combinada.
    const primero = [...grupos.values()][0];
    primero.filas = [...huerfanas, ...primero.filas];
    avisos.push(`${huerfanas.length} ${huerfanas.length === 1 ? 'fila venía' : 'filas venían'} sin folio antes del primero y se asignaron al embarque «${primero.clave}». Revísalo.`);
  }
  return {
    plan: {
      hoja: tabla.hoja, encabezados: tabla.encabezados, columnaFolio: tabla.encabezados[columna] ?? '', embarques: [...grupos.values()],
      origenColumna: origen, avisos,
    },
    exceso: null,
    variasHojas: null,
  };
}

/** Atajo: solo el plan. */
export const planearDivision = (c: ContenidoDoc, perfil: Perfil | null): PlanDivision | null => evaluarDivision(c, perfil).plan;

// ── Los archivos derivados ──────────────────────────────────────────────────

/**
 * Una celda de CSV. Se aplana el salto de línea y el tabulador (el lector detecta CSV por líneas: una celda con salto
 * de línea lo rompería) y se neutraliza el inicio de fórmula (`=`, `+`, `@`, `-letra`): el archivo derivado se puede
 * descargar y abrir en Excel, y una celda de un tercero no debe ejecutarse al abrirlo.
 */
function celdaCsv(valor: string): string {
  let v = String(valor ?? '').replace(/[\r\n\t]+/g, ' ');
  if (/^[=+@]/.test(v) || /^-[A-Za-z(]/.test(v)) v = `'${v}`;
  return /[",;|]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function aCsv(encabezados: string[], filas: string[][]): string {
  const ancho = encabezados.length;
  const linea = (f: string[]): string => new Array<string>(ancho).fill('').map((_, i) => celdaCsv(f[i] ?? '')).join(',');
  return `${[linea(encabezados), ...filas.map(linea)].join('\n')}\n`;
}

export interface HijoDerivado {
  indice: number;
  clave: string;
  nombre: string;
  bytes: Uint8Array;
  sha256: string;
  filas: number;
}

const sinExtension = (n: string): string => n.replace(/\.[A-Za-z0-9]{1,5}$/, '');

/** El nombre del archivo hijo: «<original> · embarque <folio>.csv», acotado a 200 y sin caracteres de control. */
export function nombreDeHijo(nombreOriginal: string, clave: string): string {
  const folio = clave.replace(/[\u0000-\u001f\u007f/\\]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'sin folio';
  const base = sinExtension(nombreOriginal).slice(0, 140);
  return `${base} · embarque ${folio}.csv`;
}

/** Los N archivos derivados, deterministas: el mismo Excel produce los mismos bytes y, por tanto, las mismas huellas. */
export function derivarHijos(plan: PlanDivision, nombreOriginal: string): HijoDerivado[] {
  return plan.embarques.map((e) => {
    const bytes = new TextEncoder().encode(aCsv(plan.encabezados, e.filas));
    return {
      indice: e.indice, clave: e.clave, nombre: nombreDeHijo(nombreOriginal, e.clave), bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'), filas: e.filas.length,
    };
  });
}
