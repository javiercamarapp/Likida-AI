// ═══════════════════════════════════════════════════════════════════════════
// CONTRATO ADICIONAL 'muestra-tms' (5-nov-2026): la estructura REAL de muestra del API de liquidaciones del TMS,
// un objeto por bitácora. NO reemplaza al contrato supuesto (`desglose_tms_supuesto.ts` / `desglose_mapeo_tms.ts`): convive
// con él y se elige por nombre (`CONTRATOS_DESGLOSE_TMS`).
//
//   { "BitacoraID": 0, "Operador": "", "Unidad": "",
//     "Fecha": { "Inicia": "yyyy-MM-dd HH:mm:ss", "Termina": "yyyy-MM-dd HH:mm:ss" },
//     "Percepciones": [ { "Descripcion": "", "Monto": 0.00 } ],
//     "Deducciones":  [ { "Descripcion": "", "Monto": 0.00 } ] }
//
// Procedencia: recibida el 5-nov-2026; se INFIERE que es del equipo de sistemas del cliente. No hay envoltorio,
// paginación, zona horaria ni autenticación confirmados: esta pieza es PURA (sin red, sin base, sin credenciales) y solo
// convierte lo que ya se leyó. Cableado a la ruta/lector: pendiente de confirmar esos datos (ver informe de la ronda).
//
// ── Reglas (nada se inventa) ────────────────────────────────────────────────
//   · CAMPOS OPCIONALES del piloto (11-nov-2026, todos dentro de cada bitácora, junto a los seis de la muestra):
//       `NumeroEmpleado` (texto/entero ≤40), `TipoOperador` (local|foraneo|permisionario|rabon|posturero|cargador; se aceptan mayúsculas y acento),
//       `Poliza` (texto ≤40 o null), `NumeroPago` (≤40, [A-Za-z0-9._/-]), `Neto` (número ≤2 decimales, puede ser negativo) y
//       `Folio` (texto/entero ≤40, el número que conoce el operador; solo se guarda y se muestra).
//     Un valor INVÁLIDO manda ESA bitácora a revisión con su motivo; jamás tumba el lote. Ausente o null = no vino (sigue igual que
//     antes: póliza nula ⇒ `sin_poliza`/provisional; tipo ausente ⇒ `tipo_sin_regla`).
//   · `NumeroLiquidacion` se IGNORA a propósito (campo extra): cablearlo cambia la clave de idempotencia de `BIT-<id>` a
//     `LIQ-<n>` y el índice único parcial del número por flota; si una liquidación junta varias bitácoras y llegan como objetos
//     separados con el mismo número, la segunda caería en `correccion_pendiente`/`bitacora_duplicada`. Hasta confirmar con el
//     cliente que 1 liquidación = 1 bitácora (y que el número existe desde el primer envío) no se lee.
//   · Lo que la muestra NO trae sigue «no disponible» (`noDisponible`): nº de liquidación, terminal, ID de concepto,
//     correo/mensajería, marca «enviado». Ninguno se rellena. Los opcionales ausentes también se listan ahí.
//   · El operador se resuelve contra el padrón INYECTADO. Con `NumeroEmpleado`, MANDA el número: se busca por igualdad exacta
//     (sin espacios de más); si además viene `Operador` y su nombre normalizado no coincide con el del padrón para ese número ⇒
//     REVISIÓN `operador_no_coincide` (no se adivina cuál de los dos datos está mal). Sin `NumeroEmpleado` se cruza por NOMBRE:
//     coincidencia exacta normalizada (sin acentos, mayúsculas ni espacios de más), una única persona ⇒ su nº de empleado; ninguna o
//     varias ⇒ REVISIÓN HUMANA (`operador_no_encontrado` / `operador_homonimo`). Jamás se adivina entre homónimos ni por parecido.
//   · Montos: llegan como número JSON con ≤ 2 decimales. Se leen por su representación en TEXTO (`String(n)`, que es la
//     más corta que ida y vuelta), sin multiplicar flotantes. Más de 2 decimales, negativo, null, NaN/Infinity o texto ⇒
//     revisión (no se redondea ni se interpreta). CONVENCIÓN: ambos bloques traen montos POSITIVOS; el bloque da el signo
//     (Percepciones suman, Deducciones restan), igual que `DesgloseBitacora`. Monto 0 ⇒ renglón ignorado con nota.
//   · Cuadre: sin `Neto`, Σ percepciones − Σ deducciones se calcula en CENTAVOS y el chequeo posterior (`aLiquidacionExterna`) es
//     tautológico (`totalOrigen: 'calculado'`): no demuestra que el TMS lo calculó igual; la UI debe decirlo así. CON `Neto`, el
//     cuadre es real (`totalOrigen: 'tms'`): si no coincide con los renglones ⇒ revisión `total_no_cuadra`. Un neto negativo lo
//     retiene la guarda existente `neto_negativo`.
//   · Fechas: `yyyy-MM-dd HH:mm:ss` SIN zona se interpreta como hora de México (zona del TMS). El periodo del desglose son
//     los días locales de inicio y fin. Fecha ilegible, imposible o `Termina` < `Inicia` ⇒ revisión.
//   · Conceptos: texto libre. Se reconocen con `normalizarConcepto` y un catálogo de alias (abajo). Descripción desconocida
//     ⇒ el renglón SE CONSERVA y la bitácora pasa a revisión (`concepto_desconocido`); un concepto conocido del lado
//     contrario (p. ej. Fonacot en Percepciones) también.
//   · Campos extra desconocidos se ignoran. Envoltorio configurable: arreglo directo, `{ data: [...] }` (o la ruta que se
//     indique) o ambos (`auto`).
// ═══════════════════════════════════════════════════════════════════════════

