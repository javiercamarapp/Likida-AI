// Política de privacidad de los datos del operador en el aviso al cliente (T-A4-12).
//
// 747a3730 00:21: hoy se manda a mano caja, placas de la caja, estado de la caja, unidad, placas de la unidad, operador,
// licencia, vigencia y teléfono. Los tres últimos son datos personales de un tercero (el operador): no salen hacia el
// cliente sin que la dueña de la flota los habilite (B7 sigue abierto: la política real de la flota/RH).
// Mientras no haya política, el valor por defecto es el conservador:
//  - visibles: caja, placas_caja, estado_caja, unidad, placas_unidad, operador_nombre;
//  - ocultos: licencia, vigencia, telefono_operador, hasta una habilitación explícita CON constancia (quién, rol, cuándo).
// Falla cerrado: campo desconocido, constancia incompleta o rol distinto de `flota_admin` → se oculta.
// El compositor (T-A4-14) y la respuesta a petición (T-A4-24) deben usar SOLO `camposVisibles` / `filtrarOperador`.
// Módulo puro: no escribe logs. Si alguien necesita registrar un teléfono, que use `destinatarioEnmascarado` (meta/client).

import type { OperadorResuelto } from './resolver';

export const CAMPOS_AVISO = [
  'caja',
  'placas_caja',
  'estado_caja',
  'unidad',
  'placas_unidad',
  'operador_nombre',
  'licencia',
  'vigencia',
  'telefono_operador',
] as const;

export type CampoAviso = (typeof CAMPOS_AVISO)[number];

/** Visibles sin que nadie haga nada. */
export const CAMPOS_POR_DEFECTO: readonly CampoAviso[] = [
  'caja',
  'placas_caja',
  'estado_caja',
  'unidad',
  'placas_unidad',
  'operador_nombre',
];

/** Datos personales del operador: solo con habilitación explícita y constancia. */
export const CAMPOS_SENSIBLES: readonly CampoAviso[] = ['licencia', 'vigencia', 'telefono_operador'];

export interface ConstanciaHabilitacion {
  /** Quién habilitó (id o nombre de la persona). */
  por: string;
  /** Solo la dueña de la flota puede habilitar. */
  rol: string;
  /** Cuándo, ISO 8601. */
  cuando: string;
}

export interface Habilitacion {
  /** Campos sensibles que se habilitan (los no sensibles ya están visibles; los desconocidos se ignoran). */
  campos: readonly string[];
  constancia: ConstanciaHabilitacion | null;
}

export interface PoliticaPrivacidad {
  /** Aplica a todo cliente que no tenga entrada propia. */
  general?: Habilitacion | null;
  /** Por `clienteId`. Si existe, GANA a la general por completo (también para revocar con `campos: []`). */
  porCliente?: Readonly<Record<string, Habilitacion | null | undefined>>;
}

export function constanciaValida(c: ConstanciaHabilitacion | null | undefined): boolean {
  if (!c) return false;
  if (c.rol !== 'flota_admin') return false;
  if (typeof c.por !== 'string' || c.por.trim() === '') return false;
  if (typeof c.cuando !== 'string' || Number.isNaN(Date.parse(c.cuando))) return false;
  return true;
}

function esCampoSensible(c: string): c is CampoAviso {
  return (CAMPOS_SENSIBLES as readonly string[]).includes(c);
}

/** Qué campos puede ver el cliente `clienteId`. Ante cualquier duda, solo los de por defecto. */
export function camposVisibles(
  politica: PoliticaPrivacidad | null | undefined,
  clienteId: string | null | undefined,
): ReadonlySet<CampoAviso> {
  const visibles = new Set<CampoAviso>(CAMPOS_POR_DEFECTO);
  if (!politica) return visibles;

  const propias = politica.porCliente;
  const tieneEntradaPropia =
    !!clienteId && !!propias && Object.prototype.hasOwnProperty.call(propias, clienteId) && propias[clienteId] != null;
  const aplicable = tieneEntradaPropia ? propias![clienteId as string] : politica.general;

  if (!aplicable || !constanciaValida(aplicable.constancia) || !Array.isArray(aplicable.campos)) return visibles;
  for (const campo of aplicable.campos) {
    if (esCampoSensible(campo)) visibles.add(campo);
  }
  return visibles;
}

/** Copia del operador sin lo que el cliente no puede ver (los campos ocultos quedan en `null`). */
export function filtrarOperador(
  operador: OperadorResuelto | null,
  visibles: ReadonlySet<CampoAviso>,
): OperadorResuelto | null {
  if (!operador) return null;
  return {
    ...operador,
    nombre: visibles.has('operador_nombre') ? operador.nombre : null,
    licencia: visibles.has('licencia') ? operador.licencia : null,
    vence: visibles.has('vigencia') ? operador.vence : null,
    telefono: visibles.has('telefono_operador') ? operador.telefono : null,
  };
}
