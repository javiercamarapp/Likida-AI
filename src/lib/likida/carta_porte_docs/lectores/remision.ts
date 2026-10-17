// ═══════════════════════════════════════════════════════════════════════════
// LECTOR C — REMISIÓN ESCANEADA DE PLANTA — T-A3-60 (absorbe T-A3-54).
//
// Un PDF-imagen SIN capa de texto: una página, columnas CANTIDAD / CLAVE / DESCRIPCIÓN / PESO BRUTO / VOLUMEN, una línea
// vertical que cruza columnas, el borde izquierdo recortado y un TOTAL que escribe el punto como separador de MILES mientras
// los renglones lo escriben como decimal. Aquí no hay texto que leer: lo lee un modelo de visión, que entra por el puerto
// `VisionRemision` (el adaptador real depende de la llave del modelo: BLOQUEO EXTERNO; en pruebas, una visión falsa
// determinista). Sin visión configurada NO se lee nada y se dice por qué.
//
// Reglas:
//  · La salida del modelo es un dato no confiable: se valida con un esquema cerrado y la confianza se acota (no hay texto contra
//    el cual anclar un valor leído de píxeles).
//  · Una celda o columna CORTADA (recorte izquierdo, línea encima) baja la confianza a ≤ 0.45 y se marca `columna_cortada`:
//    queda por debajo del umbral de los críticos y obliga a confirmar. Una CLAVE truncada se marca `clave_truncada` y NO se usa.
//  · La CLAVE de la planta no es una clave del SAT: no se escribe en `bienes_transp`. Se agrega a la descripción solo para que
//    el catálogo del cliente reconozca el producto; T-A3-62 pone la clave SAT.
//  · Separadores del peso: si los renglones demuestran que el punto es decimal («1275.360») se leen así; el TOTAL con punto de
//    miles solo se resuelve si CUADRA con la suma de renglones. Si no cuadra, se conserva la lectura ambigua y se marca.
//  · Lo que la remisión no trae (régimen, cliente interno, distancia, claves SAT, tramo mexicano) queda vacío para T-A3-62.
// ═══════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { extraccionVacia, type CampoValor, type Extraccion } from '../campos';
import { claveUnidadDeTexto, llaveTexto } from '../catalogos';
import type { ContenidoDoc } from '../contenido';
import {
  campoLeido, completarDerivados, pendientesDeEnriquecimiento,
  type IncidenciaLector, type ResultadoLector,
} from '../derivar';
import { normalizarNumero, normalizarPeso } from '../normalizar';

// ── El puerto de visión ─────────────────────────────────────────────────────

const Celda = z.object({
  texto: z.string().max(300).nullable(),
  confianza: z.number().min(0).max(1),
  /** El recorte o la línea tapan parte de esta celda. */
  cortada: z.boolean().optional(),
});
export type CeldaVision = z.infer<typeof Celda>;

export const COLUMNAS_REMISION = ['cantidad', 'clave', 'descripcion', 'peso_bruto', 'volumen'] as const;
export type ColumnaRemision = (typeof COLUMNAS_REMISION)[number];

const FilaVision = z.object({
  cantidad: Celda,
  clave: Celda,
  descripcion: Celda,
  peso_bruto: Celda,
  volumen: Celda.optional(),
  /** La línea tal como se lee en el escaneo (evidencia). */
  linea: z.string().max(300),
});

export const LecturaVisionRemisionSchema = z.object({
  encabezado: z.object({
    remision: Celda.optional(),
    fecha: Celda.optional(),
    orden_compra: Celda.optional(),
    origen_nombre: Celda.optional(),
    destino_nombre: Celda.optional(),
  }),
  filas: z.array(FilaVision).max(100),
  total: z.object({
    cantidad: Celda.optional(),
    peso_bruto: Celda.optional(),
    volumen: Celda.optional(),
    linea: z.string().max(300),
  }).nullable(),
  /** Columnas que el escaneo corta en TODOS los renglones (borde recortado o línea encima). */
  columnasCortadas: z.array(z.enum(COLUMNAS_REMISION)).max(5),
  notas: z.string().max(400).nullable(),
});
export type LecturaVisionRemision = z.infer<typeof LecturaVisionRemisionSchema>;

