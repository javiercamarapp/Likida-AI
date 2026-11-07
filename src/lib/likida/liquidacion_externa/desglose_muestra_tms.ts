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
//   · Lo que la muestra NO trae queda «no disponible» (`noDisponible`): nº de liquidación, nº de pago, póliza, terminal,
//     nº de empleado, tipo de operador, ID de concepto, correo/mensajería, marca «enviado», neto de origen. Ninguno se rellena.
//     Los que las guardas existentes ya vigilan siguen su camino normal: póliza nula ⇒ excepción `sin_poliza` (no se
//     envía); tipo de operador ausente ⇒ `tipo_sin_regla` (retenido) — ver `desglose_recibir.ts` / `desglose_reglas.ts`.
//   · El operador viene solo por NOMBRE. Se resuelve contra el padrón INYECTADO por coincidencia exacta normalizada
//     (sin acentos, mayúsculas ni espacios de más): una única persona ⇒ su nº de empleado; ninguna o varias ⇒ REVISIÓN
//     HUMANA (`operador_no_encontrado` / `operador_homonimo`). Jamás se adivina entre homónimos ni por parecido.
//   · Montos: llegan como número JSON con ≤ 2 decimales. Se leen por su representación en TEXTO (`String(n)`, que es la
//     más corta que ida y vuelta), sin multiplicar flotantes. Más de 2 decimales, negativo, null, NaN/Infinity o texto ⇒
//     revisión (no se redondea ni se interpreta). CONVENCIÓN: ambos bloques traen montos POSITIVOS; el bloque da el signo
//     (Percepciones suman, Deducciones restan), igual que `DesgloseBitacora`. Monto 0 ⇒ renglón ignorado con nota.
//   · Cuadre: la muestra no trae neto de origen, así que Σ percepciones − Σ deducciones se calcula en CENTAVOS y el
//     chequeo posterior (`aLiquidacionExterna`) es tautológico (`totalOrigen: 'calculado'`). No demuestra que el TMS lo
//     calculó igual; la UI debe decirlo así. Un neto negativo lo retiene la guarda existente `neto_negativo`.
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
import { aLiquidacionExterna, validarDesgloseBitacora, type DesgloseBitacora, type RenglonBitacora } from './desglose_contrato';
import { leerRuta, normalizarUnidad } from './desglose_mapeo_tms';
import { normalizarConcepto } from './desglose_reglas';

export const CONTRATO_MUESTRA_TMS = 'muestra-tms';
export const ZONA_MUESTRA_TMS = TZ_MX;
const SISTEMA_ORIGEN_MUESTRA = 'tms-muestra-tms';

/** Lo que este contrato NO trae y por tanto queda marcado «no disponible» en cada resultado. */
export const NO_DISPONIBLE_MUESTRA = [
  'numeroLiquidacion', 'numeroPago', 'poliza', 'terminal', 'numeroEmpleado', 'tipoOperador', 'idConcepto',
  'correoOperador', 'mensajeriaOperador', 'enviadoOrigen', 'neto',
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
  /** Padrón de operadores contra el que se resuelve el NOMBRE. Sin padrón, ningún desglose queda listo. */
  padron?: PadronOperadores;
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
interface Concepto { categoria: string; lado: Lado; patron: RegExp }

/**
 * Alias sobre el texto YA normalizado (sin acentos, minúsculas). Es heurístico y editable: lo que no case NO se descarta, pasa
 * a revisión. «diésel/urea» es categoría `otros` (la presentación lo renombra con la regla del contralor, `RENOMBRE_EJEMPLO`).
 */
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
];

