// ═══════════════════════════════════════════════════════════════════════════
// «DATOS QUE FALTAN» DE PEAJES — qué impide conciliar o reclamar, y por qué.
//
// Un panel de la flota, medido SOLO sobre lo que ya está en la base (catálogo de
// TAGs, casetas, tarifario y los renglones de los últimos desgloses). No lee
// correos ni abre archivos: si un dato no está en la base, el panel lo dice.
//
// Reglas del producto que este módulo cumple:
//   · Nunca un cero que parezca medición. Cada fila tiene uno de cuatro estados:
//       completo   → se midió y NO falta nada (el cero es medido);
//       faltan     → se midió y faltan N casos;
//       sin_datos  → no hay filas del origen (catálogo o archivos vacíos): no hay
//                    nada que medir, y eso NO es «completo»;
//       no_medible → la fuente no existe todavía o no se pudo leer: «aún no
//                    medible: falta <fuente>». Jamás cero.
//   · Ejemplo ANONIMIZADO: un id parcial (primeros y últimos caracteres), nunca
//     el TAG, el económico o la caseta completos.
//   · «Qué hace falta» es TEXTO FIJO por fila.
//   · Sin acceso a datos propio: `leerDatosFaltantes` COMPONE los lectores que ya
//     existen en `repo.ts` (la guarda de frontera de datos cuenta cada consulta directa); el
//     cálculo (`calcularDatosFaltantes`) es una función pura.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { esFechaReal } from './fecha_real';
import { normalizarNombre } from './formatos';
import { resolverCaseta, type CasetaCatalogo } from './casetas';
import type { TagVista, CasetaVista, TarifaVista } from './repo';

/** Una fuente: o llegó, o se dice qué falta de ella (nunca se sustituye por una lista vacía). */
export type Fuente<T> = { ok: true; datos: T } | { ok: false; falta: string };

export type EstadoFila = 'completo' | 'faltan' | 'sin_datos' | 'no_medible';

export type IdFila =
  | 'tag_sin_unidad'
  | 'economico_varios_tags'
  | 'tag_dos_economicos'
  | 'caseta_sin_coordenadas'
  | 'caseta_sin_tarifa'
  | 'cruce_sin_tarifa'
  | 'cruce_sin_fecha'
  | 'cruce_sin_clase';

export interface FilaFaltante {
  id: IdFila;
  /** Qué falta, en una línea. */
  etiqueta: string;
  estado: EstadoFila;
  /** Cuántos casos; `null` si no se midió (sin_datos / no_medible). Nunca 0 por defecto. */
  casos: number | null;
  /** Aclaración corta de la unidad medida («12 cruces», «3 TAG distintos»). */
  detalle: string | null;
  /** Un caso, anonimizado (id parcial). `null` si no hay casos. */
  ejemplo: string | null;
  /** Qué hace falta para resolverlo: texto fijo. */
  resolver: string;
  /** Para `sin_datos`/`no_medible`: qué fuente falta («falta <fuente>»). */
  falta: string | null;
}

export interface LineaMinima {
  indice: number;
  fecha: string | null;
  caseta: string | null;
  tag: string | null;
  clase: number | null;
  /** El económico tal como lo trae el archivo del proveedor. */
  unidadArchivo: string | null;
  /** La unidad a la que `peaje_tag` casó el TAG; `null` = TAG sin dar de alta. */
  unidadId: string | null;
}

export type TagMinimo = Pick<TagVista, 'tag' | 'unidadId' | 'unidadEconomico' | 'activo' | 'bajaEn'>;
export type CasetaMinima = Pick<CasetaVista, 'id' | 'nombre' | 'nombreNorm' | 'alias' | 'lat' | 'lng' | 'radioM' | 'activa'>;
export type TarifaMinima = Pick<TarifaVista, 'casetaNorm' | 'clase' | 'vigenteDesde' | 'vigenteHasta'>;

export interface EntradaDatosFaltantes {
  tags: Fuente<readonly TagMinimo[]>;
  casetas: Fuente<readonly CasetaMinima[]>;
  tarifas: Fuente<readonly TarifaMinima[]>;
  lineas: Fuente<readonly LineaMinima[]>;
}

