// ═══════════════════════════════════════════════════════════════════════════
// REGISTRO DE FORMATOS DE ENTRADA Y SELECCIÓN POR FIRMA — T-A3-59.
//
// Los archivos que llegan a A3 son formatos que envían los clientes y que se pasan a nuestro formato.
// Hay nueve formatos de entrada; este módulo es el ÚNICO punto que decide a cuál se parece un documento:
//   A  plantilla «normal» del TMS ya llena      B  plantilla «nueva» ya llena
//   C  remisión escaneada de planta             D  Bill of Lading en inglés
//   E  orden de remisión de agente aduanal      F1 correo/captura: tabla «DATOS DE LA MERCANCÍA»
//   F2 correo/captura: bloque «Datos para CP:»  F3 correo/captura: bloque de rótulos de bienes
//   G  JSON v3.0 de plataforma
//
// Reglas (ficha T-A3-59):
//  · Cada formato tiene una firma = rasgos con peso; el puntaje es la fracción de peso que coincide (0..1).
//  · Si el mejor puntaje no llega al umbral, o el segundo queda demasiado cerca (empate), el resultado es
//    «formato no reconocido»: pasa a revisión humana. NUNCA se adivina.
//  · Un libro que mezcla hojas de A y de B no se reconoce (cada firma excluye las hojas de la otra).
//  · Un formato desconocido NO se descarta: su flujo sugerido es el genérico con modelo (el de hoy), pero
//    exige que una persona lo confirme.
//  · La persona puede cambiar la elección: `elegirFormato` respeta la elección manual sobre la automática.
//  · Sin lector aplicable (los de C–F y B aún no existen: T-A3-44, T-A3-60, T-A3-61) no se envía nada al TMS
//    (`puedeEnviarAlTms = false`).
//
// Puro y determinista: no llama a ningún modelo ni toca la red. El texto de un documento escaneado lo aporta
// quien llama (`textoVision`, p. ej. el encabezado leído por visión); sin él, un escaneado no se reconoce.
// ═══════════════════════════════════════════════════════════════════════════

import { CLAVES_PROHIBIDAS_JSON, type ContenidoDoc } from './contenido';

export const FORMATOS_ENTRADA = ['A', 'B', 'C', 'D', 'E', 'F1', 'F2', 'F3', 'G'] as const;
export type FormatoEntrada = (typeof FORMATOS_ENTRADA)[number];

/** Puntaje mínimo (0..1) para reconocer un formato. */
export const UMBRAL_RECONOCIMIENTO = 0.6;
/** Distancia mínima entre el mejor y el segundo puntaje; por debajo es empate ⇒ revisión humana. */
export const MARGEN_AMBIGUEDAD = 0.15;

export type LectorId =
  | 'plantilla_tms' // lector_plantilla_tms.ts (T-A3-47)
  | 'plantilla_tms_nueva' // T-A3-44 (pendiente)
  | 'remision_escaneada' // T-A3-60 (pendiente)
  | 'bol_ingles' // T-A3-60 (pendiente)
  | 'orden_agente' // T-A3-60 (pendiente)
  | 'correo_f1' | 'correo_f2' | 'correo_f3' // T-A3-61 (pendientes)
  | 'json_plataforma_v3'; // perfiles.ts leerJsonPlataformaV3 (T-A3-58)

export interface DescripcionFormato {
  formato: FormatoEntrada;
  nombre: string;
  lector: LectorId;
  /** ¿Ya existe el lector? Si no, el documento sigue el flujo genérico y nada va al TMS. */
  lectorDisponible: boolean;
  /** Tarea que lo construye o lo construyó. */
  tarea: string;
}

