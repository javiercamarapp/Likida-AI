// ═══════════════════════════════════════════════════════════════════════════
// PLAN B (b) — IMPORTADOR CSV/EXCEL DEL EXPORT DE BITÁCORAS (T-A1-22).
//
// Si la API del sistema de transporte no llega, el cliente exporta sus bitácoras (una fila por CONCEPTO) y este módulo las
// agrupa por `(terminal, bitacora)` en `DesgloseBitacora` y las manda por el MISMO camino que el POST /v1 de desgloses
// (`recibirDesglose`: idempotencia, guardas, Excel, entregas). No toca el CSV propio de Likida (`liquidacion_csv.ts`).
//
// BLOQUEO EXTERNO: el formato real del export aún no existe. Los encabezados de abajo son ALIAS razonables (sin distinguir
// mayúsculas, acentos ni separadores); cuando llegue el archivo real se agrega una línea en ALIAS, nada más.
//
// Columnas (`;` `,` o tab; con `;` el decimal puede ser coma):
//   terminal  bitacora*  poliza  numero_empleado*  unidad  desde*  hasta*  dias  tipo*  concepto*  monto*  vale  neto  tipo_operador
//   · `tipo`: percepcion | deduccion, o cargo (= percepción) | abono (= deducción), regla del cliente.
//   · fechas: AAAA-MM-DD, DD/MM/AAAA o número de serie de Excel.
//   · los campos del ENCABEZADO (póliza, empleado, unidad, fechas, días, neto, tipo de operador) se toman de la primera fila
//     que los trae; si dos filas de la misma bitácora traen valores DISTINTOS, la bitácora se reporta y no entra.
// Lo que no se entiende se REPORTA con su número de fila y no frena a las demás bitácoras. Una bitácora sin póliza no se
// envía: queda como excepción `sin_poliza` (se resuelve sola cuando el export posterior ya la trae).
// ═══════════════════════════════════════════════════════════════════════════

import { CampoInvalido } from '@/lib/http/campos_cuerpo';
import { partirCsv, separadorDe } from '../conectores/tabla_propia/csv';
import { leerNumero, llaveEncabezado } from '../conectores/tabla_propia/validar';
import { matrizDeArchivoCatalogo } from '../peajes/archivo';
import { decodificarTexto } from '../peajes/csv';
import { fechaDeCelda } from './liquidacion_csv';
import {
  TIPOS_OPERADOR, claveDeBitacora, validarDesgloseBitacora,
  type DesgloseBitacora, type RenglonBitacora, type TipoOperadorDesglose,
} from './desglose_contrato';
import type { ResultadoDesglose } from './desglose_recibir';

export const MAX_BITACORAS_POR_ARCHIVO = 300;

const ALIAS: Record<string, string[]> = {
  terminal: ['terminal', 'sucursal', 'plaza'],
  bitacora: ['bitacora', 'no_bitacora', 'num_bitacora', 'folio_bitacora'],
  poliza: ['poliza', 'no_poliza', 'num_poliza'],
  empleado: ['numero_empleado', 'no_empleado', 'num_empleado', 'empleado', 'clave_operador'],
  unidad: ['unidad', 'economico', 'no_unidad', 'tractor'],
  desde: ['desde', 'fecha_inicio', 'periodo_desde', 'fecha_desde', 'inicio'],
  hasta: ['hasta', 'fecha_fin', 'periodo_hasta', 'fecha_hasta', 'fin'],
  dias: ['dias', 'dias_trabajados', 'no_dias'],
  tipo: ['tipo', 'tipo_concepto', 'naturaleza'],
  concepto: ['concepto', 'descripcion', 'desglose'],
  monto: ['monto', 'importe', 'valor'],
  vale: ['vale', 'no_vale', 'num_vale'],
  neto: ['neto', 'neto_a_pagar', 'total'],
  tipoOperador: ['tipo_operador', 'tipo_de_operador', 'clase_operador'],
};
const OBLIGATORIAS = ['bitacora', 'empleado', 'desde', 'hasta', 'tipo', 'concepto', 'monto'] as const;

