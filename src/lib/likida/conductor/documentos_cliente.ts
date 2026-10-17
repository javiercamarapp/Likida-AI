// ═══════════════════════════════════════════════════════════════════════════
// EL CATÁLOGO DE DOCUMENTOS POR CLIENTE (T-A5-52, R24, migración 0809) — qué papeles pide cada cliente al cierre del viaje.
// Puro, sin I/O: la lectura y la escritura son `leerDocumentosCliente`, `altaDocumentoCliente` y `bajaDocumentoCliente` (repo.ts).
//
// Cada cliente pide cosas distintas: unos solo la carta porte firmada y sellada, otros además pedimento, DODA, fitosanitario o los
// tickets de báscula (cargado y vacío). Cada documento es BÁSICO (sin él no se cierra) o COMPLEMENTARIO (se pide, pero no frena).
// Un cliente SIN catálogo no cambia nada: se sigue pidiendo solo el comprobante de entrega (POD) de siempre.
// Esta tarea NO trae ningún catálogo real: la herramienta es neutral y la llena la flota.
// ═══════════════════════════════════════════════════════════════════════════

export const TIPOS_DOCUMENTO = ['basico', 'complementario'] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];
export const MAX_DOCUMENTOS_POR_CLIENTE = 30;
export const MAX_LARGO_NOMBRE_DOC = 80;

export interface DocumentoCliente {
  id: string;
  clienteId: string;
  nombre: string;
  tipo: TipoDocumento;
  requiereFirma: boolean;
  requiereSello: boolean;
}

export type EntradaDocumento = Omit<DocumentoCliente, 'id'>;

export const esTipoDocumento = (t: unknown): t is TipoDocumento => typeof t === 'string' && (TIPOS_DOCUMENTO as readonly string[]).includes(t);

/** Espacios simples y sin extremos; no cambia mayúsculas ni acentos (se muestra tal cual lo escribió la flota). */
export const normalizarNombreDocumento = (t: string): string => t.replace(/\s+/g, ' ').trim();

const marcada = (v: unknown): boolean => v === true || v === 'on' || v === 'true';

export type ResultadoValidarDocumento = { ok: true; doc: EntradaDocumento } | { ok: false; error: string };

/** Valida lo que llega de un formulario (todo `unknown`). Nunca lanza: devuelve el motivo en palabras. */
export function validarDocumento(e: { clienteId?: unknown; nombre?: unknown; tipo?: unknown; requiereFirma?: unknown; requiereSello?: unknown }): ResultadoValidarDocumento {
  const clienteId = typeof e.clienteId === 'string' ? e.clienteId.trim() : '';
  if (clienteId === '') return { ok: false, error: 'Elige el cliente.' };
  const nombre = typeof e.nombre === 'string' ? normalizarNombreDocumento(e.nombre) : '';
  if (nombre === '') return { ok: false, error: 'Escribe el nombre del documento.' };
  if (nombre.length > MAX_LARGO_NOMBRE_DOC) return { ok: false, error: `El nombre pasa de ${MAX_LARGO_NOMBRE_DOC} caracteres.` };
  if (!esTipoDocumento(e.tipo)) return { ok: false, error: 'Indica si el documento es básico o complementario.' };
  return { ok: true, doc: { clienteId, nombre, tipo: e.tipo, requiereFirma: marcada(e.requiereFirma), requiereSello: marcada(e.requiereSello) } };
}

export interface CatalogoDeCliente {
  /** `false` = el cliente no tiene catálogo: se pide solo el POD de siempre. */
  usaCatalogo: boolean;
  basicos: DocumentoCliente[];
  complementarios: DocumentoCliente[];
}

const porNombre = (a: DocumentoCliente, b: DocumentoCliente): number => a.nombre.localeCompare(b.nombre, 'es') || a.id.localeCompare(b.id);

/** Lo que pide UN cliente. Solo cuenta lo de ese cliente; sin filas suyas, no usa catálogo. */
export function catalogoDeCliente(docs: readonly DocumentoCliente[], clienteId: string): CatalogoDeCliente {
  const suyos = docs.filter((d) => d.clienteId === clienteId);
  return {
    usaCatalogo: suyos.length > 0,
    basicos: suyos.filter((d) => d.tipo === 'basico').sort(porNombre),
    complementarios: suyos.filter((d) => d.tipo === 'complementario').sort(porNombre),
  };
}
