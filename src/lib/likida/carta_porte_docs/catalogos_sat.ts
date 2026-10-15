// ═══════════════════════════════════════════════════════════════════════════
// CATÁLOGOS SAT CARGADOS (T-A3-24) — el resolvedor que consulta `validarExtraccion`.
//
// Los catálogos completos viven en la tabla global `cp_sat_catalogo` (0793, sin datos hasta que se importen con
// scripts/importar-catalogo-sat.ts). Este archivo NO sabe de Supabase: recibe una función `cargar` y deja la consulta
// real a `repo.cargarCatalogoSat`. Cada documento hace A LO MÁS UNA consulta por catálogo (todas las claves del
// documento en un solo lote); `validarExtraccion` sigue siendo pura y solo lee el resolvedor ya precargado.
//
// Tres respuestas posibles por clave, y la diferencia es la seguridad del flujo:
//   · true   el catálogo está cargado y la clave existe;
//   · false  el catálogo está cargado y la clave NO existe  → la validación bloquea;
//   · null   el catálogo no está cargado (tabla vacía, error de lectura, TMS sin respuesta) → NUNCA bloquea: degrada a
//            un aviso «no se pudo verificar». Una tabla vacía no debe frenar a todas las flotas.
// ═══════════════════════════════════════════════════════════════════════════

import type { Extraccion } from './campos';
import { CLAVES_UNIDAD } from './catalogos';
import type { SalidaTms } from './tms_puerto';

export const CAT_PRODUCTO = 'c_ClaveProdServCP';
export const CAT_UNIDAD = 'c_ClaveUnidad';
export const CAT_EMBALAJE = 'c_TipoEmbalaje';
export const CAT_FRACCION = 'c_FraccionArancelaria';
export const CAT_PELIGROSO = 'c_MaterialPeligroso';
export const CAT_CP = 'c_CodigoPostal';
export const CAT_COLONIA = 'c_Colonia';

/** Datos extra de una fila del catálogo oficial (p. ej. de un código postal: c_Estado, c_Municipio, c_Localidad). */
export type DatosSat = Record<string, string>;

export interface ResolvedorSat {
  /** `null` = el catálogo no está cargado (o la clave no se consultó): no se puede afirmar nada. */
  existe(catalogo: string, clave: string): boolean | null;
  /** Las columnas extra de la fila, o `null` si no existe / no hay datos. */
  datos(catalogo: string, clave: string): DatosSat | null;
}

/** catálogo → (clave consultada → datos de su fila, o `null` si NO existe). Un catálogo ausente = no cargado. */
export type TablasSat = Map<string, Map<string, DatosSat | null>>;

export function crearResolvedorSat(tablas: TablasSat): ResolvedorSat {
  return {
    existe(catalogo, clave) {
      const t = tablas.get(catalogo);
      if (!t || !t.has(clave)) return null;
      return t.get(clave) !== null;
    },
    datos(catalogo, clave) {
      return tablas.get(catalogo)?.get(clave) ?? null;
    },
  };
}

/** Resolvedor en memoria a partir de listas de claves (o de claves con datos). Sirve a las pruebas y a las demos. */
export function resolvedorEnMemoria(catalogos: Record<string, ReadonlyArray<string> | Record<string, DatosSat>>): ResolvedorSat {
  const tablas: TablasSat = new Map();
  for (const [cat, contenido] of Object.entries(catalogos)) {
    const m = new Map<string, DatosSat | null>();
    if (Array.isArray(contenido)) for (const c of contenido) m.set(c, {});
    else for (const [c, d] of Object.entries(contenido)) m.set(c, d);
    tablas.set(cat, m);
  }
  // Una clave que no está en la lista de un catálogo cargado NO existe: se resuelve en la consulta (ver `existe`).
  return {
    existe(catalogo, clave) {
      const t = tablas.get(catalogo);
      if (!t) return null;
      return t.has(clave);
    },
    datos(catalogo, clave) {
      return tablas.get(catalogo)?.get(clave) ?? null;
    },
  };
}

/** Sin catálogos cargados: toda consulta es «no se sabe». */
export const SIN_CATALOGOS_SAT: ResolvedorSat = { existe: () => null, datos: () => null };

/** Fracción arancelaria sin puntos, espacios ni guiones (`8517.62.17.99` → `8517621799`). Otro texto se deja igual. */ // grep-limpio:ok
export function normalizarFraccion(v: string): string {
  return /^[\d\s.\-]+$/.test(v) ? v.replace(/[\s.\-]/g, '') : v;
}