/** Lee las imágenes de la remisión. El adaptador real (modelo de visión) está pendiente de la llave; ver el encabezado. */
export type VisionRemision = (imagenes: string[], signal?: AbortSignal) => Promise<LecturaVisionRemision>;

// ── La lectura ──────────────────────────────────────────────────────────────

/** Lo más que se le cree a un valor leído de píxeles: no hay texto contra el cual anclarlo. */
export const CONF_VISION_MAX = 0.92;
/** Una celda cortada nunca llega al umbral de los críticos (0.85). */
export const CONF_CELDA_CORTADA = 0.45;
/** Tolerancia al cuadrar el total contra la suma de renglones: 0.5 % o 1 kg, lo que sea mayor (los renglones se redondean a 3 decimales). */
const TOLERANCIA_RELATIVA = 0.005;

const NOTA_CORTADA = 'Columna cortada en el escaneo (recorte o línea encima): lo leído puede estar incompleto. Confírmalo contra el original.';

const texto = (c: CeldaVision | undefined): string | null => (c && c.texto !== null && c.texto.trim() !== '' ? c.texto.trim() : null);
const conf = (c: CeldaVision): number => Math.min(CONF_VISION_MAX, c.confianza);

/** «80 PZA» → cantidad 80 y unidad «PZA». Solo número → sin unidad. */
function cantidadYUnidad(t: string): { cantidad: string; unidad: string | null } {
  const m = /^\s*([\d.,]+)\s*([A-Za-zÁÉÍÓÚÑáéíóúñ.]{1,12})?\s*$/.exec(t);
  return m ? { cantidad: m[1], unidad: m[2] ? m[2].replace(/\.$/, '') : null } : { cantidad: t, unidad: null };
}

/** «1275.360 KG» → peso y unidad. */
function pesoYUnidad(t: string): { numero: string; unidad: string | null } {
  const m = /^\s*([\d.,]+)\s*([A-Za-z]{1,8}\.?)?\s*$/.exec(t);
  return m ? { numero: m[1], unidad: m[2] ? m[2].replace(/\.$/, '') : null } : { numero: t, unidad: null };
}

/**
 * ¿Los renglones escriben el punto como DECIMAL? Hay dos pruebas, y sin ninguna no se afirma nada:
 *   1. un peso de 4 o más enteros con punto («1275.360»): ahí el punto no puede ser de miles;
 *   2. la suma de los renglones leídos con punto decimal CUADRA con alguna de las dos lecturas del total («14.029» → 14.029 o 14029).
 */
function renglonesUsanPuntoDecimal(pesos: string[], totalTexto: string | null): boolean {
  if (pesos.some((p) => /^\d{4,}\.\d{1,3}$/.test(pesoYUnidad(p).numero))) return true;
  if (totalTexto === null || pesos.length === 0) return false;
  const numeros = pesos.map((p) => pesoYUnidad(p).numero);
  if (!numeros.every((n) => /^\d+(\.\d+)?$/.test(n))) return false;
  const suma = numeros.reduce((s, n) => s + Number(n), 0);
  const t = normalizarPeso(pesoYUnidad(totalTexto).numero);
  return [t.valor, t.alternativa].some((x) => x !== null && Math.abs(x - suma) <= Math.max(1, suma * TOLERANCIA_RELATIVA));
}

const hayVision = (v: VisionRemision | null | undefined): v is VisionRemision => typeof v === 'function';

export interface OpcionesRemision { signal?: AbortSignal }