export interface ProblemaDesgloseCsv { clave: string | null; fila: number | null; motivo: string }
export interface ResultadoDesglosesCsv {
  desgloses: DesgloseBitacora[];
  /** Bitácoras que no se envían a propósito pero se muestran (hoy: `sin_poliza`). */
  excepciones: Array<{ clave: string; motivo: 'sin_poliza' }>;
  problemas: ProblemaDesgloseCsv[];
  /** Renglones con monto 0 explícito: no son cargo ni abono, se ignoran (se cuentan para que no pasen en silencio). */
  renglonesEnCero: number;
}

const sinAcentos = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** `DD/MM/AAAA` o `DD-MM-AAAA` → ISO si es una fecha real; `AAAA-MM-DD` y el serial de Excel pasan por `fechaDeCelda`. */
export function fechaDeDesglose(texto: string): string | null {
  const t = fechaDeCelda(texto);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return fechaReal(t);
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t.trim());
  if (!m) return null;
  return fechaReal(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
}

function fechaReal(iso: string): string | null {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** Los encabezados del archivo, ¿son los de un export de bitácoras (y no el CSV propio con `clave_externa`)? */
export function esFormatoDesglose(encabezados: readonly string[]): boolean {
  const llaves = encabezados.map((h) => llaveEncabezado(String(h ?? '')));
  const tiene = (k: string) => ALIAS[k].some((a) => llaves.includes(a));
  return tiene('bitacora') && tiene('concepto') && tiene('monto') && !llaves.includes('clave_externa');
}

type Tipo = 'percepcion' | 'deduccion';
const tipoDe = (crudo: string): Tipo | null => {
  const t = sinAcentos(crudo);
  if (t === 'percepcion' || t === 'cargo') return 'percepcion';
  if (t === 'deduccion' || t === 'abono') return 'deduccion';
  return null;
};

interface FilaGrupo { fila: number; c: string[] }

export function desglosesDeMatriz(matriz: readonly (readonly string[])[], decimalComa = false): ResultadoDesglosesCsv {
  const vacio: ResultadoDesglosesCsv = { desgloses: [], excepciones: [], problemas: [], renglonesEnCero: 0 };
  if (matriz.length === 0) return { ...vacio, problemas: [{ clave: null, fila: null, motivo: 'El archivo está vacío.' }] };
  const llaves = matriz[0].map((h) => llaveEncabezado(String(h ?? '')));
  const ix: Record<string, number> = {};
  for (const [k, alias] of Object.entries(ALIAS)) ix[k] = alias.map((a) => llaves.indexOf(a)).find((i) => i >= 0) ?? -1;
  const faltan = OBLIGATORIAS.filter((k) => ix[k] < 0);
  if (faltan.length) {
    return { ...vacio, problemas: [{ clave: null, fila: null, motivo: `Faltan columnas: ${faltan.map((k) => ALIAS[k][0]).join(', ')}.` }] };
  }

  const celda = (c: readonly string[], k: string): string => (ix[k] >= 0 ? String(c[ix[k]] ?? '').trim() : '');
  const problemas: ProblemaDesgloseCsv[] = [];
  const grupos = new Map<string, { terminal: string; bitacora: string; filas: FilaGrupo[] }>();
  matriz.slice(1).forEach((fila, k) => {
    const c = fila.map((x) => String(x ?? ''));
    const nFila = k + 2;
    const bitacora = celda(c, 'bitacora');
    if (!bitacora) return void problemas.push({ clave: null, fila: nFila, motivo: 'fila sin bitácora' });
    const terminal = celda(c, 'terminal');
    const id = `${terminal}\u0000${bitacora}`;
    (grupos.get(id) ?? grupos.set(id, { terminal, bitacora, filas: [] }).get(id)!).filas.push({ fila: nFila, c });
  });

  const desgloses: DesgloseBitacora[] = [];
  const excepciones: ResultadoDesglosesCsv['excepciones'] = [];
  let renglonesEnCero = 0;

  for (const g of grupos.values()) {
    const clave = claveDeBitacora(g.terminal || undefined, g.bitacora);
    let ok = true;
    const err = (motivo: string, fila: number | null = g.filas[0].fila) => { problemas.push({ clave, fila, motivo }); ok = false; };

    // Campos del encabezado: la primera fila que los trae; valores distintos entre filas = error (jamás se adivina).
    const encabezado = (k: string, normal: (v: string) => string = (v) => v): string => {
      let visto: string | null = null;
      for (const { fila, c } of g.filas) {
        const v = celda(c, k);
        if (v === '') continue;
        const n = normal(v);
        if (visto === null) visto = n;
        else if (visto !== n) { err(`la columna ${ALIAS[k][0]} trae valores distintos en la misma bitácora`, fila); break; }
      }
      return visto ?? '';
    };
    const empleado = encabezado('empleado');
    const poliza = encabezado('poliza');
    const unidad = encabezado('unidad');
    const desdeT = encabezado('desde', (v) => fechaDeDesglose(v) ?? v);
    const hastaT = encabezado('hasta', (v) => fechaDeDesglose(v) ?? v);
    const diasT = encabezado('dias');
    const netoT = encabezado('neto', (v) => String(leerNumero(v, decimalComa) ?? v));
    const tipoOpT = encabezado('tipoOperador', sinAcentos);

    if (!empleado) err('sin numero_empleado');
    const desde = fechaDeDesglose(desdeT); const hasta = fechaDeDesglose(hastaT);
    if (!desde || !hasta) err('periodo ilegible (se espera AAAA-MM-DD, DD/MM/AAAA o una fecha de Excel)');
    else if (desde > hasta) err('periodo incoherente: desde es posterior a hasta');

    let dias: number | undefined;
    if (diasT !== '') {
      const n = leerNumero(diasT, decimalComa);
      if (n === null || !Number.isInteger(n)) err('dias ilegible (se espera un entero)'); else dias = n;
    }
    let neto: number | undefined;
    if (netoT !== '') {
      const n = leerNumero(netoT, decimalComa);
      if (n === null) err('neto ilegible'); else neto = n;
    }
    let tipoOperador: TipoOperadorDesglose | undefined;
    if (tipoOpT !== '') {
      if ((TIPOS_OPERADOR as readonly string[]).includes(tipoOpT)) tipoOperador = tipoOpT as TipoOperadorDesglose;
      else err(`tipo_operador «${tipoOpT}» no es ${TIPOS_OPERADOR.join(' | ')}`);
    }

    const percepciones: RenglonBitacora[] = []; const deducciones: RenglonBitacora[] = [];
    for (const { fila, c } of g.filas) {
      const tipo = tipoDe(celda(c, 'tipo'));
      if (tipo === null) { err(`tipo «${celda(c, 'tipo')}» no es percepcion/deduccion (o cargo/abono)`, fila); continue; }
      const concepto = celda(c, 'concepto');
      if (!concepto) { err('concepto vacío', fila); continue; }
      const monto = leerNumero(celda(c, 'monto'), decimalComa);
      if (monto === null) { err('monto vacío o ilegible', fila); continue; }
      if (monto < 0) { err('monto negativo (el signo lo da el tipo)', fila); continue; }
      if (monto === 0) { renglonesEnCero++; continue; }
      const vale = celda(c, 'vale');
      (tipo === 'percepcion' ? percepciones : deducciones).push({ concepto, monto, ...(vale ? { vale } : {}) });
    }
    if (!ok) continue;

    try {
      const d = validarDesgloseBitacora({
        ...(g.terminal ? { terminal: g.terminal } : {}),
        bitacora: g.bitacora,
        poliza: poliza || null,
        operador: { numeroEmpleado: empleado },
        ...(unidad ? { unidad } : {}),
        ...(tipoOperador ? { tipoOperador } : {}),
        desde, hasta,
        ...(dias !== undefined ? { dias } : {}),
        percepciones, deducciones,
        ...(neto !== undefined ? { neto } : {}),
      });
      if (d.poliza === null) { excepciones.push({ clave, motivo: 'sin_poliza' }); continue; }
      desgloses.push(d);
    } catch (e) {
      if (!(e instanceof CampoInvalido)) throw e;
      err(e.message);
    }
  }
  return { desgloses, excepciones, problemas, renglonesEnCero };
}

/** Texto CSV → desgloses. El decimal con coma solo vale cuando el separador es `;` (el CSV de Excel en español). */
export function desglosesDeCsv(texto: string): ResultadoDesglosesCsv {
  return desglosesDeMatriz(partirCsv(texto), separadorDe(texto) === ';');
}

// ── Importar un archivo (CSV o Excel) por el camino del POST ───────────────────

export interface ResultadoImportacionDesgloses {
  recibidas: number;
  idempotentes: number;
  retenidas: number;
  correcciones: number;
  excepciones: Array<{ clave: string; motivo: string }>;
  problemas: ProblemaDesgloseCsv[];
  renglonesEnCero: number;
  /** El archivo no se pudo leer en absoluto (formato, vacío, demasiado grande, no es un export de bitácoras). */
  error?: string;
}

export interface DependenciasImportacionDesgloses {
  recibir: (tenantId: string, d: DesgloseBitacora) => Promise<ResultadoDesglose>;
}

async function recibirPorOmision(tenantId: string, d: DesgloseBitacora): Promise<ResultadoDesglose> {
  // Import perezoso: este módulo se puede usar (y probar) sin arrastrar el acceso a datos.
  const { recibirDesglose } = await import('./desglose_recibir');
  return recibirDesglose(tenantId, d);
}

export async function importarDesglosesDeArchivo(
  tenantId: string, nombre: string, bytes: Uint8Array, deps: DependenciasImportacionDesgloses = { recibir: recibirPorOmision },
): Promise<ResultadoImportacionDesgloses> {
  const base: ResultadoImportacionDesgloses = {
    recibidas: 0, idempotentes: 0, retenidas: 0, correcciones: 0, excepciones: [], problemas: [], renglonesEnCero: 0,
  };
  const ext = (/\.([a-z0-9]+)$/i.exec(nombre.trim())?.[1] ?? '').toLowerCase();
  let matriz: readonly (readonly string[])[]; let decimalComa = false;
  if (ext === 'csv' || ext === 'txt' || ext === '') {
    if (bytes.length === 0) return { ...base, error: 'El archivo está vacío.' };
    const texto = decodificarTexto(bytes);
    matriz = partirCsv(texto); decimalComa = separadorDe(texto) === ';';
  } else {
    const m = matrizDeArchivoCatalogo(nombre, bytes);
    if (!m.ok) return { ...base, error: m.motivo };
    matriz = m.matriz.map((f) => f.map((x) => (x == null ? '' : String(x))));
  }
  if (matriz.length > 0 && !esFormatoDesglose(matriz[0])) {
    return { ...base, error: 'El archivo no parece un export de bitácoras: faltan las columnas bitacora, concepto y monto.' };
  }
  const lectura = desglosesDeMatriz(matriz, decimalComa);
  const total = lectura.desgloses.length + lectura.excepciones.length + new Set(lectura.problemas.map((p) => p.clave).filter(Boolean)).size;
  if (total > MAX_BITACORAS_POR_ARCHIVO) {
    return { ...base, problemas: lectura.problemas, error: `El archivo trae ${total} bitácoras; el máximo por carga es ${MAX_BITACORAS_POR_ARCHIVO}. Pártelo en varios.` };
  }
  const salida: ResultadoImportacionDesgloses = {
    ...base, excepciones: [...lectura.excepciones], problemas: [...lectura.problemas], renglonesEnCero: lectura.renglonesEnCero,
  };
  for (const d of lectura.desgloses) {
    const clave = claveDeBitacora(d.terminal, d.bitacora);
    try {
      const r = await deps.recibir(tenantId, d);
      if (r.estado === 'creada') { salida.recibidas++; if (r.retenida) salida.retenidas++; }
      else if (r.estado === 'idempotente') salida.idempotentes++;
      else if (r.estado === 'correccion_pendiente') { salida.correcciones++; salida.excepciones.push({ clave, motivo: 'correccion_pendiente' }); }
      else salida.excepciones.push({ clave, motivo: r.estado });
    } catch (e) {
      if (e instanceof CampoInvalido) { salida.problemas.push({ clave, fila: null, motivo: e.message }); continue; }
      // Sin datos del operador en el texto: solo la clave de la bitácora. Es seguro volver a subir (idempotente).
      salida.problemas.push({ clave, fila: null, motivo: 'no se pudo guardar; vuelve a subir el archivo (es seguro repetirlo).' });
    }
  }
  return salida;
}
