import { z } from 'zod';
import { normalizarNombre, llaveUnidad } from './formatos';

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

export const reglasCobroConfigSchema = z.object({
  clasesValidas: clasesSchema.default([]),
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
