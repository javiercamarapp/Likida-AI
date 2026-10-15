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
//   3. nada: sin periodo la regla de extemporáneos NO se aplica y se avisa.
// El «No. de periodo» del archivo (745, 746…) es un consecutivo del proveedor, no
// una fecha: se guarda como referencia, pero no alcanza para calcular el inicio.
//
// PURO: sin base, sin red.
// ═══════════════════════════════════════════════════════════════════════════

export type OrigenPeriodo = 'declarado' | 'nombre_archivo';

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
 * septiembre de 2026», «21-30 oct 2026». `null` si el nombre no lo dice con
 * claridad (no se adivina). `fechas` solo ayuda a deducir el año cuando el nombre no lo trae.
 */
export function periodoDeNombreArchivo(nombre: string, fechas: readonly (string | null)[] = []): PeriodoArchivo | null {
  const n = sinAcentos(nombre).toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '');
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

/** El periodo de un archivo: lo declarado manda; si no, el nombre; si no, `null` (la regla de extemporáneos no se aplica). */
export function resolverPeriodo(entrada: {
  declarado?: { desde: string; hasta: string } | null;
  nombreArchivo?: string | null;
  fechas?: readonly (string | null)[];
}): PeriodoArchivo | null {
  if (entrada.declarado) {
    const v = validarPeriodoDeclarado(entrada.declarado.desde, entrada.declarado.hasta);
    if (v.ok) return v.periodo;
  }
  if (entrada.nombreArchivo) return periodoDeNombreArchivo(entrada.nombreArchivo, entrada.fechas ?? []);
  return null;
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