function reconocer(descripcion: string): Concepto | null {
  const n = normalizarConcepto(descripcion);
  return CATALOGO_CONCEPTOS_MUESTRA.find((c) => c.patron.test(n)) ?? null;
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

// ── Una bitácora ────────────────────────────────────────────────────────────

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function textoPlano(v: unknown): string | null {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function bitacoraIdDe(v: unknown): string | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? String(v) : null;
  if (typeof v === 'string' && /^[1-9]\d{0,17}$/.test(v.trim())) return v.trim();
  return null;
}

/** Convierte UNA bitácora de la muestra. Nunca lanza por datos malos: los reporta en `revision`. */
export function convertirBitacoraMuestra(raw: unknown, config: Pick<ConfigMuestraTms, 'padron'> = {}): ResultadoBitacoraMuestra {
  const revision: MotivoRevision[] = [];
  const ignorados: Array<{ donde: string; motivo: string }> = [];
  const categorias: Array<{ donde: string; categoria: string }> = [];
  const motivo = (codigo: CodigoRevision, campo: string, detalle: string) => { revision.push({ codigo, campo, detalle }); };
  const vacio = (bitacoraId: string): ResultadoBitacoraMuestra => ({
    bitacoraId, desglose: null, revision, requiereRevision: true, noDisponible: NO_DISPONIBLE_MUESTRA, ignorados, periodoMx: null, netoCentavos: null, categorias,
  });

  if (!esObjeto(raw)) {
    motivo('fila_invalida', 'cuerpo', 'La fila no es un objeto.');
    return vacio('');
  }

  // BitacoraID
  const bitacora = bitacoraIdDe(raw.BitacoraID);
  if (bitacora === null) motivo('bitacora_invalida', 'BitacoraID', 'BitacoraID tiene que ser un entero mayor que cero.');

  // Operador (solo nombre)
  const nombreCrudo = textoPlano(raw.Operador);
  if (nombreCrudo === null || nombreCrudo === '') motivo('operador_vacio', 'Operador', 'El nombre del operador viene vacío.');

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
      const c = reconocer(desc);
      if (c === null) motivo('concepto_desconocido', `${donde}.Descripcion`, 'Descripción que no está en el catálogo de conceptos; revisar (el renglón se conserva).');
      else {
        categorias.push({ donde, categoria: c.categoria });
        if (c.lado !== lado) motivo('concepto_lado_inesperado', `${donde}.Descripcion`, `Concepto «${c.categoria}» llega en ${clave}; normalmente va del otro lado.`);
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

  // Operador contra padrón (solo si el nombre es legible)
  let operador: OperadorPadron | null = null;
  if (nombreCrudo !== null && nombreCrudo !== '') {
    const r = resolverOperadorPorNombre(nombreCrudo, config.padron);
    if (r.ok) operador = r.operador;
    else motivo(r.codigo, 'Operador', r.codigo === 'operador_homonimo'
      ? 'Más de una persona del padrón coincide con ese nombre; no se adivina: revisión humana.'
      : r.codigo === 'operador_sin_padron' ? 'No hay padrón de operadores contra el cual resolver el nombre.'
        : r.codigo === 'operador_sin_numero' ? 'El operador del padrón que coincide no tiene número de empleado; hay que capturarlo.'
          : 'Ningún operador del padrón coincide con ese nombre.');
  }

  // ¿Hay lo mínimo para armar un desglose interno válido?
  if (bitacora === null || operador === null || desde === null || hasta === null || montosMalos || bloques.percepcion.length + bloques.deduccion.length === 0) {
    return vacio(bitacora ?? '');
  }
  let desglose: DesgloseBitacora;
  try {
    desglose = validarDesgloseBitacora({
      bitacora,
      poliza: null, // no disponible: la guarda `sin_poliza` existente decide, no se inventa
      operador: { numeroEmpleado: operador.numeroEmpleado.trim(), nombre: nombreCrudo },
      ...(unidad !== undefined ? { unidad } : {}),
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
    bitacoraId: bitacora, desglose, revision, requiereRevision: revision.length > 0, noDisponible: NO_DISPONIBLE_MUESTRA, ignorados, periodoMx,
    netoCentavos: centavosPorBloque.percepcion - centavosPorBloque.deduccion, categorias,
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
