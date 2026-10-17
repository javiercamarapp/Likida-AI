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
import { aplicarReglasGuia, type ReglasGuia } from './validacion';
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
  /** Número de cliente interno (B7). Si falta se usa `numero_cliente_interno` de la extracción. */
  clienteInterno: string | null;
  plantilla: 'normal' | 'nueva';
  /** `texto_km` («874,11 km», lo que trae la plantilla) o `numero`. Sin dato: `texto_km`. */
  distanciaFormato?: DistanciaFormato;
  /** `descarga`: puede usar una plantilla aún no verificada, con aviso. `envio` (por defecto): solo plantillas verificadas. */
  uso?: 'descarga' | 'envio';
  /** Avisos de la elección de plantilla (ver `elegirPlantilla`), que se suman a los del armado. */
  avisos?: string[];
  /**
   * Reglas de dependencia de la Guía de llenado (T-A3-45): no se escribe lo que la Guía dice vacío (embalaje sin material
   * peligroso, pedimento en exportación…) y se limpian descripción y razón social, con aviso de lo cambiado. Ausente = las
   * reglas de la Guía; `false` = ninguna; un objeto ajusta o apaga reglas sueltas.
   */
  reglasGuia?: Partial<ReglasGuia> | false;
}

export interface PlantillaConstruida {
  /** hoja → coordenada (`C12`) → celda. */
  hojas: Record<string, Record<string, CeldaPlantilla>>;
  faltantes: Faltante[];
  avisos: string[];
  /** Solo con la plantilla «nueva»: el criterio para usarla aún no lo confirma el cliente (B-2/B-10); el visor lo muestra. */
  criterio_provisional?: true;
}

export const AVISO_CRITERIO_PROVISIONAL = 'Plantilla «nueva» elegida con criterio provisional (más de una razón social de embarcador): el cliente aún no confirma cuándo se usa. Revísala antes de enviar.';

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
  if (tr === 'si_no_tilde') return v === 'true' ? 'Sí' : v === 'false' ? 'No' : v;
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

/** Campo del origen N: el primero usa los nombres de siempre; del 2.º en adelante `origen_N_…`. */
export function campoOrigen(campo: string, n: number): string {
  if (n === 1 || !campo.startsWith('origen_')) return campo;
  return `origen_${n}_${campo.slice('origen_'.length)}`;
}