import { TZ_MX, hoyMx } from '../../formato';
import { CampoInvalido } from '@/lib/http/campos_cuerpo';
import { aInstanteMx } from '../peajes/formatos';
import { aLiquidacionExterna, normalizarTipoOperador, TIPOS_OPERADOR, validarDesgloseBitacora, type DesgloseBitacora, type RenglonBitacora, type TipoOperadorDesglose } from './desglose_contrato';
import { leerRuta, normalizarUnidad } from './desglose_mapeo_tms';
import { normalizarConcepto } from './desglose_reglas';

export const CONTRATO_MUESTRA_TMS = 'muestra-tms';
export const ZONA_MUESTRA_TMS = TZ_MX;
const SISTEMA_ORIGEN_MUESTRA = 'tms-muestra-tms';

/** Lo que este contrato NO trae y por tanto queda marcado «no disponible» en cada resultado. */
export const NO_DISPONIBLE_MUESTRA = [
  'numeroLiquidacion', 'terminal', 'idConcepto', 'correoOperador', 'mensajeriaOperador', 'enviadoOrigen',
] as const;


/** Registro de contratos de desglose del TMS que el software sabe leer. Elegir uno es configuración, no código. */
export const CONTRATOS_DESGLOSE_TMS = {
  supuesto: { id: 'supuesto', estado: 'SUPUESTO-API', fuente: 'desglose_tms_supuesto.ts + desglose_mapeo_tms.ts' },
  [CONTRATO_MUESTRA_TMS]: {
    id: CONTRATO_MUESTRA_TMS, estado: 'MUESTRA-REAL (inferida del equipo de sistemas del cliente)', fuente: 'desglose_muestra_tms.ts',
  },
} as const;

// ── Tipos ───────────────────────────────────────────────────────────────────

export type CodigoRevision =
  | 'fila_invalida' | 'bitacora_invalida' | 'operador_vacio' | 'operador_sin_padron' | 'operador_no_encontrado' | 'operador_homonimo' | 'operador_sin_numero'
  | 'operador_no_coincide' | 'numero_empleado_invalido' | 'tipo_operador_invalido' | 'poliza_invalida' | 'numero_pago_invalido' | 'folio_invalido'
  | 'neto_invalido' | 'total_no_cuadra' | 'ajuste_redondeo_excesivo'
  | 'unidad_invalida' | 'fecha_invalida' | 'fechas_invertidas' | 'bitacora_repetida'
  | 'estructura_invalida' | 'sin_renglones' | 'descripcion_vacia'
  | 'monto_nulo' | 'monto_no_numerico' | 'monto_negativo' | 'monto_decimales' | 'monto_excesivo'
  | 'concepto_desconocido' | 'concepto_lado_inesperado' | 'contrato_interno';

export interface MotivoRevision {
  codigo: CodigoRevision;
  /** Ruta del campo en la muestra (`Percepciones[2].Monto`). Nunca lleva valores personales. */
  campo: string;
  detalle: string;
}

export interface OperadorPadron {
  numeroEmpleado: string;
  nombre: string;
}

export type PadronOperadores = ReadonlyArray<OperadorPadron>;

export interface ConfigMuestraTms {
  /**
   * `arreglo`: el cuerpo ES la lista. `envuelto`: la lista vive en `rutaLista`. `auto` (defecto): lo que venga; un objeto suelto
   * con `BitacoraID` cuenta como una sola bitácora.
   */
  envoltorio?: 'auto' | 'arreglo' | 'envuelto';
  /** Ruta de la lista con `envuelto`/`auto`. Defecto `data`. */
  rutaLista?: string;
  /** Padrón de operadores contra el que se resuelve el operador (por número de empleado si viene, si no por NOMBRE). Sin padrón, ningún desglose queda listo. */
  padron?: PadronOperadores;
  /** Conceptos adicionales (alias por flota) que se suman al catálogo base. Hoy nadie los inyecta: ver «P0-3» sobre el catálogo. */
  conceptosAdicionales?: CatalogoConceptos;
}

