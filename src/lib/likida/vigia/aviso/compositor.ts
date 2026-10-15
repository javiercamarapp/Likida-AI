// Compositor del mensaje de aviso y de actualización (T-A4-14).
//
// 747a3730 00:21: hoy se manda a mano caja, placas de la caja, estado de la caja, unidad, placas de la unidad, operador,
// licencia y vigencia, teléfono. 04:56: «hacerlo idéntico». BLOQUEO EXTERNO B8: aún no hay ejemplos reales del mensaje
// de hoy; mientras tanto el texto es genérico y las etiquetas salen de `ConfigCompositor`.
// Reglas:
//  - Solo campos estructurados de la fila resuelta (T-A4-11) filtrados por la política de privacidad (T-A4-12). Nada del
//    texto libre del programa (COMENTARIOS) entra: el tipo de entrada ni siquiera lo declara.
//  - Lo que falta se omite o se marca «por confirmar» (config); jamás se inventa ni se toma de otra fila.
//  - Un campo oculto por política no se muestra ni se lista como pendiente, tampoco en los cambios de una actualización.
//  - Tope de 1 000 caracteres (MAX_TEXTO_AL_CLIENTE); `lineasPlantilla` sin saltos (aLineaPlantilla).
//  - `huella` = sha256 del contenido normalizado: mismo contenido, misma huella (idempotencia de reenvío).
// Módulo puro: sin base, sin red, sin logs.

import { createHash } from 'node:crypto';
import { MAX_TEXTO_AL_CLIENTE } from '../enviar';
import { aLineaPlantilla } from '../redactor';
import type { CampoAviso } from './privacidad';
import type { FilaResuelta } from './resolver';

export type ModoFaltante = 'omitir' | 'por_confirmar';

export interface ConfigCompositor {
  /** Qué hacer con un dato visible que no se tiene. Por defecto `por_confirmar`. */
  faltante?: ModoFaltante;
  /** Encabezado del aviso nuevo (texto genérico hasta tener los ejemplos B8). */
  encabezado?: string;
}

export interface CambioAviso {
  campo: CampoAviso;
  antes: string | null;
  despues: string | null;
}

export interface EntradaCompositor {
  /** Solo los números de la fila (respaldo si el catálogo no los resolvió). */
  fila: { caja?: string | null; unidad?: string | null };
  resuelto: Pick<FilaResuelta, 'unidad' | 'caja' | 'operador'>;
  visibles: ReadonlySet<CampoAviso>;
  /** 1 = aviso nuevo; > 1 = actualización. */
  version: number;
  cambios?: readonly CambioAviso[];
  config?: ConfigCompositor;
}

export interface AvisoComputado {
  texto: string;
  lineasPlantilla: string[];
  /** Campos visibles que no se tuvieron. */
  pendientes: CampoAviso[];
  huella: string;
}

export const ENCABEZADO_POR_DEFECTO = 'Datos de la unidad asignada a tu viaje:';
const POR_CONFIRMAR = 'por confirmar';
const MAX_VALOR = 80;

const ETIQUETA_CAMBIO: Record<CampoAviso, string> = {
  caja: 'la caja',
  placas_caja: 'las placas de la caja',
  estado_caja: 'el estado de la caja',
  unidad: 'la unidad',
  placas_unidad: 'las placas de la unidad',
  operador_nombre: 'el operador',
  licencia: 'la licencia',
  vigencia: 'la vigencia de la licencia',
  telefono_operador: 'el teléfono del operador',
};

/** Valor de una sola línea, sin espacios repetidos y acotado; `null` si queda vacío. */
function valor(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (t === '') return null;
  return t.length > MAX_VALOR ? `${t.slice(0, MAX_VALOR - 1)}…` : t;
}

/** AAAA-MM-DD → DD/MM/AAAA (sin pasar por Date: no hay zona horaria). Otro formato se muestra tal cual. */
function fecha(v: string | null | undefined): string | null {
  const t = valor(v);
  const m = t ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(t) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : t;
}

function normalizar(texto: string): string {
  return texto.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function componerAviso(entrada: EntradaCompositor): AvisoComputado {
  const { fila, resuelto, visibles } = entrada;
  const modo: ModoFaltante = entrada.config?.faltante ?? 'por_confirmar';
  const op = resuelto.operador;

  const lineas: string[] = [];
  const pendientes: CampoAviso[] = [];
  const poner = (campo: CampoAviso, etiqueta: string, v: string | null) => {
    if (!visibles.has(campo)) return;
    if (v) lineas.push(`${etiqueta}: ${v}`);
    else {
      pendientes.push(campo);
      if (modo === 'por_confirmar') lineas.push(`${etiqueta}: ${POR_CONFIRMAR}`);
    }
  };

  poner('caja', 'Caja', valor(resuelto.caja?.numero) ?? valor(fila.caja));
  poner('placas_caja', 'Placas de la caja', valor(resuelto.caja?.placas));
  poner('estado_caja', 'Estado de la caja', valor(resuelto.caja?.estado));
  poner('unidad', 'Unidad', valor(resuelto.unidad?.numero) ?? valor(fila.unidad));
  poner('placas_unidad', 'Placas de la unidad', valor(resuelto.unidad?.placas));
  poner('operador_nombre', 'Operador', valor(op?.nombre));

  // Licencia y vigencia comparten renglón; solo se muestra lo que la política deja ver.
  const verLic = visibles.has('licencia');
  const verVig = visibles.has('vigencia');
  if (verLic || verVig) {
    const lic = verLic ? valor(op?.licencia) : null;
    const vig = verVig ? fecha(op?.vence) : null;
    const partes: string[] = [];
    if (verLic && lic) partes.push(lic);
    if (verVig && vig) partes.push(`vigencia ${vig}`);
    if (partes.length > 0) lineas.push(`Licencia: ${partes.join(', ')}`);
    else {
      if (verLic) pendientes.push('licencia');
      if (verVig) pendientes.push('vigencia');
      if (modo === 'por_confirmar') lineas.push(`Licencia: ${POR_CONFIRMAR}`);
    }
  }
  poner('telefono_operador', 'Teléfono del operador', valor(op?.telefono));

  // Actualización: solo cambios de campos visibles.
  const esActualizacion = entrada.version > 1 || (entrada.cambios?.length ?? 0) > 0;
  const cambios = (entrada.cambios ?? []).filter((c) => visibles.has(c.campo));
  const frases = cambios.map((c) => {
    const f = c.campo === 'vigencia' ? fecha : valor;
    return `cambió ${ETIQUETA_CAMBIO[c.campo]}: ${f(c.antes) ?? POR_CONFIRMAR} → ${f(c.despues) ?? POR_CONFIRMAR}`;
  });

  let encabezado: string;
  if (esActualizacion) {
    encabezado = frases.length > 0 ? `Actualización: ${frases.join('; ')}.` : 'Actualización de los datos de tu viaje:';
  } else {
    encabezado = valor(entrada.config?.encabezado) ?? ENCABEZADO_POR_DEFECTO;
  }

  const bloques = [encabezado, ...lineas];
  let texto = bloques.join('\n');
  if (texto.length > MAX_TEXTO_AL_CLIENTE) texto = `${texto.slice(0, MAX_TEXTO_AL_CLIENTE - 1)}…`;

  const lineasPlantilla = bloques.map((l) => aLineaPlantilla(l));
  const huella = createHash('sha256').update(normalizar(texto)).digest('hex');
  return { texto, lineasPlantilla, pendientes, huella };
}
