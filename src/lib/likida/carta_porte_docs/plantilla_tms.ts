// ═══════════════════════════════════════════════════════════════════════════
// CONSTRUCTOR PURO DE LA PLANTILLA DEL TMS — extracción + layout → celdas.
//
// Sin E/S ni librería de Excel: devuelve, por hoja, un mapa coordenada → valor, y la
// lista de obligatorios («*») que quedaron vacíos (`faltantes`), que consumen el
// visor y la validación previa a la salida. Escribir el .xlsx es T-A3-08.
//
// Cada celda lleva `texto:true` cuando es texto de un tercero: el escritor la
// neutraliza (`= + - @`) y la guarda como celda de TEXTO. Aquí NO se modifica el valor.
// ═══════════════════════════════════════════════════════════════════════════

import { ESTADOS_SAT } from './catalogos';
import type { CampoValor, Extraccion } from './campos';
import { normalizarNumero } from './normalizar';
import { LAYOUT_NORMAL, type ColumnaTabla, type EntradaCelda, type LayoutPlantilla, type TablaLayout, type TransformacionPlantilla } from './plantilla_tms.layout';

export type ValorCelda = string | number | null;
export interface CeldaPlantilla { valor: ValorCelda; texto: boolean }
export interface Faltante { campo: string; celda: string }

export interface ContextoPlantilla {
  /** Número de cliente interno (C7). Si falta se usa `numero_cliente_interno` de la extracción. */
  clienteInterno: string | null;
  plantilla: 'normal' | 'nueva';
}

export interface PlantillaConstruida {
  /** hoja → coordenada (`C12`) → celda. */
  hojas: Record<string, Record<string, CeldaPlantilla>>;
  faltantes: Faltante[];
  avisos: string[];
}

const NOMBRE_ESTADO = new Map(ESTADOS_SAT.map((e) => [e.codigo, e.nombre]));

function vacio(v: string | null | undefined): v is null | undefined | '' { return v === null || v === undefined || v === ''; }

function valorCampo(campo: string, ext: Extraccion, fila: Record<string, CampoValor> | null, ctx: ContextoPlantilla): string | null {
  if (campo === 'ctx.clienteInterno') return ctx.clienteInterno ?? ext.campos.numero_cliente_interno?.valor ?? null;
  if (campo.startsWith('mercancia.')) return fila?.[campo.slice(10)]?.valor ?? null;
  return ext.campos[campo]?.valor ?? null;
}

function aplicar(v: string | null, tr: TransformacionPlantilla | undefined, texto: boolean): ValorCelda {
  if (vacio(v)) return null;
  if (tr === 'nombre_estado') return NOMBRE_ESTADO.get(v) ?? v;
  if (tr === 'si_no') return v === 'true' ? 'SI' : v === 'false' ? 'NO' : v;
  if (tr === 'entero') return Number.parseInt(v, 10);
  if (!texto) { const n = normalizarNumero(v).valor; return n === null ? v : n; }
  return v;
}

interface Regla {
  campo?: string; alterno?: string; constante?: string | number; transformacion?: TransformacionPlantilla;
  defecto?: string; obligatorio: boolean; texto: boolean;
}

function resolver(r: Regla, ext: Extraccion, fila: Record<string, CampoValor> | null, ctx: ContextoPlantilla): ValorCelda {
  if (r.constante !== undefined) return r.constante;
  let v = valorCampo(r.campo as string, ext, fila, ctx);
  if (vacio(v) && r.alterno) v = valorCampo(r.alterno, ext, fila, ctx);
  // Peligroso: la clave solo aplica si el material es peligroso; si no, `N/A`.
  if (r.campo === 'mercancia.clave_material_peligroso' && vacio(v) && fila?.material_peligroso?.valor === 'true') return null;
  const a = aplicar(v, r.transformacion, r.texto);
  return a === null && r.defecto !== undefined ? r.defecto : a;
}

function poner(sal: PlantillaConstruida, hoja: string, celda: string, r: Regla, ext: Extraccion, fila: Record<string, CampoValor> | null, ctx: ContextoPlantilla): void {
  const valor = resolver(r, ext, fila, ctx);
  (sal.hojas[hoja] ??= {})[celda] = { valor, texto: r.texto };
  if (valor === null && r.obligatorio) sal.faltantes.push({ campo: r.campo ?? '', celda: `${celda}` });
}

function construirTabla(sal: PlantillaConstruida, hoja: string, tb: TablaLayout, ext: Extraccion, ctx: ContextoPlantilla): void {
  for (const col of tb.columnas) {
    (sal.hojas[hoja] ??= {})[`${col.columna}${tb.filaEncabezado}`] = { valor: col.encabezado, texto: true };
  }
  const filas: Array<Record<string, CampoValor> | null> =
    tb.id === 'mercancias' ? (ext.mercancias.length > 0 ? ext.mercancias.slice(0, tb.maxFilas) : [null]) : [null];
  if (tb.id === 'mercancias' && ext.mercancias.length > tb.maxFilas) {
    sal.avisos.push(`El documento trae ${ext.mercancias.length} mercancías y la plantilla admite ${tb.maxFilas}: se omitieron ${ext.mercancias.length - tb.maxFilas}.`);
  }
  if (tb.id === 'mercancias' && ext.mercancias.length === 0) sal.avisos.push('El documento no trae mercancías: la fila 22 queda vacía.');
  filas.forEach((fila, i) => {
    for (const col of tb.columnas as ColumnaTabla[]) {
      poner(sal, hoja, `${col.columna}${tb.primeraFila + i}`, col, ext, fila, ctx);
    }
  });
}

/**
 * Aplica el layout a una extracción. Un solo destino por documento (multi-destino: T-A3-10).
 * `plantilla:'nueva'` aún no existe (bloqueo B-2): se construye la normal y se avisa.
 */
export function construirPlantilla(ext: Extraccion, ctx: ContextoPlantilla, layout: LayoutPlantilla = LAYOUT_NORMAL): PlantillaConstruida {
  const sal: PlantillaConstruida = { hojas: {}, faltantes: [], avisos: [] };
  if (layout.provisional) sal.avisos.push('Layout provisional: forma de la muestra M2, pendiente de la plantilla en blanco del TMS (B-2).');
  if (ctx.plantilla === 'nueva') sal.avisos.push('La plantilla «nueva» (varias razones sociales) aún no está definida: se generó con la normal.');
  for (const h of layout.hojas) {
    sal.hojas[h.hoja] ??= {};
    for (const e of h.celdas as EntradaCelda[]) poner(sal, h.hoja, e.celda, e, ext, null, ctx);
    for (const tb of h.tablas) construirTabla(sal, h.hoja, tb, ext, ctx);
  }
  // Las coordenadas de `faltantes` van sin hoja; se distingue por campo. Deduplicar mismo par.
  const vistos = new Set<string>();
  sal.faltantes = sal.faltantes.filter((f) => { const k = `${f.campo}|${f.celda}`; if (vistos.has(k)) return false; vistos.add(k); return true; });
  return sal;
}
