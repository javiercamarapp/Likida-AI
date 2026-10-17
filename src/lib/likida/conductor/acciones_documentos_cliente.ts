import { puedeAsignar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import { altaDocumentoCliente, bajaDocumentoCliente } from './repo';
import { MAX_DOCUMENTOS_POR_CLIENTE, validarDocumento } from './documentos_cliente';

// ═══════════════════════════════════════════════════════════════════════════
// LAS ACCIONES DEL CATÁLOGO DE DOCUMENTOS POR CLIENTE (T-A5-52) — alta y baja de un documento, con puerto para poder probarlas:
// el permiso, la validación y los mensajes en palabras.
//
// El permiso se comprueba AQUÍ (una acción de servidor es un endpoint): dueño, encargado y superadmin. El `tenantId` sale de la
// SESIÓN, nunca del formulario; el cliente lo valida la base (debe ser de la misma flota).
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoAccionDocumentos =
  | { ok: true; mensaje: string }
  | { ok: false; error: string };

export interface DepsDocumentos { alta: typeof altaDocumentoCliente; baja: typeof bajaDocumentoCliente }
export const depsDocumentosReales = (): DepsDocumentos => ({ alta: altaDocumentoCliente, baja: bajaDocumentoCliente });

export interface ContextoDocumentos { tenantId: string; rol: string }

export async function altaDocumentoDelPanel(
  ctx: ContextoDocumentos, entrada: { clienteId?: unknown; nombre?: unknown; tipo?: unknown; requiereFirma?: unknown; requiereSello?: unknown },
  d: DepsDocumentos = depsDocumentosReales(),
): Promise<ResultadoAccionDocumentos> {
  if (!puedeAsignar(ctx.rol)) return { ok: false, error: 'Solo el dueño de la flota o el jefe de tráfico editan los documentos de un cliente.' };
  const v = validarDocumento(entrada);
  if (!v.ok) return { ok: false, error: v.error };
  try {
    const r = await d.alta(ctx.tenantId, v.doc);
    if (r === 'duplicado') return { ok: false, error: `Ese cliente ya tiene un documento llamado «${v.doc.nombre}».` };
    if (r === 'cliente_inexistente') return { ok: false, error: 'No encuentro ese cliente; recarga la pantalla e intenta de nuevo.' };
    if (r === 'tope') return { ok: false, error: `Un cliente puede tener hasta ${MAX_DOCUMENTOS_POR_CLIENTE} documentos; quita alguno antes de agregar otro.` };
    return { ok: true, mensaje: `Documento «${v.doc.nombre}» agregado como ${v.doc.tipo === 'basico' ? 'básico' : 'complementario'}.` };
  } catch (e) {
    logger.error('documentos_cliente.alta_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: 'No pude guardarlo ahorita. Lo que ya estaba guardado sigue igual; intenta de nuevo en un momento.' };
  }
}

export async function bajaDocumentoDelPanel(
  ctx: ContextoDocumentos, entrada: { id?: unknown }, d: DepsDocumentos = depsDocumentosReales(),
): Promise<ResultadoAccionDocumentos> {
  if (!puedeAsignar(ctx.rol)) return { ok: false, error: 'Solo el dueño de la flota o el jefe de tráfico editan los documentos de un cliente.' };
  const id = typeof entrada.id === 'string' ? entrada.id.trim() : '';
  if (id === '') return { ok: false, error: 'No sé cuál documento quitar; recarga la pantalla e intenta de nuevo.' };
  try {
    const existia = await d.baja(ctx.tenantId, id);
    if (!existia) return { ok: false, error: 'Ese documento ya no existe; recarga la pantalla.' };
    return { ok: true, mensaje: 'Documento quitado del catálogo del cliente.' };
  } catch (e) {
    logger.error('documentos_cliente.baja_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: 'No pude quitarlo ahorita. Intenta de nuevo en un momento.' };
  }
}
