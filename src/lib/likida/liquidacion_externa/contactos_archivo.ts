// ═══════════════════════════════════════════════════════════════════════════
// CORREOS Y COORDINADORES DESDE UN ARCHIVO SUBIDO EN EL PANEL (Ola 1 · A1).
//
// La lógica ya existía (`contactos_csv.ts`: interpretar + aplicar) y solo se alcanzaba por la API (`POST /v1/liquidaciones-externas/
// contactos`). Esta función la pone al alcance de la oficina: lee el CSV/Excel con `numero_empleado;correo;coordinador_nombre;
// coordinador_correo` y aplica las MISMAS reglas — el operador se busca por número de empleado y NUNCA se crea, solo se tocan
// `correo` y `coordinador_id` (jamás `telefono`), una celda vacía no borra, es idempotente y el informe no repite ningún correo.
// ═══════════════════════════════════════════════════════════════════════════

import { matrizDeArchivoCatalogo } from '../peajes/archivo';
import { aplicarContactos, interpretarContactos, resumenContactos, type InformeContactos, type PuertoContactos } from './contactos_csv';
import { puertoContactosReal } from './repo_correo';

export interface ResultadoContactosArchivo {
  /** `null` = el archivo no se pudo leer (el motivo va en `error`). */
  informe: InformeContactos | null;
  /** «N actualizados / M sin operador / K inválidos», sin ningún correo. */
  resumen: string;
  /** Hasta 5 renglones «fila N: motivo» para la oficina (nunca el valor de un correo). */
  detalle: string[];
  error?: string;
}

const TOPE_DETALLE = 5;

export async function importarContactosDeArchivo(
  tenantId: string, nombre: string, bytes: Uint8Array, puerto: PuertoContactos = puertoContactosReal(tenantId),
): Promise<ResultadoContactosArchivo> {
  const m = matrizDeArchivoCatalogo(nombre, bytes);
  if (!m.ok) return { informe: null, resumen: m.motivo, detalle: [], error: m.motivo };
  const lectura = interpretarContactos(m.matriz as unknown[][]);
  if (lectura.error && lectura.filas.length === 0) return { informe: null, resumen: lectura.error, detalle: [], error: lectura.error };
  const informe = await aplicarContactos(lectura, puerto);
  const detalle = [...informe.sinOperador, ...informe.ambiguos, ...informe.invalidas]
    .sort((a, b) => a.fila - b.fila)
    .slice(0, TOPE_DETALLE)
    .map((d) => `fila ${d.fila}: ${d.motivo}`);
  return { informe, resumen: resumenContactos(informe), detalle };
}
