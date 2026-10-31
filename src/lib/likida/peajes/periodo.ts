// ═══════════════════════════════════════════════════════════════════════════
// EL PERIODO DE UN ARCHIVO DE PEAJES — de dónde sale el INICIO que decide qué
// cobro es «extemporáneo».
//
// El proveedor manda un corte DECENAL («01 A 10 DE SEPT», «11 A 20», «21 A 30»).
// Un cruce con fecha ANTERIOR al inicio de su decena es un cobro que llegó tarde
// (extemporáneo). El periodo MEDIDO (min/max de las fechas de las líneas) NO sirve
// para eso: el extemporáneo lo ensancha y el mínimo se volvería el «inicio».
//
// Orden de fuentes, de la más firme a la más débil — y NUNCA se inventa:
//   1. el periodo que DECLARA la persona al subir el archivo;
//   2. el que dice el NOMBRE del archivo («01 A 10 DE SEPT», «del 11 al 20 de
//      septiembre 2026»); el año sale del nombre o, si no lo trae, del año en que
//      cae la mayoría de las fechas de las líneas;
//   3. (A2 ola 1) cuando el nombre no lo dice —un archivo que llega por correo, API o SFTP con
//      otro nombre—, se INFIERE, siempre marcado como inferido (nunca se presenta como declarado):
//        a. por el «No. de periodo» (745, 746…): es un consecutivo del proveedor, no una fecha; sirve
//           contando decenas desde OTRO archivo de la flota cuyo periodo sí se conoce (declarado o por
//           nombre) y solo se acepta si la mayoría de las fechas del archivo cae en esa decena;
//        b. por la decena DOMINANTE: la decena (1–10, 11–20, 21–fin) donde cae casi todo el archivo.
//           Los extemporáneos son pocos y caen antes, por eso la mayoría manda y el mínimo no;
//   4. nada: sin periodo la regla de extemporáneos NO se aplica y se avisa.
//
// PURO: sin base, sin red.
// ═══════════════════════════════════════════════════════════════════════════

export type OrigenPeriodo = 'declarado' | 'nombre_archivo' | 'no_periodo' | 'decena_dominante';

/** Los orígenes que son una INFERENCIA del sistema (la persona no los dijo): la pantalla los rotula y pide confirmarlos. */
export const ORIGENES_INFERIDOS: readonly OrigenPeriodo[] = ['no_periodo', 'decena_dominante'];
export const esPeriodoInferido = (o: string | null | undefined): boolean => (ORIGENES_INFERIDOS as readonly string[]).includes(o ?? '');

export interface PeriodoArchivo {
  /** ISO YYYY-MM-DD (inclusive). */
  desde: string;
  hasta: string;
  origen: OrigenPeriodo;
}

const MESES: Record<string, number> = {
  ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, may: 5, mayo: 5,
  jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8, sep: 9, sept: 9, septiembre: 9, set: 9,
  oct: 10, octubre: 10, nov: 11, noviembre: 11, dic: 12, diciembre: 12,
};

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