export interface ResultadoBitacoraMuestra {
  /** `BitacoraID` como texto; vacío si no se pudo leer. */
  bitacoraId: string;
  /** `null` si no se pudo armar un desglose válido (faltan datos obligatorios). Con revisión, NO debe enviarse sin que alguien lo vea. */
  desglose: DesgloseBitacora | null;
  /** Vacío = lista para el camino normal (que aún aplica póliza/guardas). */
  revision: MotivoRevision[];
  requiereRevision: boolean;
  noDisponible: readonly string[];
  /** Renglones sin valor (Monto 0) que se omitieron, con su ruta. */
  ignorados: Array<{ donde: string; motivo: string }>;
  /** Hora de México de inicio/fin como instante ISO, si se pudieron leer. */
  periodoMx: { inicia: string; termina: string } | null;
  /** Σ percepciones − Σ deducciones en centavos (null si no hay desglose). Total CALCULADO, no de origen. */
  netoCentavos: number | null;
  /** Categoría de cada renglón reconocido (`otros` para diésel/urea; la renombra la config del contralor). */
  categorias: Array<{ donde: string; categoria: string }>;
}

export class EnvoltorioInvalido extends CampoInvalido {
  constructor(detalle: string) {
    super('cuerpo', detalle);
    this.name = 'EnvoltorioInvalido';
  }
}

// ── Catálogo de conceptos (texto libre ⇒ reconocimiento) ────────────────────

type Lado = 'percepcion' | 'deduccion';
/** `ambos`: el concepto es válido en cualquiera de los dos bloques (solo el ajuste de redondeo). */
interface Concepto { categoria: string; lado: Lado | 'ambos'; patron: RegExp }

/**
 * Alias sobre el texto YA normalizado (sin acentos, minúsculas). Es heurístico y editable: lo que no case NO se descarta, pasa
 * a revisión. «diésel/urea» es categoría `otros` (la presentación lo renombra con la regla del contralor, `RENOMBRE_EJEMPLO`).
 */
export type CatalogoConceptos = readonly Concepto[];
export type { Concepto as ConceptoMuestra };

// ── P0-3 · PUNTO ÚNICO donde se agregan conceptos ───────────────────────────
// El catálogo de abajo es CERRADO y vive en código: un concepto fuera de él manda la bitácora a revisión (`concepto_desconocido`).
// El catálogo REAL del cliente (valores exactos de `Descripcion`, 11-nov-2026) está cubierto: ver la tabla en la hoja técnica y los
// casos en `desglose_muestra_catalogo.test.ts`. Para agregar otro concepto: una entrada nueva aquí (categoría, lado, patrón) y su caso.
// La comparación tolera mayúsculas, acentos, puntos y espacios dobles: el patrón se prueba contra el texto normalizado
// (`normalizarConcepto`) Y contra su forma sin puntuación (`claveConcepto`: «Bono E.C» ⇒ «bono e c», «DEV.INFONAVIT» ⇒ «dev infonavit»).
// La CATEGORÍA es informativa: no se calcula nada con ella. Lo que ve el operador en el Excel es siempre la `Descripcion` ORIGINAL del
// cliente; los renombres, `conceptos_viaje` y `conceptos_prohibidos` de la config de la flota también trabajan sobre ese texto original.
// Alias por flota SIN deploy (columna jsonb en `liquidacion_correo_config` + pantalla + migración) es tamaño M y NO se hizo:
// `reconocer` ya acepta un catálogo adicional (`CatalogoConceptos`) para que esa pieza futura solo tenga que inyectarlo.
//
// AJUSTE DE REDONDEO («Dif en registro»): llega en Percepciones O en Deducciones y siempre son centavos (diferencia de redondeo del
// sistema del cliente). Se acepta en ambos bloques y SE CONSERVA como renglón con su signo según el bloque, para que el neto cuadre con
// el del cliente. TOPE: |monto| < 1.00 peso; un ajuste de 1.00 o más NO es redondeo y manda la bitácora a revisión
// (`ajuste_redondeo_excesivo`). Un monto 0 se ignora como cualquier renglón en cero.
export const CATALOGO_CONCEPTOS_MUESTRA: readonly Concepto[] = [
  { categoria: 'sueldo', lado: 'percepcion', patron: /\b(sueldo|salario|pago de viaje|complemento)\b/ },
  { categoria: 'bono', lado: 'percepcion', patron: /\bbonos?\b/ },
  { categoria: 'estadia', lado: 'percepcion', patron: /\b(estadias?|demoras?)\b/ },
  { categoria: 'recoleccion', lado: 'percepcion', patron: /\brecolecc?ion(es)?\b/ },
  { categoria: 'km_extra', lado: 'percepcion', patron: /\bkm\.? ?extras?\b/ },
  { categoria: 'viaticos', lado: 'percepcion', patron: /\b(viaticos?|taxi|talacha|lavada)\b/ },
  { categoria: 'fonacot', lado: 'deduccion', patron: /\bfonacot\b/ },
  { categoria: 'infonavit', lado: 'deduccion', patron: /\binfonavit\b/ },
  { categoria: 'anticipo', lado: 'deduccion', patron: /\banticipos?\b/ },
  { categoria: 'descuento_financiero', lado: 'deduccion', patron: /\b(descuento financiero|desc\.? ?fin)\b/ },
  { categoria: 'otros', lado: 'deduccion', patron: /\b(diesel|urea)\b/ },
  // ── Catálogo real del cliente (11-nov-2026) que los alias de arriba no cubren ──
  { categoria: 'ajuste_redondeo', lado: 'ambos', patron: /^dif en registro$/ },
  { categoria: 'viaticos', lado: 'percepcion', patron: /^boletos autobus$/ },
  { categoria: 'domingo_laborado', lado: 'percepcion', patron: /^domingo laborado$/ },
  { categoria: 'hora_extra', lado: 'percepcion', patron: /^horas? extras?$/ },
  { categoria: 'otros', lado: 'percepcion', patron: /^otros$/ },
  { categoria: 'imss', lado: 'deduccion', patron: /^imss$/ },
  { categoria: 'ispt', lado: 'deduccion', patron: /^(ispt|isr)$/ },
  { categoria: 'prestamo', lado: 'deduccion', patron: /^prestamos?$/ },
  { categoria: 'aviso_descuento', lado: 'deduccion', patron: /^aviso( de)? descuento$/ },
  { categoria: 'gastos_viaje', lado: 'deduccion', patron: /^gastos de viaje$/ },
];

