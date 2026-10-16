import { mxn } from '@/lib/formato';
import { normalizarNombre, normalizarTag, llaveUnidad } from './formatos';

// ═══════════════════════════════════════════════════════════════════════════
// LAS REGLAS DE REVISIÓN DE COBROS — «¿este cobro del proveedor es correcto?»
//
// El primer filtro de finanzas al recibir el archivo decenal del proveedor es
// validar que cada cobro sea el correcto (clase/ejes esperados 3 y 5, y que no
// llegue un cobro fuera de su mes). Esta pieza lo hace sobre las LÍNEAS DEL
// ARCHIVO, sin GPS ni viajes (ese cruce es otro frente: ver `PUNTO_EXTENSION_VIAJE`).
//
// ── LA DOCTRINA ─────────────────────────────────────────────────────────────
//   · Todo lo que sale de aquí es un CANDIDATO PARA VALIDAR CON EL PROVEEDOR,
//     nunca un «cobro indebido»: no existe el tarifario por caseta/clase, así que
//     ninguna regla puede afirmar que el monto está mal. Cada candidato dice qué
//     pasó, qué significa y qué hacer, en lenguaje llano.
//   · Una regla que no puede aplicarse (sin periodo, sin clase, sin hora) NO se
//     aplica EN SILENCIO: queda en `reglasNoAplicadas` con el porqué.
//   · Las listas (excepciones de clase por caseta, casetas que no deben cruzarse,
//     tags dados de baja) las configura la flota; NO viene nada precargado.
//
// Reglas:
//   clase_fuera_de_3_5       clase distinta de {3, 5} (3 = tracto solo, 5 = tracto
//                            + caja de 2 ejes), salvo las clases que la flota declare
//                            válidas para esa caseta. Depende del TIPO DE UNIDAD del TAG
//                            (T-A2-39): `tracto` y SIN TIPO se evalúan contra {3, 5} (el
//                            sin tipo sale rotulado «sin tipo de unidad: candidato»);
//                            `utilitario` se evalúa contra la lista `clasesUtilitario` que
//                            declare la flota — vacía = no se evalúa y se dice en
//                            `reglasNoAplicadas` (no se inventa una tarifa de coche). La clase 1 en casetas de TARIFA
//                            POR PASADA (la caseta cobra la pasada, no por ejes) no se
//                            marca: se declara con una excepción por caseta.
//   extemporaneo             la fecha del cruce es anterior al inicio del periodo del
//                            archivo: el proveedor cobra tarde. Sin periodo no se aplica.
//   duplicado_exacto         mismo TAG, mismo segundo, misma caseta, mismo importe. Es
//                            DISTINTO del «doble cobro» de `reclamacion.ts` (mismo TAG y
//                            caseta en ≤ 10 min): ese puede ser un retorno o un carril.
//   tag_dado_de_baja         cruce posterior a la baja del TAG (unidad siniestrada, TAG
//                            cancelado): la flota ya no debería recibir cargos con él.
//   caseta_no_debe_cruzarse  la caseta está en la lista de casetas prohibidas de la flota, salvo las
//                            UNIDADES que la flota exceptúe para esa caseta (p. ej. la camioneta de
//                            rescates). Un cruce revisado se puede JUSTIFICAR con un motivo: sigue en
//                            la lista (historial), rotulado. Con la lista vacía la regla va a
//                            `reglasNoAplicadas` («no hay casetas prohibidas configuradas»).
//
// PURO: sin base, sin red. El I/O vive en `revision_cobros.ts`.
// ═══════════════════════════════════════════════════════════════════════════

export type CategoriaCobro =
  | 'clase_fuera_de_3_5'
  | 'extemporaneo'
  | 'duplicado_exacto'
  | 'tag_dado_de_baja'
  | 'caseta_no_debe_cruzarse';

export const CATEGORIAS_COBRO: readonly CategoriaCobro[] = [
  'clase_fuera_de_3_5', 'extemporaneo', 'duplicado_exacto', 'tag_dado_de_baja', 'caseta_no_debe_cruzarse',
];

