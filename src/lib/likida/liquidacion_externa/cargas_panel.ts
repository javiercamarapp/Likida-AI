// ═══════════════════════════════════════════════════════════════════════════
// LAS CARGAS POR ARCHIVO DEL PANEL DE LIQUIDACIÓN POR CORREO (Ola 1 · A1): del archivo al mensaje que ve la oficina.
//
// La página (`dashboard/agentes/liquidacion/page.tsx`) solo gatea (rol y flota de la sesión) y llama aquí; esto lee el archivo con las
// MISMAS funciones que las rutas /v1 (`importarDesglosesDeArchivo` → `recibirDesglose`; `importarContactosDeArchivo` →
// `aplicarContactos`) y devuelve el aviso en lenguaje llano. Jamás pone un correo ni un importe en el mensaje.
// ═══════════════════════════════════════════════════════════════════════════

import type { Flash } from '../mensaje_flash';
import { importarDesglosesDeArchivo } from './desglose_csv';
import { importarContactosDeArchivo } from './contactos_archivo';

/** Tope del archivo subido desde el panel. */
export const MAX_ARCHIVO_CARGA_BYTES = 4_000_000;

export interface ArchivoCarga { nombre: string; bytes: Uint8Array }

/** El `File` del formulario → bytes, o el motivo en lenguaje llano. */
export async function leerArchivoCarga(fd: FormData): Promise<{ ok: true; archivo: ArchivoCarga } | { ok: false; error: string }> {
  const a = fd.get('archivo');
  if (!(a instanceof File) || a.size === 0) return { ok: false, error: 'Elige el archivo (CSV o Excel).' };
  if (a.size > MAX_ARCHIVO_CARGA_BYTES) return { ok: false, error: 'El archivo pesa demasiado (máximo 4 MB). Pártelo en varios.' };
  return { ok: true, archivo: { nombre: a.name, bytes: new Uint8Array(await a.arrayBuffer()) } };
}

const ERROR_GENERICO = 'No se pudo procesar el archivo. Vuelve a intentarlo: repetirlo es seguro.';

export async function cargarDesglosesDePanel(
  tenantId: string, a: ArchivoCarga, importar: typeof importarDesglosesDeArchivo = importarDesglosesDeArchivo,
): Promise<Flash> {
  try {
    const r = await importar(tenantId, a.nombre, a.bytes);
    if (r.error) return { error: r.error };
    const partes = [`${r.recibidas} recibidos`, `${r.idempotentes} ya estaban`];
    if (r.retenidas) partes.push(`${r.retenidas} retenidos`);
    if (r.correcciones) partes.push(`${r.correcciones} con corrección pendiente`);
    if (r.excepciones.length) partes.push(`${r.excepciones.length} con excepción`);
    if (r.problemas.length) partes.push(`${r.problemas.length} con problema`);
    const detalle = [
      ...r.excepciones.slice(0, 3).map((x) => `${x.clave}: ${x.motivo}`),
      ...r.problemas.slice(0, 3).map((x) => `${x.clave ?? 'archivo'}: ${x.motivo}`),
    ].join('\n');
    return {
      ...(r.sinProcesar
        ? { error: `Se acabó el tiempo de la carga: faltan ${r.sinProcesar} por procesar. Vuelve a subir el mismo archivo (lo ya recibido no se envía dos veces). ${partes.join(' / ')}.` }
        : { aviso: `Carga terminada: ${partes.join(' / ')}.` }),
      ...(detalle ? { detalle } : {}),
    };
  } catch {
    return { error: ERROR_GENERICO };
  }
}

export async function cargarContactosDePanel(
  tenantId: string, a: ArchivoCarga, importar: typeof importarContactosDeArchivo = importarContactosDeArchivo,
): Promise<Flash> {
  try {
    const r = await importar(tenantId, a.nombre, a.bytes);
    if (r.error) return { error: r.error };
    return { aviso: `Correos cargados: ${r.resumen}.`, ...(r.detalle.length ? { detalle: r.detalle.join('\n') } : {}) };
  } catch {
    return { error: ERROR_GENERICO };
  }
}
