// ═══════════════════════════════════════════════════════════════════════════
// PIEZAS COMUNES de los lectores de CORREO / CAPTURA en texto (F1, F2, F3) — T-A3-61.
//
// Los tres leen el TEXTO del correo (o la transcripción de su captura) por rótulo, con el mapa de rótulos engañosos y la
// detección de corte de T-A3-53 (`rotulos.ts`). Lo que el correo no trae queda vacío: nada se inventa ni se infiere aquí.
// ═══════════════════════════════════════════════════════════════════════════

import { extraccionVacia, type CampoValor, type Extraccion } from '../campos';
import type { ContenidoDoc } from '../contenido';
import { campoLeido, pendientesDeEnriquecimiento, type FormatoLector, type IncidenciaLector, type ResultadoLector } from '../derivar';
import type { LecturaRotulos, Resolucion } from '../rotulos';
import { separarInterfaz } from '../rotulos';

/** Confianza de un valor leído por rótulo en texto limpio. */
export const CONF_CORREO = 0.93;
/** Lo que sale de texto libre (sin rótulo): menos seguro. */
export const CONF_TEXTO_LIBRE = 0.85;

export interface OpcionesLectorCorreo {
  /** El texto de la captura (imagen) tal como la leyó el modelo de visión (en pruebas, uno determinista). */
  transcripcion?: string | null;
}

export interface TextoDeCorreo { texto: string | null; transcrita: boolean }

/** El texto que hay que leer: el del correo (o PDF con texto), o la transcripción de la captura. */
export function textoDeCorreo(c: ContenidoDoc, o: OpcionesLectorCorreo = {}): TextoDeCorreo {
  if (c.formato === 'imagen') return { texto: o.transcripcion?.trim() ? o.transcripcion : null, transcrita: true };
  return { texto: c.texto && c.texto.trim() !== '' ? c.texto : null, transcrita: false };
}

export const resolucionDe = (c: ContenidoDoc): Resolucion | null => c.resolucion ?? null;

/** Un campo por rótulo, con su evidencia; `null` si no se pudo normalizar. */
export function campoDeTexto(clave: string, mercancia: boolean, crudo: string, evidencia: string, confianza: number, transcrita: boolean, notas: string[] = []): CampoValor | null {
  const cv = campoLeido(clave, mercancia, crudo, { confianza, evidencia, origen: transcrita ? 'llm' : 'perfil', notas });
  return cv;
}

/** Líneas del cuerpo, sin la interfaz del correo. */
export const lineasDelCuerpo = (texto: string): string[] => separarInterfaz(texto).lineas;

/** Arma el resultado común de un lector de correo a partir de la lectura por rótulos y lo que el variante agregó. */
export function cerrarLectorCorreo(
  formato: FormatoLector, e: Extraccion, lec: LecturaRotulos | null, extra: { avisos?: string[]; adicionales?: Record<string, string>; resolucion?: Resolucion | null },
): ResultadoLector {
  const avisos = [...(lec?.avisos ?? []), ...(extra.avisos ?? [])];
  const incidencias: IncidenciaLector[] = [];
  const cap = lec?.capturaIncompleta ?? null;
  if (cap) incidencias.push({ codigo: 'captura_incompleta', campo: null, renglon: null, detalle: `La captura termina en «${cap.ultimoRotulo}» sin valor: faltan datos. Pide el texto copiado del correo o una captura completa.` });
  if (lec?.bajaResolucion) incidencias.push({ codigo: 'baja_resolucion', campo: null, renglon: null, detalle: 'Captura de baja resolución: lo leído tiene confianza baja y debe confirmarse contra el correo.' });
  const leido = e.mercancias.length > 0;
  if (!leido) avisos.push('No se leyó ninguna mercancía del correo: sigue el flujo genérico y una persona lo confirma.');
  return { formato, leido, extraccion: e, avisos, incidencias, vacios: pendientesDeEnriquecimiento(e), adicionales: { ...(lec?.adicionales ?? {}), ...(extra.adicionales ?? {}) }, capturaIncompleta: cap };
}

/** Un lector que no recibió texto: no lee nada y lo dice. */
export function sinTexto(formato: FormatoLector, c: ContenidoDoc): ResultadoLector {
  const aviso = c.formato === 'imagen'
    ? 'Es una captura y no hay transcripción de su texto (falta el modelo de visión): sigue el flujo genérico y una persona lo confirma.'
    : 'El correo no trae texto legible: sigue el flujo genérico y una persona lo confirma.';
  return { formato, leido: false, extraccion: extraccionVacia(), avisos: [...c.avisos, aviso], incidencias: [], vacios: [], adicionales: {}, capturaIncompleta: null };
}

/** Pone un campo de mercancía (primera fila) o del documento si el campo es válido y aún está vacío. */
export function ponerSiVacio(e: Extraccion, fila: Record<string, CampoValor>, donde: 'doc' | 'merc', clave: string, cv: CampoValor | null): void {
  if (!cv) return;
  const destino = donde === 'doc' ? e.campos : fila;
  if (!destino[clave] || destino[clave].valor === null || destino[clave].valor === '') destino[clave] = cv;
}
