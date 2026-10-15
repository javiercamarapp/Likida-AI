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
import { LAYOUT_NORMAL, layoutDe, layoutPuedeEnviarse, type ColumnaTabla, type EntradaCelda, type LayoutPlantilla, type TablaLayout, type TransformacionPlantilla } from './plantilla_tms.layout';

export type ValorCelda = string | number | null;
export interface CeldaPlantilla { valor: ValorCelda; texto: boolean }
/** `bloqueante` ⇒ el documento no puede salir hasta corregirlo (p. ej. más destinos de los que caben); `mensaje` lo dice en llano. */
export interface Faltante { campo: string; celda: string; bloqueante?: true; mensaje?: string }

export type DistanciaFormato = 'texto_km' | 'numero';
/** La plantilla admite hasta 4 destinos (tabla A49:T53). */
export const MAX_DESTINOS = 4;
export const MENSAJE_MAS_DE_4_DESTINOS = 'Más de 4 destinos: divide el embarque.';

export interface ContextoPlantilla {
  /** Número de cliente interno (C7). Si falta se usa `numero_cliente_interno` de la extracción. */
  clienteInterno: string | null;
  plantilla: 'normal' | 'nueva';
  /** `texto_km` («874,11 km», lo que trae la plantilla) o `numero`. Sin dato: `texto_km`. */
  distanciaFormato?: DistanciaFormato;
  /** `descarga`: puede usar una plantilla aún no verificada, con aviso. `envio` (por defecto): solo plantillas verificadas. */
  uso?: 'descarga' | 'envio';
  /** Avisos de la elección de plantilla (ver `elegirPlantilla`), que se suman a los del armado. */
  avisos?: string[];
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

function formatearDistancia(v: string, formato: DistanciaFormato): ValorCelda {
  const n = normalizarNumero(v).valor;
  if (n === null) return v; // ilegible: se deja tal cual, como texto, para que lo revise una persona
  return formato === 'numero' ? n : `${n.toFixed(2).replace('.', ',')} km`;
}

function aplicar(v: string | null, tr: TransformacionPlantilla | undefined, texto: boolean, formato: DistanciaFormato): ValorCelda {
  if (vacio(v)) return null;
  if (tr === 'distancia') return formatearDistancia(v, formato);
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

/** Campo del destino N: el primero usa los nombres de siempre; del 2.º en adelante `destino_N_…`. */
export function campoDestino(campo: string, n: number): string {
  if (n === 1) return campo;
  if (campo === 'distancia_km') return `destino_${n}_distancia_km`;
  if (campo.startsWith('contacto_destino_')) return `destino_${n}_contacto_${campo.slice('contacto_destino_'.length)}`;
  if (campo.startsWith('destino_')) return `destino_${n}_${campo.slice('destino_'.length)}`;
  return campo;
}

/** Cuántos destinos trae la extracción: el mayor N con algún dato `destino_N_*` (mínimo 1). */
export function contarDestinos(ext: Extraccion): number {
  let max = 1;
  for (const [k, v] of Object.entries(ext.campos)) {
    const m = /^destino_(\d{1,4})_/.exec(k);
    if (m && !vacio(v?.valor)) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function resolver(r: Regla, ext: Extraccion, fila: Record<string, CampoValor> | null, ctx: ContextoPlantilla): ValorCelda {
  if (r.constante !== undefined) return r.constante;
  let v = valorCampo(r.campo as string, ext, fila, ctx);
  if (vacio(v) && r.alterno) v = valorCampo(r.alterno, ext, fila, ctx);
  // Peligroso: la clave solo aplica si el material es peligroso; si no, `N/A`.
  if (r.campo === 'mercancia.clave_material_peligroso' && vacio(v) && fila?.material_peligroso?.valor === 'true') return null;
  const a = aplicar(v, r.transformacion, r.texto, ctx.distanciaFormato ?? 'texto_km');
  return a === null && r.defecto !== undefined ? r.defecto : a;
}

function poner(sal: PlantillaConstruida, hoja: string, celda: string, r: Regla, ext: Extraccion, fila: Record<string, CampoValor> | null, ctx: ContextoPlantilla): void {
  const valor = resolver(r, ext, fila, ctx);
  // Una distancia que se queda como texto («874,11 km») se escribe como celda de texto.
  const texto = r.texto || (r.transformacion === 'distancia' && typeof valor === 'string');
  (sal.hojas[hoja] ??= {})[celda] = { valor, texto };
  if (valor === null && r.obligatorio) sal.faltantes.push({ campo: r.campo ?? '', celda: `${celda}` });
}

function construirTabla(sal: PlantillaConstruida, hoja: string, tb: TablaLayout, ext: Extraccion, ctx: ContextoPlantilla): void {
  for (const col of tb.columnas) {
    (sal.hojas[hoja] ??= {})[`${col.columna}${tb.filaEncabezado}`] = { valor: col.encabezado, texto: true };
  }
  const totalDestinos = contarDestinos(ext);
  if (tb.id === 'destinos' && totalDestinos > MAX_DESTINOS) {
    // Nunca se recorta en silencio: se llenan los 4 primeros y el documento queda bloqueado.
    sal.faltantes.push({ campo: 'destinos', celda: `A${tb.primeraFila + MAX_DESTINOS}`, bloqueante: true, mensaje: MENSAJE_MAS_DE_4_DESTINOS });
    sal.avisos.push(`El documento trae ${totalDestinos} destinos y la plantilla admite ${MAX_DESTINOS}. ${MENSAJE_MAS_DE_4_DESTINOS}`);
  }
  const filas: Array<Record<string, CampoValor> | null> =
    tb.id === 'mercancias' ? (ext.mercancias.length > 0 ? ext.mercancias.slice(0, tb.maxFilas) : [null]) : [null];
  if (tb.id === 'mercancias' && ext.mercancias.length > tb.maxFilas) {
    sal.avisos.push(`El documento trae ${ext.mercancias.length} mercancías y la plantilla admite ${tb.maxFilas}: se omitieron ${ext.mercancias.length - tb.maxFilas}.`);
  }
  if (tb.id === 'mercancias' && ext.mercancias.length === 0) sal.avisos.push('El documento no trae mercancías: la fila 22 queda vacía.');
  const nFilas = tb.id === 'destinos' && tb.multi ? Math.min(totalDestinos, tb.maxFilas) : filas.length;
  for (let i = 0; i < nFilas; i++) {
    const fila = tb.id === 'destinos' ? null : filas[i];
    for (const col of tb.columnas as ColumnaTabla[]) {
      const celda = `${col.columna}${tb.primeraFila + i}`;
      if (col.indice) { poner(sal, hoja, celda, { ...col, constante: i + 1 }, ext, null, ctx); continue; }
      if (col.idDestino) { ponerIdDestino(sal, hoja, celda, col, totalDestinos, fila, ext, ctx); continue; }
      const regla: ColumnaTabla = tb.id === 'destinos' && col.campo
        ? { ...col, campo: campoDestino(col.campo, i + 1), alterno: col.alterno ? campoDestino(col.alterno, i + 1) : undefined }
        : col;
      poner(sal, hoja, celda, regla, ext, fila, ctx);
    }
  }
}

/** `Id Destino` de la mercancía: con un solo destino es 1; con varios lo dice el documento y NUNCA se adivina. */
function ponerIdDestino(sal: PlantillaConstruida, hoja: string, celda: string, col: ColumnaTabla, totalDestinos: number, fila: Record<string, CampoValor> | null, ext: Extraccion, ctx: ContextoPlantilla): void {
  if (totalDestinos <= 1) { poner(sal, hoja, celda, col, ext, fila, ctx); return; }
  const regla: Regla = { campo: 'mercancia.id_destino', transformacion: 'entero', obligatorio: true, texto: false };
  const valor = resolver(regla, ext, fila, ctx);
  const valido = typeof valor === 'number' && Number.isInteger(valor) && valor >= 1 && valor <= Math.min(totalDestinos, MAX_DESTINOS);
  (sal.hojas[hoja] ??= {})[celda] = { valor: valido ? valor : null, texto: false };
  if (!valido) {
    sal.faltantes.push({
      campo: 'mercancia.id_destino', celda,
      ...(valor === null ? {} : { bloqueante: true as const, mensaje: `La mercancía apunta al destino ${String(valor)}, que no existe (hay ${Math.min(totalDestinos, MAX_DESTINOS)}).` }),
    });
  }
}

/**
 * Aplica el layout a una extracción: hasta 4 destinos (filas 50–53), con `Id Destino` en cada mercancía.
 * La plantilla «nueva» aún no está especificada (bloqueo B-2): su layout no está verificado, así que solo se usa para
 * DESCARGAR (`ctx.uso:'descarga'`); para enviar se genera la normal y se avisa.
 */
export function construirPlantilla(ext: Extraccion, ctx: ContextoPlantilla, layoutExplicito?: LayoutPlantilla): PlantillaConstruida {
  const sal: PlantillaConstruida = { hojas: {}, faltantes: [], avisos: [...(ctx.avisos ?? [])] };
  let layout = layoutExplicito ?? layoutDe(ctx.plantilla);
  if (!layoutPuedeEnviarse(layout) && (ctx.uso ?? 'envio') === 'envio') {
    layout = LAYOUT_NORMAL;
    sal.avisos.push('La plantilla «nueva» (varias razones sociales) aún no está definida: se generó con la normal.');
  } else if (!layoutPuedeEnviarse(layout)) {
    sal.avisos.push('La plantilla «nueva» (varias razones sociales) está pendiente de especificación: úsala solo para revisar, no para enviar.');
  }
  if (layout.provisional) sal.avisos.push('Layout provisional: forma de la muestra M2, pendiente de la plantilla en blanco del TMS (B-2).');
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