export interface ResultadoDatosFaltantes {
  filas: FilaFaltante[];
  /** Cuántos archivos de desglose alimentaron las filas de cruces (los más recientes). */
  archivos: number;
}

// ── Textos fijos ────────────────────────────────────────────────────────────

const FUENTE_ARCHIVOS = 'los archivos de desglose recibidos';

const TEXTO: Record<IdFila, { etiqueta: string; resolver: string }> = {
  tag_sin_unidad: {
    etiqueta: 'TAG sin unidad asignada',
    resolver: 'Dar de alta el TAG en el catálogo y asignarle su unidad (económico). Mientras no esté, sus cruces no se pueden atribuir a un viaje ni reclamar.',
  },
  economico_varios_tags: {
    etiqueta: 'Económico con más de un TAG activo',
    resolver: 'Confirmar cuál es el TAG vigente de la unidad y dar de baja el otro; si de verdad lleva dos, dejarlo así. El sistema no adivina cuál cobró.',
  },
  tag_dos_economicos: {
    etiqueta: 'TAG con dos económicos distintos en los archivos',
    resolver: 'Pedir al proveedor o corregir el catálogo para que cada TAG tenga un solo económico. Con dos, el cobro no se puede atribuir a una unidad.',
  },
  caseta_sin_coordenadas: {
    etiqueta: 'Caseta sin coordenadas',
    resolver: 'Cargar latitud y longitud de la caseta en el catálogo. Sin ellas no se puede contrastar contra el GPS de la unidad.',
  },
  caseta_sin_tarifa: {
    etiqueta: 'Caseta sin tarifa en el tarifario',
    resolver: 'Cargar o capturar la tarifa por caseta y clase de eje. Sin tarifa no se puede decir cuánto debió costar el cruce ni cuánto reclamar.',
  },
  cruce_sin_tarifa: {
    etiqueta: 'Cruce sin tarifa aplicable',
    resolver: 'Cargar la tarifa de esa caseta y clase vigente en la fecha del cruce. Sin ella el cobro no se compara y no se calcula el exceso reclamable.',
  },
  cruce_sin_fecha: {
    etiqueta: 'Cruce con fecha vacía o ilegible',
    resolver: 'Reemitir el archivo del proveedor con la fecha del cruce o corregir la columna de fecha en el mapeo. Sin fecha no se cruza con el viaje ni se mide el plazo de reclamo.',
  },
  cruce_sin_clase: {
    etiqueta: 'Cruce con clase de eje desconocida',
    resolver: 'Pedir al proveedor la columna de clase o categoría de eje, o mapearla. Sin clase no se sabe qué tarifa le toca ni si el cobro es indebido.',
  },
};

// ── Anonimización ───────────────────────────────────────────────────────────

/** Un id parcial: lo justo para reconocer el caso sin exponer el identificador completo («TAG-0001» → «TAG…01»). */
export function idParcial(valor: string): string {
  const v = valor.trim();
  if (v === '') return '…';
  if (v.length <= 5) return `${v.charAt(0)}…${v.slice(-1)}`;
  return `${v.slice(0, 3)}…${v.slice(-2)}`;
}

// ── Utilidades ──────────────────────────────────────────────────────────────

const limpio = (v: string | null | undefined): string => (v ?? '').trim();
const llaveTag = (v: string | null | undefined): string => limpio(v).toUpperCase();

function fila(id: IdFila, estado: EstadoFila, extra: { casos?: number; detalle?: string; ejemplo?: string; falta?: string } = {}): FilaFaltante {
  return {
    id, etiqueta: TEXTO[id].etiqueta, estado, resolver: TEXTO[id].resolver,
    casos: extra.casos ?? null, detalle: extra.detalle ?? null, ejemplo: extra.ejemplo ?? null, falta: extra.falta ?? null,
  };
}

const noMedible = (id: IdFila, falta: string): FilaFaltante => fila(id, 'no_medible', { falta });
const sinDatos = (id: IdFila, falta: string): FilaFaltante => fila(id, 'sin_datos', { falta });
const resultado = (id: IdFila, casos: number, detalle: string, ejemplo: string | null): FilaFaltante =>
  casos === 0 ? fila(id, 'completo', { casos: 0 }) : fila(id, 'faltan', { casos, detalle, ...(ejemplo === null ? {} : { ejemplo }) });