/** Forma sin puntuación: «Bono E.C» ⇒ «bono e c», «DEV.INFONAVIT» ⇒ «dev infonavit». */
export function claveConcepto(s: string): string {
  return normalizarConcepto(s).replace(/[^a-z0-9ñ]+/g, ' ').trim();
}

function reconocer(descripcion: string, adicional: CatalogoConceptos = []): Concepto | null {
  const n = normalizarConcepto(descripcion);
  const k = claveConcepto(descripcion);
  return [...CATALOGO_CONCEPTOS_MUESTRA, ...adicional].find((c) => c.patron.test(n) || c.patron.test(k)) ?? null;
}

// ── Montos: texto, no flotantes ─────────────────────────────────────────────

const MAX_PESOS_DIGITOS = 9;

type Centavos = { ok: true; centavos: number } | { ok: false; codigo: CodigoRevision; detalle: string };

/**
 * `Monto` de la muestra a centavos ENTEROS sin aritmética de coma flotante: se lee el texto más corto que identifica al número
 * (`String(n)`): `1500.5` ⇒ «1500.5» ⇒ 150050; `1500.505` y `0.1+0.2` traen >2 decimales ⇒ rechazo; la notación científica se rechaza.
 */
export function centavosDeMontoMuestra(v: unknown): Centavos {
  if (v === null || v === undefined) return { ok: false, codigo: 'monto_nulo', detalle: 'El monto viene vacío (null).' };
  if (typeof v !== 'number') return { ok: false, codigo: 'monto_no_numerico', detalle: 'El monto tiene que ser un número JSON (no texto ni otro tipo).' };
  if (!Number.isFinite(v)) return { ok: false, codigo: 'monto_no_numerico', detalle: 'El monto no es un número finito.' };
  if (v < 0) return { ok: false, codigo: 'monto_negativo', detalle: 'El monto es negativo; el bloque (Percepciones/Deducciones) ya da el signo.' };
  if (v === 0) return { ok: true, centavos: 0 }; // incluye -0
  const t = String(v);
  if (/[eE]/.test(t)) return { ok: false, codigo: 'monto_excesivo', detalle: 'El monto está fuera de rango o en notación científica.' };
  const [enteros, decimales = ''] = t.split('.');
  if (decimales.length > 2) return { ok: false, codigo: 'monto_decimales', detalle: 'El monto trae más de 2 decimales; no se redondea en silencio.' };
  if (enteros.length > MAX_PESOS_DIGITOS) return { ok: false, codigo: 'monto_excesivo', detalle: 'El monto excede el máximo admitido.' };
  return { ok: true, centavos: Number(enteros) * 100 + Number(decimales.padEnd(2, '0')) };
}

// ── Fechas: hora local de México ────────────────────────────────────────────

function instanteMx(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(v.trim());
  return m ? aInstanteMx(m[1], m[2]) : null;
}

/** Día local de México (AAAA-MM-DD) de un instante ISO. */
function diaMx(iso: string): string {
  return hoyMx(new Date(iso));
}

// ── Operador: nombre contra padrón ──────────────────────────────────────────