export const ETIQUETA_CATEGORIA_COBRO: Record<CategoriaCobro, string> = {
  clase_fuera_de_3_5: 'Clase distinta de 3 y 5',
  extemporaneo: 'Cobro extemporáneo',
  duplicado_exacto: 'Cobro duplicado exacto',
  tag_dado_de_baja: 'TAG dado de baja',
  caseta_no_debe_cruzarse: 'Caseta que no debe cruzarse',
};

/** Todo candidato lleva este rótulo: el reporte nunca afirma que el cobro sea indebido. */
export const ROTULO_CANDIDATO = 'Candidato: validar con el proveedor';

/** Tipo de la unidad de un TAG (`peaje_tag.tipo_unidad`, 0812). Sin tipo = `null`: no se adivina. */
export type TipoUnidadPeaje = 'tracto' | 'utilitario';
export const TIPOS_UNIDAD_PEAJE: readonly TipoUnidadPeaje[] = ['tracto', 'utilitario'];

/** Rótulo de un candidato de clase cuya unidad no tiene tipo declarado (falta el maestro TAG→unidad con tipo). */
export const ROTULO_SIN_TIPO_UNIDAD = 'sin tipo de unidad: candidato';

/** Las clases de cobro válidas por defecto: 3 (tracto solo) y 5 (tracto + caja de 2 ejes). */
export const CLASES_VALIDAS_DEFAULT: readonly number[] = [3, 5];

/**
 * PUNTO DE EXTENSIÓN (no implementado a propósito): el cruce de cada cobro contra el
 * viaje/GPS depende del identificador de despacho del TMS del cliente y de su API. Cuando
 * exista, se agrega como una regla más que reciba `viajePorLinea` y use el mismo contrato
 * `Candidato`; nada de este módulo cambia.
 */
export const PUNTO_EXTENSION_VIAJE = 'cruce_cobro_vs_viaje_pendiente' as const;

export interface LineaCobro {
  /** Renglón dentro del archivo (0-based). */
  indice: number;
  fecha: string | null;
  /** HH:MM:SS; vacío o ausente si el archivo no trae hora. */
  hora?: string | null;
  caseta: string | null;
  tag: string | null;
  unidad: string | null;
  /** `undefined`/`null` = el archivo no trae clase para esa línea. */
  clase?: number | null;
  monto: number;
  /** Tipo de la unidad del TAG (T-A2-39). `undefined`/`null` = sin tipo de unidad. */
  tipoUnidad?: TipoUnidadPeaje | null;
}

export interface ReglasCobro {
  /** Clases válidas en toda caseta. Default {3, 5}. */
  clasesValidas?: readonly number[];
  /**
   * Clases válidas para las unidades `utilitario` (la flota las declara). Vacía o ausente = a un utilitario NO
   * se le evalúa la clase (y la regla lo dice en `reglasNoAplicadas`): no se inventa una tarifa de coche.
   */
  clasesUtilitario?: readonly number[];
  /**
   * Clases ADICIONALES válidas por caseta (la llave es el nombre normalizado con `normalizarNombre`).
   * Ej.: casetas de tarifa por pasada → [1].
   */
  excepcionesClase?: ReadonlyMap<string, readonly number[]>;
  /** Inicio del periodo del archivo (ISO). `null`/ausente = la regla de extemporáneos no se aplica. */
  periodoDesde?: string | null;
  /** TAG normalizado (`normalizarTag`) → último día en que el TAG estaba vigente (ISO). */
  tagsBaja?: ReadonlyMap<string, string>;
  /** Casetas (nombre normalizado) que la flota no debe cruzar. */
  casetasNoCruzar?: ReadonlySet<string>;
  /**
   * Excepciones por UNIDAD de las casetas que no deben cruzarse: caseta (nombre normalizado) → unidades
   * (normalizadas con `normalizarNombre`) a las que NO se les marca el cruce. Una línea sin unidad no se exceptúa.
   */
  excepcionesPorUnidad?: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Cruces revisados con motivo: `indice` de la línea → motivo. Solo aplica a `caseta_no_debe_cruzarse`.
   * El candidato NO desaparece: sigue en la lista con `justificacion`.
   */
  justificados?: ReadonlyMap<number, string>;
}