export const REGISTRO: Readonly<Record<FormatoEntrada, DescripcionFormato>> = {
  A: { formato: 'A', nombre: 'Plantilla «normal» del TMS llena', lector: 'plantilla_tms', lectorDisponible: true, tarea: 'T-A3-47' },
  B: { formato: 'B', nombre: 'Plantilla «nueva» del TMS llena', lector: 'plantilla_tms_nueva', lectorDisponible: false, tarea: 'T-A3-44' },
  C: { formato: 'C', nombre: 'Remisión escaneada de planta', lector: 'remision_escaneada', lectorDisponible: false, tarea: 'T-A3-60' },
  D: { formato: 'D', nombre: 'Bill of Lading en inglés', lector: 'bol_ingles', lectorDisponible: false, tarea: 'T-A3-60' },
  E: { formato: 'E', nombre: 'Orden de remisión de agente aduanal', lector: 'orden_agente', lectorDisponible: false, tarea: 'T-A3-60' },
  F1: { formato: 'F1', nombre: 'Correo/captura: tabla «DATOS DE LA MERCANCÍA»', lector: 'correo_f1', lectorDisponible: false, tarea: 'T-A3-61' },
  F2: { formato: 'F2', nombre: 'Correo/captura: bloque «Datos para CP:»', lector: 'correo_f2', lectorDisponible: false, tarea: 'T-A3-61' },
  F3: { formato: 'F3', nombre: 'Correo/captura: bloque de rótulos de bienes', lector: 'correo_f3', lectorDisponible: false, tarea: 'T-A3-61' },
  G: { formato: 'G', nombre: 'JSON v3.0 de plataforma', lector: 'json_plataforma_v3', lectorDisponible: true, tarea: 'T-A3-58' },
};

// ── Contexto de firma ───────────────────────────────────────────────────────

export interface EntradaClasificacion {
  contenido: ContenidoDoc;
  /** Texto leído por visión del encabezado de un escaneado o una captura (la visión falsa determinista en pruebas). */
  textoVision?: string | null;
}

interface Ctx {
  formato: ContenidoDoc['formato'];
  /** Nombres de hoja normalizados (solo libros). */
  hojas: Set<string>;
  /** Todo el texto visible, normalizado (sin acentos, minúsculas, espacios colapsados). */
  texto: string;
  arbol: unknown;
}

/** Sin acentos, minúsculas, espacios colapsados. */
const norm = (t: unknown): string => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const llaveHojaLocal = (t: unknown): string => norm(t).replace(/[^a-z0-9]+/g, '');

function construirCtx(e: EntradaClasificacion): Ctx {
  const c = e.contenido;
  const partes: string[] = [];
  if (c.texto) partes.push(c.texto);
  if (c.tabla) for (const h of c.tabla) for (const f of h.filas) partes.push(f.join(' | '));
  if (e.textoVision) partes.push(e.textoVision);
  return {
    formato: c.formato,
    hojas: new Set((c.tabla ?? []).map((h) => llaveHojaLocal(h.nombre))),
    texto: norm(partes.join('\n')),
    arbol: c.formato === 'json' ? c.xml : null,
  };
}

const tiene = (x: Ctx, ...frases: string[]): boolean => frases.some((f) => x.texto.includes(norm(f)));
const cuantas = (x: Ctx, frases: string[]): number => frases.filter((f) => x.texto.includes(norm(f))).length;
const esTabla = (x: Ctx): boolean => x.formato === 'excel' || x.formato === 'csv';
const esVisual = (x: Ctx): boolean => x.formato === 'correo' || x.formato === 'imagen' || x.formato === 'pdf_texto' || x.formato === 'pdf_escaneado';

/** Lectura segura de una clave propia (nunca de la cadena de prototipos). */
function propia(o: unknown, k: string): unknown {
  if (CLAVES_PROHIBIDAS_JSON.has(k) || o === null || typeof o !== 'object' || Array.isArray(o)) return null;
  return Object.prototype.hasOwnProperty.call(o, k) ? (o as Record<string, unknown>)[k] : null;
}

// ── Firmas ──────────────────────────────────────────────────────────────────