const plural = (n: number, uno: string, varios: string): string => (n === 1 ? uno : varios);

function vigenteEn(t: TarifaMinima, fecha: string | null): boolean {
  if (fecha === null || !esFechaReal(fecha)) return true; // sin fecha no se puede descartar la vigencia: se mira solo caseta y clase
  return t.vigenteDesde <= fecha && (t.vigenteHasta === null || fecha <= t.vigenteHasta);
}

// ── El cálculo (puro) ───────────────────────────────────────────────────────

export function calcularDatosFaltantes(e: EntradaDatosFaltantes, archivos: number): ResultadoDatosFaltantes {
  const filas: FilaFaltante[] = [];
  const L = e.lineas;

  // (a) TAG sin unidad asignada — desde los cruces: el TAG viene en el archivo y `peaje_tag` no lo casó con ninguna unidad.
  // (El catálogo no puede tener un TAG sin unidad: `peaje_tag.unidad_id` es NOT NULL.)
  if (!L.ok) filas.push(noMedible('tag_sin_unidad', L.falta));
  else if (L.datos.length === 0) filas.push(sinDatos('tag_sin_unidad', FUENTE_ARCHIVOS));
  else {
    const conTag = L.datos.filter((l) => llaveTag(l.tag) !== '');
    if (conTag.length === 0) filas.push(sinDatos('tag_sin_unidad', 'cruces con TAG en los archivos recibidos'));
    else {
      const sinUnidad = conTag.filter((l) => l.unidadId === null);
      const tags = [...new Set(sinUnidad.map((l) => llaveTag(l.tag)))].sort();
      filas.push(resultado('tag_sin_unidad', tags.length,
        `${tags.length} ${plural(tags.length, 'TAG distinto', 'TAG distintos')} · ${sinUnidad.length} ${plural(sinUnidad.length, 'cruce', 'cruces')}`,
        tags.length > 0 ? idParcial(tags[0]) : null));
    }
  }

  // (b1) Económico con más de un TAG activo — desde el catálogo de TAGs.
  if (!e.tags.ok) filas.push(noMedible('economico_varios_tags', e.tags.falta));
  else if (e.tags.datos.length === 0) filas.push(sinDatos('economico_varios_tags', 'el catálogo de TAGs'));
  else {
    const porUnidad = new Map<string, { eco: string; tags: Set<string> }>();
    for (const t of e.tags.datos) {
      if (!t.activo || (t.bajaEn ?? null) !== null) continue;
      const g = porUnidad.get(t.unidadId) ?? { eco: limpio(t.unidadEconomico) || t.unidadId, tags: new Set<string>() };
      g.tags.add(llaveTag(t.tag));
      porUnidad.set(t.unidadId, g);
    }
    const varios = [...porUnidad.values()].filter((g) => g.tags.size > 1).sort((a, b) => a.eco.localeCompare(b.eco));
    filas.push(resultado('economico_varios_tags', varios.length,
      `${varios.length} ${plural(varios.length, 'económico', 'económicos')}`, varios.length > 0 ? idParcial(varios[0].eco) : null));
  }

  // (b2) TAG con dos económicos distintos — desde los renglones: el mismo TAG aparece con dos identificadores de unidad.
  if (!L.ok) filas.push(noMedible('tag_dos_economicos', L.falta));
  else if (L.datos.length === 0) filas.push(sinDatos('tag_dos_economicos', FUENTE_ARCHIVOS));
  else if (!L.datos.some((l) => limpio(l.unidadArchivo) !== '')) {
    filas.push(noMedible('tag_dos_economicos', 'el económico por renglón en los archivos de desglose'));
  } else {
    const porTag = new Map<string, Set<string>>();
    for (const l of L.datos) {
      const tag = llaveTag(l.tag);
      const eco = limpio(l.unidadArchivo).toUpperCase();
      if (tag === '' || eco === '') continue;
      porTag.set(tag, (porTag.get(tag) ?? new Set<string>()).add(eco));
    }
    const dobles = [...porTag.entries()].filter(([, ecos]) => ecos.size > 1).map(([tag]) => tag).sort();
    filas.push(resultado('tag_dos_economicos', dobles.length,
      `${dobles.length} ${plural(dobles.length, 'TAG', 'TAG')}`, dobles.length > 0 ? idParcial(dobles[0]) : null));
  }

  // (c) Caseta sin coordenadas — desde el catálogo de casetas (solo activas: una dada de baja ya no estorba).
  const casetasActivas = e.casetas.ok ? e.casetas.datos.filter((c) => c.activa) : [];
  if (!e.casetas.ok) filas.push(noMedible('caseta_sin_coordenadas', e.casetas.falta));
  else if (casetasActivas.length === 0) filas.push(sinDatos('caseta_sin_coordenadas', 'el catálogo de casetas'));
  else {
    const sin = casetasActivas.filter((c) => c.lat === null || c.lng === null || !Number.isFinite(c.lat) || !Number.isFinite(c.lng));
    filas.push(resultado('caseta_sin_coordenadas', sin.length,
      `${sin.length} de ${casetasActivas.length} ${plural(casetasActivas.length, 'caseta', 'casetas')}`, sin.length > 0 ? idParcial(sin[0].nombre) : null));
  }

  // (d1) Caseta sin tarifa — el catálogo contra el tarifario (ninguna clase, ninguna vigencia).
  if (!e.casetas.ok) filas.push(noMedible('caseta_sin_tarifa', e.casetas.falta));
  else if (!e.tarifas.ok) filas.push(noMedible('caseta_sin_tarifa', e.tarifas.falta));
  else if (casetasActivas.length === 0) filas.push(sinDatos('caseta_sin_tarifa', 'el catálogo de casetas'));
  else {
    const conTarifa = new Set(e.tarifas.datos.map((t) => t.casetaNorm));
    const sin = casetasActivas.filter((c) => !conTarifa.has(c.nombreNorm));
    filas.push(resultado('caseta_sin_tarifa', sin.length,
      `${sin.length} de ${casetasActivas.length} ${plural(casetasActivas.length, 'caseta', 'casetas')}`, sin.length > 0 ? idParcial(sin[0].nombre) : null));
  }

  // (d2) Cruce sin tarifa aplicable — cada renglón contra el tarifario por caseta, clase (si viene) y vigencia (si hay fecha).
  if (!L.ok) filas.push(noMedible('cruce_sin_tarifa', L.falta));
  // A61-PRU-01 — el catálogo es insumo de `resolverCaseta`, que decide la llave con la
  // que se busca la tarifa: sin él, un cruce que llega con el alias no se resuelve y se
  // contaba como faltante aunque su tarifa exista. (d1) ya caía a «no medible» aquí.
  else if (!e.casetas.ok) filas.push(noMedible('cruce_sin_tarifa', e.casetas.falta));
  else if (!e.tarifas.ok) filas.push(noMedible('cruce_sin_tarifa', e.tarifas.falta));
  else if (L.datos.length === 0) filas.push(sinDatos('cruce_sin_tarifa', FUENTE_ARCHIVOS));
  else {
    const catalogo: CasetaCatalogo[] = e.casetas.datos.map((c) => ({ id: c.id, nombre: c.nombre, nombreNorm: c.nombreNorm, alias: [...c.alias], lat: c.lat, lng: c.lng, radioM: c.radioM }));
    const conNombre = L.datos.filter((l) => limpio(l.caseta) !== '');
    if (conNombre.length === 0) filas.push(sinDatos('cruce_sin_tarifa', 'el nombre de la caseta en los cruces recibidos'));
    else {
      const sin = conNombre.filter((l) => {
        const r = resolverCaseta(l.caseta, catalogo);
        const llave = r.tipo === 'unica' ? r.caseta.nombreNorm : normalizarNombre(l.caseta);
        return !(e.tarifas.ok && e.tarifas.datos.some((t) => t.casetaNorm === llave && (l.clase === null || t.clase === l.clase) && vigenteEn(t, l.fecha)));
      });
      filas.push(resultado('cruce_sin_tarifa', sin.length,
        `${sin.length} ${plural(sin.length, 'cruce', 'cruces')}`, sin.length > 0 ? idParcial(limpio(sin[0].caseta)) : null));
    }
  }

  // (e) Cruce con fecha vacía o ilegible.
  if (!L.ok) filas.push(noMedible('cruce_sin_fecha', L.falta));
  else if (L.datos.length === 0) filas.push(sinDatos('cruce_sin_fecha', FUENTE_ARCHIVOS));
  else {
    const sin = L.datos.filter((l) => l.fecha === null || !esFechaReal(l.fecha));
    filas.push(resultado('cruce_sin_fecha', sin.length,
      `${sin.length} de ${L.datos.length} ${plural(L.datos.length, 'cruce', 'cruces')}`, sin.length > 0 ? ejemploDeCruce(sin[0]) : null));
  }

  // (f) Clase de eje desconocida.
  if (!L.ok) filas.push(noMedible('cruce_sin_clase', L.falta));
  else if (L.datos.length === 0) filas.push(sinDatos('cruce_sin_clase', FUENTE_ARCHIVOS));
  else {
    const sin = L.datos.filter((l) => l.clase === null || !Number.isInteger(l.clase));
    filas.push(resultado('cruce_sin_clase', sin.length,
      `${sin.length} de ${L.datos.length} ${plural(L.datos.length, 'cruce', 'cruces')}`, sin.length > 0 ? ejemploDeCruce(sin[0]) : null));
  }

  return { filas, archivos };
}