/** Claves a consultar de la fracción: la normalizada y, si trae NICO (10 dígitos), también sus 8 dígitos (el catálogo base). */
export function clavesDeFraccion(v: string): string[] {
  const n = normalizarFraccion(v);
  if (!/^\d+$/.test(n)) return [];
  if (n.length === 10) return [n, n.slice(0, 8)];
  return n.length === 8 ? [n] : [];
}

const valor = (c: { valor: string | null } | undefined): string => (c?.valor ?? '').trim();

/** Todas las claves del documento que merecen consulta, por catálogo. Solo las de forma válida (lo demás ya lo atrapa la forma). */
export function clavesParaConsultar(e: Extraccion): Map<string, Set<string>> {
  const por = new Map<string, Set<string>>();
  const poner = (cat: string, clave: string) => {
    if (!clave) return;
    let s = por.get(cat);
    if (!s) { s = new Set(); por.set(cat, s); }
    s.add(clave);
  };
  for (const fila of e.mercancias) {
    const prod = valor(fila.bienes_transp);
    if (/^\d{8}$/.test(prod)) poner(CAT_PRODUCTO, prod);
    const uni = valor(fila.clave_unidad);
    if (!CLAVES_UNIDAD.has(uni) && /^[A-Z0-9]{2,3}$/.test(uni) && !/^\d{1,2}$/.test(uni)) poner(CAT_UNIDAD, uni);
    const emb = valor(fila.embalaje);
    if (/^[0-9A-Z]{2,3}$/.test(emb)) poner(CAT_EMBALAJE, emb);
    for (const f of clavesDeFraccion(valor(fila.fraccion_arancelaria))) poner(CAT_FRACCION, f);
    const pel = valor(fila.clave_material_peligroso);
    if (pel && pel.toUpperCase() !== 'N/A') poner(CAT_PELIGROSO, pel);
  }
  for (const lado of ['origen', 'destino'] as const) {
    const cp = valor(e.campos[`${lado}_cp`]);
    if (/^\d{5}$/.test(cp)) poner(CAT_CP, cp);
    const col = valor(e.campos[`${lado}_colonia_clave`]);
    if (col) poner(CAT_COLONIA, col);
  }
  return por;
}

/** Lee del catálogo `catalogo` las filas cuyas claves se piden. `null` = el catálogo no está cargado. */
export type CargarCatalogoSat = (catalogo: string, claves: string[]) => Promise<Map<string, DatosSat> | null>;

export const MAX_CONSULTAS_TMS = 25;
export const TIMEOUT_TMS_MS = 5000;

async function consultaTms(tms: SalidaTms, catalogo: string, clave: string): Promise<boolean | null> {
  if (!tms.consultarCatalogo) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      tms.consultarCatalogo(catalogo, clave),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), TIMEOUT_TMS_MS); }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Precarga, con UNA consulta por catálogo, lo que el documento necesita. Si la local dice «no cargado» y el puerto del
 * TMS expone `consultarCatalogo`, se usa como SEGUNDA fuente (acotada y sin lanzar). Nunca lanza: un error de lectura
 * equivale a «catálogo no cargado».
 */
export async function precargarCatalogosSat(
  e: Extraccion, cargar: CargarCatalogoSat, opc: { tms?: SalidaTms } = {},
): Promise<ResolvedorSat> {
  const pedidas = clavesParaConsultar(e);
  const tablas: TablasSat = new Map();
  await Promise.all([...pedidas].map(async ([catalogo, claves]) => {
    const lista = [...claves];
    let encontradas: Map<string, DatosSat> | null = null;
    try { encontradas = await cargar(catalogo, lista); } catch { encontradas = null; }
    if (encontradas) {
      const t = new Map<string, DatosSat | null>();
      for (const c of lista) t.set(c, encontradas.get(c) ?? null);
      tablas.set(catalogo, t);
      return;
    }
    if (!opc.tms?.consultarCatalogo) return; // sigue «no cargado»
    const t = new Map<string, DatosSat | null>();
    const respuestas = await Promise.all(lista.slice(0, MAX_CONSULTAS_TMS).map(async (c) => [c, await consultaTms(opc.tms as SalidaTms, catalogo, c)] as const));
    for (const [c, r] of respuestas) if (r !== null) t.set(c, r ? {} : null);
    if (t.size > 0) tablas.set(catalogo, t);
  }));
  return crearResolvedorSat(tablas);
}