interface Rasgo { peso: number; coincide: (x: Ctx) => boolean }
interface Firma { rasgos: Rasgo[]; /** Si alguno de estos se cumple, el formato queda en 0 (p. ej. las hojas de la otra plantilla). */ excluye?: Array<(x: Ctx) => boolean> }

const HOJAS_NUEVA = ['datos', 'origenes', 'destinos'];

const FIRMAS: Readonly<Record<FormatoEntrada, Firma>> = {
  A: {
    rasgos: [
      { peso: 0.5, coincide: (x) => esTabla(x) && x.hojas.has('remintentedestinatario') && x.hojas.has('mercancias') },
      { peso: 0.3, coincide: (x) => esTabla(x) && tiene(x, '*regimen aduanero', 'regimen aduanero') },
      { peso: 0.2, coincide: (x) => esTabla(x) && tiene(x, 'llena cliente') },
    ],
    excluye: [(x) => HOJAS_NUEVA.some((h) => x.hojas.has(h))],
  },
  B: {
    rasgos: [
      { peso: 0.7, coincide: (x) => esTabla(x) && HOJAS_NUEVA.every((h) => x.hojas.has(h)) && x.hojas.has('mercancias') },
      { peso: 0.3, coincide: (x) => esTabla(x) && x.hojas.has('guiadellenado') },
    ],
    excluye: [(x) => x.hojas.has('remintentedestinatario')],
  },
  C: {
    rasgos: [
      { peso: 0.2, coincide: (x) => x.formato === 'pdf_escaneado' || x.formato === 'imagen' || x.formato === 'pdf_texto' },
      { peso: 0.3, coincide: (x) => tiene(x, 'remision') },
      { peso: 0.5, coincide: (x) => cuantas(x, ['cantidad', 'clave', 'descripcion', 'peso bruto', 'volumen']) >= 4 },
    ],
    excluye: [(x) => esTabla(x) || x.formato === 'json' || x.formato === 'xml'],
  },
  D: {
    rasgos: [
      { peso: 0.3, coincide: (x) => tiene(x, 'bill of lading') },
      { peso: 0.25, coincide: (x) => tiene(x, 'weight (lbs)', 'weight lbs') },
      { peso: 0.2, coincide: (x) => cuantas(x, ['pieces', 'shipper', 'consignee', 'carrier']) >= 3 },
      { peso: 0.1, coincide: (x) => /\bhm\b/.test(x.texto) },
      { peso: 0.15, coincide: (x) => /\bnotes\b/.test(x.texto) },
    ],
    excluye: [(x) => esTabla(x) || x.formato === 'json' || x.formato === 'xml'],
  },
  E: {
    rasgos: [
      { peso: 0.2, coincide: (x) => tiene(x, 'importador') },
      { peso: 0.2, coincide: (x) => tiene(x, 'caja no') },
      { peso: 0.15, coincide: (x) => tiene(x, 'placas') },
      { peso: 0.2, coincide: (x) => tiene(x, 'pedimento') },
      { peso: 0.15, coincide: (x) => tiene(x, 'remitente') && tiene(x, 'origen') },
      { peso: 0.1, coincide: (x) => cuantas(x, ['ref', 'cantidad', 'contenido']) >= 3 },
    ],
    excluye: [(x) => esTabla(x) || x.formato === 'json' || x.formato === 'xml'],
  },
  F1: {
    rasgos: [
      { peso: 0.5, coincide: (x) => tiene(x, 'datos de la mercancia') },
      { peso: 0.4, coincide: (x) => cuantas(x, ['clave unidad', 'peso por embalaje', 'fraccion', 'embalaje', 'cantidad']) >= 3 },
      { peso: 0.1, coincide: esVisual },
    ],
    excluye: [(x) => esTabla(x) || x.formato === 'json' || x.formato === 'xml'],
  },
  F2: {
    rasgos: [
      { peso: 0.6, coincide: (x) => tiene(x, 'datos para cp') },
      { peso: 0.3, coincide: (x) => cuantas(x, ['tipo de materia', 'tipo de documento', 'regimen']) >= 2 },
      { peso: 0.1, coincide: esVisual },
    ],
    excluye: [(x) => esTabla(x) || x.formato === 'json' || x.formato === 'xml'],
  },
  F3: {
    rasgos: [
      { peso: 0.35, coincide: (x) => tiene(x, 'bienes transportados') },
      { peso: 0.2, coincide: (x) => tiene(x, 'clave unidad sat') },
      { peso: 0.2, coincide: (x) => tiene(x, 'embalaje') },
      { peso: 0.25, coincide: (x) => tiene(x, 'peso en kilos') },
    ],
    excluye: [(x) => esTabla(x) || x.formato === 'json' || x.formato === 'xml'],
  },
  G: {
    rasgos: [
      { peso: 0.3, coincide: (x) => typeof propia(x.arbol, 'Version') === 'string' && /^3(\.|$)/.test(String(propia(x.arbol, 'Version')).trim()) },
      {
        peso: 0.4,
        coincide: (x) => {
          const m = propia(propia(propia(x.arbol, 'Ruta'), 'Mercancias'), 'Mercancia');
          return Array.isArray(m) ? m.length > 0 : m !== null && typeof m === 'object';
        },
      },
      { peso: 0.3, coincide: (x) => propia(x.arbol, 'DocumentacionAduanera') !== null && typeof propia(x.arbol, 'DocumentacionAduanera') === 'object' },
    ],
    excluye: [(x) => x.formato !== 'json'],
  },
};