/** Minúsculas, sin acentos, sin puntuación y con espacios colapsados: «Pérez  Núñez, Juan» ≡ «perez nunez juan». */
export function normalizarNombre(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

type Resolucion =
  | { ok: true; operador: OperadorPadron }
  | { ok: false; codigo: 'operador_sin_padron' | 'operador_no_encontrado' | 'operador_homonimo' | 'operador_sin_numero' };

export function resolverOperadorPorNombre(nombre: string, padron: PadronOperadores | undefined): Resolucion {
  if (padron === undefined) return { ok: false, codigo: 'operador_sin_padron' };
  const buscado = normalizarNombre(nombre);
  const coinciden = padron.filter((o) => normalizarNombre(o.nombre) === buscado);
  // La misma persona listada dos veces (mismo nº de empleado) no es homonimia.
  const numeros = new Set(coinciden.map((o) => o.numeroEmpleado.trim()));
  if (numeros.size === 0) return { ok: false, codigo: 'operador_no_encontrado' };
  if (numeros.size > 1) return { ok: false, codigo: 'operador_homonimo' };
  // Una única persona, pero sin número de empleado en el padrón: no hay con qué armar el desglose (no se inventa).
  if (coinciden[0].numeroEmpleado.trim() === '') return { ok: false, codigo: 'operador_sin_numero' };
  return { ok: true, operador: coinciden[0] };
}

/** El operador por NÚMERO DE EMPLEADO (igualdad exacta, sin espacios de más). Misma persona listada dos veces no es homonimia. */
export function resolverOperadorPorNumero(numero: string, padron: PadronOperadores | undefined): Resolucion {
  if (padron === undefined) return { ok: false, codigo: 'operador_sin_padron' };
  const buscado = numero.trim();
  const coinciden = padron.filter((o) => o.numeroEmpleado.trim() === buscado);
  if (coinciden.length === 0) return { ok: false, codigo: 'operador_no_encontrado' };
  // El mismo número con DOS nombres distintos es un padrón ambiguo: no se adivina.
  if (new Set(coinciden.map((o) => normalizarNombre(o.nombre))).size > 1) return { ok: false, codigo: 'operador_homonimo' };
  return { ok: true, operador: coinciden[0] };
}

// ── Una bitácora ────────────────────────────────────────────────────────────

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function textoPlano(v: unknown): string | null {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/** Entero > 0 (hasta 18 dígitos) o texto alfanumérico `[A-Za-z0-9._-]` de 1 a 40. La clave es `BIT-<id>`: dos IDs distintos nunca chocan. */
export const PATRON_BITACORA_ID = /^[A-Za-z0-9._-]{1,40}$/;
function bitacoraIdDe(v: unknown): string | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? String(v) : null;
  if (typeof v === 'string' && PATRON_BITACORA_ID.test(v.trim())) return v.trim();
  return null;
}

const CONTROL = /[\u0000-\u001f\u007f]/;
const PATRON_NUMERO_PAGO = /^[A-Za-z0-9._/-]{1,40}$/;
type Opcional<T> = { ok: true; valor: T | undefined } | { ok: false; detalle: string };
const ausente = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Texto o entero seguro, ≤ `max`, sin caracteres de control. Ausente/null/vacío ⇒ `undefined` (no vino). */
function textoOpcional(v: unknown, max: number, nombre: string): Opcional<string> {
  if (ausente(v)) return { ok: true, valor: undefined };
  const t = typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? String(v) : null;
  if (t === null) return { ok: false, detalle: `${nombre} tiene que ser texto o un entero.` };
  if (t.length > max) return { ok: false, detalle: `${nombre} no puede pasar de ${max} caracteres.` };
  if (CONTROL.test(t)) return { ok: false, detalle: `${nombre} no puede traer saltos de línea ni caracteres de control.` };
  return { ok: true, valor: t };
}

function tipoOperadorDe(v: unknown): Opcional<TipoOperadorDesglose> {
  if (ausente(v)) return { ok: true, valor: undefined };
  const t = normalizarTipoOperador(v);
  return t !== undefined
    ? { ok: true, valor: t }
    : { ok: false, detalle: `TipoOperador tiene que ser ${TIPOS_OPERADOR.map((x) => `«${x}»`).join(', ')}.` };
}

/** `Neto`: número JSON con ≤ 2 decimales, el signo se admite (un neto negativo lo retiene la guarda `neto_negativo`). */
function netoCentavosDe(v: unknown): Opcional<number> {
  if (v === undefined || v === null) return { ok: true, valor: undefined };
  if (typeof v !== 'number') return { ok: false, detalle: 'Neto tiene que ser un número JSON (no texto).' };
  const c = centavosDeMontoMuestra(Math.abs(v));
  if (!c.ok) return { ok: false, detalle: c.detalle.replace(/^El monto/, 'Neto') };
  return { ok: true, valor: v < 0 ? -c.centavos : c.centavos };
}

/** Convierte UNA bitácora de la muestra. Nunca lanza por datos malos: los reporta en `revision`. */
export function convertirBitacoraMuestra(raw: unknown, config: Pick<ConfigMuestraTms, 'padron' | 'conceptosAdicionales'> = {}): ResultadoBitacoraMuestra {
  const revision: MotivoRevision[] = [];
  const ignorados: Array<{ donde: string; motivo: string }> = [];
  const categorias: Array<{ donde: string; categoria: string }> = [];
  const ausentes: string[] = [];
  const motivo = (codigo: CodigoRevision, campo: string, detalle: string) => { revision.push({ codigo, campo, detalle }); };
  const vacio = (bitacoraId: string): ResultadoBitacoraMuestra => ({
    bitacoraId, desglose: null, revision, requiereRevision: true, noDisponible: [...NO_DISPONIBLE_MUESTRA, ...ausentes], ignorados, periodoMx: null, netoCentavos: null, categorias,
  });

  if (!esObjeto(raw)) {
    motivo('fila_invalida', 'cuerpo', 'La fila no es un objeto.');
    return vacio('');
  }

  // BitacoraID
  const bitacora = bitacoraIdDe(raw.BitacoraID);
  if (bitacora === null) motivo('bitacora_invalida', 'BitacoraID', 'BitacoraID tiene que ser un entero mayor que cero o un texto de letras, números y . _ - (hasta 40 caracteres).');

  // Operador: por NumeroEmpleado si viene (manda); si no, por nombre.
  const nombreCrudo = textoPlano(raw.Operador);
  const empleado = textoOpcional(raw.NumeroEmpleado, 40, 'NumeroEmpleado');
  if (!empleado.ok) motivo('numero_empleado_invalido', 'NumeroEmpleado', empleado.detalle);
  const numeroEmpleadoCrudo = empleado.ok ? empleado.valor : undefined;
  const nombreDado: string = nombreCrudo ?? '';
  const sinNombre = nombreDado === '';
  if (sinNombre && numeroEmpleadoCrudo === undefined && empleado.ok) motivo('operador_vacio', 'Operador', 'El nombre del operador viene vacío (y no se mandó NumeroEmpleado).');

  // Campos opcionales del piloto (inválido ⇒ revisión de ESTA bitácora)
  const tipo = tipoOperadorDe(raw.TipoOperador);
  if (!tipo.ok) motivo('tipo_operador_invalido', 'TipoOperador', tipo.detalle);
  let poliza: string | null = null;
  const pol = textoOpcional(raw.Poliza, 40, 'Poliza');
  if (!pol.ok) motivo('poliza_invalida', 'Poliza', pol.detalle);
  else if (pol.valor !== undefined) poliza = pol.valor;
  const pago = textoOpcional(raw.NumeroPago, 40, 'NumeroPago');
  if (!pago.ok) motivo('numero_pago_invalido', 'NumeroPago', pago.detalle);
  else if (pago.valor !== undefined && !PATRON_NUMERO_PAGO.test(pago.valor)) motivo('numero_pago_invalido', 'NumeroPago', 'NumeroPago solo admite letras, números y . _ / - (hasta 40 caracteres).');
  const folio = textoOpcional(raw.Folio, 40, 'Folio');
  if (!folio.ok) motivo('folio_invalido', 'Folio', folio.detalle);
  const neto = netoCentavosDe(raw.Neto);
  if (!neto.ok) motivo('neto_invalido', 'Neto', neto.detalle);
  if (numeroEmpleadoCrudo === undefined) ausentes.push('numeroEmpleado');
  if (!tipo.ok || tipo.valor === undefined) ausentes.push('tipoOperador');
  if (poliza === null) ausentes.push('poliza');
  if (!pago.ok || pago.valor === undefined) ausentes.push('numeroPago');
  if (!neto.ok || neto.valor === undefined) ausentes.push('neto');
  if (!folio.ok || folio.valor === undefined) ausentes.push('folio');

  // Unidad
  let unidad: string | undefined;
  if (raw.Unidad !== undefined && raw.Unidad !== null && !(typeof raw.Unidad === 'string' && raw.Unidad.trim() === '')) {
    const u = textoPlano(raw.Unidad);
    if (u === null) motivo('unidad_invalida', 'Unidad', 'La unidad tiene que ser texto o número.');
    else unidad = normalizarUnidad(u);
  }

  // Fechas
  let periodoMx: { inicia: string; termina: string } | null = null;
  let desde: string | null = null;
  let hasta: string | null = null;
  const fecha = raw.Fecha;
  if (!esObjeto(fecha)) {
    motivo('fecha_invalida', 'Fecha', 'Fecha tiene que traer `Inicia` y `Termina`.');
  } else {
    const ini = instanteMx(fecha.Inicia);
    const fin = instanteMx(fecha.Termina);
    if (ini === null) motivo('fecha_invalida', 'Fecha.Inicia', 'Inicia no es una fecha-hora `yyyy-MM-dd HH:mm:ss` válida.');
    if (fin === null) motivo('fecha_invalida', 'Fecha.Termina', 'Termina no es una fecha-hora `yyyy-MM-dd HH:mm:ss` válida.');
    if (ini !== null && fin !== null) {
      if (Date.parse(fin) < Date.parse(ini)) motivo('fechas_invertidas', 'Fecha', 'Termina es anterior a Inicia.');
      else { periodoMx = { inicia: ini, termina: fin }; desde = diaMx(ini); hasta = diaMx(fin); }
    }
  }

  // Renglones
  const centavosPorBloque = { percepcion: 0, deduccion: 0 };
  const bloques = { percepcion: [] as RenglonBitacora[], deduccion: [] as RenglonBitacora[] };
  let montosMalos = false;
  const procesar = (clave: 'Percepciones' | 'Deducciones', lado: Lado) => {
    const lista = raw[clave];
    if (lista === undefined || lista === null) return;
    if (!Array.isArray(lista)) { motivo('estructura_invalida', clave, `${clave} tiene que ser una lista.`); montosMalos = true; return; }
    lista.forEach((r, i) => {
      const donde = `${clave}[${i}]`;
      if (!esObjeto(r)) { motivo('estructura_invalida', donde, 'El renglón tiene que ser un objeto.'); montosMalos = true; return; }
      const desc = typeof r.Descripcion === 'string' ? r.Descripcion.trim() : '';
      const m = centavosDeMontoMuestra(r.Monto);
      if (!m.ok) { motivo(m.codigo, `${donde}.Monto`, m.detalle); montosMalos = true; return; }
      if (m.centavos === 0) { ignorados.push({ donde, motivo: 'monto en cero' }); return; }
      if (desc === '') { motivo('descripcion_vacia', `${donde}.Descripcion`, 'El renglón no trae descripción.'); montosMalos = true; return; }
      const c = reconocer(desc, config.conceptosAdicionales);
      if (c === null) motivo('concepto_desconocido', `${donde}.Descripcion`, 'Descripción que no está en el catálogo de conceptos; revisar (el renglón se conserva).');
      else {
        categorias.push({ donde, categoria: c.categoria });
        if (c.lado !== 'ambos' && c.lado !== lado) motivo('concepto_lado_inesperado', `${donde}.Descripcion`, `Concepto «${c.categoria}» llega en ${clave}; normalmente va del otro lado.`);
        if (c.categoria === 'ajuste_redondeo' && m.centavos >= 100) motivo('ajuste_redondeo_excesivo', `${donde}.Monto`, 'Un ajuste de redondeo («Dif en registro») es de centavos (menos de 1.00); este no lo es: revisar en el origen.');
      }
      centavosPorBloque[lado] += m.centavos;
      bloques[lado].push({ concepto: desc, monto: m.centavos / 100 });
    });
  };
  procesar('Percepciones', 'percepcion');
  procesar('Deducciones', 'deduccion');
  if (!montosMalos && bloques.percepcion.length + bloques.deduccion.length === 0) {
    motivo('sin_renglones', 'Percepciones', 'La bitácora no trae ningún renglón con valor (arreglos vacíos o todo en cero).');
  }

  // Operador contra padrón
  let operador: OperadorPadron | null = null;
  const textoResolucion = (codigo: string, porNumero: boolean): string => (codigo === 'operador_homonimo'
    ? (porNumero ? 'Más de un nombre distinto del padrón comparte ese número de empleado; no se adivina: revisión humana.'
      : 'Más de una persona del padrón coincide con ese nombre; no se adivina: revisión humana.')
    : codigo === 'operador_sin_padron' ? 'No hay padrón de operadores contra el cual resolver al operador.'
      : codigo === 'operador_sin_numero' ? 'El operador del padrón que coincide no tiene número de empleado; hay que capturarlo.'
        : porNumero ? 'Ningún operador del padrón tiene ese número de empleado.' : 'Ningún operador del padrón coincide con ese nombre.');
  if (numeroEmpleadoCrudo !== undefined) {
    const r = resolverOperadorPorNumero(numeroEmpleadoCrudo, config.padron);
    if (!r.ok) motivo(r.codigo, 'NumeroEmpleado', textoResolucion(r.codigo, true));
    else if (!sinNombre && normalizarNombre(r.operador.nombre) !== normalizarNombre(nombreDado)) {
      motivo('operador_no_coincide', 'Operador', 'El nombre que llegó no coincide con el del padrón para ese número de empleado; no se adivina cuál de los dos está mal.');
    } else operador = r.operador;
  } else if (empleado.ok && !sinNombre) {
    const r = resolverOperadorPorNombre(nombreDado, config.padron);
    if (r.ok) operador = r.operador;
    else motivo(r.codigo, 'Operador', textoResolucion(r.codigo, false));
  }

  // Neto de origen: si viene, tiene que cuadrar con los renglones (sin él, el total se calcula y no hay cuadre real)
  const netoCalculado = centavosPorBloque.percepcion - centavosPorBloque.deduccion;
  let netoValido: number | undefined;
  if (neto.ok && neto.valor !== undefined && !montosMalos) {
    if (neto.valor === netoCalculado) netoValido = neto.valor;
    else motivo('total_no_cuadra', 'Neto', 'El Neto no coincide con Percepciones − Deducciones; revisar en el origen.');
  }

  // ¿Hay lo mínimo para armar un desglose interno válido?
  if (bitacora === null || operador === null || !tipo.ok || !folio.ok || !empleado.ok || desde === null || hasta === null || montosMalos || bloques.percepcion.length + bloques.deduccion.length === 0) {
    return vacio(bitacora ?? '');
  }
  let desglose: DesgloseBitacora;
  try {
    desglose = validarDesgloseBitacora({
      bitacora,
      poliza, // null si no vino (o vino inválida, que ya va a revisión): la guarda `sin_poliza` existente decide, no se inventa
      operador: { numeroEmpleado: operador.numeroEmpleado.trim(), nombre: sinNombre ? operador.nombre : nombreDado },
      ...(unidad !== undefined ? { unidad } : {}),
      ...(tipo.ok && tipo.valor !== undefined ? { tipoOperador: tipo.valor } : {}),
      ...(pago.ok && pago.valor !== undefined && PATRON_NUMERO_PAGO.test(pago.valor) ? { numeroPago: pago.valor } : {}),
      ...(folio.ok && folio.valor !== undefined ? { folio: folio.valor } : {}),
      ...(netoValido !== undefined ? { neto: netoValido / 100 } : {}),
      desde, hasta,
      percepciones: bloques.percepcion,
      deducciones: bloques.deduccion,
    });
    aLiquidacionExterna(desglose, { sistemaOrigen: SISTEMA_ORIGEN_MUESTRA });
  } catch (e) {
    if (!(e instanceof CampoInvalido)) throw e;
    motivo('contrato_interno', e.campo, 'El desglose no cumple el contrato interno.');
    return vacio(bitacora);
  }
  return {
    bitacoraId: bitacora, desglose, revision, requiereRevision: revision.length > 0, noDisponible: [...NO_DISPONIBLE_MUESTRA, ...ausentes], ignorados, periodoMx,
    netoCentavos: netoCalculado, categorias,
  };
}

// ── La lista completa ───────────────────────────────────────────────────────

/** Saca la lista de bitácoras del cuerpo según el envoltorio configurado. Lanza `EnvoltorioInvalido` si no coincide. */
export function listaDeMuestra(cuerpo: unknown, config: Pick<ConfigMuestraTms, 'envoltorio' | 'rutaLista'> = {}): unknown[] {
  const modo = config.envoltorio ?? 'auto';
  const ruta = config.rutaLista ?? 'data';
  if (Array.isArray(cuerpo)) {
    if (modo === 'envuelto') throw new EnvoltorioInvalido(`Se esperaba la lista en \`${ruta}\` y llegó un arreglo directo.`);
    return cuerpo;
  }
  if (modo === 'arreglo') throw new EnvoltorioInvalido('Se esperaba un arreglo directo de bitácoras.');
  if (esObjeto(cuerpo)) {
    const dentro = leerRuta(cuerpo, ruta);
    if (Array.isArray(dentro)) return dentro;
    if (modo === 'auto' && 'BitacoraID' in cuerpo) return [cuerpo];
    throw new EnvoltorioInvalido(`No hay una lista de bitácoras en \`${ruta}\`.`);
  }
  throw new EnvoltorioInvalido('El cuerpo tiene que ser un arreglo o un objeto con la lista de bitácoras.');
}

export interface ResultadoMuestra {
  resultados: ResultadoBitacoraMuestra[];
  /** Listas para el camino normal (desglose armado y sin motivos de revisión). */
  listas: DesgloseBitacora[];
  /** Todo lo demás: a revisión humana, con sus motivos. */
  enRevision: ResultadoBitacoraMuestra[];
}

/** Convierte la respuesta completa. Una bitácora mala no tumba a las demás. */
export function convertirMuestraTms(cuerpo: unknown, config: ConfigMuestraTms = {}): ResultadoMuestra {
  const resultados = listaDeMuestra(cuerpo, config).map((f) => convertirBitacoraMuestra(f, config));
  return {
    resultados,
    listas: resultados.flatMap((r) => (r.desglose !== null && !r.requiereRevision ? [r.desglose] : [])),
    enRevision: resultados.filter((r) => r.desglose === null || r.requiereRevision),
  };
}