export async function leerRemisionEscaneada(c: ContenidoDoc, vision: VisionRemision | null | undefined, op: OpcionesRemision = {}): Promise<ResultadoLector> {
  const e: Extraccion = extraccionVacia();
  const avisos: string[] = [...c.avisos]; const incidencias: IncidenciaLector[] = [];
  const adicionales: Record<string, string> = {};
  const fin = (leido: boolean): ResultadoLector => ({ formato: 'C', leido, extraccion: e, avisos, incidencias, vacios: pendientesDeEnriquecimiento(e), adicionales });

  if (c.imagenes.length === 0) {
    avisos.push('La remisión escaneada no trae imágenes que leer.');
    return fin(false);
  }
  if (!hayVision(vision)) {
    incidencias.push({ codigo: 'sin_vision', campo: null, renglon: null, detalle: 'No hay modelo de visión configurado: la remisión escaneada no se puede leer y nada se envía al TMS.' });
    avisos.push('Sin modelo de visión configurado: esta remisión escaneada se captura a mano.');
    return fin(false);
  }

  let lectura: LecturaVisionRemision;
  try {
    const crudo = await vision(c.imagenes, op.signal);
    const v = LecturaVisionRemisionSchema.safeParse(crudo);
    if (!v.success) {
      avisos.push('El modelo de visión devolvió una lectura que no cumple el esquema: no se usó. Captura la remisión a mano.');
      return fin(false);
    }
    lectura = v.data;
  } catch (err) {
    if (op.signal?.aborted) throw err;
    avisos.push('El modelo de visión no pudo leer la remisión: se captura a mano.');
    return fin(false);
  }
  if (lectura.notas) avisos.push(`Nota de la lectura: ${lectura.notas}`);
  const cortadas = new Set<ColumnaRemision>(lectura.columnasCortadas);
  for (const k of cortadas) avisos.push(`La columna ${k.toUpperCase().replace('_', ' ')} sale cortada en el escaneo: confirma sus valores contra el original.`);

  // Encabezado.
  const enc = lectura.encabezado;
  const docCampo = (clave: string, celda: CeldaVision | undefined): void => {
    const t = texto(celda);
    if (!celda || t === null) return;
    const cv = campoLeido(clave, false, t, { confianza: celda.cortada ? CONF_CELDA_CORTADA : conf(celda), evidencia: t, origen: 'llm', notas: celda.cortada ? [NOTA_CORTADA] : [] });
    if (cv) e.campos[clave] = cv;
  };
  docCampo('folio_cliente', enc.remision);
  docCampo('fecha_salida', enc.fecha);
  docCampo('origen_nombre', enc.origen_nombre);
  docCampo('destino_nombre', enc.destino_nombre);
  const oc = texto(enc.orden_compra); if (oc) adicionales.orden_compra = oc;

  // Renglones. Primero se decide cómo escribe los pesos ESTE documento.
  const pesosTexto = lectura.filas.map((f) => texto(f.peso_bruto)).filter((t): t is string => t !== null);
  const puntoDecimal = renglonesUsanPuntoDecimal(pesosTexto, lectura.total ? texto(lectura.total.peso_bruto) : null);
  const miles: ',' | undefined = puntoDecimal ? ',' : undefined;

  const sumaPeso: Array<number | null> = []; const sumaPiezas: Array<number | null> = [];
  lectura.filas.forEach((f, i) => {
    const fila: Record<string, CampoValor> = {};
    const ev = f.linea;
    const celdaCampo = (col: ColumnaRemision, celda: CeldaVision | undefined): { cortada: boolean; confianza: number; notas: string[] } | null => {
      if (!celda || texto(celda) === null) return null;
      const cortada = celda.cortada === true || cortadas.has(col);
      if (cortada) incidencias.push({ codigo: col === 'clave' ? 'clave_truncada' : 'columna_cortada', campo: col, renglon: i, detalle: col === 'clave' ? 'La clave de planta sale truncada: no se usa y el catálogo no podrá reconocer el producto.' : `La columna ${col} sale cortada: lectura poco confiable.` });
      return { cortada, confianza: cortada ? Math.min(conf(celda), CONF_CELDA_CORTADA) : conf(celda), notas: cortada ? [NOTA_CORTADA] : [] };
    };

    // Cantidad (+ unidad si viene pegada).
    const cc = celdaCampo('cantidad', f.cantidad);
    const tCant = texto(f.cantidad);
    if (cc && tCant) {
      const { cantidad, unidad } = cantidadYUnidad(tCant);
      const cant = campoLeido('cantidad', true, cantidad, { confianza: cc.confianza, evidencia: ev, origen: 'llm', notas: cc.notas });
      if (cant) fila.cantidad = cant;
      if (unidad) { const u = campoLeido('unidad_texto', true, unidad, { confianza: cc.confianza, evidencia: ev, origen: 'llm', notas: cc.notas }); if (u) fila.unidad_texto = u; }
    }
    sumaPiezas.push(fila.cantidad ? Number(fila.cantidad.valor) : null);

    // Descripción (+ clave de planta, que NO es del SAT).
    const cd = celdaCampo('descripcion', f.descripcion);
    const tDesc = texto(f.descripcion);
    const ck = celdaCampo('clave', f.clave);
    const tClave = texto(f.clave);
    if (cd && tDesc) {
      let descripcion = tDesc; const notas = [...cd.notas];
      if (ck && tClave && !ck.cortada && !llaveTexto(tDesc).includes(llaveTexto(tClave))) {
        descripcion = `${tDesc} (${tClave})`;
        notas.push('Se agregó la clave de planta a la descripción para que el catálogo del cliente reconozca el producto; no es una clave del SAT.');
      }
      if (ck?.cortada) notas.push('La clave de planta salió truncada y no se usó; el catálogo del cliente no podrá reconocer el producto.');
      const d = campoLeido('descripcion', true, descripcion, { confianza: cd.confianza, evidencia: ev, origen: 'llm', notas });
      if (d) fila.descripcion = d;
    }

    // Peso bruto de la columna (la columna se llama «PESO BRUTO»).
    const cp = celdaCampo('peso_bruto', f.peso_bruto);
    const tPeso = texto(f.peso_bruto);
    if (cp && tPeso) {
      const { numero, unidad } = pesoYUnidad(tPeso);
      const notas = [...cp.notas];
      if (unidad === null) notas.push('La columna no escribe la unidad: se tomó como kilogramos (peso bruto).');
      const p = campoLeido('peso_kg', true, numero, { confianza: unidad === null ? Math.min(cp.confianza, 0.85) : cp.confianza, evidencia: ev, origen: 'llm', notas, miles });
      if (p) {
        fila.peso_kg = p;
        fila.peso_unidad = { valor: unidad === null || claveUnidadDeTexto(unidad) === 'KGM' ? 'KGM' : unidad, confianza: p.confianza, evidencia: ev, origen: 'llm' };
        fila.peso_tipo = { valor: 'bruto', confianza: p.confianza, evidencia: ev, origen: 'llm' };
      }
    }
    sumaPeso.push(fila.peso_kg ? Number(fila.peso_kg.valor) : null);

    const cv = celdaCampo('volumen', f.volumen);
    if (cv && f.volumen && texto(f.volumen)) { const v = campoLeido('volumen', true, texto(f.volumen), { confianza: cv.confianza, evidencia: ev, origen: 'llm', notas: cv.notas }); if (v) fila.volumen = v; }

    if (Object.keys(fila).length > 0) e.mercancias.push(fila);
    else { sumaPeso.pop(); sumaPiezas.pop(); }
  });

  // Totales: el TOTAL escribe el punto como separador de MILES; solo se resuelve si cuadra con los renglones.
  const tot = lectura.total;
  if (tot) {
    const pesosCompletos = sumaPeso.length > 0 && sumaPeso.every((p): p is number => p !== null);
    const suma = pesosCompletos ? (sumaPeso as number[]).reduce((s, p) => s + p, 0) : null;
    const tTotal = texto(tot.peso_bruto);
    if (tot.peso_bruto && tTotal) {
      const { numero } = pesoYUnidad(tTotal);
      const base = Math.min(conf(tot.peso_bruto), CONF_VISION_MAX);
      const cortada = tot.peso_bruto.cortada === true;
      const p = normalizarPeso(numero);
      const confBase = cortada ? Math.min(base, CONF_CELDA_CORTADA) : base;
      let valor: number | null = p.valor; const notas: string[] = [...p.notas]; let confianza = p.ambiguo ? Math.min(confBase, confBase - 0.2) : confBase;
      if (cortada) notas.push(NOTA_CORTADA);
      if (p.ambiguo && p.alternativa !== null && suma !== null) {
        const tol = Math.max(1, suma * TOLERANCIA_RELATIVA);
        const lecturas = [p.valor as number, p.alternativa];
        const cuadran = lecturas.filter((x) => Math.abs(x - suma) <= tol);
        if (cuadran.length === 1) {
          valor = cuadran[0];
          notas.length = 0;
          if (valor === p.alternativa) {
            notas.push(`El total «${numero}» usa el punto como separador de miles (los renglones lo usan como decimal): se leyó ${valor} kg porque cuadra con la suma de los renglones (${Math.round(suma * 1000) / 1000} kg).`);
            incidencias.push({ codigo: 'total_miles_por_cuadre', campo: 'peso_bruto_total', renglon: null, detalle: `Total «${numero}» resuelto como ${valor} kg por cuadre con la suma de renglones.` });
          } else {
            notas.push(`El total «${numero}» se leyó ${valor} kg porque cuadra con la suma de los renglones (${Math.round(suma * 1000) / 1000} kg).`);
          }
          confianza = Math.min(confBase, 0.9);
        } else {
          incidencias.push({ codigo: 'total_no_cuadra', campo: 'peso_bruto_total', renglon: null, detalle: `El total «${numero}» no cuadra con la suma de los renglones (${Math.round(suma * 1000) / 1000} kg) en ninguna de sus dos lecturas: se conserva la ambigua.` });
          avisos.push('El peso total no cuadra con la suma de los renglones: confírmalo contra el original.');
        }
      } else if (suma !== null && valor !== null && Math.abs(valor - suma) > Math.max(1, suma * TOLERANCIA_RELATIVA)) {
        incidencias.push({ codigo: 'total_no_cuadra', campo: 'peso_bruto_total', renglon: null, detalle: `El total (${valor} kg) no cuadra con la suma de los renglones (${Math.round(suma * 1000) / 1000} kg).` });
        avisos.push('El peso total no cuadra con la suma de los renglones: confírmalo contra el original.');
        confianza = Math.min(confianza, 0.6);
      }
      if (valor !== null) e.campos.peso_bruto_total = { valor: String(valor), confianza: Math.max(0, Math.round(confianza * 1000) / 1000), evidencia: tot.linea.slice(0, 200), origen: 'llm', ...(notas.length ? { notas } : {}) };
    }
    const tPiezas = texto(tot.cantidad);
    if (tot.cantidad && tPiezas) {
      const n = normalizarNumero(cantidadYUnidad(tPiezas).cantidad);
      const sumaP = sumaPiezas.length > 0 && sumaPiezas.every((x): x is number => x !== null) ? (sumaPiezas as number[]).reduce((s, x) => s + x, 0) : null;
      if (n.valor !== null && sumaP !== null && n.valor !== sumaP) {
        incidencias.push({ codigo: 'total_no_cuadra', campo: 'piezas_total', renglon: null, detalle: `El total de piezas (${n.valor}) no cuadra con la suma de los renglones (${sumaP}).` });
        avisos.push('El total de piezas no cuadra con la suma de los renglones: confírmalo contra el original.');
      }
      const cv = campoLeido('piezas_total', false, cantidadYUnidad(tPiezas).cantidad, { confianza: conf(tot.cantidad), evidencia: tot.linea, origen: 'llm' });
      if (cv) e.campos.piezas_total = cv;
    }
    const tVol = texto(tot.volumen);
    if (tot.volumen && tVol) { const cv = campoLeido('volumen_total', false, pesoYUnidad(tVol).numero, { confianza: conf(tot.volumen), evidencia: tot.linea, origen: 'llm', miles }); if (cv) e.campos.volumen_total = cv; }
  } else if (e.mercancias.length > 0) avisos.push('No se leyó la fila de TOTAL: el peso y las piezas no se pudieron cuadrar.');

  completarDerivados(e);
  if (e.mercancias.length === 0) avisos.push('No se leyó ningún renglón de la remisión escaneada.');
  return fin(e.mercancias.length > 0);
}