function ejemploDeCruce(l: LineaMinima): string {
  if (limpio(l.tag) !== '') return idParcial(llaveTag(l.tag));
  if (limpio(l.caseta) !== '') return idParcial(limpio(l.caseta));
  return `renglón ${l.indice + 1}`;
}

// ── La lectura (compone lectores existentes; sin consultas propias) ───────────

export interface LectoresDatosFaltantes {
  listarTags: (tenantId: string) => Promise<TagMinimo[]>;
  listarCasetas: (tenantId: string) => Promise<CasetaMinima[]>;
  listarTarifas: (tenantId: string) => Promise<TarifaMinima[]>;
  lineasDeDesglose: (tenantId: string, desgloseId: string) => Promise<Array<Record<string, unknown>>>;
}

async function leer<T>(nombre: string, falta: string, f: () => Promise<T>): Promise<Fuente<T>> {
  try {
    return { ok: true, datos: await f() };
  } catch (e) {
    logger.warn('peajes.datos_faltantes_fuente', { fuente: nombre, err: e instanceof Error ? e.message : String(e) });
    return { ok: false, falta };
  }
}

function lineaDeFila(f: Record<string, unknown>): LineaMinima {
  const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
  const clase = f.clase === null || f.clase === undefined ? null : Number(f.clase);
  return {
    indice: Number(f.indice), fecha: texto(f.fecha), caseta: texto(f.caseta), tag: texto(f.tag),
    clase: clase !== null && Number.isFinite(clase) ? clase : null, unidadArchivo: texto(f.unidad_archivo), unidadId: texto(f.unidad_id),
  };
}

