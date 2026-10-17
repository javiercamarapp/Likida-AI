import { mxn } from '@/lib/formato';
import { ETIQUETA_CATEGORIA_COBRO, ROTULO_CANDIDATO, type CategoriaCobro } from './reglas_cobro';
import { ETIQUETA_CATEGORIA_TARIFA, type CategoriaTarifa } from './reglas_tarifa';
import { PLAZO_RECLAMO_MESES, DIAS_AVISO_VENCIMIENTO } from './reclamos_seguimiento';

// ═══════════════════════════════════════════════════════════════════════════
// INSIGHTS DE PEAJES (T-A2-26): «qué pasó / qué significa / qué hacer» por categoría
// de candidato, más los KPIs de la revisión de cobros.
//
// PURO: recibe agregados YA calculados por los módulos de revisión, reclamos, plazo,
// atípicos y vínculo con viaje; no consulta, no guarda y no decide nada que no esté en
// la entrada. Los textos son DETERMINISTAS (la IA puede explicarlos, no cambiarlos).
// Todo número lleva su fuente. Un dato que no existe es «sin dato» (`valor: null`),
// nunca un cero que parezca medición.
//
// Dos cosas que NO se mezclan:
//   · «% revisado»: candidatos ya atendidos (reclamado, descartado o justificado) entre
//     candidatos totales. Es lo que hace una persona.
//   · «cruces evaluados automáticamente»: cruces a los que se les pudo aplicar al menos
//     una regla entre cruces totales. Es lo que hace el sistema.
// El «~3 %» de revisión manual que dijo el cliente es una declaración suya, no una
// medición: aquí no aparece como cifra. Y el ahorro de tiempo NO se rotula como dato
// mientras falte la línea base de minutos que hoy dedica finanzas (BLOQUEO EXTERNO).
// ═══════════════════════════════════════════════════════════════════════════

export type CategoriaInsight = CategoriaCobro | CategoriaTarifa;

/** Orden fijo de las tarjetas: el mismo de las hojas del reporte para el portal. */
export const ORDEN_CATEGORIAS_INSIGHT: readonly CategoriaInsight[] = [
  'unidad_inmovilizada', 'clase_fuera_de_3_5', 'extemporaneo', 'duplicado_exacto', 'importe_sobre_tarifa', 'tag_dado_de_baja', 'caseta_no_debe_cruzarse',
];

export const ETIQUETA_CATEGORIA_INSIGHT: Record<CategoriaInsight, string> = { ...ETIQUETA_CATEGORIA_COBRO, ...ETIQUETA_CATEGORIA_TARIFA };

/** Palabras que nunca deben llegar a la pantalla del cliente (minúsculas). */
export const PALABRAS_PROHIBIDAS_INSIGHTS: readonly string[] = ['sección', 'ratio', 'null'];

export interface EntradaCategoriaInsight {
  categoria: CategoriaInsight;
  /** Candidatos de la categoría. */
  n: number;
  /** Dinero de esos candidatos (pesos). */
  monto: number;
  /** De ellos, los ya atendidos por una persona: reclamados + descartados + justificados. */
  atendidos: number;
  /** Solo para `importe_sobre_tarifa`: `false` = la tarifa se infirió de los archivos y nadie la confirmó. */
  tarifaConfirmada?: boolean;
}

export interface EntradaInsights {
  /** `evaluados` = cruces a los que se les pudo aplicar al menos una regla; `total` = cruces del periodo. */
  cruces: { total: number; evaluados: number };
  categorias: readonly EntradaCategoriaInsight[];
  /** De `resumirAcreditacion` (T-A2-17): lo reclamado, lo acreditado y la diferencia. */
  acreditacion: { reclamado: number; acreditado: number; diferencia: number };
  /** De `clasificarPlazos` (T-A2-16): lo que vence en los próximos 30 días; `null` = no disponible. */
  porVencer: { cruces: number; monto: number } | null;
  /** Hallazgos atípicos aún en estado «nuevo»; `null` = no disponible. */
  atipicosNuevos: number | null;
  /** Cruces sin viaje ligado; `null` = no disponible. */
  sinViaje: number | null;
}

