// ═══════════════════════════════════════════════════════════════════════════
// ORDEN DE LOS NIVELES DEL MODELO, POR TIPO DE DOCUMENTO (T-A3-68 f).
//
// Los niveles son 1 = Gemini 3.5 Flash-Lite, 2 = Gemini 3.8 Flash y 3 = Sonnet 5.5 (roles `cartaporte_extractor*`, models.ts).
// Qué niveles se recorren, y en qué orden, no va fijo en el código: se decide por tipo de documento
//   · `texto`  — lo que ya viene como texto limpio (PDF con texto, Excel, CSV, correo, JSON);
//   · `vision` — lo que el modelo tiene que MIRAR (imagen, captura, PDF escaneado);
// con un valor por omisión (aquí) y un ajuste por variable de entorno sin tocar el código:
//   LIKIDA_CARTAPORTE_NIVELES_TEXTO=1,2,3   LIKIDA_CARTAPORTE_NIVELES_VISION=2,3
// El orden por omisión (3.8 Flash → Sonnet, niveles 2 y 3, para texto y visión) sale de la decisión de Javier y de la simulación
// sin costo con las salidas grabadas (informe privado 25): Lite como nivel 1 dejó errores sin señal y no ahorró (escalaba casi siempre).
// Lite sigue disponible: LIKIDA_CARTAPORTE_NIVELES_TEXTO=1,2,3.
// ═══════════════════════════════════════════════════════════════════════════

import type { ContenidoDoc } from './contenido';
import type { NivelModelo } from './extractor';

export type TipoLectura = 'texto' | 'vision';

/** El orden por omisión. */
export const ORDEN_NIVELES_DEFECTO: Readonly<Record<TipoLectura, readonly NivelModelo[]>> = {
  texto: [2, 3],
  vision: [2, 3],
};

const VARIABLE: Record<TipoLectura, string> = { texto: 'LIKIDA_CARTAPORTE_NIVELES_TEXTO', vision: 'LIKIDA_CARTAPORTE_NIVELES_VISION' };

/** Imagen (o sin texto) = visión; todo lo demás llega como texto. */
export const tipoDeLectura = (c: Pick<ContenidoDoc, 'texto' | 'imagenes'>): TipoLectura => (c.texto === null && c.imagenes.length > 0 ? 'vision' : 'texto');

/** «2,3» → [2, 3]. Sin repetidos, solo 1, 2 o 3; vacío o con algo inválido → `null` (se usa el orden por omisión). */
export function leerOrden(valor: string | undefined): readonly NivelModelo[] | null {
  if (!valor || valor.trim() === '') return null;
  const partes = valor.split(',').map((x) => x.trim());
  const niveles: NivelModelo[] = [];
  for (const p of partes) {
    if (p !== '1' && p !== '2' && p !== '3') return null;
    const n = Number(p) as NivelModelo;
    if (niveles.includes(n)) return null;
    niveles.push(n);
  }
  return niveles;
}

/** Los niveles que se recorren para este tipo de documento: el de la variable de entorno si es válido, si no el de omisión. */
export function ordenDeNiveles(tipo: TipoLectura, env: Record<string, string | undefined> = process.env): readonly NivelModelo[] {
  return leerOrden(env[VARIABLE[tipo]]) ?? ORDEN_NIVELES_DEFECTO[tipo];
}