/**
 * Lee las cuatro fuentes y calcula el panel. `desgloseIds` son los archivos a medir (los más recientes de la flota);
 * `null` = no se pudo listar. Una fuente que falla NO se vuelve lista vacía: sus filas salen «no medible».
 */
export async function leerDatosFaltantes(
  tenantId: string,
  desgloseIds: readonly string[] | null,
  lectores: LectoresDatosFaltantes,
): Promise<ResultadoDatosFaltantes> {
  const [tags, casetas, tarifas, lineas] = await Promise.all([
    leer('tags', 'el catálogo de TAGs', () => lectores.listarTags(tenantId)),
    leer('casetas', 'el catálogo de casetas', () => lectores.listarCasetas(tenantId)),
    leer('tarifas', 'el tarifario', () => lectores.listarTarifas(tenantId)),
    desgloseIds === null
      ? Promise.resolve<Fuente<LineaMinima[]>>({ ok: false, falta: 'la lista de archivos de desglose' })
      : leer('lineas', 'los renglones de los archivos de desglose', async () => {
          const porArchivo = await Promise.all(desgloseIds.map((id) => lectores.lineasDeDesglose(tenantId, id)));
          return porArchivo.flat().map(lineaDeFila);
        }),
  ]);
  return calcularDatosFaltantes({ tags, casetas, tarifas, lineas }, desgloseIds?.length ?? 0);
}