export interface TarjetaInsight {
  id: string;
  titulo: string;
  quePaso: string;
  queSignifica: string;
  queHacer: string;
  n: number;
  monto: number;
  fuente: string;
}

export type FormatoKpi = 'cruces' | 'porcentaje' | 'pesos' | 'hallazgos';

export interface Kpi {
  id: string;
  titulo: string;
  /** `null` = sin dato (no se pudo medir): la pantalla lo muestra como «sin dato», no como 0. */
  valor: number | null;
  formato: FormatoKpi;
  detalle: string;
  fuente: string;
}

export interface KpiCruces extends Kpi { n: number; total: number }
export interface KpiMonto extends Kpi { monto: number | null }

export interface ResultadoInsights {
  tarjetas: TarjetaInsight[];
  kpis: {
    crucesEvaluados: KpiCruces;
    pctRevisado: Kpi;
    reclamado: Kpi;
    acreditado: Kpi;
    pendiente: Kpi;
    porVencer: KpiMonto;
    atipicosNuevos: Kpi;
    sinViaje: Kpi;
  };
  /** El % de ahorro de tiempo no existe como dato hasta tener la línea base del cliente. */
  ahorroDeTiempo: { disponible: false; motivo: string };
}

// ── Utilidades ──────────────────────────────────────────────────────────────

const FUENTE_REVISION = 'Revisión de cobros del archivo del proveedor';
const FUENTE_SEGUIMIENTO = 'Seguimiento de reclamos y notas de crédito';
const FUENTE_PLAZO = `Plazo de reclamo (${PLAZO_RECLAMO_MESES} meses)`;
const FUENTE_ATIPICOS = 'Detector de cruces atípicos';
const FUENTE_VIAJES = 'Cruce de casetas con viajes';

const r2 = (x: number) => Math.round(x * 100) / 100;
const entero = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
const dinero = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? r2(x) : 0);
const pct1 = (num: number, den: number): number => Math.round((num / den) * 1000) / 10;
const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);
const cruces = (n: number) => `${n} ${plural(n, 'cruce', 'cruces')}`;

// ── Textos por categoría (deterministas, lenguaje llano) ────────────────────

interface TextosCategoria {
  quePaso: (n: number, monto: string) => string;
  queSignifica: string;
  queHacer: string;
}