const PESO_TOTAL: Readonly<Record<FormatoEntrada, number>> = Object.fromEntries(
  FORMATOS_ENTRADA.map((f) => [f, FIRMAS[f].rasgos.reduce((s, r) => s + r.peso, 0)]),
) as Record<FormatoEntrada, number>;

// ── Clasificación ───────────────────────────────────────────────────────────

export type Puntajes = Record<FormatoEntrada, number>;

export interface Clasificacion {
  /** El formato elegido; `null` = formato no reconocido (revisión humana). */
  formato: FormatoEntrada | null;
  origen: 'automatica' | 'manual';
  puntajes: Puntajes;
  mejor: { formato: FormatoEntrada; puntaje: number } | null;
  segundo: { formato: FormatoEntrada; puntaje: number } | null;
  /** Una persona debe confirmar o cambiar la elección antes de seguir. */
  requiereRevision: boolean;
  motivo: string;
  lector: LectorId | null;
  lectorDisponible: boolean;
  /** `lector_determinista` si hay lector aplicable; `generico_llm` es el flujo de hoy (formato nuevo o sin lector). */
  flujoSugerido: 'lector_determinista' | 'generico_llm';
  /** Sin lector aplicable, o con la elección sin confirmar, nada se envía al TMS. */
  puedeEnviarAlTms: boolean;
}

const redondear = (n: number): number => Math.round(n * 1000) / 1000;

/** Puntaje 0..1 de cada formato para un documento. */
export function puntuarFormatos(e: EntradaClasificacion): Puntajes {
  const x = construirCtx(e);
  const out = {} as Puntajes;
  for (const f of FORMATOS_ENTRADA) {
    const firma = FIRMAS[f];
    if (firma.excluye?.some((fn) => fn(x))) { out[f] = 0; continue; }
    const suma = firma.rasgos.reduce((s, r) => s + (r.coincide(x) ? r.peso : 0), 0);
    out[f] = redondear(suma / PESO_TOTAL[f]);
  }
  return out;
}