/** Cuántos orígenes trae la extracción: el mayor N con algún dato `origen_N_*` (mínimo 1). */
export function contarOrigenes(ext: Extraccion): number {
  let max = 1;
  for (const [k, v] of Object.entries(ext.campos)) {
    const m = /^origen_(\d{1,4})_/.exec(k);
    if (m && !vacio(v?.valor)) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** ID de un origen/destino de la plantilla «nueva»: prefijo + 6 dígitos por posición (único y estable dentro del documento). */
export const idRegistro = (tipo: 'origen' | 'destino', n: number): string => `${tipo === 'origen' ? 'OR' : 'DE'}${String(n).padStart(6, '0')}`;

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
  const totalOrigenes = contarOrigenes(ext);
  const totalDestinos = contarDestinos(ext);
  const total = tb.id === 'origenes' ? totalOrigenes : totalDestinos;
  if ((tb.id === 'destinos' || tb.id === 'origenes') && total > tb.maxFilas) {
    // Nunca se recorta en silencio: se llenan los primeros y el documento queda bloqueado.
    const mensaje = tb.id === 'destinos' && tb.maxFilas === MAX_DESTINOS ? MENSAJE_MAS_DE_4_DESTINOS : `Más de ${tb.maxFilas} ${tb.id}: divide el embarque.`;
    sal.faltantes.push({ campo: tb.id, celda: `A${tb.primeraFila + tb.maxFilas}`, bloqueante: true, mensaje });
    sal.avisos.push(`El documento trae ${total} ${tb.id} y la plantilla admite ${tb.maxFilas}. ${mensaje}`);
  }
  const filas: Array<Record<string, CampoValor> | null> =
    tb.id === 'mercancias' ? (ext.mercancias.length > 0 ? ext.mercancias.slice(0, tb.maxFilas) : [null]) : [null];
  if (tb.id === 'mercancias' && ext.mercancias.length > tb.maxFilas) {
    sal.avisos.push(`El documento trae ${ext.mercancias.length} mercancías y la plantilla admite ${tb.maxFilas}: se omitieron ${ext.mercancias.length - tb.maxFilas}.`);
  }
  if (tb.id === 'mercancias' && ext.mercancias.length === 0) sal.avisos.push(`El documento no trae mercancías: la fila ${tb.primeraFila} queda vacía.`);
  const nFilas = (tb.id === 'destinos' || tb.id === 'origenes') && tb.multi ? Math.min(total, tb.maxFilas) : filas.length;
  for (let i = 0; i < nFilas; i++) {
    const fila = tb.id === 'mercancias' ? filas[i] : null;
    for (const col of tb.columnas as ColumnaTabla[]) {
      // Columna solo de encabezado (sin campo ni constante): no se escribe valor.
      if (!col.campo && col.constante === undefined && !col.indice && !col.idDestino && !col.idRegistro && !col.referencia) continue;
      const celda = `${col.columna}${tb.primeraFila + i}`;
      if (col.indice) { poner(sal, hoja, celda, { ...col, constante: i + 1 }, ext, null, ctx); continue; }
      if (col.idRegistro) { (sal.hojas[hoja] ??= {})[celda] = { valor: idRegistro(col.idRegistro, i + 1), texto: true }; continue; }
      if (col.referencia) { ponerReferencia(sal, hoja, celda, col.referencia, col.referencia === 'origen' ? totalOrigenes : totalDestinos, fila, ext, ctx); continue; }
      if (col.idDestino) { ponerIdDestino(sal, hoja, celda, col, totalDestinos, fila, ext, ctx); continue; }
      const regla: ColumnaTabla = tb.id === 'destinos' && col.campo
        ? { ...col, campo: campoDestino(col.campo, i + 1), alterno: col.alterno ? campoDestino(col.alterno, i + 1) : undefined }
        : tb.id === 'origenes' && col.campo
          ? { ...col, campo: campoOrigen(col.campo, i + 1) }
          : col;
      poner(sal, hoja, celda, regla, ext, fila, ctx);
    }
  }
}

/**
 * Plantilla «nueva»: `ID Destino` / `ID Origen` de la mercancía. Con un solo origen/destino es el 1 (`OR000001`); con varios lo
 * dice el documento (`mercancia.id_origen` / `id_destino`, número de posición) y NUNCA se adivina. Una referencia que apunta a
 * un registro que no existe bloquea el documento.
 */
function ponerReferencia(sal: PlantillaConstruida, hoja: string, celda: string, tipo: 'origen' | 'destino', total: number, fila: Record<string, CampoValor> | null, ext: Extraccion, ctx: ContextoPlantilla): void {
  const campo = `mercancia.id_${tipo}`;
  const nombre = tipo === 'origen' ? 'origen' : 'destino';
  let n: number | null = 1;
  let crudo: ValorCelda = null;
  if (total > 1) {
    crudo = resolver({ campo, transformacion: 'entero', obligatorio: true, texto: false }, ext, fila, ctx);
    n = typeof crudo === 'number' && Number.isInteger(crudo) && crudo >= 1 && crudo <= total ? crudo : null;
  }
  (sal.hojas[hoja] ??= {})[celda] = { valor: n === null ? null : idRegistro(tipo, n), texto: true };
  if (n === null) {
    sal.faltantes.push({
      campo, celda,
      ...(crudo === null ? {} : { bloqueante: true as const, mensaje: `La mercancía apunta al ${nombre} ${String(crudo)}, que no existe (hay ${total}).` }),
    });
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
export function construirPlantilla(extOriginal: Extraccion, ctx: ContextoPlantilla, layoutExplicito?: LayoutPlantilla): PlantillaConstruida {
  const sal: PlantillaConstruida = { hojas: {}, faltantes: [], avisos: [...(ctx.avisos ?? [])] };
  const guia = aplicarReglasGuia(extOriginal, ctx.reglasGuia);
  const ext = guia.extraccion;
  sal.avisos.push(...guia.avisos);
  let layout = layoutExplicito ?? layoutDe(ctx.plantilla);
  if (!layoutPuedeEnviarse(layout) && (ctx.uso ?? 'envio') === 'envio') {
    layout = LAYOUT_NORMAL;
    sal.avisos.push('La plantilla «nueva» (varias razones sociales) aún no está verificada contra la del TMS: se generó con la normal.');
  } else if (!layoutPuedeEnviarse(layout)) {
    sal.avisos.push('La plantilla «nueva» (varias razones sociales) aún no está verificada contra la del TMS: úsala solo para revisar o descargar, no para enviar.');
  }
  if (layout.provisional) sal.avisos.push('Layout provisional: pendiente de la plantilla en blanco del TMS (B-2).');
  if (layout.nombre === 'nueva') { sal.criterio_provisional = true; sal.avisos.push(AVISO_CRITERIO_PROVISIONAL); }
  for (const h of layout.hojas) {
    sal.hojas[h.hoja] ??= {};
    for (const e of h.encabezados ?? []) sal.hojas[h.hoja][e.celda] = { valor: e.texto, texto: true };
    // Las celdas fijas son del embarque (régimen, referencia, cliente, caja…); si alguna cae en un campo de mercancía
    // (el régimen aduanero de la carga), se toma de la primera.
    for (const e of h.celdas as EntradaCelda[]) poner(sal, h.hoja, e.celda, e, ext, ext.mercancias[0] ?? null, ctx);
    for (const tb of h.tablas) construirTabla(sal, h.hoja, tb, ext, ctx);
  }
  // Las coordenadas de `faltantes` van sin hoja; se distingue por campo. Deduplicar mismo par.
  const vistos = new Set<string>();
  sal.faltantes = sal.faltantes.filter((f) => { const k = `${f.campo}|${f.celda}`; if (vistos.has(k)) return false; vistos.add(k); return true; });
  return sal;
}