const TEXTOS: Record<CategoriaInsight, TextosCategoria> = {
  unidad_inmovilizada: {
    quePaso: (n, m) => `${cruces(n)} de unidades que estaban en taller, con siniestro o dadas de baja, por ${m}.`,
    queSignifica: `Una unidad inmovilizada no debería cruzar casetas: puede ser un cobro ajeno, un TAG usado en otra unidad o un dato de inmovilización desactualizado. ${ROTULO_CANDIDATO}.`,
    queHacer: 'Revisa primero estos cruces, porque son los más claros. Confirma que la unidad sí estaba detenida y, si es así, reclámalos al proveedor.',
  },
  clase_fuera_de_3_5: {
    quePaso: (n, m) => `${cruces(n)} cobrados con una clase distinta de las válidas para tu flota, por ${m}.`,
    queSignifica: `La clase cobrada no coincide con la que le toca a la unidad. Puede ser un error de cobro o una caseta que cobra por pasada. ${ROTULO_CANDIDATO}.`,
    queHacer: 'Marca como excepción las casetas que cobran por pasada. Reclama el resto al proveedor y sube el archivo por categoría.',
  },
  extemporaneo: {
    quePaso: (n, m) => `${cruces(n)} cobrados fuera del periodo del archivo, por ${m}.`,
    queSignifica: `El proveedor cobró un cruce de una fecha que no corresponde a esa decena. Puede ser un cobro tardío legítimo o un error. ${ROTULO_CANDIDATO}.`,
    queHacer: 'Compara la fecha del cruce con el periodo del archivo y reclama los que no se justifiquen antes de que venza el plazo.',
  },
  duplicado_exacto: {
    quePaso: (n, m) => `${cruces(n)} que se repiten con los mismos datos de fecha, hora, caseta y importe, por ${m}.`,
    queSignifica: `Dos cobros idénticos suelen ser un doble cobro, aunque pudo haber dos pasadas reales. ${ROTULO_CANDIDATO}.`,
    queHacer: 'Revisa que no haya sido una segunda pasada real y reclama el cobro repetido.',
  },
  importe_sobre_tarifa: {
    quePaso: (n, m) => `${cruces(n)} cobrados por arriba de la tarifa registrada, por ${m} de diferencia o cobro.`,
    queSignifica: `El importe es mayor que la tarifa de esa caseta y clase. ${ROTULO_CANDIDATO}.`,
    queHacer: 'Compara con la tarifa vigente de la caseta y reclama la diferencia al proveedor.',
  },
  tag_dado_de_baja: {
    quePaso: (n, m) => `${cruces(n)} de TAGs que ya se habían dado de baja, por ${m}.`,
    queSignifica: `Un TAG dado de baja no debería seguir cobrando: puede ser un cobro indebido o una baja mal registrada. ${ROTULO_CANDIDATO}.`,
    queHacer: 'Confirma la fecha de baja y reclama los cobros posteriores.',
  },
  caseta_no_debe_cruzarse: {
    quePaso: (n, m) => `${cruces(n)} en casetas que tu flota marcó como «no debe cruzarse», por ${m}.`,
    queSignifica: `La unidad pasó por una caseta que no está en su ruta. Puede ser un desvío del operador o un cobro ajeno. ${ROTULO_CANDIDATO}.`,
    queHacer: 'Pregunta al operador o revisa el viaje: si fue un desvío no se reclama al proveedor; si no, sí.',
  },
};

const SIGNIFICA_TARIFA_POR_CONFIRMAR =
  `La tarifa se tomó de los archivos anteriores y nadie la ha confirmado: la diferencia queda por confirmar. ${ROTULO_CANDIDATO}.`;
const QUE_HACER_TARIFA_POR_CONFIRMAR = 'Confirma la tarifa de esa caseta con un clic en Configuración; después la diferencia ya se puede reclamar.';

function tarjetaDe(e: EntradaCategoriaInsight): TarjetaInsight {
  const t = TEXTOS[e.categoria];
  const porConfirmar = e.categoria === 'importe_sobre_tarifa' && e.tarifaConfirmada !== true;
  return {
    id: e.categoria,
    titulo: ETIQUETA_CATEGORIA_INSIGHT[e.categoria],
    quePaso: t.quePaso(e.n, mxn(e.monto)),
    queSignifica: porConfirmar ? SIGNIFICA_TARIFA_POR_CONFIRMAR : t.queSignifica,
    queHacer: porConfirmar ? QUE_HACER_TARIFA_POR_CONFIRMAR : t.queHacer,
    n: e.n,
    monto: e.monto,
    fuente: FUENTE_REVISION,
  };
}

const TARJETA_SIN_CANDIDATOS: TarjetaInsight = {
  id: 'sin_candidatos',
  titulo: 'Nada que reclamar',
  quePaso: 'Con las reglas que tienes configuradas, no hay nada que reclamar en este archivo.',
  queSignifica: 'Ninguna regla encontró cobros dudosos. No significa que el archivo esté perfecto: solo se revisan las reglas activas.',
  queHacer: 'Si faltan reglas (tarifas, casetas que no deben cruzarse, TAGs dados de baja), agrégalas en Configuración y vuelve a revisar.',
  n: 0,
  monto: 0,
  fuente: FUENTE_REVISION,
};

// ── Cálculo ─────────────────────────────────────────────────────────────────

