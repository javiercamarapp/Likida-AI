import { z } from 'zod';
import { normalizarNombre, llaveUnidad, fechaHoraDeCelda, type Celda } from './formatos';
import { MOTIVOS_INMOVILIZADA, type MotivoInmovilizada } from './reglas_cobro';

// ═══════════════════════════════════════════════════════════════════════════
// LA CONFIGURACIÓN DE LAS REGLAS DE COBRO, validada. PURO: sin base ni red.
//
// Cuatro listas, todas de la flota y TODAS VACÍAS de origen (nada precargado, ni
// casetas reales): `clasesValidas`, `excepcionesClase`, `casetasNoCruzar` y
// `excepcionesPorUnidad`. Aquí viven las formas que se guardan y los mensajes en
// lenguaje llano; el I/O está en `revision_cobros.ts`.
// ═══════════════════════════════════════════════════════════════════════════

/** Clases de cobro que la flota puede declarar: 1 a 12 (las que existen en el archivo del proveedor). */
export const CLASE_MIN = 1;
export const CLASE_MAX = 12;

export const claseSchema = z.number({ error: 'La clase debe ser un número.' })
  .int('La clase debe ser un número entero.')
  .min(CLASE_MIN, `La clase va de ${CLASE_MIN} a ${CLASE_MAX}.`)
  .max(CLASE_MAX, `La clase va de ${CLASE_MIN} a ${CLASE_MAX}.`);

export const clasesSchema = z.array(claseSchema).max(CLASE_MAX, 'Demasiadas clases.');

const textoCorto = (campo: string, max: number) =>
  z.string({ error: `Falta ${campo}.` }).transform((s) => s.trim().replace(/\s+/g, ' '))
    .pipe(z.string().min(1, `Falta ${campo}.`).max(max, `${campo[0].toUpperCase()}${campo.slice(1)} admite hasta ${max} caracteres.`));

export const casetaSchema = textoCorto('el nombre de la caseta', 120)
  .refine((s) => normalizarNombre(s) !== '', 'El nombre de la caseta no tiene letras ni números.');

export const unidadSchema = textoCorto('la unidad', 40)
  .refine((s) => llaveUnidad(s) !== '', 'La unidad no tiene letras ni números.');

export const motivoSchema = textoCorto('el motivo', 300)
  .refine((s) => s.length >= 3, 'Escribe un motivo de al menos 3 caracteres.');

/** Tipo de la unidad de un TAG (T-A2-39): `peaje_tag.tipo_unidad`. */
export const tipoUnidadSchema = z.enum(['tracto', 'utilitario'], { error: 'El tipo de unidad debe ser «tracto» o «utilitario».' });

export const reglasCobroConfigSchema = z.object({
  clasesValidas: clasesSchema.default([]),
  /** Clases válidas para las unidades utilitarias. Ausente o vacía = no se les evalúa la clase (y se dice). */
  clasesUtilitario: clasesSchema.optional(),
  excepcionesClase: z.array(z.object({ caseta: casetaSchema, clases: clasesSchema.min(1, 'Declara al menos una clase.') })).default([]),
  casetasNoCruzar: z.array(casetaSchema).default([]),
  excepcionesPorUnidad: z.array(z.object({ caseta: casetaSchema, unidad: unidadSchema })).default([]),
});

export type ReglasCobroConfig = z.infer<typeof reglasCobroConfigSchema>;

/** Sin listas por defecto: una flota nueva ve todo vacío. */
export const REGLAS_COBRO_CONFIG_VACIA: ReglasCobroConfig = {
  clasesValidas: [], excepcionesClase: [], casetasNoCruzar: [], excepcionesPorUnidad: [],
};

/** El primer mensaje llano de un fallo de validación. */
export function primerMensaje(e: z.ZodError): string {
  return e.issues[0]?.message ?? 'Los datos no son válidos.';
}

export type Validado<T> = { ok: true; valor: T } | { ok: false; motivo: string };

export function validarExcepcionUnidad(entrada: { caseta: unknown; unidad: unknown; nota?: unknown }): Validado<{ caseta: string; casetaNorm: string; unidad: string; unidadNorm: string; nota: string | null }> {
  const c = casetaSchema.safeParse(entrada.caseta);
  if (!c.success) return { ok: false, motivo: primerMensaje(c.error) };
  const u = unidadSchema.safeParse(entrada.unidad);
  if (!u.success) return { ok: false, motivo: primerMensaje(u.error) };
  const nota = typeof entrada.nota === 'string' && entrada.nota.trim() ? entrada.nota.trim().slice(0, 300) : null;
  return { ok: true, valor: { caseta: c.data, casetaNorm: normalizarNombre(c.data), unidad: u.data, unidadNorm: llaveUnidad(u.data), nota } };
}

