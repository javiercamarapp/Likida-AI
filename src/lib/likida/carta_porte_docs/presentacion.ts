// ═══════════════════════════════════════════════════════════════════════════
// PRESENTACIÓN — del documento a las filas que pinta la pantalla de revisión. PURO.
//
// La pantalla no decide nada: recibe, por cada campo, su valor, su confianza, de dónde salió, la
// evidencia, las notas y los hallazgos que le tocan (los de ese campo y los que lo nombran como
// «relacionado»). Todos los campos del complemento aparecen —también los que el documento no trae,
// como filas vacías—: un hueco que no se ve es un hueco que no se llena.
// ═══════════════════════════════════════════════════════════════════════════

import { CAMPOS_DOC, CAMPOS_MERCANCIA, type CampoDoc, type CampoValor, type GrupoCampo, type Origen } from './campos';
import type { Hallazgo, Severidad } from './validacion';
import type { DocumentoFila, EstadoDoc } from './repo';

export interface FilaCampo {
  /** El nombre del input en la forma (`c:…` / `m:…`). */
  nombre: string;
  /** El de su casilla de confirmación. */
  nombreConfirmar: string;
  clave: string;
  renglon: number | null;
  rotulo: string;
  tipo: CampoDoc['tipo'];
  critico: boolean;
  valor: string;
  /** `null` = el documento no lo trae. */
  confianza: number | null;
  origen: Origen | null;
  evidencia: string | null;
  notas: string[];
  hallazgos: Array<{ severidad: Severidad; mensaje: string; codigo: string }>;
  /** Tiene algo por confirmar: se pinta la casilla. */
  porConfirmar: boolean;
  bloqueado: boolean;
}

export interface GrupoFilas { id: GrupoCampo; titulo: string; filas: FilaCampo[] }
export interface RenglonMercancia { indice: number; esNuevo: boolean; filas: FilaCampo[] }

export interface Revision {
  grupos: GrupoFilas[];
  mercancias: RenglonMercancia[];
  /** Hallazgos que no cuelgan de un campo (documento, mercancías). */
  generales: Hallazgo[];
  bloqueos: number;
  porConfirmar: number;
  listoParaAprobar: boolean;
}

const TITULOS: Record<GrupoCampo, string> = { documento: 'Datos del embarque', origen: 'Origen (remitente)', destino: 'Destino (destinatario)', transporte: 'Transporte', carga: 'Carga' };

function hallazgosDe(todos: Hallazgo[], clave: string, renglon: number | null): FilaCampo['hallazgos'] {
  return todos
    .filter((h) => (h.campo === clave && h.renglon === renglon) || (h.relacionados ?? []).some((r) => r.campo === clave && r.renglon === renglon))
    .map((h) => ({ severidad: h.severidad, mensaje: h.mensaje, codigo: h.codigo }));
}

function fila(def: CampoDoc, c: CampoValor | undefined, renglon: number | null, todos: Hallazgo[]): FilaCampo {
  const prefijo = renglon === null ? `c:${def.clave}` : `m:${renglon}:${def.clave}`;
  const hs = hallazgosDe(todos, def.clave, renglon);
  return {
    nombre: prefijo, nombreConfirmar: `k:${prefijo}`, clave: def.clave, renglon, rotulo: def.rotulo, tipo: def.tipo, critico: def.critico,
    valor: c?.valor ?? '', confianza: c && c.valor !== null && c.valor !== '' ? c.confianza : null, origen: c?.origen ?? null, evidencia: c?.evidencia ?? null,
    notas: c?.notas ?? [], hallazgos: hs, porConfirmar: hs.some((h) => h.severidad === 'confirmar'), bloqueado: hs.some((h) => h.severidad === 'bloqueo'),
  };
}

export function revisionDe(doc: Pick<DocumentoFila, 'extraccion' | 'validacion'>): Revision | null {
  if (!doc.extraccion) return null;
  const todos = doc.validacion?.hallazgos ?? [];
  const e = doc.extraccion;
  const grupos: GrupoFilas[] = (['documento', 'origen', 'destino', 'transporte'] as GrupoCampo[]).map((g) => ({
    id: g, titulo: TITULOS[g], filas: CAMPOS_DOC.filter((d) => d.grupo === g || (g === 'documento' && d.grupo === 'carga')).map((d) => fila(d, e.campos[d.clave], null, todos)),
  }));
  const mercancias: RenglonMercancia[] = e.mercancias.map((m, i) => ({ indice: i, esNuevo: false, filas: CAMPOS_MERCANCIA.map((d) => fila(d, m[d.clave], i, todos)) }));
  // Una fila vacía para agregar una mercancía que el modelo no vio.
  mercancias.push({ indice: e.mercancias.length, esNuevo: true, filas: CAMPOS_MERCANCIA.map((d) => fila(d, undefined, e.mercancias.length, todos)) });
  const generales = todos.filter((h) => h.campo === 'documento' || h.campo === 'mercancias');
  return {
    grupos, mercancias, generales,
    bloqueos: doc.validacion?.bloqueos ?? 0, porConfirmar: doc.validacion?.porConfirmar ?? 0, listoParaAprobar: doc.validacion?.listoParaAprobar ?? false,
  };
}

export const ROTULO_ESTADO: Record<EstadoDoc, string> = {
  recibido: 'Recibido', procesando: 'Leyendo…', por_revisar: 'Por revisar', aprobado: 'Aprobado', rechazado: 'Rechazado', fallido: 'No se pudo leer',
  dividido: 'Dividido en embarques',
};

export const ROTULO_ORIGEN: Record<Origen, string> = { xml: 'XML', perfil: 'Perfil del cliente', llm: 'Modelo', humano: 'Persona', derivado: 'Calculado' };

export const ROTULO_FORMATO: Record<string, string> = {
  pdf_texto: 'PDF con texto', pdf_escaneado: 'PDF escaneado', imagen: 'Foto', excel: 'Excel', csv: 'CSV', xml: 'XML', correo: 'Correo',
};

export const ROTULO_CANAL: Record<string, string> = { manual: 'Carga manual', correo: 'Correo', whatsapp: 'WhatsApp' };

/** El orden de la bandeja: lo que necesita a una persona primero. */
export function prioridadEstado(e: EstadoDoc): number {
  return { por_revisar: 0, fallido: 1, recibido: 2, procesando: 3, rechazado: 4, aprobado: 5, dividido: 6 }[e];
}