function ordenar(p: Puntajes): Array<{ formato: FormatoEntrada; puntaje: number }> {
  return FORMATOS_ENTRADA.map((f) => ({ formato: f, puntaje: p[f] })).sort((a, b) => b.puntaje - a.puntaje || FORMATOS_ENTRADA.indexOf(a.formato) - FORMATOS_ENTRADA.indexOf(b.formato));
}

const SIN_ELECCION = { lector: null, lectorDisponible: false, flujoSugerido: 'generico_llm', puedeEnviarAlTms: false } as const;

/** Clasifica un documento por su firma. Si no supera el umbral o hay empate: `formato: null` y revisión humana. */
export function clasificarFormato(e: EntradaClasificacion): Clasificacion {
  const puntajes = puntuarFormatos(e);
  const [primero, segundo] = ordenar(puntajes);
  const base = { origen: 'automatica' as const, puntajes, mejor: primero.puntaje > 0 ? primero : null, segundo: segundo.puntaje > 0 ? segundo : null };
  if (primero.puntaje < UMBRAL_RECONOCIMIENTO) {
    return {
      ...base, formato: null, requiereRevision: true, ...SIN_ELECCION,
      motivo: primero.puntaje === 0
        ? 'Formato no reconocido: el documento no coincide con ninguna firma. Revisión humana; si es un formato nuevo, sigue el flujo genérico tras confirmarlo.'
        : `Formato no reconocido: el mejor candidato (${primero.formato}) puntúa ${primero.puntaje} y el umbral es ${UMBRAL_RECONOCIMIENTO}. Revisión humana.`,
    };
  }
  if (primero.puntaje - segundo.puntaje < MARGEN_AMBIGUEDAD) {
    return {
      ...base, formato: null, requiereRevision: true, ...SIN_ELECCION,
      motivo: `Formato ambiguo: ${primero.formato} (${primero.puntaje}) y ${segundo.formato} (${segundo.puntaje}) quedan a menos de ${MARGEN_AMBIGUEDAD}. Una persona debe elegir; no se adivina.`,
    };
  }
  const d = REGISTRO[primero.formato];
  return {
    ...base, formato: primero.formato, requiereRevision: false,
    motivo: `Formato ${d.formato} (${d.nombre}) con puntaje ${primero.puntaje}.`,
    lector: d.lector, lectorDisponible: d.lectorDisponible,
    flujoSugerido: d.lectorDisponible ? 'lector_determinista' : 'generico_llm',
    puedeEnviarAlTms: d.lectorDisponible,
  };
}

/** `'generico'` = la persona manda el documento al flujo genérico con modelo (formato nuevo, sin lector). */
export type EleccionManual = FormatoEntrada | 'generico';

/**
 * Elección final: la manual de una persona se respeta siempre sobre la automática (el visor la muestra y permite
 * cambiarla). Los puntajes automáticos se conservan para mostrar.
 */
export function elegirFormato(e: EntradaClasificacion, manual?: EleccionManual | null): Clasificacion {
  const auto = clasificarFormato(e);
  if (manual === undefined || manual === null) return auto;
  if (manual === 'generico') {
    return { ...auto, formato: null, origen: 'manual', requiereRevision: false, motivo: 'Elegido por una persona: flujo genérico con modelo (sin lector de formato).', ...SIN_ELECCION };
  }
  if (!(FORMATOS_ENTRADA as readonly string[]).includes(manual)) throw new Error(`Formato desconocido: ${String(manual)}.`);
  const d = REGISTRO[manual];
  return {
    ...auto, formato: manual, origen: 'manual', requiereRevision: false,
    motivo: `Elegido por una persona: ${d.formato} (${d.nombre}).${auto.formato !== manual ? ` La firma automática decía ${auto.formato ?? 'no reconocido'}.` : ''}`,
    lector: d.lector, lectorDisponible: d.lectorDisponible,
    flujoSugerido: d.lectorDisponible ? 'lector_determinista' : 'generico_llm',
    puedeEnviarAlTms: d.lectorDisponible,
  };
}