export function validarJustificacion(entrada: { indice: unknown; motivo: unknown }): Validado<{ indice: number; motivo: string }> {
  const i = z.number().int().min(0, 'El renglón del cruce no es válido.').safeParse(entrada.indice);
  if (!i.success) return { ok: false, motivo: 'El renglón del cruce no es válido.' };
  const m = motivoSchema.safeParse(entrada.motivo);
  if (!m.success) return { ok: false, motivo: primerMensaje(m.error) };
  return { ok: true, valor: { indice: i.data, motivo: m.data } };
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIDADES INMOVILIZADAS (T-A2-36) — la lista de unidades en taller / siniestradas / de baja con sus fechas.
//
//   unidad;desde;hasta;motivo;nota
//   C2-08;2026-09-03;2026-09-05;taller;
//
// `hasta` y `nota` son opcionales (`hasta` vacío = sigue inmovilizada). `motivo` es taller, siniestro o baja.
// «unidad» es el número económico o las placas. PURO: valida el CSV y lo resuelve contra la lista de unidades
// que trae el llamador; el I/O vive en `datos.ts`. Hostil a propósito: una fecha ilegible, un motivo fuera de
// la lista, una ventana al revés o una unidad que no existe (o que casa con varias) rechaza esa fila con su
// motivo y su número de fila; nunca se adivina.
// ═══════════════════════════════════════════════════════════════════════════

export const TOPE_INMOVILIZADAS_IMPORTACION = 5_000;

export interface InmovilizadaImportada {
  fila: number;
  unidadRef: string;
  desde: string;
  hasta: string | null;
  motivo: MotivoInmovilizada;
  nota: string | null;
}

export interface LecturaInmovilizadas {
  ventanas: InmovilizadaImportada[];
  rechazadas: Array<{ fila: number; motivo: string }>;
  error?: string;
}

const COLS_INMOVILIZADA: Record<'unidad' | 'desde' | 'hasta' | 'motivo' | 'nota', string[]> = {
  unidad: ['unidad', 'economico', 'numero economico', 'no economico', 'no. economico', 'numero_economico', 'placas', 'placa', 'camion'],
  desde: ['desde', 'inicio', 'fecha inicio', 'fecha desde', 'fecha de inicio', 'ingreso'],
  hasta: ['hasta', 'fin', 'fecha fin', 'fecha hasta', 'fecha de fin', 'salida'],
  motivo: ['motivo', 'causa', 'tipo'],
  nota: ['nota', 'notas', 'comentario', 'comentarios', 'observaciones'],
};

export function parsearInmovilizadasMatriz(matriz: Celda[][]): LecturaInmovilizadas {
  const vacio: LecturaInmovilizadas = { ventanas: [], rechazadas: [] };
  if (matriz.length === 0) return { ...vacio, error: 'El archivo está vacío.' };
  const enc = matriz[0].map(normalizarNombre);
  const idx: Partial<Record<keyof typeof COLS_INMOVILIZADA, number>> = {};
  for (const k of Object.keys(COLS_INMOVILIZADA) as Array<keyof typeof COLS_INMOVILIZADA>) {
    const i = enc.findIndex((e) => COLS_INMOVILIZADA[k].includes(e));
    if (i >= 0) idx[k] = i;
  }
  const faltan = (['unidad', 'desde', 'motivo'] as const).filter((k) => idx[k] === undefined);
  if (faltan.length > 0) {
    return {
      ...vacio,
      error: `Faltan columnas: ${faltan.join(', ')}. Encabezados leídos: ${matriz[0].map((c) => `«${String(c ?? '').trim()}»`).join(', ')}. `
        + 'El CSV necesita: unidad (número económico o placas), desde y motivo (taller, siniestro o baja); hasta y nota son opcionales.',
    };
  }
  if (matriz.length - 1 > TOPE_INMOVILIZADAS_IMPORTACION) {
    return { ...vacio, error: `El archivo trae más de ${TOPE_INMOVILIZADAS_IMPORTACION} renglones. Pártelo y súbelo en partes.` };
  }

  const ventanas: InmovilizadaImportada[] = [];
  const rechazadas: Array<{ fila: number; motivo: string }> = [];
  // Una misma (unidad, desde, motivo) repetida en el archivo no se resuelve eligiendo una: se rechaza si difieren.
  const vistas = new Map<string, number>();
  for (let f = 1; f < matriz.length; f++) {
    const fila = matriz[f];
    if (!fila || fila.every((c) => String(c ?? '').trim() === '')) continue;
    const n = f + 1;
    const unidadRef = String(fila[idx.unidad as number] ?? '').trim();
    if (!unidadRef) { rechazadas.push({ fila: n, motivo: 'sin unidad' }); continue; }
    const desde = fechaHoraDeCelda(fila[idx.desde as number]).fecha;
    if (!desde) { rechazadas.push({ fila: n, motivo: 'la fecha «desde» está vacía o no se entiende' }); continue; }
    let hasta: string | null = null;
    if (idx.hasta !== undefined) {
      const crudo = fila[idx.hasta];
      if (String(crudo ?? '').trim() !== '') {
        hasta = fechaHoraDeCelda(crudo).fecha;
        if (!hasta) { rechazadas.push({ fila: n, motivo: 'la fecha «hasta» no se entiende (déjala vacía si la unidad sigue inmovilizada)' }); continue; }
      }
    }
    if (hasta !== null && hasta < desde) { rechazadas.push({ fila: n, motivo: `la ventana está al revés: «hasta» (${hasta}) es anterior a «desde» (${desde})` }); continue; }
    const crudoMotivo = String(fila[idx.motivo as number] ?? '').trim();
    const motivo = MOTIVOS_INMOVILIZADA.find((m) => m === normalizarNombre(crudoMotivo));
    if (!motivo) { rechazadas.push({ fila: n, motivo: `el motivo «${crudoMotivo.slice(0, 40)}» no es válido: usa «taller», «siniestro» o «baja»` }); continue; }
    const notaCruda = idx.nota === undefined ? '' : String(fila[idx.nota] ?? '').trim();
    const nota = notaCruda ? notaCruda.slice(0, 300) : null;
    const llave = `${llaveUnidad(unidadRef)}|${desde}|${motivo}`;
    const previa = vistas.get(llave);
    if (previa !== undefined) {
      const p = ventanas[previa];
      if (p.hasta !== hasta) { rechazadas.push({ fila: n, motivo: 'la misma unidad, fecha y motivo aparece con otro «hasta» en el archivo — no se elige uno' }); }
      continue; // repetida idéntica: inocua
    }
    vistas.set(llave, ventanas.length);
    ventanas.push({ fila: n, unidadRef, desde, hasta, motivo, nota });
  }
  return { ventanas, rechazadas };
}

export interface UnidadInmovilizadaRef { id: string; numeroEconomico: string; placas: string | null }

/** Casa cada renglón con UNA unidad (por número económico y, si no, por placas). */
export function resolverUnidadesInmovilizadas(
  ventanas: readonly InmovilizadaImportada[], unidades: readonly UnidadInmovilizadaRef[],
): { altas: Array<InmovilizadaImportada & { unidadId: string }>; rechazadas: Array<{ fila: number; motivo: string }> } {
  const porEco = new Map<string, UnidadInmovilizadaRef[]>();
  const porPlaca = new Map<string, UnidadInmovilizadaRef[]>();
  const meter = (m: Map<string, UnidadInmovilizadaRef[]>, k: string, u: UnidadInmovilizadaRef) => {
    if (!k) return;
    m.set(k, [...(m.get(k) ?? []), u]);
  };
  for (const u of unidades) {
    meter(porEco, normalizarNombre(u.numeroEconomico), u);
    meter(porPlaca, normalizarNombre(u.placas), u);
  }
  const altas: Array<InmovilizadaImportada & { unidadId: string }> = [];
  const rechazadas: Array<{ fila: number; motivo: string }> = [];
  for (const v of ventanas) {
    const ref = normalizarNombre(v.unidadRef);
    const e = porEco.get(ref) ?? [];
    const candidatas = e.length > 0 ? e : (porPlaca.get(ref) ?? []);
    if (candidatas.length === 0) rechazadas.push({ fila: v.fila, motivo: `la unidad «${v.unidadRef}» no existe en la flota (revisa el número económico o las placas)` });
    else if (candidatas.length > 1) rechazadas.push({ fila: v.fila, motivo: `«${v.unidadRef}» corresponde a más de una unidad — usa el número económico` });
    else altas.push({ ...v, unidadId: candidatas[0].id });
  }
  return { altas, rechazadas };
}