function iso(anio: number, mes: number, dia: number): string | null {
  if (anio < 2000 || anio > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > diasDelMes(anio, mes)) return null;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** El año en que cae la MAYORÍA de las fechas (un extemporáneo de diciembre en un archivo de enero no cambia la moda). */
function anioModa(fechas: readonly (string | null)[]): number | null {
  const cuenta = new Map<number, number>();
  for (const f of fechas) {
    if (!f) continue;
    const a = Number(f.slice(0, 4));
    if (Number.isInteger(a)) cuenta.set(a, (cuenta.get(a) ?? 0) + 1);
  }
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * El periodo que dice el NOMBRE del archivo: «01 A 10 DE SEPT.xlsx», «11 al 20 de
 * septiembre de 2026», «21-30 oct 2026», o el rango ISO del conector del TMS («…-2026-09-01-2026-09-10.csv»). `null` si el nombre no lo dice con
 * claridad (no se adivina). `fechas` solo ayuda a deducir el año cuando el nombre no lo trae.
 */
export function periodoDeNombreArchivo(nombre: string, fechas: readonly (string | null)[] = []): PeriodoArchivo | null {
  const n = sinAcentos(nombre).toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '');
  // El rango en ISO que el conector del TMS pone en el nombre del archivo que arma («tms-peajes-2026-09-01-2026-09-10.csv»): la ventana pedida a la API.
  const iso2 = /(\d{4})-(\d{2})-(\d{2})[^0-9]{1,4}(\d{4})-(\d{2})-(\d{2})/.exec(n);
  if (iso2) {
    const d1 = iso(Number(iso2[1]), Number(iso2[2]), Number(iso2[3]));
    const d2 = iso(Number(iso2[4]), Number(iso2[5]), Number(iso2[6]));
    return d1 && d2 && d1 <= d2 ? { desde: d1, hasta: d2, origen: 'nombre_archivo' } : null;
  }
  // eslint-disable-next-line security/detect-unsafe-regex -- nombre de archivo acotado (<= 255 por el SO)
  const m = /(?:^|[^0-9])(\d{1,2})\s*(?:a|al|-|–)\s*(\d{1,2})\s*(?:de\s+)?([a-z]{3,10})\.?(?:\s*(?:de\s+)?(\d{4}))?/.exec(n);
  if (!m) return null;
  const mes = MESES[m[3]];
  if (!mes) return null;
  const anio = m[4] ? Number(m[4]) : anioModa(fechas);
  if (anio === null) return null;
  const d1 = Number(m[1]);
  const d2 = Number(m[2]);
  const desde = iso(anio, mes, d1);
  const hasta = iso(anio, mes, Math.min(d2, diasDelMes(anio, mes)));
  if (!desde || !hasta || desde > hasta) return null;
  return { desde, hasta, origen: 'nombre_archivo' };
}

/** Valida un periodo declarado (YYYY-MM-DD ambos, desde <= hasta). */
export function validarPeriodoDeclarado(desde: unknown, hasta: unknown): { ok: true; periodo: PeriodoArchivo } | { ok: false; motivo: string } {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof desde !== 'string' || typeof hasta !== 'string' || !re.test(desde) || !re.test(hasta)) {
    return { ok: false, motivo: 'El periodo debe llevar fecha de inicio y de fin (AAAA-MM-DD).' };
  }
  const ok = (f: string) => iso(Number(f.slice(0, 4)), Number(f.slice(5, 7)), Number(f.slice(8, 10))) === f;
  if (!ok(desde) || !ok(hasta)) return { ok: false, motivo: 'Una de las fechas del periodo no existe en el calendario.' };
  if (desde > hasta) return { ok: false, motivo: 'El inicio del periodo no puede ser posterior a su fin.' };
  return { ok: true, periodo: { desde, hasta, origen: 'declarado' } };
}

/** Cómo se llegó al periodo, en llano. Un origen inferido lo dice y pide confirmarlo. */
export function rotuloOrigenPeriodo(origen: string | null | undefined, declarado = 'declarado'): string {
  if (origen === 'declarado') return declarado;
  if (origen === 'no_periodo') return 'inferido por el «No. de periodo»: confírmalo o decláralo';
  if (origen === 'decena_dominante') return 'inferido por la decena donde cae casi todo el archivo: confírmalo o decláralo';
  return 'tomado del nombre del archivo';
}

/** Qué parte del mes es el día: decena 0 = 1–10, 1 = 11–20, 2 = 21–fin. */
const decenaDeDia = (dia: number): number => Math.min(2, Math.floor((dia - 1) / 10));

/** Índice absoluto de la decena de una fecha ISO (3 por mes): permite contar decenas entre dos archivos. */
export function indiceDecena(fecha: string): number | null {
  const a = Number(fecha.slice(0, 4)); const m = Number(fecha.slice(5, 7)); const d = Number(fecha.slice(8, 10));
  if (iso(a, m, d) !== fecha) return null;
  return (a * 12 + (m - 1)) * 3 + decenaDeDia(d);
}