interface Agregado { n: number; monto: number; atendidos: number; tarifaConfirmada: boolean }

/** Suma categorías repetidas y sanea números: la entrada puede venir de varios archivos. */
function agregar(entradas: readonly EntradaCategoriaInsight[]): Map<CategoriaInsight, Agregado> {
  const m = new Map<CategoriaInsight, Agregado>();
  for (const e of entradas) {
    if (!ORDEN_CATEGORIAS_INSIGHT.includes(e.categoria)) continue;
    const a = m.get(e.categoria) ?? { n: 0, monto: 0, atendidos: 0, tarifaConfirmada: true };
    a.n += entero(e.n);
    a.monto += dinero(e.monto);
    a.atendidos += Math.min(entero(e.atendidos), entero(e.n));
    if (e.tarifaConfirmada !== true) a.tarifaConfirmada = false;
    m.set(e.categoria, a);
  }
  for (const a of m.values()) { a.monto = r2(a.monto); a.atendidos = Math.min(a.atendidos, a.n); }
  return m;
}

export function insightsDeCobros(entrada: EntradaInsights): ResultadoInsights {
  const agregadas = agregar(entrada.categorias);

  // Tarjetas
  const tarjetas: TarjetaInsight[] = [];
  let candidatos = 0;
  let atendidos = 0;
  for (const cat of ORDEN_CATEGORIAS_INSIGHT) {
    const a = agregadas.get(cat);
    if (!a || a.n === 0) continue;
    candidatos += a.n;
    atendidos += a.atendidos;
    tarjetas.push(tarjetaDe({ categoria: cat, n: a.n, monto: a.monto, atendidos: a.atendidos, tarifaConfirmada: a.tarifaConfirmada }));
  }
  if (tarjetas.length === 0) tarjetas.push({ ...TARJETA_SIN_CANDIDATOS });

  // Cruces evaluados automáticamente (lo que hace el sistema)
  const total = entero(entrada.cruces?.total);
  const evaluados = Math.min(entero(entrada.cruces?.evaluados), total);
  const crucesEvaluados: KpiCruces = {
    id: 'cruces_evaluados',
    titulo: 'Cruces evaluados automáticamente',
    valor: total > 0 ? pct1(evaluados, total) : null,
    formato: 'porcentaje',
    n: evaluados,
    total,
    detalle: total > 0
      ? `${evaluados} de ${total} cruces tuvieron al menos una regla aplicable.`
      : 'No hay cruces en el periodo: sin cruces no hay nada que evaluar.',
    fuente: FUENTE_REVISION,
  };

  // % revisado (lo que hace una persona), rotulado aparte
  const pctRevisado: Kpi = {
    id: 'pct_revisado',
    titulo: 'Candidatos revisados por una persona',
    valor: candidatos > 0 ? pct1(atendidos, candidatos) : null,
    formato: 'porcentaje',
    detalle: candidatos > 0
      ? `${atendidos} de ${candidatos} candidatos ya se reclamaron, descartaron o justificaron.`
      : 'No hay candidatos que revisar.',
    fuente: FUENTE_REVISION,
  };

  // Reclamado vs acreditado vs pendiente
  const reclamadoN = dinero(entrada.acreditacion?.reclamado);
  const acreditadoN = dinero(entrada.acreditacion?.acreditado);
  const pendienteN = r2(Math.max(0, reclamadoN - acreditadoN));
  const sinReclamos = reclamadoN === 0 && acreditadoN === 0;
  const reclamado: Kpi = {
    id: 'reclamado', titulo: 'Reclamado al proveedor', valor: reclamadoN, formato: 'pesos',
    detalle: sinReclamos ? 'Aún no has registrado ningún reclamo.' : `Suma de los reclamos registrados: ${mxn(reclamadoN)}.`,
    fuente: FUENTE_SEGUIMIENTO,
  };
  const acreditado: Kpi = {
    id: 'acreditado', titulo: 'Acreditado por el proveedor', valor: acreditadoN, formato: 'pesos',
    detalle: acreditadoN > reclamadoN
      ? 'Lo acreditado es mayor que lo reclamado: revisa si falta registrar un reclamo o la nota trae de más.'
      : sinReclamos ? 'Aún no hay notas de crédito confirmadas.' : `Notas de crédito confirmadas a mano: ${mxn(acreditadoN)}.`,
    fuente: FUENTE_SEGUIMIENTO,
  };
  const pendiente: Kpi = {
    id: 'pendiente', titulo: 'Pendiente de acreditar', valor: pendienteN, formato: 'pesos',
    detalle: pendienteN > 0 ? `Falta acreditar ${mxn(pendienteN)} de lo reclamado.` : 'No hay saldo pendiente de acreditar.',
    fuente: FUENTE_SEGUIMIENTO,
  };

  // Por vencer en ≤ 30 días
  const pv = entrada.porVencer;
  const porVencer: KpiMonto = pv
    ? {
        id: 'por_vencer', titulo: `Por vencer en ${DIAS_AVISO_VENCIMIENTO} días o menos`, valor: entero(pv.cruces), monto: dinero(pv.monto), formato: 'cruces',
        detalle: entero(pv.cruces) > 0
          ? `${cruces(entero(pv.cruces))} (${mxn(dinero(pv.monto))}) pierden el derecho a reclamo pronto: el plazo es de ${PLAZO_RECLAMO_MESES} meses.`
          : `Ningún cruce vence en los próximos ${DIAS_AVISO_VENCIMIENTO} días.`,
        fuente: FUENTE_PLAZO,
      }
    : {
        id: 'por_vencer', titulo: `Por vencer en ${DIAS_AVISO_VENCIMIENTO} días o menos`, valor: null, monto: null, formato: 'cruces',
        detalle: 'Dato no disponible: falta la fecha base del plazo.', fuente: FUENTE_PLAZO,
      };

  const atipicos: Kpi = entrada.atipicosNuevos === null || entrada.atipicosNuevos === undefined
    ? { id: 'atipicos_nuevos', titulo: 'Cruces atípicos nuevos', valor: null, formato: 'hallazgos', detalle: 'Dato no disponible: el detector de atípicos no se ha corrido.', fuente: FUENTE_ATIPICOS }
    : {
        id: 'atipicos_nuevos', titulo: 'Cruces atípicos nuevos', valor: entero(entrada.atipicosNuevos), formato: 'hallazgos',
        detalle: entero(entrada.atipicosNuevos) > 0 ? `${entero(entrada.atipicosNuevos)} ${plural(entero(entrada.atipicosNuevos), 'hallazgo nuevo', 'hallazgos nuevos')} sin revisar.` : 'No hay hallazgos atípicos nuevos.',
        fuente: FUENTE_ATIPICOS,
      };

  const sinViaje: Kpi = entrada.sinViaje === null || entrada.sinViaje === undefined
    ? { id: 'sin_viaje', titulo: 'Cruces sin viaje', valor: null, formato: 'cruces', detalle: 'Dato no disponible: el cruce con viajes no está activo.', fuente: FUENTE_VIAJES }
    : {
        id: 'sin_viaje', titulo: 'Cruces sin viaje', valor: entero(entrada.sinViaje), formato: 'cruces',
        detalle: entero(entrada.sinViaje) > 0 ? `${cruces(entero(entrada.sinViaje))} no se pudieron ligar a ningún viaje.` : 'Todos los cruces se ligaron a un viaje.',
        fuente: FUENTE_VIAJES,
      };

  return {
    tarjetas,
    kpis: { crucesEvaluados, pctRevisado, reclamado, acreditado, pendiente, porVencer, atipicosNuevos: atipicos, sinViaje },
    ahorroDeTiempo: {
      disponible: false,
      motivo: 'Falta la línea base de minutos que hoy dedica finanzas a revisar peajes; sin ella no se puede mostrar un ahorro defendible.',
    },
  };
}