export interface CandidatoCobro {
  indice: number;
  categoria: CategoriaCobro;
  fecha: string | null;
  hora: string | null;
  caseta: string | null;
  tag: string | null;
  unidad: string | null;
  clase: number | null;
  monto: number;
  /** Tipo de la unidad del TAG; `null` = sin tipo de unidad. Solo lo llevan los candidatos de clase. */
  tipoUnidad?: TipoUnidadPeaje | null;
  /** Solo si la unidad no tiene tipo declarado: `ROTULO_SIN_TIPO_UNIDAD`. */
  rotuloTipoUnidad?: string;
  /** Lenguaje llano: qué pasó. */
  quePaso: string;
  /** Lenguaje llano: qué significa (y qué NO significa). */
  queSignifica: string;
  /** Lenguaje llano: qué hacer. */
  queHacer: string;
  /** Dato crudo de apoyo para el Excel (línea del primer cobro, fecha de baja, inicio del periodo…). */
  referencia: string;
  /** Solo si alguien revisó este cruce y lo justificó: el motivo. El candidato sigue en el historial. */
  justificacion?: string;
}

export interface ReglaNoAplicada { regla: CategoriaCobro; motivo: string }

export interface ResumenCategoria { n: number; monto: number }

export interface ResultadoRevision {
  candidatos: CandidatoCobro[];
  porCategoria: Record<CategoriaCobro, ResumenCategoria>;
  /** Líneas distintas con al menos un candidato (una línea puede caer en dos categorías). */
  lineasConCandidato: number;
  montoConCandidato: number;
  lineasRevisadas: number;
  montoRevisado: number;
  reglasNoAplicadas: ReglaNoAplicada[];
  /** Líneas sin clase: no se les pudo validar la clase. */
  sinClase: number;
  /** Cruces por clase (para que se vea la mezcla, p. ej. cuántos de clase 1). */
  porClase: Array<{ clase: number | null; n: number; monto: number }>;
  /**
   * Casetas donde la clase 1 domina (≥ 95 % y ≥ 20 cruces) y NO tienen excepción declarada: lo más
   * probable es que cobren por pasada. SOLO una sugerencia; la declara una persona.
   */
  sugerenciasPasada: Array<{ caseta: string; cruces: number; monto: number }>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const normCaseta = (c: string | null) => normalizarNombre(c ?? '');
const nombreCaseta = (l: LineaCobro) => l.caseta?.trim() || 'una caseta sin nombre';
const quien = (l: LineaCobro) => (l.unidad ? `La unidad ${l.unidad}` : l.tag ? `El TAG ${l.tag}` : 'Un vehículo');
const cuando = (l: LineaCobro) => (l.fecha ? ` el ${l.fecha}${l.hora ? ` a las ${l.hora.slice(0, 5)}` : ''}` : '');

function base(l: LineaCobro): Omit<CandidatoCobro, 'categoria' | 'quePaso' | 'queSignifica' | 'queHacer' | 'referencia'> {
  return {
    indice: l.indice, fecha: l.fecha, hora: l.hora ? l.hora.slice(0, 8) : null, caseta: l.caseta, tag: l.tag, unidad: l.unidad,
    clase: l.clase ?? null, monto: l.monto,
  };
}

/** Reglas de la lista de clases: texto «3 y 5». */
function listaClases(cs: readonly number[]): string {
  const o = [...cs].sort((a, b) => a - b);
  return o.length <= 1 ? String(o[0] ?? '') : `${o.slice(0, -1).join(', ')} y ${o[o.length - 1]}`;
}

/**
 * Aplica las reglas a las líneas de UN archivo. El orden de salida es el del archivo;
 * una línea puede tener varios candidatos (p. ej. extemporáneo y clase 9).
 */
export function revisarCobros(lineas: readonly LineaCobro[], reglas: ReglasCobro = {}): ResultadoRevision {
  const clasesValidas = reglas.clasesValidas ?? CLASES_VALIDAS_DEFAULT;
  const clasesUtilitario = reglas.clasesUtilitario ?? [];
  const excepciones = reglas.excepcionesClase ?? new Map<string, readonly number[]>();
  const periodoDesde = reglas.periodoDesde ?? null;
  const tagsBaja = reglas.tagsBaja ?? new Map<string, string>();
  const noCruzar = reglas.casetasNoCruzar ?? new Set<string>();
  const exceptuadas = reglas.excepcionesPorUnidad ?? new Map<string, ReadonlySet<string>>();
  const justificados = reglas.justificados ?? new Map<number, string>();

  const candidatos: CandidatoCobro[] = [];
  const reglasNoAplicadas: ReglaNoAplicada[] = [];

  // ── ¿Qué reglas pueden aplicarse a ESTE archivo? ──────────────────────────
  const conClase = lineas.filter((l) => l.clase !== undefined && l.clase !== null).length;
  const sinClase = lineas.length - conClase;
  if (lineas.length > 0 && conClase === 0) {
    reglasNoAplicadas.push({ regla: 'clase_fuera_de_3_5', motivo: 'El archivo no trae clase en ninguna línea: no se puede validar la clase/ejes del cobro.' });
  }
  const utilitariosSinLista = clasesUtilitario.length > 0 ? 0
    : lineas.filter((l) => l.tipoUnidad === 'utilitario' && l.clase !== undefined && l.clase !== null).length;
  if (utilitariosSinLista > 0) {
    reglasNoAplicadas.push({
      regla: 'clase_fuera_de_3_5',
      motivo: `${utilitariosSinLista} cruce(s) de unidades utilitarias: la flota no ha declarado qué clases les corresponden, así que no se evalúa su clase (no se inventa una tarifa). Decláralas en «Reglas de cobro».`,
    });
  }
  if (periodoDesde === null) {
    reglasNoAplicadas.push({ regla: 'extemporaneo', motivo: 'Sin periodo del archivo no se puede saber qué cobro llegó tarde. Declara el periodo al subir el archivo o usa un nombre como «01 A 10 DE SEPT».' });
  }
  const conTag = lineas.filter((l) => l.tag).length;
  const conHora = lineas.filter((l) => l.fecha && l.hora).length;
  if (lineas.length > 0 && (conTag === 0 || conHora === 0)) {
    reglasNoAplicadas.push({
      regla: 'duplicado_exacto',
      motivo: conTag === 0
        ? 'El archivo no trae TAG: sin TAG no se puede afirmar que dos cobros sean el mismo.'
        : 'El archivo no trae hora del cruce: sin el segundo exacto no se puede afirmar que dos cobros sean el mismo.',
    });
  }
  if (tagsBaja.size > 0 && conTag === 0) {
    reglasNoAplicadas.push({ regla: 'tag_dado_de_baja', motivo: 'El archivo no trae TAG: no se pueden comparar contra los TAGs dados de baja.' });
  }

  if (noCruzar.size === 0) {
    reglasNoAplicadas.push({ regla: 'caseta_no_debe_cruzarse', motivo: 'No hay casetas prohibidas configuradas: la flota decide cuáles no deben cruzarse (Configuración → Reglas de cobro). Nada viene precargado.' });
  }

  // ── Clase fuera de {3,5} ──────────────────────────────────────────────────
  for (const l of lineas) {
    if (l.clase === undefined || l.clase === null) continue;
    const tipo = l.tipoUnidad ?? null;
    if (tipo === 'utilitario' && clasesUtilitario.length === 0) continue; // no aplicada: ya dicho arriba
    const norm = normCaseta(l.caseta);
    const extras = excepciones.get(norm) ?? [];
    const validas = tipo === 'utilitario' ? clasesUtilitario : clasesValidas;
    if (validas.includes(l.clase) || extras.includes(l.clase)) continue;
    const esperadas = [...validas, ...extras];
    candidatos.push({
      ...base(l), categoria: 'clase_fuera_de_3_5', tipoUnidad: tipo,
      ...(tipo === null ? { rotuloTipoUnidad: ROTULO_SIN_TIPO_UNIDAD } : {}),
      quePaso: `${quien(l)} pasó por ${nombreCaseta(l)}${cuando(l)} y el proveedor cobró con clase ${l.clase} (${mxn(l.monto)}). Lo esperado ${tipo === 'utilitario' ? 'para un utilitario ' : ''}es clase ${listaClases(esperadas)}.`,
      queSignifica: (l.clase === 1
        ? 'La clase 1 suele ser la tarifa por pasada de algunas casetas, y entonces es normal. Aparece aquí porque esta caseta no está declarada como de tarifa por pasada. No es un error confirmado.'
        : `Una clase distinta de ${listaClases(esperadas)} puede indicar que el proveedor clasificó mal los ejes del vehículo y cobró de más (o de menos). Sin el tarifario no se puede afirmar cuánto debió costar.`)
        + (tipo === null ? ' Sin tipo de unidad: candidato. Esta unidad no tiene tipo declarado (tracto o utilitario): si es una camioneta, otra clase puede ser normal. Declara el tipo en el catálogo de TAGs.' : ''),
      queHacer: l.clase === 1
        ? 'Si esta caseta cobra por pasada, decláralo en «Reglas de cobro» para que deje de aparecer. Si no, pide al proveedor la clase con la que cobró.'
        : 'Compara con la clase que le corresponde a la unidad y, si no coincide, reclama al proveedor la diferencia por el portal (tienes 3 meses desde el cobro).',
      referencia: `clase ${l.clase}; válidas ${listaClases(esperadas)}${tipo === null ? `; ${ROTULO_SIN_TIPO_UNIDAD}` : `; ${tipo}`}`,
    });
  }

  // ── Extemporáneo ──────────────────────────────────────────────────────────
  if (periodoDesde !== null) {
    for (const l of lineas) {
      if (l.fecha === null || l.fecha >= periodoDesde) continue;
      candidatos.push({
        ...base(l), categoria: 'extemporaneo',
        quePaso: `${quien(l)} cruzó ${nombreCaseta(l)}${cuando(l)}, pero el cobro (${mxn(l.monto)}) llegó en el archivo que empieza el ${periodoDesde}.`,
        queSignifica: 'El proveedor cobró tarde un cruce de un periodo anterior. No significa que el cobro sea incorrecto: significa que hay que revisarlo junto con el mes en que ocurrió, para no pagarlo dos veces ni dejar de validarlo.',
        queHacer: 'Revísalo contra el archivo del periodo en que ocurrió el cruce (si ya se cobró ahí, es un cobro repetido) y valida la clase y el costo.',
        referencia: `inicio del periodo ${periodoDesde}`,
      });
    }
  }

  // ── Duplicado exacto: mismo TAG, mismo segundo, misma caseta, mismo importe ─
  {
    const vistos = new Map<string, number>();
    for (const l of lineas) {
      const tag = normalizarTag(l.tag);
      if (!tag || !l.fecha || !l.hora) continue;
      const k = `${tag}|${l.fecha}|${l.hora.slice(0, 8)}|${normCaseta(l.caseta)}|${l.monto.toFixed(2)}`;
      const primero = vistos.get(k);
      if (primero === undefined) { vistos.set(k, l.indice); continue; }
      candidatos.push({
        ...base(l), categoria: 'duplicado_exacto',
        quePaso: `${quien(l)} aparece cobrado dos veces en ${nombreCaseta(l)}${cuando(l)} por ${mxn(l.monto)}: mismo TAG, mismo segundo, misma caseta y mismo importe (primer cobro: línea ${primero + 1} del archivo).`,
        queSignifica: 'Dos renglones idénticos hasta el segundo no suelen ser dos cruces reales. Puede ser un cobro repetido por el proveedor o un renglón repetido en el archivo. No es lo mismo que dos cobros seguidos en minutos (ese caso es un posible retorno o reintento y se revisa aparte).',
        queHacer: 'Pide al proveedor confirmar si fueron dos cruces. Si no, reclama el segundo cobro.',
        referencia: `primer cobro: línea ${primero + 1}`,
      });
    }
  }

  // ── TAG dado de baja ──────────────────────────────────────────────────────
  if (tagsBaja.size > 0) {
    for (const l of lineas) {
      const tag = normalizarTag(l.tag);
      const baja = tag ? tagsBaja.get(tag) : undefined;
      if (!baja || !l.fecha || l.fecha <= baja) continue;
      candidatos.push({
        ...base(l), categoria: 'tag_dado_de_baja',
        quePaso: `El TAG ${l.tag} fue dado de baja el ${baja}, pero aparece un cobro de ${mxn(l.monto)} en ${nombreCaseta(l)}${cuando(l)}.`,
        queSignifica: 'Un TAG dado de baja (por ejemplo, de una unidad siniestrada) no debería generar cruces. Puede haber un error del proveedor, un TAG que siguió en uso o una baja registrada con fecha equivocada.',
        queHacer: 'Confirma la fecha de baja y, si es correcta, valida con el proveedor por qué el TAG sigue cobrando; si la baja está mal capturada, corrígela en «Reglas de cobro».',
        referencia: `baja el ${baja}`,
      });
    }
  }

  // ── Caseta que no debe cruzarse ───────────────────────────────────────────
  if (noCruzar.size > 0) {
    for (const l of lineas) {
      if (!l.caseta) continue;
      const norm = normCaseta(l.caseta);
      if (!noCruzar.has(norm)) continue;
      if (l.unidad && exceptuadas.get(norm)?.has(llaveUnidad(l.unidad))) continue;
      const justificacion = justificados.get(l.indice);
      candidatos.push({
        ...base(l), categoria: 'caseta_no_debe_cruzarse',
        quePaso: `${quien(l)} cruzó ${nombreCaseta(l)}${cuando(l)} (${mxn(l.monto)}), una caseta que la flota marcó como «no debe cruzarse».`,
        queSignifica: 'La flota declaró esa caseta como prohibida o fuera de ruta. El cobro puede ser correcto: significa que la unidad pasó por donde no debía (o que la lista está desactualizada).',
        queHacer: 'Revisa con el operador o con el despacho si el cruce estaba autorizado. Si lo estaba, quita la caseta de la lista; si no, es un tema interno de la flota, no un reclamo al proveedor.',
        referencia: 'lista de casetas que no deben cruzarse',
        ...(justificacion ? { justificacion } : {}),
      });
    }
  }

  candidatos.sort((a, b) => a.indice - b.indice || CATEGORIAS_COBRO.indexOf(a.categoria) - CATEGORIAS_COBRO.indexOf(b.categoria));

  // ── Resumen ───────────────────────────────────────────────────────────────
  const porCategoria = Object.fromEntries(CATEGORIAS_COBRO.map((c) => [c, { n: 0, monto: 0 }])) as Record<CategoriaCobro, ResumenCategoria>;
  const lineasUnicas = new Map<number, number>();
  for (const c of candidatos) {
    porCategoria[c.categoria].n++;
    porCategoria[c.categoria].monto = r2(porCategoria[c.categoria].monto + c.monto);
    lineasUnicas.set(c.indice, c.monto);
  }
  let montoConCandidato = 0;
  for (const m of lineasUnicas.values()) montoConCandidato += m;

  const claseAcum = new Map<number | null, { n: number; monto: number }>();
  const casetaClase1 = new Map<string, { nombre: string; n: number; uno: number; monto: number }>();
  let montoRevisado = 0;
  for (const l of lineas) {
    montoRevisado += l.monto;
    const k = l.clase ?? null;
    const a = claseAcum.get(k) ?? { n: 0, monto: 0 };
    a.n++; a.monto += l.monto;
    claseAcum.set(k, a);
    if (l.caseta && l.clase !== undefined && l.clase !== null) {
      const nk = normCaseta(l.caseta);
      const c = casetaClase1.get(nk) ?? { nombre: l.caseta, n: 0, uno: 0, monto: 0 };
      c.n++;
      if (l.clase === 1) { c.uno++; c.monto += l.monto; }
      casetaClase1.set(nk, c);
    }
  }
  const sugerenciasPasada = [...casetaClase1.entries()]
    .filter(([nk, c]) => c.n >= 20 && c.uno / c.n >= 0.95 && !(excepciones.get(nk) ?? []).includes(1) && !clasesValidas.includes(1))
    .map(([, c]) => ({ caseta: c.nombre, cruces: c.uno, monto: r2(c.monto) }))
    .sort((a, b) => b.cruces - a.cruces);

  return {
    candidatos, porCategoria,
    lineasConCandidato: lineasUnicas.size, montoConCandidato: r2(montoConCandidato),
    lineasRevisadas: lineas.length, montoRevisado: r2(montoRevisado),
    reglasNoAplicadas, sinClase,
    porClase: [...claseAcum.entries()]
      .map(([clase, v]) => ({ clase, n: v.n, monto: r2(v.monto) }))
      .sort((a, b) => (a.clase ?? 999) - (b.clase ?? 999)),
    sugerenciasPasada,
  };
}