/** La decena (desde/hasta ISO) de un índice absoluto. */
function decenaDeIndice(idx: number): { desde: string; hasta: string } {
  const dec = ((idx % 3) + 3) % 3;
  const meses = (idx - dec) / 3;
  const anio = Math.floor(meses / 12);
  const mes = (meses % 12) + 1;
  const ult = diasDelMes(anio, mes);
  const p = (n: number) => String(n).padStart(2, '0');
  const ini = dec * 10 + 1;
  return { desde: `${anio}-${p(mes)}-${p(ini)}`, hasta: `${anio}-${p(mes)}-${p(dec === 2 ? ult : ini + 9)}` };
}

/** Cuántas de las fechas caen dentro de [desde, hasta], y cuántas son legibles. */
function dentroDe(fechas: readonly (string | null)[], desde: string, hasta: string): { dentro: number; total: number } {
  let dentro = 0; let total = 0;
  for (const f of fechas) {
    if (!f) continue;
    total++;
    if (f >= desde && f <= hasta) dentro++;
  }
  return { dentro, total };
}

/** Mínimo de líneas con fecha para inferir algo: con tres cruces no hay mayoría que valga. */
export const MIN_LINEAS_INFERENCIA = 30;
/** Fracción de las fechas que debe caer en la decena para llamarla «dominante». */
export const UMBRAL_DECENA_DOMINANTE = 0.85;
/** Fracción mínima que debe cuadrar con la decena sacada del «No. de periodo» para aceptarla: la MISMA que la decena dominante (la numeración del proveedor no está confirmada; con 50 % una coincidencia de casualidad asignaría un periodo equivocado y movería la regla de extemporáneos y los plazos de reclamo). */
export const UMBRAL_NO_PERIODO = UMBRAL_DECENA_DOMINANTE;

/**
 * La decena donde cae casi todo el archivo (≥ 85 % de las fechas legibles, con al menos `MIN_LINEAS_INFERENCIA`). Un cobro
 * extemporáneo es de una decena ANTERIOR y pocos: no mueve la mayoría. `null` si ninguna decena domina (no se adivina).
 */
export function periodoPorDecenaDominante(fechas: readonly (string | null)[]): PeriodoArchivo | null {
  const cuenta = new Map<number, number>();
  let total = 0;
  for (const f of fechas) {
    if (!f) continue;
    const i = indiceDecena(f);
    if (i === null) continue;
    total++;
    cuenta.set(i, (cuenta.get(i) ?? 0) + 1);
  }
  if (total < MIN_LINEAS_INFERENCIA) return null;
  const [idx, n] = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0];
  if (n / total < UMBRAL_DECENA_DOMINANTE) return null;
  const d = decenaDeIndice(idx);
  return { desde: d.desde, hasta: d.hasta, origen: 'decena_dominante' };
}

/** Un archivo de la misma flota cuyo «No. de periodo» y cuyo periodo SÍ se conocen (declarado o por nombre). */
export interface AnclaPeriodo { noPeriodo: number; desde: string }

/**
 * La decena que corresponde a un «No. de periodo» contando decenas desde un archivo ancla de la misma flota. El número es un
 * consecutivo del proveedor que NO se ha confirmado que avance una unidad por decena: por eso solo se acepta si al menos el 85 % de las
 * fechas del archivo cae en la decena resultante (`UMBRAL_NO_PERIODO`); si no, `null`. Siempre queda marcado como inferido.
 */
export function periodoPorNoPeriodo(
  noPeriodo: string | null | undefined, ancla: AnclaPeriodo | null | undefined, fechas: readonly (string | null)[],
): PeriodoArchivo | null {
  const n = /^\d{1,6}$/.test((noPeriodo ?? '').trim()) ? Number((noPeriodo ?? '').trim()) : null;
  if (n === null || !ancla) return null;
  const base = indiceDecena(ancla.desde);
  if (base === null) return null;
  const d = decenaDeIndice(base + (n - ancla.noPeriodo));
  const { dentro, total } = dentroDe(fechas, d.desde, d.hasta);
  if (total < MIN_LINEAS_INFERENCIA || dentro / total < UMBRAL_NO_PERIODO) return null;
  return { desde: d.desde, hasta: d.hasta, origen: 'no_periodo' };
}

/**
 * El periodo de un archivo: lo declarado manda; si no, el nombre; si no, se INFIERE (primero por el «No. de periodo» contra un archivo ancla,
 * luego por la decena dominante) y queda marcado como inferido; si no, `null` (la regla de extemporáneos no se aplica).
 */
export function resolverPeriodo(entrada: {
  declarado?: { desde: string; hasta: string } | null;
  nombreArchivo?: string | null;
  fechas?: readonly (string | null)[];
  noPeriodo?: string | null;
  ancla?: AnclaPeriodo | null;
}): PeriodoArchivo | null {
  if (entrada.declarado) {
    const v = validarPeriodoDeclarado(entrada.declarado.desde, entrada.declarado.hasta);
    if (v.ok) return v.periodo;
  }
  const porNombre = entrada.nombreArchivo ? periodoDeNombreArchivo(entrada.nombreArchivo, entrada.fechas ?? []) : null;
  if (porNombre) return porNombre;
  return periodoPorNoPeriodo(entrada.noPeriodo, entrada.ancla, entrada.fechas ?? []) ?? periodoPorDecenaDominante(entrada.fechas ?? []);
}

/** «2026-09» de una fecha ISO. */
export const mesDeFecha = (f: string): string => f.slice(0, 7);

/** El primer y último día de un mes «AAAA-MM». */
export function limitesDelMes(mes: string): { desde: string; hasta: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!m) return null;
  const a = Number(m[1]);
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  return { desde: `${m[1]}-${m[2]}-01`, hasta: `${m[1]}-${m[2]}-${String(diasDelMes(a, mm)).padStart(2, '0')}` };
}

/** El mes anterior de «AAAA-MM». */
export function mesAnterior(mes: string): string | null {
  const l = limitesDelMes(mes);
  if (!l) return null;
  let a = Number(mes.slice(0, 4));
  let m = Number(mes.slice(5, 7)) - 1;
  if (m === 0) { m = 12; a -= 1; }
  return `${a}-${String(m).padStart(2, '0')}`;
}

/** Los últimos `n` meses «AAAA-MM» hasta el de `hoy` (inclusive), del más reciente al más viejo: lo que ofrece el selector de mes. */
export function mesesRecientes(hoy: string, n = 12): string[] {
  const out: string[] = [];
  let m: string | null = hoy.slice(0, 7);
  if (!limitesDelMes(m)) return out;
  while (m && out.length < n) { out.push(m); m = mesAnterior(m); }
  return out;
}

/** Las tres decenas de un mes: 1–10, 11–20, 21–fin. */
export function decenasDelMes(mes: string): Array<{ desde: string; hasta: string; etiqueta: string }> {
  const l = limitesDelMes(mes);
  if (!l) return [];
  return [
    { desde: `${mes}-01`, hasta: `${mes}-10`, etiqueta: '1 a 10' },
    { desde: `${mes}-11`, hasta: `${mes}-20`, etiqueta: '11 a 20' },
    { desde: `${mes}-21`, hasta: l.hasta, etiqueta: `21 a ${l.hasta.slice(8)}` },
  ];
}

/** Suma `n` meses a una fecha ISO sin desbordar el fin de mes (31-ene + 1 mes = 28/29-feb). */
export function sumarMeses(fechaIso: string, n: number): string {
  const a = Number(fechaIso.slice(0, 4));
  const m = Number(fechaIso.slice(5, 7)) - 1 + n;
  const d = Number(fechaIso.slice(8, 10));
  const anio = a + Math.floor(m / 12);
  const mes = ((m % 12) + 12) % 12 + 1;
  const dia = Math.min(d, diasDelMes(anio, mes));
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Días enteros de `a` a `b` (b - a), ambos ISO. */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
